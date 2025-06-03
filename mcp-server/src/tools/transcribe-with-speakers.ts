import { z } from 'zod';
import { join } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { WhisperIntegration } from '../whisper/integration.js';
import { AudioConverter } from '../utils/audio-converter.js';
import { DiarizationPythonManager } from '../utils/diarization-python.js';
import { DiarizationAlignment } from '../utils/diarization-alignment.js';
import { DiarizationOptionsSchema, DiarizationResult, DiarizationError, TranscriptionResult } from '../types/index.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TranscribeWithSpeakersArgsSchema = z.object({
  audio_file_path: z.string().describe('Path to the audio file to transcribe with speaker diarization'),
  options: DiarizationOptionsSchema.optional().describe('Diarization and transcription options'),
  auto_convert: z.boolean().optional().default(true).describe('Automatically convert unsupported formats to WAV')
});

type TranscribeWithSpeakersArgs = z.infer<typeof TranscribeWithSpeakersArgsSchema>;

// Helper function to convert whisper.cpp JSON output to TranscriptionResult
function convertWhisperToTranscriptionResult(whisperOutput: any): TranscriptionResult {
  const segments = [];
  
  if (whisperOutput.transcription && Array.isArray(whisperOutput.transcription)) {
    for (const segment of whisperOutput.transcription) {
      if (segment.offsets && segment.text) {
        segments.push({
          start: segment.offsets.from / 1000, // Convert milliseconds to seconds
          end: segment.offsets.to / 1000,
          text: segment.text.trim()
        });
      }
    }
  }
  
  // Extract full text - clean up timestamp format if present
  let fullText = whisperOutput.text || '';
  if (whisperOutput.transcription) {
    fullText = whisperOutput.transcription
      ?.map((seg: any) => seg.text)
      .join(' ')
      .trim() || '';
  }
  
  // Remove VTT/SRT timestamp formatting if present
  fullText = fullText.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '').trim();
  
  return {
    text: fullText,
    segments: segments,
    language: whisperOutput.result?.language || 'en',
    model_used: whisperOutput.params?.model || 'unknown',
    processing_time: 0 // Will be set later
  };
}

