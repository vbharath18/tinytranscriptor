/**
 * Unit tests for AudioSplitter utility class
 */

import { describe, it, expect } from 'vitest';
import { AudioSplitter } from './audioSplitter';
import type { ChunkingOptions } from '../types/chunking';
import { DEFAULT_CHUNKING_OPTIONS } from '../types/chunking';

describe('AudioSplitter', () => {
  // Helper function to create test audio data
  const createTestAudio = (durationSeconds: number, sampleRate: number = 16000): Float32Array => {
    const samples = Math.floor(durationSeconds * sampleRate);
    const audioData = new Float32Array(samples);
    
    // Fill with simple sine wave for testing
    for (let i = 0; i < samples; i++) {
      audioData[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5;
    }
    
    return audioData;
  };

  // Helper function to create audio with silence regions
  const createAudioWithSilence = (
    sampleRate: number = 16000,
    segments: Array<{ duration: number; amplitude: number }>
  ): Float32Array => {
    const totalSamples = segments.reduce((sum, seg) => sum + Math.floor(seg.duration * sampleRate), 0);
    const audioData = new Float32Array(totalSamples);
    
    let currentIndex = 0;
    for (const segment of segments) {
      const segmentSamples = Math.floor(segment.duration * sampleRate);
      
      for (let i = 0; i < segmentSamples; i++) {
        if (segment.amplitude > 0) {
          // Generate sine wave for non-silent segments
          audioData[currentIndex + i] = Math.sin(2 * Math.PI * 440 * (currentIndex + i) / sampleRate) * segment.amplitude;
        }
        // Silent segments remain 0 (already initialized)
      }
      
      currentIndex += segmentSamples;
    }
    
    return audioData;
  };

  describe('splitAudio', () => {
    it('should return single chunk for audio shorter than chunk duration', () => {
      const audioData = createTestAudio(10); // 10 seconds
      const sampleRate = 16000;
      const options: Partial<ChunkingOptions> = { chunkDuration: 25 };
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate, options);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].id).toBe('chunk-0');
      expect(chunks[0].startTime).toBe(0);
      expect(chunks[0].endTime).toBeCloseTo(10, 2);
      expect(chunks[0].overlapStart).toBe(0);
      expect(chunks[0].overlapEnd).toBe(0);
      expect(chunks[0].audioData.length).toBe(audioData.length);
    });

    it('should split long audio into multiple overlapping chunks', () => {
      const audioData = createTestAudio(60); // 60 seconds
      const sampleRate = 16000;
      const options: Partial<ChunkingOptions> = {
        chunkDuration: 25,
        overlapDuration: 2.5
      };
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate, options);
      
      // Should create multiple chunks
      expect(chunks.length).toBeGreaterThan(1);
      
      // First chunk should start at 0
      expect(chunks[0].startTime).toBe(0);
      expect(chunks[0].overlapStart).toBe(0);
      expect(chunks[0].overlapEnd).toBe(2.5);
      
      // Middle chunks should have overlap on both sides
      if (chunks.length > 2) {
        const middleChunk = chunks[1];
        expect(middleChunk.overlapStart).toBe(2.5);
        expect(middleChunk.overlapEnd).toBe(2.5);
      }
      
      // Last chunk should have overlap only at start
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.overlapStart).toBe(2.5);
      expect(lastChunk.overlapEnd).toBe(0);
    });

    it('should use default options when none provided', () => {
      const audioData = createTestAudio(60);
      const sampleRate = 16000;
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate);
      
      expect(chunks.length).toBeGreaterThan(1);
      
      // Check that default overlap duration is used
      expect(chunks[0].overlapEnd).toBe(DEFAULT_CHUNKING_OPTIONS.overlapDuration);
    });

    it('should handle exact chunk duration boundaries', () => {
      const audioData = createTestAudio(50); // Exactly 2 chunks of 25s
      const sampleRate = 16000;
      const options: Partial<ChunkingOptions> = {
        chunkDuration: 25,
        overlapDuration: 0 // No overlap for simpler testing
      };
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate, options);
      
      expect(chunks).toHaveLength(2);
      expect(chunks[0].endTime).toBeCloseTo(25, 1);
      expect(chunks[1].startTime).toBeCloseTo(25, 1);
      expect(chunks[1].endTime).toBeCloseTo(50, 1);
    });

    it('should generate unique IDs for each chunk', () => {
      const audioData = createTestAudio(60);
      const sampleRate = 16000;
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate);
      
      const ids = chunks.map(chunk => chunk.id);
      const uniqueIds = new Set(ids);
      
      expect(uniqueIds.size).toBe(chunks.length);
      expect(ids[0]).toBe('chunk-0');
      expect(ids[1]).toBe('chunk-1');
    });
  });

  describe('createOverlappingChunks', () => {
    it('should create chunks with correct timing metadata', () => {
      const audioData = createTestAudio(30);
      const sampleRate = 16000;
      const boundaries = [0, 200000, 400000]; // 0s, 12.5s, 25s
      const chunkSamples = 400000; // 25 seconds
      const overlapSamples = 40000; // 2.5 seconds
      
      const chunks = AudioSplitter.createOverlappingChunks(
        audioData,
        boundaries,
        chunkSamples,
        overlapSamples,
        sampleRate
      );
      
      expect(chunks).toHaveLength(3);
      
      // First chunk
      expect(chunks[0].startTime).toBe(0);
      expect(chunks[0].endTime).toBeCloseTo(25, 1);
      expect(chunks[0].overlapStart).toBe(0);
      expect(chunks[0].overlapEnd).toBe(2.5);
      
      // Second chunk
      expect(chunks[1].startTime).toBeCloseTo(12.5, 1);
      expect(chunks[1].overlapStart).toBe(2.5);
      expect(chunks[1].overlapEnd).toBe(2.5);
      
      // Third chunk
      expect(chunks[2].startTime).toBe(25);
      expect(chunks[2].overlapStart).toBe(2.5);
      expect(chunks[2].overlapEnd).toBe(0);
    });

    it('should handle boundary at end of audio correctly', () => {
      const audioData = createTestAudio(30);
      const sampleRate = 16000;
      const boundaries = [400000]; // 25s (near end)
      const chunkSamples = 400000; // 25 seconds
      const overlapSamples = 40000; // 2.5 seconds
      
      const chunks = AudioSplitter.createOverlappingChunks(
        audioData,
        boundaries,
        chunkSamples,
        overlapSamples,
        sampleRate
      );
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].endTime).toBeCloseTo(30, 1); // Should end at actual audio end
      expect(chunks[0].audioData.length).toBe(audioData.length - 400000);
    });

    it('should extract correct audio data for each chunk', () => {
      const audioData = createTestAudio(10);
      const sampleRate = 16000;
      const boundaries = [0, 80000]; // 0s, 5s
      const chunkSamples = 80000; // 5 seconds
      const overlapSamples = 0;
      
      const chunks = AudioSplitter.createOverlappingChunks(
        audioData,
        boundaries,
        chunkSamples,
        overlapSamples,
        sampleRate
      );
      
      expect(chunks).toHaveLength(2);
      expect(chunks[0].audioData.length).toBe(80000);
      expect(chunks[1].audioData.length).toBe(audioData.length - 80000);
      
      // Verify audio data is correctly extracted
      for (let i = 0; i < chunks[0].audioData.length; i++) {
        expect(chunks[0].audioData[i]).toBe(audioData[i]);
      }
    });
  });

  describe('getAudioDuration', () => {
    it('should calculate correct duration', () => {
      const audioData = createTestAudio(15.5);
      const sampleRate = 16000;
      
      const duration = AudioSplitter.getAudioDuration(audioData, sampleRate);
      
      expect(duration).toBeCloseTo(15.5, 2);
    });

    it('should handle empty audio', () => {
      const audioData = new Float32Array(0);
      const sampleRate = 16000;
      
      const duration = AudioSplitter.getAudioDuration(audioData, sampleRate);
      
      expect(duration).toBe(0);
    });
  });

  describe('validateChunkingParameters', () => {
    const validAudioData = createTestAudio(30);
    const validSampleRate = 16000;
    const validOptions: ChunkingOptions = { ...DEFAULT_CHUNKING_OPTIONS };

    it('should not throw for valid parameters', () => {
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, validOptions);
      }).not.toThrow();
    });

    it('should throw for empty audio data', () => {
      const emptyAudio = new Float32Array(0);
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(emptyAudio, validSampleRate, validOptions);
      }).toThrow('Audio data cannot be empty');
    });

    it('should throw for invalid sample rate', () => {
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, 0, validOptions);
      }).toThrow('Sample rate must be positive');
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, -1000, validOptions);
      }).toThrow('Sample rate must be positive');
    });

    it('should throw for invalid chunk duration', () => {
      const invalidOptions = { ...validOptions, chunkDuration: 0 };
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, invalidOptions);
      }).toThrow('Chunk duration must be positive');
    });

    it('should throw for negative overlap duration', () => {
      const invalidOptions = { ...validOptions, overlapDuration: -1 };
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, invalidOptions);
      }).toThrow('Overlap duration cannot be negative');
    });

    it('should throw when overlap duration >= chunk duration', () => {
      const invalidOptions = { ...validOptions, chunkDuration: 10, overlapDuration: 10 };
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, invalidOptions);
      }).toThrow('Overlap duration must be less than chunk duration');
      
      const invalidOptions2 = { ...validOptions, chunkDuration: 10, overlapDuration: 15 };
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, invalidOptions2);
      }).toThrow('Overlap duration must be less than chunk duration');
    });
  });

  describe('findSilenceBoundaries', () => {
    it('should detect silence boundaries in audio with clear silent regions', () => {
      const sampleRate = 16000;
      // Create audio: 5s speech, 0.5s silence, 5s speech, 0.3s silence, 5s speech
      const audioData = createAudioWithSilence(sampleRate, [
        { duration: 5, amplitude: 0.5 },
        { duration: 0.5, amplitude: 0 },
        { duration: 5, amplitude: 0.5 },
        { duration: 0.3, amplitude: 0 },
        { duration: 5, amplitude: 0.5 }
      ]);
      
      const boundaries = AudioSplitter.findSilenceBoundaries(audioData, sampleRate, 0.01);
      
      // Should find at least one boundary (the 0.5s silence is long enough)
      expect(boundaries.length).toBeGreaterThanOrEqual(1);
      
      // First boundary should be around 5.25s (middle of first silence)
      const firstBoundaryTime = boundaries[0] / sampleRate;
      expect(firstBoundaryTime).toBeGreaterThan(5);
      expect(firstBoundaryTime).toBeLessThan(5.5);
    });

    it('should not detect boundaries in continuous audio without silence', () => {
      const audioData = createTestAudio(10); // Continuous sine wave
      const sampleRate = 16000;
      
      const boundaries = AudioSplitter.findSilenceBoundaries(audioData, sampleRate, 0.01);
      
      expect(boundaries).toHaveLength(0);
    });

    it('should ignore very short silence periods', () => {
      const sampleRate = 16000;
      // Create audio with very short silence (0.1s - below 0.2s minimum)
      const audioData = createAudioWithSilence(sampleRate, [
        { duration: 5, amplitude: 0.5 },
        { duration: 0.1, amplitude: 0 },
        { duration: 5, amplitude: 0.5 }
      ]);
      
      const boundaries = AudioSplitter.findSilenceBoundaries(audioData, sampleRate, 0.01);
      
      expect(boundaries).toHaveLength(0);
    });

    it('should respect silence threshold parameter', () => {
      const sampleRate = 16000;
      // Create audio with low-level "silence" (amplitude 0.005)
      const audioData = createAudioWithSilence(sampleRate, [
        { duration: 5, amplitude: 0.5 },
        { duration: 0.5, amplitude: 0.005 },
        { duration: 5, amplitude: 0.5 }
      ]);
      
      // With high threshold (0.01), should detect the low-level region as silence
      const boundariesHigh = AudioSplitter.findSilenceBoundaries(audioData, sampleRate, 0.01);
      expect(boundariesHigh.length).toBeGreaterThan(0);
      
      // With low threshold (0.001), should not detect it as silence
      const boundariesLow = AudioSplitter.findSilenceBoundaries(audioData, sampleRate, 0.001);
      expect(boundariesLow).toHaveLength(0);
    });

    it('should handle audio ending in silence', () => {
      const sampleRate = 16000;
      const audioData = createAudioWithSilence(sampleRate, [
        { duration: 5, amplitude: 0.5 },
        { duration: 0.5, amplitude: 0 }
      ]);
      
      const boundaries = AudioSplitter.findSilenceBoundaries(audioData, sampleRate, 0.01);
      
      expect(boundaries.length).toBeGreaterThan(0);
      const boundaryTime = boundaries[boundaries.length - 1] / sampleRate;
      expect(boundaryTime).toBeGreaterThan(5);
    });

    it('should return boundaries in ascending order', () => {
      const sampleRate = 16000;
      const audioData = createAudioWithSilence(sampleRate, [
        { duration: 3, amplitude: 0.5 },
        { duration: 0.3, amplitude: 0 },
        { duration: 3, amplitude: 0.5 },
        { duration: 0.4, amplitude: 0 },
        { duration: 3, amplitude: 0.5 }
      ]);
      
      const boundaries = AudioSplitter.findSilenceBoundaries(audioData, sampleRate, 0.01);
      
      // Check that boundaries are in ascending order
      for (let i = 1; i < boundaries.length; i++) {
        expect(boundaries[i]).toBeGreaterThan(boundaries[i - 1]);
      }
    });
  });

  describe('calculateRMS', () => {
    it('should calculate correct RMS for sine wave', () => {
      const sampleRate = 16000;
      const frequency = 440;
      const amplitude = 0.5;
      const duration = 1;
      const samples = Math.floor(duration * sampleRate);
      const audioData = new Float32Array(samples);
      
      // Generate pure sine wave
      for (let i = 0; i < samples; i++) {
        audioData[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
      }
      
      const rms = AudioSplitter.calculateRMS(audioData, 0, samples);
      
      // RMS of sine wave should be amplitude / sqrt(2)
      const expectedRMS = amplitude / Math.sqrt(2);
      expect(rms).toBeCloseTo(expectedRMS, 3);
    });

    it('should return 0 for silent audio', () => {
      const audioData = new Float32Array(1000);
      // Array is already initialized to 0
      
      const rms = AudioSplitter.calculateRMS(audioData, 0, audioData.length);
      
      expect(rms).toBe(0);
    });

    it('should handle partial ranges correctly', () => {
      const audioData = new Float32Array(1000);
      
      // Fill first half with 0.5, second half with 0
      for (let i = 0; i < 500; i++) {
        audioData[i] = 0.5;
      }
      
      const rmsFirstHalf = AudioSplitter.calculateRMS(audioData, 0, 500);
      const rmsSecondHalf = AudioSplitter.calculateRMS(audioData, 500, 1000);
      
      expect(rmsFirstHalf).toBe(0.5);
      expect(rmsSecondHalf).toBe(0);
    });
  });

  describe('optimizeBoundariesWithSilence', () => {
    it('should prefer silence boundaries when they are close to ideal positions', () => {
      const audioLength = 160000; // 10 seconds at 16kHz
      const stepSamples = 80000; // 5 seconds
      const chunkSamples = 80000;
      const silenceBoundaries = [79000, 159000]; // Close to ideal positions
      
      const boundaries = AudioSplitter.optimizeBoundariesWithSilence(
        audioLength,
        stepSamples,
        chunkSamples,
        silenceBoundaries
      );
      
      expect(boundaries).toContain(79000); // Should use silence boundary instead of 80000
    });

    it('should fall back to regular boundaries when no silence boundaries are nearby', () => {
      const audioLength = 160000;
      const stepSamples = 80000;
      const chunkSamples = 80000;
      const silenceBoundaries = [10000, 150000]; // Far from ideal positions
      
      const boundaries = AudioSplitter.optimizeBoundariesWithSilence(
        audioLength,
        stepSamples,
        chunkSamples,
        silenceBoundaries
      );
      
      expect(boundaries).toContain(0);
      expect(boundaries).toContain(80000); // Should use regular boundary
    });

    it('should always start with position 0', () => {
      const audioLength = 160000;
      const stepSamples = 80000;
      const chunkSamples = 80000;
      const silenceBoundaries = [40000, 120000];
      
      const boundaries = AudioSplitter.optimizeBoundariesWithSilence(
        audioLength,
        stepSamples,
        chunkSamples,
        silenceBoundaries
      );
      
      expect(boundaries[0]).toBe(0);
    });

    it('should not exceed audio length', () => {
      const audioLength = 100000;
      const stepSamples = 80000;
      const chunkSamples = 80000;
      const silenceBoundaries = [120000]; // Beyond audio length
      
      const boundaries = AudioSplitter.optimizeBoundariesWithSilence(
        audioLength,
        stepSamples,
        chunkSamples,
        silenceBoundaries
      );
      
      boundaries.forEach(boundary => {
        expect(boundary).toBeLessThan(audioLength);
      });
    });
  });

  describe('splitAudio with silence detection', () => {
    it('should use silence boundaries when preferSilenceBoundaries is true', () => {
      const sampleRate = 16000;
      // Create audio with clear silence at 25s mark
      const audioData = createAudioWithSilence(sampleRate, [
        { duration: 25, amplitude: 0.5 },
        { duration: 0.5, amplitude: 0 },
        { duration: 25, amplitude: 0.5 }
      ]);
      
      const options: Partial<ChunkingOptions> = {
        chunkDuration: 25,
        overlapDuration: 2.5,
        preferSilenceBoundaries: true,
        silenceThreshold: 0.01
      };
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate, options);
      
      expect(chunks.length).toBeGreaterThan(1);
      
      // Should split near the silence boundary rather than exactly at 22.5s
      const secondChunkStart = chunks[1].startTime;
      expect(secondChunkStart).toBeGreaterThan(24);
      expect(secondChunkStart).toBeLessThan(26);
    });

    it('should fall back to regular splitting when preferSilenceBoundaries is false', () => {
      const sampleRate = 16000;
      const audioData = createAudioWithSilence(sampleRate, [
        { duration: 25, amplitude: 0.5 },
        { duration: 0.5, amplitude: 0 },
        { duration: 25, amplitude: 0.5 }
      ]);
      
      const options: Partial<ChunkingOptions> = {
        chunkDuration: 25,
        overlapDuration: 2.5,
        preferSilenceBoundaries: false
      };
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate, options);
      
      expect(chunks.length).toBeGreaterThan(1);
      
      // Should split at regular intervals (22.5s for second chunk)
      const secondChunkStart = chunks[1].startTime;
      expect(secondChunkStart).toBeCloseTo(22.5, 1);
    });

    it('should handle audio with no silence boundaries gracefully', () => {
      const audioData = createTestAudio(60); // Continuous sine wave
      const sampleRate = 16000;
      
      const options: Partial<ChunkingOptions> = {
        preferSilenceBoundaries: true,
        silenceThreshold: 0.01
      };
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate, options);
      
      // Should still create chunks even without silence boundaries
      expect(chunks.length).toBeGreaterThan(1);
      
      // Should fall back to regular time-based splitting
      expect(chunks[1].startTime).toBeCloseTo(22.5, 1);
    });
  });

  describe('validateChunkingParameters with silence detection', () => {
    const validAudioData = createTestAudio(30);
    const validSampleRate = 16000;
    const validOptions: ChunkingOptions = { ...DEFAULT_CHUNKING_OPTIONS };

    it('should validate silence threshold range', () => {
      const invalidOptionsLow = { ...validOptions, silenceThreshold: -0.1 };
      const invalidOptionsHigh = { ...validOptions, silenceThreshold: 1.5 };
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, invalidOptionsLow);
      }).toThrow('Silence threshold must be between 0 and 1');
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, invalidOptionsHigh);
      }).toThrow('Silence threshold must be between 0 and 1');
    });

    it('should accept valid silence threshold values', () => {
      const validOptions1 = { ...validOptions, silenceThreshold: 0 };
      const validOptions2 = { ...validOptions, silenceThreshold: 0.5 };
      const validOptions3 = { ...validOptions, silenceThreshold: 1 };
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, validOptions1);
      }).not.toThrow();
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, validOptions2);
      }).not.toThrow();
      
      expect(() => {
        AudioSplitter.validateChunkingParameters(validAudioData, validSampleRate, validOptions3);
      }).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should handle very short audio correctly', () => {
      const audioData = createTestAudio(0.5); // 0.5 seconds
      const sampleRate = 16000;
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate);
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0].startTime).toBe(0);
      expect(chunks[0].endTime).toBeCloseTo(0.5, 2);
    });

    it('should handle audio exactly matching chunk + overlap duration', () => {
      const audioData = createTestAudio(27.5); // 25s chunk + 2.5s overlap
      const sampleRate = 16000;
      const options: Partial<ChunkingOptions> = {
        chunkDuration: 25,
        overlapDuration: 2.5
      };
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate, options);
      
      expect(chunks).toHaveLength(2);
      expect(chunks[1].endTime).toBeCloseTo(27.5, 1);
    });

    it('should maintain audio data integrity across chunks', () => {
      const audioData = createTestAudio(60);
      const sampleRate = 16000;
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate);
      
      // Verify that all chunks have valid audio data
      chunks.forEach((chunk, index) => {
        expect(chunk.audioData).toBeInstanceOf(Float32Array);
        expect(chunk.audioData.length).toBeGreaterThan(0);
        expect(chunk.id).toBe(`chunk-${index}`);
        
        // Verify timing consistency
        expect(chunk.endTime).toBeGreaterThan(chunk.startTime);
        expect(chunk.overlapStart).toBeGreaterThanOrEqual(0);
        expect(chunk.overlapEnd).toBeGreaterThanOrEqual(0);
      });
    });

    it('should demonstrate silence detection accuracy with realistic audio patterns', () => {
      const sampleRate = 16000;
      // Simulate realistic speech pattern: speech, pause, speech, pause, speech
      const audioData = createAudioWithSilence(sampleRate, [
        { duration: 12, amplitude: 0.4 },  // 12s speech
        { duration: 0.8, amplitude: 0 },   // 0.8s pause
        { duration: 15, amplitude: 0.3 },  // 15s speech
        { duration: 1.2, amplitude: 0 },   // 1.2s pause
        { duration: 20, amplitude: 0.5 }   // 20s speech
      ]);
      
      const options: Partial<ChunkingOptions> = {
        chunkDuration: 25,
        overlapDuration: 2.5,
        preferSilenceBoundaries: true,
        silenceThreshold: 0.02
      };
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate, options);
      
      expect(chunks.length).toBeGreaterThan(1);
      
      // Verify that chunks are split near natural pause points
      // rather than at arbitrary time boundaries
      const chunkBoundaries = chunks.slice(1).map(chunk => chunk.startTime);
      
      // At least one boundary should be near the first pause (around 12.4s)
      const nearFirstPause = chunkBoundaries.some(boundary => 
        boundary > 11 && boundary < 14
      );
      
      // At least one boundary should be near the second pause (around 28.6s)
      const nearSecondPause = chunkBoundaries.some(boundary => 
        boundary > 26 && boundary < 30
      );
      
      expect(nearFirstPause || nearSecondPause).toBe(true);
    });
  });
});