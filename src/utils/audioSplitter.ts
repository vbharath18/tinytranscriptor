/**
 * AudioSplitter utility class for splitting audio into overlapping chunks
 * 
 * This class provides functionality to split long audio files into smaller chunks
 * with configurable overlap to enable transcription of audio longer than 30 seconds.
 */

import type { AudioChunk, ChunkingOptions } from '../types/chunking';
import { DEFAULT_CHUNKING_OPTIONS } from '../types/chunking';

/**
 * Utility class for splitting audio data into overlapping chunks
 */
export class AudioSplitter {
  /**
   * Splits audio data into overlapping chunks based on the provided options
   * 
   * @param audioData - The audio data as Float32Array
   * @param sampleRate - The sample rate of the audio in Hz
   * @param options - Chunking configuration options
   * @returns Array of AudioChunk objects with proper timing and overlap metadata
   */
  static splitAudio(
    audioData: Float32Array,
    sampleRate: number,
    options: Partial<ChunkingOptions> = {}
  ): AudioChunk[] {
    const config = { ...DEFAULT_CHUNKING_OPTIONS, ...options };
    
    // Calculate chunk and overlap sizes in samples
    const chunkSamples = Math.floor(config.chunkDuration * sampleRate);
    const overlapSamples = Math.floor(config.overlapDuration * sampleRate);
    
    // If audio is shorter than chunk duration, return single chunk
    if (audioData.length <= chunkSamples) {
      return [{
        id: 'chunk-0',
        startTime: 0,
        endTime: audioData.length / sampleRate,
        audioData: audioData.slice(),
        overlapStart: 0,
        overlapEnd: 0,
      }];
    }
    
    // Calculate step size (chunk size minus overlap)
    const stepSamples = chunkSamples - overlapSamples;
    
    let boundaries: number[];
    
    if (config.preferSilenceBoundaries) {
      // Find silence boundaries and use them to optimize chunk boundaries
      const silenceBoundaries = this.findSilenceBoundaries(audioData, sampleRate, config.silenceThreshold);
      boundaries = this.optimizeBoundariesWithSilence(
        audioData.length,
        stepSamples,
        chunkSamples,
        silenceBoundaries
      );
    } else {
      // Generate regular time-based boundaries
      boundaries = [];
      for (let start = 0; start < audioData.length; start += stepSamples) {
        boundaries.push(start);
      }
    }
    
    return this.createOverlappingChunks(audioData, boundaries, chunkSamples, overlapSamples, sampleRate);
  }
  
  /**
   * Creates AudioChunk objects from audio data and boundary positions
   * 
   * @param audioData - The source audio data
   * @param boundaries - Array of start positions in samples
   * @param chunkSamples - Size of each chunk in samples
   * @param overlapSamples - Size of overlap in samples
   * @param sampleRate - Sample rate for time calculations
   * @returns Array of AudioChunk objects with proper metadata
   */
  static createOverlappingChunks(
    audioData: Float32Array,
    boundaries: number[],
    chunkSamples: number,
    overlapSamples: number,
    sampleRate: number
  ): AudioChunk[] {
    const chunks: AudioChunk[] = [];
    
    for (let i = 0; i < boundaries.length; i++) {
      const startSample = boundaries[i];
      const endSample = Math.min(startSample + chunkSamples, audioData.length);
      
      // Extract audio data for this chunk
      const chunkAudioData = audioData.slice(startSample, endSample);
      
      // Calculate overlap information
      const overlapStart = i > 0 ? overlapSamples / sampleRate : 0;
      const overlapEnd = i < boundaries.length - 1 ? overlapSamples / sampleRate : 0;
      
      // Create chunk object
      const chunk: AudioChunk = {
        id: `chunk-${i}`,
        startTime: startSample / sampleRate,
        endTime: endSample / sampleRate,
        audioData: chunkAudioData,
        overlapStart,
        overlapEnd,
      };
      
      chunks.push(chunk);
    }
    
    return chunks;
  }
  
  /**
   * Calculates the total duration of audio data in seconds
   * 
   * @param audioData - The audio data
   * @param sampleRate - The sample rate in Hz
   * @returns Duration in seconds
   */
  static getAudioDuration(audioData: Float32Array, sampleRate: number): number {
    return audioData.length / sampleRate;
  }
  