export const transcribeWithSpeakersTool = {
  name: 'transcribe_with_speakers',
  description: 'Transcribe audio with speaker identification using whisper.cpp + diarization models',
  inputSchema: {
    type: 'object',
    properties: {
      audio_file_path: {
        type: 'string',
        description: 'Path to the audio file to transcribe'
      },
      options: {
        type: 'object',
        description: 'Diarization and transcription options',
        properties: {
          model: {
            type: 'string',
            enum: ['pyannote', 'simple-diarizer'],
            default: 'pyannote',
            description: 'Speaker diarization model'
          },
          min_speakers: {
            type: 'number',
            minimum: 1,
            default: 1,
            description: 'Minimum number of speakers'
          },
          max_speakers: {
            type: 'number',
            minimum: 1,
            default: 10,
            description: 'Maximum number of speakers'
          },
          whisper_model: {
            type: 'string',
            enum: ['tiny.en', 'tiny', 'base.en', 'base', 'small.en', 'small', 'medium.en', 'medium', 'large-v1', 'large-v2', 'large-v3'],
            default: 'base.en',
            description: 'Whisper model to use'
          },
          output_format: {
            type: 'string',
            enum: ['json', 'txt', 'vtt', 'srt'],
            default: 'json',
            description: 'Output format'
          },
          use_mps: {
            type: 'boolean',
            default: true,
            description: 'Use MPS acceleration on Apple Silicon'
          }
        }
      },
      auto_convert: {
        type: 'boolean',
        default: true,
        description: 'Automatically convert unsupported formats to WAV'
      }
    },
    required: ['audio_file_path']
  },
  zodSchema: TranscribeWithSpeakersArgsSchema,
  
  async handler(args: TranscribeWithSpeakersArgs) {
    const startTime = Date.now();
    const options = args.options || {
      model: 'pyannote' as const,
      min_speakers: 1,
      max_speakers: 10,
      whisper_model: 'base.en' as const,
      output_format: 'json' as const,
      use_mps: true
    };
    
    // Initialize components
    const whisper = new WhisperIntegration();
    const converter = new AudioConverter();
    const diarizationManager = new DiarizationPythonManager();
    const alignment = new DiarizationAlignment();
    
    let tempFile: string | null = null;
    let tempDir: string | null = null;
    
    try {
      // Step 1: Validate input
      if (!existsSync(args.audio_file_path)) {
        throw new DiarizationError('INPUT_ERROR', `Audio file not found: ${args.audio_file_path}`);
      }

      // Step 2: Check diarization availability
      const diarizationAvailable = await diarizationManager.isAvailable();
      if (!diarizationAvailable) {
        throw new DiarizationError(
          'SETUP_ERROR',
          'Speaker diarization requires Python with PyTorch and pyannote.audio. Please install: pip install torch torchaudio pyannote.audio'
        );
      }

      // Step 3: Setup temporary directory
      tempDir = join(__dirname, '../../temp');
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }

      // Step 4: Handle audio format conversion
      let processedAudioPath = args.audio_file_path;
      
      if (args.auto_convert && !converter.isWhisperCompatible(args.audio_file_path)) {
        const ffmpegAvailable = await converter.checkFfmpegInstallation();
        if (!ffmpegAvailable) {
          throw new DiarizationError(
            'SETUP_ERROR',
            'ffmpeg is required for audio format conversion. Install with: brew install ffmpeg'
          );
        }
        
        tempFile = await converter.convertToWav(args.audio_file_path);
        processedAudioPath = tempFile;
      }

      // Step 5: Run whisper.cpp transcription with timestamps
      console.error('[Diarization] Running whisper.cpp transcription...');
      const transcriptionOptions = {
        model: options.whisper_model || 'base.en',
        output_format: 'json' as const, // Need timestamps for alignment
        word_timestamps: true,
        language: 'auto' as const,
        temperature: 0,
        threads: 4
      };

      const transcription = await whisper.transcribe(processedAudioPath, transcriptionOptions);
      
      // Step 6: Run diarization
      console.error('[Diarization] Running speaker diarization...');
      const diarizationParams = {
        audio_file_path: processedAudioPath,
        model: options.model || 'pyannote',
        min_speakers: options.min_speakers || 1,
        max_speakers: options.max_speakers || 10,
        tempDir: tempDir
      };

      const diarizationSegments = await diarizationManager.runDiarization(diarizationParams);

      // Step 7: Use transcription result directly (whisper integration now parses JSON)
      console.error('[Diarization] Processing transcription segments...');
      const transcriptionResult = transcription as TranscriptionResult;
      
      // Step 8: Align transcription with speaker segments
      console.error('[Diarization] Aligning transcription with speakers...');
      const speakerSegments = alignment.alignTranscriptionWithSpeakers(
        transcriptionResult,
        diarizationSegments,
        {
          overlapThreshold: 0.1,
          mergeThreshold: 1.0,
          confidenceThreshold: 0.1
        }
      );

      // Step 9: Create result
      const processingTime = Date.now() - startTime;
      const uniqueSpeakers = Array.from(new Set(speakerSegments.map(s => s.speaker)));
      
      const result: DiarizationResult = {
        segments: speakerSegments,
        speakers: uniqueSpeakers,
        metadata: {
          whisper_model: options.whisper_model || 'base.en',
          diarization_model: options.model || 'pyannote',
          processing_time: processingTime,
          num_speakers: uniqueSpeakers.length,
          device_used: options.use_mps ? 'mps' : 'cpu'
        }
      };

      // Step 10: Format output
      const outputFormat = options.output_format || 'json';
      let formattedOutput: string;

      if (outputFormat === 'json') {
        formattedOutput = JSON.stringify(result, null, 2);
      } else {
        formattedOutput = alignment.formatSpeakerSegments(speakerSegments, outputFormat);
      }

      // Cleanup temp file if created
      if (tempFile) {
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }

      console.error(`[Diarization] ✓ Completed in ${processingTime}ms. Found ${uniqueSpeakers.length} speakers.`);

      return {
        content: [{
          type: 'text' as const,
          text: formattedOutput
        }]
      };

    } catch (error) {
      // Cleanup temp file on error
      if (tempFile) {
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }

      console.error('[Diarization] ✗ Failed:', error);

      if (error instanceof DiarizationError) {
        // Provide helpful error messages
        let helpText = '';
        switch (error.code) {
          case 'SETUP_ERROR':
            helpText = '\\n\\nSetup Help:\\n- Install Python: brew install python3\\n- Install dependencies: pip install torch torchaudio pyannote.audio\\n- Set HF_TOKEN environment variable for Pyannote models';
            break;
          case 'INPUT_ERROR':
            helpText = '\\n\\nPlease check that the audio file exists and is accessible.';
            break;
          case 'PROCESSING_ERROR':
            helpText = '\\n\\nThis may be due to audio format issues or model loading problems. Try with a different audio file or check your Python environment.';
            break;
        }
        throw new Error(`Speaker diarization failed: ${error.message}${helpText}`);
      }

      throw new Error(`Speaker diarization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};