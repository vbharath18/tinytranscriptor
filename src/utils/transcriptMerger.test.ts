/**
 * Unit tests for TranscriptMerger utility class
 */

import { describe, it, expect } from 'vitest';
import { TranscriptMerger } from './transcriptMerger';
import type { ChunkResult } from '../types/chunking';

describe('TranscriptMerger', () => {
  describe('mergeChunkResults', () => {
    it('should return empty string for empty array', () => {
      const result = TranscriptMerger.mergeChunkResults([]);
      expect(result).toBe('');
    });

    it('should return empty string for null/undefined input', () => {
      const result1 = TranscriptMerger.mergeChunkResults(null as any);
      const result2 = TranscriptMerger.mergeChunkResults(undefined as any);
      expect(result1).toBe('');
      expect(result2).toBe('');
    });

    it('should return single transcript for single chunk', () => {
      const chunks: ChunkResult[] = [{
        id: 'chunk-1',
        transcript: 'Hello world',
        startTime: 0,
        endTime: 5,
        overlapStart: 0,
        overlapEnd: 0
      }];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Hello world');
    });

    it('should merge multiple chunks in chronological order', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-2',
          transcript: 'This is the second part',
          startTime: 5,
          endTime: 10,
          overlapStart: 0,
          overlapEnd: 0
        },
        {
          id: 'chunk-1',
          transcript: 'Hello world',
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Hello world This is the second part');
    });

    it('should handle overlapping chunks by removing duplicates', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'Hello world this is a test',
          startTime: 0,
          endTime: 7.5,
          overlapStart: 0,
          overlapEnd: 2.5
        },
        {
          id: 'chunk-2',
          transcript: 'this is a test of the system',
          startTime: 5,
          endTime: 12.5,
          overlapStart: 2.5,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Hello world this is a test of the system');
    });

    it('should trim whitespace from individual transcripts', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: '  Hello world  ',
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 0
        },
        {
          id: 'chunk-2',
          transcript: '  This is next  ',
          startTime: 5,
          endTime: 10,
          overlapStart: 0,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Hello world This is next');
    });
  });

  describe('removeOverlapDuplicates', () => {
    it('should handle empty strings', () => {
      expect(TranscriptMerger.removeOverlapDuplicates('', '', 2.5)).toBe('');
      expect(TranscriptMerger.removeOverlapDuplicates('hello', '', 2.5)).toBe('hello');
      expect(TranscriptMerger.removeOverlapDuplicates('', 'world', 2.5)).toBe('world');
    });

    it('should remove exact word overlap at the end/beginning', () => {
      const text1 = 'Hello world this is';
      const text2 = 'this is a test';
      const result = TranscriptMerger.removeOverlapDuplicates(text1, text2, 2.5);
      expect(result).toBe('Hello world this is a test');
    });

    it('should handle longer overlapping sequences', () => {
      const text1 = 'The quick brown fox jumps over';
      const text2 = 'fox jumps over the lazy dog';
      const result = TranscriptMerger.removeOverlapDuplicates(text1, text2, 3.0);
      expect(result).toBe('The quick brown fox jumps over the lazy dog');
    });

    it('should handle case-insensitive matching', () => {
      const text1 = 'Hello World This Is';
      const text2 = 'this is a test';
      const result = TranscriptMerger.removeOverlapDuplicates(text1, text2, 2.5);
      expect(result).toBe('Hello World this is a test');
    });

    it('should handle punctuation in overlapping words', () => {
      const text1 = 'Hello world, this is';
      const text2 = 'this is, a test.';
      const result = TranscriptMerger.removeOverlapDuplicates(text1, text2, 2.5);
      expect(result).toBe('Hello world, this is, a test.');
    });

    it('should concatenate when no overlap is found', () => {
      const text1 = 'Hello world';
      const text2 = 'completely different';
      const result = TranscriptMerger.removeOverlapDuplicates(text1, text2, 2.5);
      expect(result).toBe('Hello world completely different');
    });

    it('should handle single word overlap', () => {
      const text1 = 'Hello world test';
      const text2 = 'test something else';
      const result = TranscriptMerger.removeOverlapDuplicates(text1, text2, 1.0);
      expect(result).toBe('Hello world test something else');
    });

    it('should handle partial word matches correctly', () => {
      const text1 = 'The testing phase';
      const text2 = 'test results are good';
      const result = TranscriptMerger.removeOverlapDuplicates(text1, text2, 2.0);
      // Should not match "testing" with "test" as they are different words
      expect(result).toBe('The testing phase test results are good');
    });

    it('should handle very short overlap durations', () => {
      const text1 = 'Hello world this';
      const text2 = 'this is great';
      const result = TranscriptMerger.removeOverlapDuplicates(text1, text2, 0.5);
      expect(result).toBe('Hello world this is great');
    });

    it('should handle very long overlap durations', () => {
      const text1 = 'The quick brown fox jumps over the lazy dog';
      const text2 = 'brown fox jumps over the lazy dog and runs away';
      const result = TranscriptMerger.removeOverlapDuplicates(text1, text2, 10.0);
      expect(result).toBe('The quick brown fox jumps over the lazy dog and runs away');
    });
  });

  describe('alignTranscripts', () => {
    it('should return empty array for empty input', () => {
      const result = TranscriptMerger.alignTranscripts([]);
      expect(result).toEqual([]);
    });

    it('should return single chunk unchanged', () => {
      const chunks: ChunkResult[] = [{
        id: 'chunk-1',
        transcript: 'Hello world',
        startTime: 0,
        endTime: 5,
        overlapStart: 0,
        overlapEnd: 0
      }];

      const result = TranscriptMerger.alignTranscripts(chunks);
      expect(result).toEqual(chunks);
    });

    it('should align chunks with good overlap', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'Hello world this is a test',
          confidence: 0.95,
          startTime: 0,
          endTime: 7.5,
          overlapStart: 0,
          overlapEnd: 2.5
        },
        {
          id: 'chunk-2',
          transcript: 'this is a test of the system',
          confidence: 0.87,
          startTime: 5,
          endTime: 12.5,
          overlapStart: 2.5,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.alignTranscripts(chunks);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('chunk-1');
      expect(result[1].id).toBe('chunk-2');
      // Timing should remain the same for moderate alignment scores
      expect(result[0].endTime).toBe(7.5);
      expect(result[1].startTime).toBe(5);
    });

    it('should handle chunks with no overlap', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'First part',
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 0
        },
        {
          id: 'chunk-2',
          transcript: 'Second part',
          startTime: 6,
          endTime: 11,
          overlapStart: 0,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.alignTranscripts(chunks);
      expect(result).toEqual(chunks);
    });

    it('should handle multiple chunks with various overlap patterns', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'The quick brown fox',
          confidence: 0.9,
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 1
        },
        {
          id: 'chunk-2',
          transcript: 'brown fox jumps over',
          confidence: 0.85,
          startTime: 4,
          endTime: 9,
          overlapStart: 1,
          overlapEnd: 1
        },
        {
          id: 'chunk-3',
          transcript: 'jumps over the lazy dog',
          confidence: 0.92,
          startTime: 8,
          endTime: 13,
          overlapStart: 1,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.alignTranscripts(chunks);
      expect(result).toHaveLength(3);
      // All chunks should be processed
      expect(result.map(r => r.id)).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    });
  });

  describe('confidence-based merging', () => {
    it('should merge chunks with confidence scores', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'Hello world this is',
          confidence: 0.95,
          startTime: 0,
          endTime: 7.5,
          overlapStart: 0,
          overlapEnd: 2.5
        },
        {
          id: 'chunk-2',
          transcript: 'this is a great test',
          confidence: 0.87,
          startTime: 5,
          endTime: 12.5,
          overlapStart: 2.5,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Hello world this is a great test');
    });

    it('should prefer higher confidence words in overlap regions', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'The quick brown fox',
          confidence: 0.99, // Higher confidence
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 1
        },
        {
          id: 'chunk-2',
          transcript: 'brown fox jumps high',
          confidence: 0.75, // Lower confidence
          startTime: 4,
          endTime: 9,
          overlapStart: 1,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      // Should prefer the higher confidence version of overlapping words
      expect(result).toBe('The quick brown fox jumps high');
    });

    it('should handle chunks with missing confidence scores', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'Hello world this is',
          // No confidence score
          startTime: 0,
          endTime: 7.5,
          overlapStart: 0,
          overlapEnd: 2.5
        },
        {
          id: 'chunk-2',
          transcript: 'this is a test',
          confidence: 0.87,
          startTime: 5,
          endTime: 12.5,
          overlapStart: 2.5,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Hello world this is a test');
    });

    it('should handle complex overlap with varying confidence', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'The weather today is very nice and sunny',
          confidence: 0.85,
          startTime: 0,
          endTime: 8,
          overlapStart: 0,
          overlapEnd: 2
        },
        {
          id: 'chunk-2',
          transcript: 'nice and sunny with clear blue skies',
          confidence: 0.92, // Higher confidence
          startTime: 6,
          endTime: 14,
          overlapStart: 2,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      // Should use higher confidence version of overlap
      expect(result).toBe('The weather today is very nice and sunny with clear blue skies');
    });
  });

  describe('word-level overlap detection', () => {
    it('should detect exact word matches in overlap regions', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'artificial intelligence and machine learning',
          confidence: 0.9,
          startTime: 0,
          endTime: 6,
          overlapStart: 0,
          overlapEnd: 2
        },
        {
          id: 'chunk-2',
          transcript: 'machine learning algorithms are powerful',
          confidence: 0.88,
          startTime: 4,
          endTime: 10,
          overlapStart: 2,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('artificial intelligence and machine learning algorithms are powerful');
    });

    it('should handle punctuation in word-level detection', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'Hello, world! This is great.',
          confidence: 0.9,
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 1.5
        },
        {
          id: 'chunk-2',
          transcript: 'This is great, really amazing!',
          confidence: 0.85,
          startTime: 3.5,
          endTime: 8.5,
          overlapStart: 1.5,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      // The higher confidence chunk1 should be preferred for the overlap, preserving its punctuation
      expect(result).toBe('Hello, world! This is great. really amazing!');
    });

    it('should handle case-insensitive word matching', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'The QUICK Brown Fox',
          confidence: 0.9,
          startTime: 0,
          endTime: 4,
          overlapStart: 0,
          overlapEnd: 1
        },
        {
          id: 'chunk-2',
          transcript: 'brown fox JUMPS Over',
          confidence: 0.85,
          startTime: 3,
          endTime: 7,
          overlapStart: 1,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      // The higher confidence chunk1 should be preferred for the overlap, preserving its case
      expect(result).toBe('The QUICK Brown Fox JUMPS Over');
    });

    it('should handle partial word matches correctly', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'The testing framework works',
          confidence: 0.9,
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 1.5
        },
        {
          id: 'chunk-2',
          transcript: 'test results show success',
          confidence: 0.85,
          startTime: 3.5,
          endTime: 8.5,
          overlapStart: 1.5,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      // "testing" and "test" should not be considered the same word
      expect(result).toBe('The testing framework works test results show success');
    });
  });

  describe('integration scenarios', () => {
    it('should handle realistic transcription scenario with multiple overlapping chunks', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'Welcome to our presentation today we will be discussing',
          startTime: 0,
          endTime: 25,
          overlapStart: 0,
          overlapEnd: 2.5
        },
        {
          id: 'chunk-2',
          transcript: 'we will be discussing the latest developments in artificial intelligence',
          startTime: 22.5,
          endTime: 47.5,
          overlapStart: 2.5,
          overlapEnd: 2.5
        },
        {
          id: 'chunk-3',
          transcript: 'artificial intelligence and machine learning technologies that are transforming',
          startTime: 45,
          endTime: 70,
          overlapStart: 2.5,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Welcome to our presentation today we will be discussing the latest developments in artificial intelligence and machine learning technologies that are transforming');
    });

    it('should handle chunks with confidence scores', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'Hello world',
          confidence: 0.95,
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 1
        },
        {
          id: 'chunk-2',
          transcript: 'world this is great',
          confidence: 0.87,
          startTime: 4,
          endTime: 9,
          overlapStart: 1,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Hello world this is great');
    });

    it('should handle chunks with no actual overlap despite overlap timing', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'First part complete',
          startTime: 0,
          endTime: 7.5,
          overlapStart: 0,
          overlapEnd: 2.5
        },
        {
          id: 'chunk-2',
          transcript: 'Second part begins',
          startTime: 5,
          endTime: 12.5,
          overlapStart: 2.5,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('First part complete Second part begins');
    });

    it('should handle empty transcripts in chunks', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'Hello world',
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 0
        },
        {
          id: 'chunk-2',
          transcript: '',
          startTime: 5,
          endTime: 10,
          overlapStart: 0,
          overlapEnd: 0
        },
        {
          id: 'chunk-3',
          transcript: 'Final part',
          startTime: 10,
          endTime: 15,
          overlapStart: 0,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Hello world Final part');
    });

    it('should handle complex alignment scenario with multiple overlaps and confidence scores', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'Welcome to our comprehensive presentation on artificial intelligence',
          confidence: 0.92,
          startTime: 0,
          endTime: 8,
          overlapStart: 0,
          overlapEnd: 2
        },
        {
          id: 'chunk-2',
          transcript: 'artificial intelligence and machine learning technologies that are revolutionizing',
          confidence: 0.88,
          startTime: 6,
          endTime: 14,
          overlapStart: 2,
          overlapEnd: 2
        },
        {
          id: 'chunk-3',
          transcript: 'technologies that are revolutionizing the way we work and live',
          confidence: 0.95,
          startTime: 12,
          endTime: 20,
          overlapStart: 2,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('Welcome to our comprehensive presentation on artificial intelligence and machine learning technologies that are revolutionizing the way we work and live');
    });

    it('should handle alignment with poor overlap quality', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'The first part of the speech',
          confidence: 0.9,
          startTime: 0,
          endTime: 5,
          overlapStart: 0,
          overlapEnd: 1
        },
        {
          id: 'chunk-2',
          transcript: 'completely different content here',
          confidence: 0.85,
          startTime: 4,
          endTime: 9,
          overlapStart: 1,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      // Should fall back to simple concatenation when no good overlap is found
      expect(result).toBe('The first part of the speech completely different content here');
    });

    it('should handle very long transcripts with multiple confidence-based decisions', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'In today\'s rapidly evolving technological landscape, we are witnessing unprecedented advances in artificial intelligence',
          confidence: 0.94,
          startTime: 0,
          endTime: 12,
          overlapStart: 0,
          overlapEnd: 3
        },
        {
          id: 'chunk-2',
          transcript: 'advances in artificial intelligence and machine learning that are fundamentally changing how we approach problem solving',
          confidence: 0.89,
          startTime: 9,
          endTime: 21,
          overlapStart: 3,
          overlapEnd: 3
        },
        {
          id: 'chunk-3',
          transcript: 'approach problem solving and decision making in complex business environments across various industries',
          confidence: 0.91,
          startTime: 18,
          endTime: 30,
          overlapStart: 3,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toContain('In today\'s rapidly evolving technological landscape');
      expect(result).toContain('artificial intelligence and machine learning');
      expect(result).toContain('complex business environments across various industries');
      // Should be a coherent single transcript
      expect(result.split(' ').length).toBeGreaterThan(20);
    });

    it('should maintain transcript quality with mixed confidence scenarios', () => {
      const chunks: ChunkResult[] = [
        {
          id: 'chunk-1',
          transcript: 'The weather forecast predicts rain',
          confidence: 0.99, // Very high confidence
          startTime: 0,
          endTime: 4,
          overlapStart: 0,
          overlapEnd: 1
        },
        {
          id: 'chunk-2',
          transcript: 'rain tomorrow with thunderstorms',
          confidence: 0.65, // Lower confidence
          startTime: 3,
          endTime: 7,
          overlapStart: 1,
          overlapEnd: 1
        },
        {
          id: 'chunk-3',
          transcript: 'thunderstorms expected in the evening',
          // No confidence score
          startTime: 6,
          endTime: 10,
          overlapStart: 1,
          overlapEnd: 0
        }
      ];

      const result = TranscriptMerger.mergeChunkResults(chunks);
      expect(result).toBe('The weather forecast predicts rain tomorrow with thunderstorms expected in the evening');
    });
  });
});