  /**
   * Finds silence boundaries in audio data for natural chunk splitting
   * 
   * @param audioData - The audio data to analyze
   * @param sampleRate - The sample rate of the audio
   * @param silenceThreshold - The threshold below which audio is considered silence (0-1)
   * @returns Array of sample positions where silence boundaries occur
   */
  static findSilenceBoundaries(
    audioData: Float32Array,
    sampleRate: number,
    silenceThreshold: number = 0.01
  ): number[] {
    const boundaries: number[] = [];
    
    // Window size for silence detection (100ms)
    const windowSize = Math.floor(sampleRate * 0.1);
    const minSilenceDuration = Math.floor(sampleRate * 0.2); // 200ms minimum silence
    
    let silenceStart = -1;
    
    for (let i = 0; i < audioData.length - windowSize; i += windowSize) {
      const windowEnd = Math.min(i + windowSize, audioData.length);
      const rms = this.calculateRMS(audioData, i, windowEnd);
      
      if (rms < silenceThreshold) {
        // Start of silence region
        if (silenceStart === -1) {
          silenceStart = i;
        }
      } else {
        // End of silence region
        if (silenceStart !== -1) {
          const silenceDuration = i - silenceStart;
          
          // Only consider it a boundary if silence is long enough
          if (silenceDuration >= minSilenceDuration) {
            // Add boundary at the middle of the silence region
            const boundaryPosition = silenceStart + Math.floor(silenceDuration / 2);
            boundaries.push(boundaryPosition);
          }
          
          silenceStart = -1;
        }
      }
    }
    
    // Handle case where audio ends in silence
    if (silenceStart !== -1) {
      const silenceDuration = audioData.length - silenceStart;
      if (silenceDuration >= minSilenceDuration) {
        const boundaryPosition = silenceStart + Math.floor(silenceDuration / 2);
        boundaries.push(boundaryPosition);
      }
    }
    
    return boundaries;
  }
  
  /**
   * Calculates the Root Mean Square (RMS) of audio data in a given range
   * 
   * @param audioData - The audio data
   * @param startIndex - Start index of the range
   * @param endIndex - End index of the range
   * @returns RMS value representing the audio level
   */
  static calculateRMS(audioData: Float32Array, startIndex: number, endIndex: number): number {
    let sum = 0;
    const length = endIndex - startIndex;
    
    for (let i = startIndex; i < endIndex; i++) {
      sum += audioData[i] * audioData[i];
    }
    
    return Math.sqrt(sum / length);
  }
  
  /**
   * Optimizes chunk boundaries by preferring silence boundaries when available
   * 
   * @param audioLength - Total length of audio in samples
   * @param stepSamples - Regular step size between chunks
   * @param chunkSamples - Size of each chunk in samples
   * @param silenceBoundaries - Array of silence boundary positions
   * @returns Optimized array of chunk start positions
   */
  static optimizeBoundariesWithSilence(
    audioLength: number,
    stepSamples: number,
    chunkSamples: number,
    silenceBoundaries: number[]
  ): number[] {
    const boundaries: number[] = [];
    const searchRadius = Math.floor(stepSamples * 0.3); // Search within 30% of step size
    
    let currentPosition = 0;
    
    while (currentPosition < audioLength) {
      boundaries.push(currentPosition);
      
      // Calculate ideal next position
      const idealNext = currentPosition + stepSamples;
      
      if (idealNext >= audioLength) {
        break;
      }
      
      // Find the closest silence boundary within search radius
      const searchStart = Math.max(0, idealNext - searchRadius);
      const searchEnd = Math.min(audioLength, idealNext + searchRadius);
      
      let bestBoundary = idealNext;
      let minDistance = Infinity;
      
      for (const silenceBoundary of silenceBoundaries) {
        if (silenceBoundary >= searchStart && silenceBoundary <= searchEnd) {
          const distance = Math.abs(silenceBoundary - idealNext);
          if (distance < minDistance) {
            minDistance = distance;
            bestBoundary = silenceBoundary;
          }
        }
      }
      
      currentPosition = bestBoundary;
    }
    
    return boundaries;
  }
  
  /**
   * Validates that chunking parameters are reasonable
   * 
   * @param audioData - The audio data to validate against
   * @param sampleRate - The sample rate
   * @param options - The chunking options to validate
   * @throws Error if parameters are invalid
   */
  static validateChunkingParameters(
    audioData: Float32Array,
    sampleRate: number,
    options: ChunkingOptions
  ): void {
    if (audioData.length === 0) {
      throw new Error('Audio data cannot be empty');
    }
    
    if (sampleRate <= 0) {
      throw new Error('Sample rate must be positive');
    }
    
    if (options.chunkDuration <= 0) {
      throw new Error('Chunk duration must be positive');
    }
    
    if (options.overlapDuration < 0) {
      throw new Error('Overlap duration cannot be negative');
    }
    
    if (options.overlapDuration >= options.chunkDuration) {
      throw new Error('Overlap duration must be less than chunk duration');
    }
    
    if (options.silenceThreshold < 0 || options.silenceThreshold > 1) {
      throw new Error('Silence threshold must be between 0 and 1');
    }
  }
}