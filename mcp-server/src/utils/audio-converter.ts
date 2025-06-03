import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { WhisperError } from '../types/index.js';

export interface ConversionOptions {
  outputPath?: string;
  sampleRate?: number;
  channels?: number;
  format?: 'wav' | 'mp3' | 'flac';
}

export class AudioConverter {
  private ffmpegBinary: string;
  private tempDir: string;

  constructor(ffmpegBinary = 'ffmpeg', tempDir = '/tmp') {
    this.ffmpegBinary = ffmpegBinary;
    this.tempDir = tempDir;
  }

  /**
   * Check if ffmpeg is available
   */
  async checkFfmpegInstallation(): Promise<boolean> {
    try {
      const result = await this.executeCommand(this.ffmpegBinary, ['-version']);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Get audio file information
   */
  async getAudioInfo(audioPath: string): Promise<{
    duration: number;
    format: string;
    sampleRate: number;
    channels: number;
  }> {
    if (!existsSync(audioPath)) {
      throw new WhisperError(`Audio file not found: ${audioPath}`, 'FILE_NOT_FOUND');
    }

    const args = [
      '-i', audioPath,
      '-f', 'null',
      '-'
    ];

    const result = await this.executeCommand(this.ffmpegBinary, args);
    
    // Parse ffmpeg output for duration and format info
    const output = result.stderr;
    
    // Extract duration (format: Duration: HH:MM:SS.ms)
    const durationMatch = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    const duration = durationMatch 
      ? parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseFloat(durationMatch[3])
      : 0;

    // Extract format info
    const formatMatch = output.match(/Input #0, ([^,]+)/);
    const format = formatMatch ? formatMatch[1] : 'unknown';

    // Extract sample rate
    const sampleRateMatch = output.match(/(\d+) Hz/);
    const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1]) : 0;

    // Extract channels
    const channelsMatch = output.match(/(mono|stereo|\d+ channels)/);
    let channels = 1;
    if (channelsMatch) {
      const channelStr = channelsMatch[1];
      if (channelStr === 'stereo') channels = 2;
      else if (channelStr === 'mono') channels = 1;
      else {
        const numMatch = channelStr.match(/(\d+)/);
        if (numMatch) channels = parseInt(numMatch[1]);
      }
    }

    return { duration, format, sampleRate, channels };
  }

  /**
   * Convert audio file to WAV format suitable for whisper.cpp
   */
  async convertToWav(inputPath: string, options: ConversionOptions = {}): Promise<string> {
    const {
      outputPath,
      sampleRate = 16000,
      channels = 1,
    } = options;

    if (!existsSync(inputPath)) {
      throw new WhisperError(`Input file not found: ${inputPath}`, 'FILE_NOT_FOUND');
    }

    // Generate output path if not provided
    const finalOutputPath = outputPath || this.generateTempPath(inputPath, 'wav');
    
    // Ensure output directory exists
    const outputDir = dirname(finalOutputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const args = [
      '-i', inputPath,
      '-acodec', 'pcm_s16le',
      '-ar', sampleRate.toString(),
      '-ac', channels.toString(),
      '-f', 'wav',
      '-y', // Overwrite output file
      finalOutputPath
    ];

    const result = await this.executeCommand(this.ffmpegBinary, args);
    
    if (result.exitCode !== 0) {
      throw new WhisperError(
        `Audio conversion failed: ${result.stderr}`,
        'CONVERSION_FAILED'
      );
    }

    return finalOutputPath;
  }

  /**
   * Split audio file into chunks
   */
  async splitAudio(
    inputPath: string, 
    chunkDurationSeconds: number = 600, // 10 minutes
    overlapSeconds: number = 30
  ): Promise<string[]> {
    if (!existsSync(inputPath)) {
      throw new WhisperError(`Input file not found: ${inputPath}`, 'FILE_NOT_FOUND');
    }

    // Get audio duration
    const audioInfo = await this.getAudioInfo(inputPath);
    const totalDuration = audioInfo.duration;

    if (totalDuration <= chunkDurationSeconds) {
      // File is short enough, no splitting needed
      return [inputPath];
    }

    const outputPaths: string[] = [];
    let startTime = 0;
    let chunkIndex = 0;

    while (startTime < totalDuration) {
      const chunkPath = this.generateChunkPath(inputPath, chunkIndex);
      
      // Calculate chunk duration (add overlap except for first chunk)
      const actualChunkDuration = Math.min(
        chunkDurationSeconds + (chunkIndex > 0 ? overlapSeconds : 0),
        totalDuration - startTime + (chunkIndex > 0 ? overlapSeconds : 0)
      );

      const args = [
        '-i', inputPath,
        '-ss', startTime.toString(),
        '-t', actualChunkDuration.toString(),
        '-acodec', 'copy',
        '-y',
        chunkPath
      ];

      const result = await this.executeCommand(this.ffmpegBinary, args);
      
      if (result.exitCode !== 0) {
        throw new WhisperError(
          `Audio splitting failed at chunk ${chunkIndex}: ${result.stderr}`,
          'SPLITTING_FAILED'
        );
      }

      outputPaths.push(chunkPath);
      
      // Move to next chunk (subtract overlap to avoid gaps)
      startTime += chunkDurationSeconds - (chunkIndex > 0 ? overlapSeconds : 0);
      chunkIndex++;
    }

    return outputPaths;
  }

  /**
   * Check if file format is supported by whisper.cpp directly
   */
  isWhisperCompatible(audioPath: string): boolean {
    const ext = extname(audioPath).toLowerCase();
    return ['.wav', '.flac'].includes(ext);
  }

  /**
   * Generate temporary file path
   */
  private generateTempPath(originalPath: string, extension: string): string {
    const baseName = basename(originalPath, extname(originalPath));
    const timestamp = Date.now();
    return join(this.tempDir, `${baseName}_${timestamp}.${extension}`);
  }

  /**
   * Generate chunk file path
   */
  private generateChunkPath(originalPath: string, chunkIndex: number): string {
    const ext = extname(originalPath);
    const baseName = basename(originalPath, ext);
    return join(this.tempDir, `${baseName}_chunk_${chunkIndex.toString().padStart(3, '0')}${ext}`);
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