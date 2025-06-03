import { z } from 'zod';
import { WhisperIntegration } from '../whisper/integration.js';
import { AudioConverter } from '../utils/audio-converter.js';
import { TranscribeOptionsSchema } from '../types/index.js';
import { unlinkSync } from 'fs';

const TranscribeArgsSchema = z.object({
  audio_path: z.string().describe('Path to the audio file to transcribe'),
  options: TranscribeOptionsSchema.optional().describe('Transcription options'),
  auto_convert: z.boolean().optional().default(true).describe('Automatically convert unsupported formats to WAV')
});

type TranscribeArgs = z.infer<typeof TranscribeArgsSchema>;

export const transcribeTool = {
  name: 'transcribe',
  description: 'Transcribe audio file to text using whisper.cpp with automatic format conversion',
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
      auto_convert: {
        type: 'boolean',
        default: true,
        description: 'Automatically convert unsupported formats to WAV'
      }
    },
    required: ['audio_path']
  },
  zodSchema: TranscribeArgsSchema,
  
  async handler(args: TranscribeArgs) {
    const whisper = new WhisperIntegration();
    const converter = new AudioConverter();
    let tempFile: string | null = null;
    
    try {
      let processedAudioPath = args.audio_path;
      
      // Check if format conversion is needed
      if (args.auto_convert && !converter.isWhisperCompatible(args.audio_path)) {
        // Check if ffmpeg is available
        const ffmpegAvailable = await converter.checkFfmpegInstallation();
        if (!ffmpegAvailable) {
          throw new Error('ffmpeg is required for audio format conversion. Install with: brew install ffmpeg');
        }
        
        // Convert to WAV
        tempFile = await converter.convertToWav(args.audio_path);
        processedAudioPath = tempFile;
      }
      
      const result = await whisper.transcribe(processedAudioPath, args.options);
      
      // Cleanup temp file if created
      if (tempFile) {
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }
      
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            transcription: result.text,
            metadata: {
              model_used: result.model_used,
              language: result.language,
              processing_time: result.processing_time,
              segments: result.segments,
              format_converted: tempFile !== null,
              original_format: args.audio_path.split('.').pop()?.toLowerCase()
            }
          }, null, 2)
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
      
      throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
};