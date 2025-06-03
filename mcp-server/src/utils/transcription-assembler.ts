import { TranscriptionResult } from '../types/index.js';

export interface ChunkTranscription {
  chunkIndex: number;
  startOffset: number; // in seconds
  result: TranscriptionResult;
}

export interface AssemblyOptions {
  overlapSeconds?: number;
  removeOverlapDuplicates?: boolean;
  preserveTimestamps?: boolean;
}

export class TranscriptionAssembler {
  /**
   * Assemble multiple chunk transcriptions into a single coherent transcript
   */
  assembleTranscriptions(
    chunks: ChunkTranscription[], 
    options: AssemblyOptions = {}
  ): TranscriptionResult {
    const {
      overlapSeconds = 30,
      removeOverlapDuplicates = true,
      preserveTimestamps = true
    } = options;

    if (chunks.length === 0) {
      return {
        text: '',
        model_used: 'base.en',
        processing_time: 0
      };
    }

    if (chunks.length === 1) {
      return chunks[0].result;
    }

    // Sort chunks by index to ensure correct order
    const sortedChunks = chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    let assembledText = '';
    let assembledSegments: Array<{start: number; end: number; text: string}> = [];
    let totalProcessingTime = 0;

    for (let i = 0; i < sortedChunks.length; i++) {
      const chunk = sortedChunks[i];
      const isFirstChunk = i === 0;
      const isLastChunk = i === sortedChunks.length - 1;

      totalProcessingTime += chunk.result.processing_time;

      if (preserveTimestamps && chunk.result.segments) {
        // Process segments with timestamp adjustment
        const adjustedSegments = this.adjustSegmentTimestamps(
          chunk.result.segments,
          chunk.startOffset,
          isFirstChunk,
          isLastChunk,
          overlapSeconds
        );

        if (removeOverlapDuplicates && !isFirstChunk) {
          // Remove overlapping content from the beginning of this chunk
          const filteredSegments = this.removeOverlapSegments(
            adjustedSegments,
            assembledSegments,
            overlapSeconds
          );
          assembledSegments.push(...filteredSegments);
        } else {
          assembledSegments.push(...adjustedSegments);
        }
      }

      // Process plain text
      let chunkText = chunk.result.text;
      
      if (removeOverlapDuplicates && !isFirstChunk) {
        // Remove overlapping content from the beginning of this chunk
        chunkText = this.removeOverlapText(chunkText, overlapSeconds);
      }

      // Add appropriate spacing
      if (!isFirstChunk && assembledText && chunkText) {
        const needsSpace = !assembledText.endsWith(' ') && !chunkText.startsWith(' ');
        if (needsSpace) {
          assembledText += ' ';
        }
      }

      assembledText += chunkText;
    }

    // Create final result
    const assembledResult: TranscriptionResult = {
      text: assembledText.trim(),
      model_used: sortedChunks[0].result.model_used,
      processing_time: totalProcessingTime,
      language: sortedChunks[0].result.language
    };

    if (preserveTimestamps && assembledSegments.length > 0) {
      assembledResult.segments = assembledSegments;
    }

    return assembledResult;
  }

  /**
   * Adjust segment timestamps based on chunk start offset
   */
  private adjustSegmentTimestamps(
    segments: Array<{start: number; end: number; text: string}>,
    startOffset: number,
    isFirstChunk: boolean,
    isLastChunk: boolean,
    overlapSeconds: number
  ): Array<{start: number; end: number; text: string}> {
    return segments.map(segment => ({
      start: segment.start + startOffset,
      end: segment.end + startOffset,
      text: segment.text
    }));
  }

  /**
   * Remove overlapping segments from the beginning of a chunk
   */
  private removeOverlapSegments(
    newSegments: Array<{start: number; end: number; text: string}>,
    existingSegments: Array<{start: number; end: number; text: string}>,
    overlapSeconds: number
  ): Array<{start: number; end: number; text: string}> {
    if (existingSegments.length === 0) {
      return newSegments;
    }

    const lastExistingTime = existingSegments[existingSegments.length - 1].end;
    const overlapCutoffTime = lastExistingTime - overlapSeconds;

    // Find the first segment that starts after the overlap cutoff
    const firstNonOverlapIndex = newSegments.findIndex(
      segment => segment.start >= overlapCutoffTime
    );

    if (firstNonOverlapIndex === -1) {
      // All segments are in overlap region, return empty
      return [];
    }

    return newSegments.slice(firstNonOverlapIndex);
  }

  /**
   * Remove overlapping text from the beginning of a chunk
   * This is a simplified approach for plain text
   */
  private removeOverlapText(text: string, overlapSeconds: number): string {
    // For plain text without timestamps, we use a heuristic:
    // Remove approximately the first 1/4 of the overlap duration worth of text
    // This is rough but helps avoid obvious duplications
    
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length <= 1) {
      return text;
    }

    // Remove first few lines as a simple overlap removal strategy
    const linesToRemove = Math.min(2, Math.floor(lines.length * 0.1));
    return lines.slice(linesToRemove).join('\n');
  }

  /**
   * Format assembled transcription for different output formats
   */
  formatOutput(result: TranscriptionResult, format: string): string {
    switch (format) {
      case 'vtt':
        return this.formatAsVTT(result);
      case 'srt':
        return this.formatAsSRT(result);
      case 'json':
        return JSON.stringify(result, null, 2);
      case 'txt':
      default:
        return result.text;
    }
  }

  /**
   * Format as VTT (WebVTT) format
   */
  private formatAsVTT(result: TranscriptionResult): string {
    if (!result.segments || result.segments.length === 0) {
      return `WEBVTT\n\n${result.text}`;
    }

    let vtt = 'WEBVTT\n\n';
    
    result.segments.forEach((segment, index) => {
      const startTime = this.formatTimestamp(segment.start);
      const endTime = this.formatTimestamp(segment.end);
      vtt += `${index + 1}\n${startTime} --> ${endTime}\n${segment.text}\n\n`;
    });

    return vtt;
  }

  /**
   * Format as SRT (SubRip) format
   */
  private formatAsSRT(result: TranscriptionResult): string {
    if (!result.segments || result.segments.length === 0) {
      return result.text;
    }

    let srt = '';
    
    result.segments.forEach((segment, index) => {
      const startTime = this.formatTimestamp(segment.start, true);
      const endTime = this.formatTimestamp(segment.end, true);
      srt += `${index + 1}\n${startTime} --> ${endTime}\n${segment.text}\n\n`;
    });

    return srt;
  }

  /**
   * Format timestamp for VTT/SRT output
   */
  private formatTimestamp(seconds: number, useSRTFormat = false): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    const separator = useSRTFormat ? ',' : '.';
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}${separator}${ms.toString().padStart(3, '0')}`;
  }
}