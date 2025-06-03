import { z } from 'zod';
import { WhisperIntegration } from '../whisper/integration.js';
import { AudioConverter } from '../utils/audio-converter.js';
import { TranscriptionAssembler, ChunkTranscription } from '../utils/transcription-assembler.js';
import { TranscribeOptionsSchema, TranscribeOptions } from '../types/index.js';
import { unlinkSync } from 'fs';

const TranscribeLongArgsSchema = z.object({
  audio_path: z.string().describe('Path to the audio file to transcribe'),
  options: TranscribeOptionsSchema.optional().describe('Transcription options'),
  chunk_duration_minutes: z.number().min(1).max(30).optional().default(10).describe('Duration of each chunk in minutes'),
  overlap_seconds: z.number().min(0).max(120).optional().default(30).describe('Overlap between chunks in seconds'),
  auto_cleanup: z.boolean().optional().default(true).describe('Automatically clean up temporary files'),
  progress_callback: z.boolean().optional().default(true).describe('Report progress during transcription')
});

type TranscribeLongArgs = z.infer<typeof TranscribeLongArgsSchema>;

export const transcribeLongTool = {
  name: 'transcribe_long',
  description: 'Transcribe long audio files with automatic splitting, format conversion, and context preservation',
  inputSchema: {
    type: 'object',
    properties: {
      audio_path: {
        type: 'string',
        description: 'Path to the audio file to transcribe'
      },
      options: {
        type: 'object',
        description: 'Transcription options',
        properties: {
          model: { type: 'string', default: 'base.en' },
          language: { type: 'string', default: 'auto' },
          output_format: { type: 'string', default: 'txt' },
          temperature: { type: 'number', default: 0 },
          threads: { type: 'number', default: 4 },
          translate: { type: 'boolean', default: false },
          word_timestamps: { type: 'boolean', default: false }
        }
      },
      chunk_duration_minutes: {
        type: 'number',
        minimum: 1,
        maximum: 30,
        default: 10,
        description: 'Duration of each chunk in minutes'
      },
      overlap_seconds: {
        type: 'number',
        minimum: 0,
        maximum: 120,
        default: 30,
        description: 'Overlap between chunks in seconds'
      },
      auto_cleanup: {
        type: 'boolean',
        default: true,
        description: 'Automatically clean up temporary files'
      },
      progress_callback: {
        type: 'boolean',
        default: true,
        description: 'Report progress during transcription'
      }
    },
    required: ['audio_path']
  },
  
  async handler(args: TranscribeLongArgs) {
    const whisper = new WhisperIntegration();
    const converter = new AudioConverter();
    const assembler = new TranscriptionAssembler();
    
    const {
      audio_path,
      options,
      chunk_duration_minutes,
      overlap_seconds,
      auto_cleanup,
      progress_callback
    } = args;

    // Use provided options (defaults will be applied by WhisperIntegration)
    const transcribeOptions = options;

    const chunkDurationSeconds = chunk_duration_minutes * 60;
    let tempFiles: string[] = [];

    try {
      // Step 1: Check if ffmpeg is available for format conversion
      const ffmpegAvailable = await converter.checkFfmpegInstallation();
      if (!ffmpegAvailable) {
        throw new Error('ffmpeg is required for audio format conversion. Install with: brew install ffmpeg');
      }

      // Step 2: Get audio information
      const audioInfo = await converter.getAudioInfo(audio_path);
      const estimatedProcessingTime = Math.ceil(audioInfo.duration / 24); // Based on 24x real-time speed
      
      if (progress_callback) {
        console.error(`Audio duration: ${Math.ceil(audioInfo.duration / 60)} minutes`);
        console.error(`Estimated processing time: ${Math.ceil(estimatedProcessingTime / 60)} minutes`);
        console.error(`Format: ${audioInfo.format}, Sample rate: ${audioInfo.sampleRate}Hz`);
      }

      // Step 3: Convert to WAV if needed
      let processedAudioPath = audio_path;
      if (!converter.isWhisperCompatible(audio_path)) {
        if (progress_callback) {
          console.error('Converting audio to WAV format...');
        }
        processedAudioPath = await converter.convertToWav(audio_path);
        tempFiles.push(processedAudioPath);
      }

      // Step 4: Split audio into chunks if needed
      let audioChunks: string[];
      if (audioInfo.duration > chunkDurationSeconds) {
        if (progress_callback) {
          console.error(`Splitting audio into ${chunk_duration_minutes}-minute chunks with ${overlap_seconds}s overlap...`);
        }
        audioChunks = await converter.splitAudio(processedAudioPath, chunkDurationSeconds, overlap_seconds);
        tempFiles.push(...audioChunks.filter(chunk => chunk !== processedAudioPath));
      } else {
        audioChunks = [processedAudioPath];
      }

      if (progress_callback) {
        console.error(`Processing ${audioChunks.length} audio chunks...`);
      }

      // Step 5: Transcribe each chunk
      const chunkTranscriptions: ChunkTranscription[] = [];
      
      for (let i = 0; i < audioChunks.length; i++) {
        const chunkPath = audioChunks[i];
        const startOffset = i * chunkDurationSeconds - (i > 0 ? overlap_seconds : 0);
        
        if (progress_callback) {
          console.error(`Transcribing chunk ${i + 1}/${audioChunks.length}...`);
        }

        try {
          const chunkResult = await whisper.transcribe(chunkPath, transcribeOptions);
          
          chunkTranscriptions.push({
            chunkIndex: i,
            startOffset: startOffset,
            result: chunkResult
          });

          if (progress_callback) {
            console.error(`Chunk ${i + 1} completed (${chunkResult.processing_time}ms)`);
          }
        } catch (error) {
          throw new Error(`Failed to transcribe chunk ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Step 6: Assemble transcriptions
      if (progress_callback) {
        console.error('Assembling final transcription...');
      }

      const assembledResult = assembler.assembleTranscriptions(chunkTranscriptions, {
        overlapSeconds: overlap_seconds,
        removeOverlapDuplicates: true,
        preserveTimestamps: transcribeOptions?.word_timestamps || transcribeOptions?.output_format === 'vtt' || transcribeOptions?.output_format === 'srt'
      });

      // Step 7: Format output
      const formattedOutput = assembler.formatOutput(assembledResult, transcribeOptions?.output_format || 'txt');

      // Step 8: Cleanup temporary files
      if (auto_cleanup) {
        for (const tempFile of tempFiles) {
          try {
            unlinkSync(tempFile);
          } catch (error) {
            // Ignore cleanup errors
          }
        }
      }

      // Step 9: Prepare response
      const responseData = {
        transcription: formattedOutput,
        metadata: {
          model_used: assembledResult.model_used,
          language: assembledResult.language,
          processing_time: assembledResult.processing_time,
          total_chunks: audioChunks.length,
          audio_duration_seconds: audioInfo.duration,
          audio_format: audioInfo.format,
          chunk_duration_minutes: chunk_duration_minutes,
          overlap_seconds: overlap_seconds,
          segments_count: assembledResult.segments?.length || 0,
          temp_files_created: tempFiles.length,
          temp_files_cleaned: auto_cleanup
        }
      };

      if (progress_callback) {
        console.error('Transcription completed successfully!');
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(responseData, null, 2)
        }]
      };

    } catch (error) {
      // Cleanup on error
      if (auto_cleanup) {
        for (const tempFile of tempFiles) {
          try {
            unlinkSync(tempFile);
          } catch {
            // Ignore cleanup errors
          }
        }
      }

      throw new Error(`Long transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};