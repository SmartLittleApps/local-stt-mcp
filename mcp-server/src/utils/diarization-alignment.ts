import { TranscriptionResult, DiarizationSegment, SpeakerSegment } from '../types/index.js';

export interface AlignmentOptions {
  overlapThreshold?: number;
  mergeThreshold?: number;
  confidenceThreshold?: number;
}

export class DiarizationAlignment {
  /**
   * Align transcription segments with speaker diarization segments
   */
  alignTranscriptionWithSpeakers(
    transcription: TranscriptionResult,
    diarization: DiarizationSegment[],
    options: AlignmentOptions = {}
  ): SpeakerSegment[] {
    const {
      overlapThreshold = 0.1,
      mergeThreshold = 1.0,
      confidenceThreshold = 0.1
    } = options;

    // Extract segments from transcription
    const transcriptionSegments = (transcription.segments && transcription.segments.length > 0) 
      ? transcription.segments 
      : [
          {
            start: 0,
            end: Math.max(20, ...diarization.map(d => d.end)), // Use max diarization end time or 20s minimum
            text: transcription.text
          }
        ];

    const aligned: SpeakerSegment[] = [];

    for (const transSegment of transcriptionSegments) {
      // Find best matching speaker segment based on temporal overlap
      let bestMatch: DiarizationSegment | null = null;
      let maxOverlap = 0;

      for (const diarSegment of diarization) {
        const overlap = this.calculateOverlap(transSegment, diarSegment);
        if (overlap > maxOverlap) {
          maxOverlap = overlap;
          bestMatch = diarSegment;
        }
      }
      
      if (bestMatch && maxOverlap > overlapThreshold) {
        const confidence = maxOverlap / (transSegment.end - transSegment.start);
        
        if (confidence >= confidenceThreshold) {
          aligned.push({
            text: transSegment.text,
            speaker: this.normalizeSpeakerLabel(bestMatch.speaker),
            start: transSegment.start,
            end: transSegment.end,
            confidence: confidence
          });
        }
      } else {
        // No speaker match found - assign to unknown
        aligned.push({
          text: transSegment.text,
          speaker: "speaker_unknown",
          start: transSegment.start,
          end: transSegment.end,
          confidence: 0
        });
      }
    }

    return this.postProcessAlignment(aligned, mergeThreshold);
  }

  /**
   * Calculate temporal overlap between two segments
   */
  private calculateOverlap(
    seg1: { start: number; end: number }, 
    seg2: { start: number; end: number }
  ): number {
    const overlapStart = Math.max(seg1.start, seg2.start);
    const overlapEnd = Math.min(seg1.end, seg2.end);
    return Math.max(0, overlapEnd - overlapStart);
  }

  /**
   * Normalize speaker labels to consistent format
   */
  private normalizeSpeakerLabel(label: string): string {
    // Convert various formats to consistent "speaker01", "speaker02", etc.
    const match = label.match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1]);
      return `speaker${num.toString().padStart(2, '0')}`;
    }
    
    // If no number found, generate one based on hash of label
    const hash = this.hashString(label);
    const num = (hash % 10) + 1; // Keep numbers 1-10
    return `speaker${num.toString().padStart(2, '0')}`;
  }

  /**
   * Simple hash function for consistent speaker numbering
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Post-process alignment to improve quality
   */
  private postProcessAlignment(
    segments: SpeakerSegment[], 
    mergeThreshold: number
  ): SpeakerSegment[] {
    if (segments.length === 0) return segments;

    const processed: SpeakerSegment[] = [];
    let current: SpeakerSegment | null = null;

    for (const segment of segments) {
      if (current && 
          current.speaker === segment.speaker && 
          segment.start - current.end < mergeThreshold) {
        // Merge with previous segment
        current.text += " " + segment.text;
        current.end = segment.end;
        current.confidence = Math.min(current.confidence, segment.confidence);
      } else {
        if (current) {
          processed.push(current);
        }
        current = { ...segment };
      }
    }

    if (current) {
      processed.push(current);
    }

    return processed;
  }

  /**
   * Format speaker segments for different output formats
   */
  formatSpeakerSegments(segments: SpeakerSegment[], format: string): string {
    switch (format) {
      case 'vtt':
        return this.formatAsVTTWithSpeakers(segments);
      case 'srt':
        return this.formatAsSRTWithSpeakers(segments);
      case 'json':
        return JSON.stringify(segments, null, 2);
      case 'txt':
      default:
        return this.formatAsPlainTextWithSpeakers(segments);
    }
  }

  /**
   * Format as VTT with speaker labels
   */
  private formatAsVTTWithSpeakers(segments: SpeakerSegment[]): string {
    let vtt = 'WEBVTT\n\n';
    
    segments.forEach((segment, index) => {
      const startTime = this.formatTimestamp(segment.start);
      const endTime = this.formatTimestamp(segment.end);
      vtt += `${index + 1}\n${startTime} --> ${endTime}\n<v ${segment.speaker}>${segment.text}</v>\n\n`;
    });

    return vtt;
  }

  /**
   * Format as SRT with speaker labels
   */
  private formatAsSRTWithSpeakers(segments: SpeakerSegment[]): string {
    let srt = '';
    
    segments.forEach((segment, index) => {
      const startTime = this.formatTimestamp(segment.start, true);
      const endTime = this.formatTimestamp(segment.end, true);
      srt += `${index + 1}\n${startTime} --> ${endTime}\n[${segment.speaker}]: ${segment.text}\n\n`;
    });

    return srt;
  }

  /**
   * Format as plain text with speaker prefixes
   */
  private formatAsPlainTextWithSpeakers(segments: SpeakerSegment[]): string {
    return segments.map(segment => `[${segment.speaker}]: ${segment.text}`).join('\n');
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