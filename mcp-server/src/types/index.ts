import { z } from 'zod';

// Whisper model options
export const WhisperModel = z.enum([
  'tiny.en',
  'tiny',
  'base.en', 
  'base',
  'small.en',
  'small',
  'medium.en',
  'medium',
  'large-v1',
  'large-v2',
  'large-v3'
]);

export type WhisperModel = z.infer<typeof WhisperModel>;

// Output format options
export const OutputFormat = z.enum([
  'txt',
  'vtt', 
  'srt',
  'json',
  'csv'
]);

export type OutputFormat = z.infer<typeof OutputFormat>;

// Language codes (subset of whisper supported languages)
export const Language = z.enum([
  'auto',
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'ru',
  'ja',
  'ko',
  'zh',
  'ar',
  'hi'
]);

export type Language = z.infer<typeof Language>;

// Transcription options schema
export const TranscribeOptionsSchema = z.object({
  model: WhisperModel.optional().default('base.en'),
  language: Language.optional().default('auto'),
  output_format: OutputFormat.optional().default('txt'),
  temperature: z.number().min(0).max(1).optional().default(0),
  threads: z.number().min(1).max(16).optional().default(4),
  translate: z.boolean().optional().default(false),
  word_timestamps: z.boolean().optional().default(false),
  max_len: z.number().min(0).optional().default(0),
  split_on_word: z.boolean().optional().default(false)
});

export type TranscribeOptions = z.infer<typeof TranscribeOptionsSchema>;

// Transcription result
export interface TranscriptionResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
  model_used: string;
  processing_time: number;
}

// Model info
export interface ModelInfo {
  name: string;
  size: string;
  description: string;
  languages: string[];
  speed_rating: number; // 1-5, 5 being fastest
  accuracy_rating: number; // 1-5, 5 being most accurate
  recommended_for: string[];
}

// Health check result
export interface HealthCheckResult {
  whisper_installed: boolean;
  whisper_version?: string;
  models_available: string[];
  recommended_model: string;
  system_info: {
    platform: string;
    arch: string;
    threads_available: number;
  };
}

// Error types
export class WhisperError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'WhisperError';
  }
}

export class ModelNotFoundError extends WhisperError {
  constructor(model: string) {
    super(`Model '${model}' not found`, 'MODEL_NOT_FOUND');
  }
}

export class AudioFileError extends WhisperError {
  constructor(path: string, reason: string) {
    super(`Audio file error: ${path} - ${reason}`, 'AUDIO_FILE_ERROR');
  }
}

// Diarization model options
export const DiarizationModel = z.enum([
  'pyannote',
  'simple-diarizer'
]);

export type DiarizationModel = z.infer<typeof DiarizationModel>;

// Diarization options schema
export const DiarizationOptionsSchema = z.object({
  model: DiarizationModel.optional().default('pyannote'),
  min_speakers: z.number().min(1).optional().default(1),
  max_speakers: z.number().min(1).optional().default(10),
  whisper_model: WhisperModel.optional().default('base.en'),
  output_format: OutputFormat.optional().default('json'),
  use_mps: z.boolean().optional().default(true)
});

export type DiarizationOptions = z.infer<typeof DiarizationOptionsSchema>;

// Diarization segment
export interface DiarizationSegment {
  start: number;
  end: number;
  speaker: string;
}

// Speaker-attributed text segment
export interface SpeakerSegment {
  text: string;
  speaker: string;
  start: number;
  end: number;
  confidence: number;
}

// Diarization result
export interface DiarizationResult {
  segments: SpeakerSegment[];
  speakers: string[];
  metadata: {
    whisper_model: string;
    diarization_model: string;
    processing_time: number;
    num_speakers: number;
    device_used: string;
  };
}

// Diarization error
export class DiarizationError extends Error {
  constructor(
    public code: 'SETUP_ERROR' | 'INPUT_ERROR' | 'PROCESSING_ERROR' | 'PERFORMANCE_ERROR',
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'DiarizationError';
  }
}