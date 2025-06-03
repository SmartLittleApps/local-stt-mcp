import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { 
  TranscribeOptions, 
  TranscriptionResult, 
  WhisperError, 
  ModelNotFoundError, 
  AudioFileError 
} from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default model paths
const PROJECT_ROOT = join(__dirname, '../../..');
const MODELS_DIR = join(PROJECT_ROOT, 'models');

export class WhisperIntegration {
  private whisperBinary: string;
  private modelsDir: string;

  constructor(whisperBinary = 'whisper-cli', modelsDir = MODELS_DIR) {
    this.whisperBinary = whisperBinary;
    this.modelsDir = modelsDir;
  }

  /**
   * Transcribe audio file using whisper.cpp
   */
  async transcribe(audioPath: string, options: Partial<TranscribeOptions> = {}): Promise<TranscriptionResult> {
    const startTime = Date.now();
    
    // Validate audio file exists
    if (!existsSync(audioPath)) {
      throw new AudioFileError(audioPath, 'File does not exist');
    }

    // Get model path and validate it exists
    const modelPath = this.getModelPath(options.model || 'base.en');
    if (!existsSync(modelPath)) {
      throw new ModelNotFoundError(options.model || 'base.en');
    }

    // Build whisper command arguments
    const args = this.buildWhisperArgs(audioPath, modelPath, options);

    try {
      const result = await this.executeWhisper(args);
      const processingTime = Date.now() - startTime;

      return {
        text: result.text,
        segments: result.segments,
        language: result.language,
        model_used: options.model || 'base.en',
        processing_time: processingTime
      };
    } catch (error) {
      throw new WhisperError(
        `Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TRANSCRIPTION_FAILED'
      );
    }
  }

  /**
   * Get available models
   */
  getAvailableModels(): string[] {
    if (!existsSync(this.modelsDir)) {
      return [];
    }

    try {
      return readdirSync(this.modelsDir)
        .filter((file: string) => file.endsWith('.bin'))
        .map((file: string) => file.replace('ggml-', '').replace('.bin', ''));
    } catch {
      return [];
    }
  }

  /**
   * Check if whisper.cpp is properly installed
   */
  async checkInstallation(): Promise<{installed: boolean; version?: string; error?: string}> {
    try {
      const result = await this.executeCommand(this.whisperBinary, ['--help']);
      const installed = result.exitCode === 0;
      return {
        installed,
        version: installed ? 'whisper.cpp' : undefined,
        error: installed ? undefined : result.stderr
      };
    } catch (error) {
      return {
        installed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get model file path
   */
  private getModelPath(model: string): string {
    return join(this.modelsDir, `ggml-${model}.bin`);
  }

  /**
   * Build whisper command arguments
   */
  private buildWhisperArgs(audioPath: string, modelPath: string, options: Partial<TranscribeOptions>): string[] {
    const args = [
      '--model', modelPath,
      '--file', audioPath,
      '--threads', (options.threads || 4).toString(),
      '--temperature', (options.temperature || 0).toString()
    ];

    // Language options
    if (options.language && options.language !== 'auto') {
      args.push('--language', options.language);
    }

    // Translation
    if (options.translate) {
      args.push('--translate');
    }

    // Output format - word timestamps override regular format
    if (options.word_timestamps) {
      args.push('--output-json-full');
    } else {
      switch (options.output_format) {
        case 'vtt':
          args.push('--output-vtt');
          break;
        case 'srt':
          args.push('--output-srt');
          break;
        case 'json':
          args.push('--output-json');
          break;
        case 'csv':
          args.push('--output-csv');
          break;
        default:
          args.push('--output-txt');
      }
    }

    // Text processing options
    if (options.max_len && options.max_len > 0) {
      args.push('--max-len', options.max_len.toString());
    }

    if (options.split_on_word) {
      args.push('--split-on-word');
    }

    // Disable prints for clean output
    args.push('--no-prints');

    return args;
  }

  /**
   * Execute whisper command and parse output
   */
  private async executeWhisper(args: string[]): Promise<{
    text: string;
    segments?: Array<{start: number; end: number; text: string}>;
    language?: string;
  }> {
    console.error(`[Whisper] Executing: ${this.whisperBinary} ${args.join(' ')}`);
    const result = await this.executeCommand(this.whisperBinary, args);
    
    if (result.exitCode !== 0) {
      throw new Error(`Whisper process failed: ${result.stderr}`);
    }

    // Parse the output based on format
    const output = result.stdout.trim();
    
    // Check if output is JSON (when using --output-json or --output-json-full)
    if (args.includes('--output-json') || args.includes('--output-json-full')) {
      console.error(`[Whisper] Processing JSON output...`);
      try {
        let jsonOutput;
        
        // --output-json-full writes to file, not stdout
        if (args.includes('--output-json-full')) {
          const audioPath = args[args.indexOf('--file') + 1];
          const jsonPath = audioPath + '.json';
          console.error(`[Whisper] Reading JSON from file: ${jsonPath}`);
          const fs = await import('fs/promises');
          const jsonContent = await fs.readFile(jsonPath, 'utf-8');
          jsonOutput = JSON.parse(jsonContent);
        } else {
          // --output-json writes to stdout
          jsonOutput = JSON.parse(output);
        }
        
        // Extract segments from whisper.cpp JSON format
        const segments = [];
        if (jsonOutput.transcription && Array.isArray(jsonOutput.transcription)) {
          for (const segment of jsonOutput.transcription) {
            if (segment.offsets && segment.text) {
              segments.push({
                start: segment.offsets.from / 1000, // Convert milliseconds to seconds
                end: segment.offsets.to / 1000,
                text: segment.text.trim()
              });
            }
          }
        }
        
        // Extract full text
        const fullText = jsonOutput.transcription
          ?.map((seg: any) => seg.text)
          .join('')
          .trim() || '';
        
        console.error(`[Whisper] ✓ JSON parsed successfully: ${segments.length} segments`);
        return {
          text: fullText,
          segments: segments,
          language: jsonOutput.result?.language || 'en'
        };
        
      } catch (parseError) {
        // If JSON parsing fails, fall back to text output
        console.error('[Whisper] ❌ JSON parsing failed:', parseError);
        console.error('[Whisper] Output preview:', output.slice(0, 200));
      }
    }
    
    // Fallback to simple text output
    return {
      text: output,
      language: 'en'
    };
  }

  /**
   * Execute command with promise wrapper
   */
  private executeCommand(command: string, args: string[]): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    return new Promise((resolve) => {
      const process = spawn(command, args);
      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (exitCode) => {
        resolve({
          exitCode: exitCode || 0,
          stdout,
          stderr
        });
      });
    });
  }
}