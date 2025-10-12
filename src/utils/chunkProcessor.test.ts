/**
 * Unit tests for ChunkProcessor class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChunkProcessor, DEFAULT_CHUNK_PROCESSOR_CONFIG } from './chunkProcessor';
import type { ChunkingProgress, AudioChunk, ChunkResult } from '../types/chunking';
import { AudioSplitter } from './audioSplitter';
import { TranscriptMerger } from './transcriptMerger';

// Mock the dependencies
vi.mock('./audioSplitter');
vi.mock('./transcriptMerger');

const MockedAudioSplitter = vi.mocked(AudioSplitter);
const MockedTranscriptMerger = vi.mocked(TranscriptMerger);

describe('ChunkProcessor', () => {
  let processor: ChunkProcessor;
  let mockProgressCallback: vi.MockedFunction<(progress: ChunkingProgress) => void>;
  let mockTranscriptionFn: vi.MockedFunction<(audioData: Float32Array) => Promise<{ text: string; confidence?: number }>>;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new ChunkProcessor();
    mockProgressCallback = vi.fn();
    mockTranscriptionFn = vi.fn();
    processor.setProgressCallback(mockProgressCallback);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default configuration when no config provided', () => {
      const defaultProcessor = new ChunkProcessor();
      expect(defaultProcessor.getConfig()).toEqual(DEFAULT_CHUNK_PROCESSOR_CONFIG);
    });

    it('should merge provided config with defaults', () => {
      const customConfig = { maxRetries: 5, retryDelayMs: 2000 };
      const customProcessor = new ChunkProcessor(customConfig);
      const config = customProcessor.getConfig();
      
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelayMs).toBe(2000);
      expect(config.continueOnPartialFailure).toBe(DEFAULT_CHUNK_PROCESSOR_CONFIG.continueOnPartialFailure);
    });

    it('should merge provided chunking options with defaults', () => {
      const customOptions = { chunkDuration: 20, maxConcurrency: 4 };
      const customProcessor = new ChunkProcessor({}, customOptions);
      const options = customProcessor.getChunkingOptions();
      
      expect(options.chunkDuration).toBe(20);
      expect(options.maxConcurrency).toBe(4);
      expect(options.overlapDuration).toBe(2.5); // Default value
    });
  });

  describe('processChunks', () => {
    const mockAudioData = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const sampleRate = 16000;

    const mockChunks: AudioChunk[] = [
      {
        id: 'chunk-0',
        startTime: 0,
        endTime: 25,
        audioData: new Float32Array([0.1, 0.2]),
        overlapStart: 0,
        overlapEnd: 2.5
      },
      {
        id: 'chunk-1',
        startTime: 22.5,
        endTime: 47.5,
        audioData: new Float32Array([0.3, 0.4]),
        overlapStart: 2.5,
        overlapEnd: 0
      }
    ];

    const mockChunkResults: ChunkResult[] = [
      {
        id: 'chunk-0',
        transcript: 'Hello world',
        confidence: 0.9,
        startTime: 0,
        endTime: 25,
        overlapStart: 0,
        overlapEnd: 2.5
      },
      {
        id: 'chunk-1',
        transcript: 'this is a test',
        confidence: 0.8,
        startTime: 22.5,
        endTime: 47.5,
        overlapStart: 2.5,
        overlapEnd: 0
      }
    ];

    beforeEach(() => {
      MockedAudioSplitter.validateChunkingParameters.mockImplementation(() => {});
      MockedAudioSplitter.splitAudio.mockReturnValue(mockChunks);
      MockedTranscriptMerger.mergeChunkResults.mockReturnValue('Hello world this is a test');
      mockTranscriptionFn.mockResolvedValue({ text: 'test transcript', confidence: 0.9 });
    });

    it('should successfully process chunks through complete workflow', async () => {
      const result = await processor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(true);
      expect(result.transcript).toBe('Hello world this is a test');
      expect(result.chunkResults).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.stats.totalChunks).toBe(2);
      expect(result.stats.successfulChunks).toBe(2);
      expect(result.stats.failedChunks).toBe(0);
    });

    it('should validate input parameters', async () => {
      MockedAudioSplitter.validateChunkingParameters.mockImplementation(() => {
        throw new Error('Invalid parameters');
      });

      const result = await processor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Invalid parameters');
    });

    it('should handle empty audio data', async () => {
      const emptyAudio = new Float32Array([]);
      const result = await processor.processChunks(emptyAudio, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Audio data cannot be empty');
    });

    it('should handle invalid sample rate', async () => {
      const result = await processor.processChunks(mockAudioData, 0, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Sample rate must be positive');
    });

    it('should call progress callback during processing', async () => {
      await processor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(mockProgressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'splitting' })
      );
      expect(mockProgressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'transcribing' })
      );
      expect(mockProgressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'merging' })
      );
    });

    it('should handle chunk splitting failure', async () => {
      MockedAudioSplitter.splitAudio.mockImplementation(() => {
        throw new Error('Splitting failed');
      });

      const result = await processor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Failed to split audio');
    });

    it('should handle transcription failures with retry', async () => {
      mockTranscriptionFn
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockRejectedValueOnce(new Error('Second attempt failed'))
        .mockResolvedValue({ text: 'Success on third attempt', confidence: 0.8 });

      const result = await processor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(true);
      expect(mockTranscriptionFn).toHaveBeenCalledTimes(4); // 2 chunks * (2 failures + 1 success) for first chunk, 1 success for second
    });

    it('should handle complete transcription failure', async () => {
      // Use a processor with faster retries for testing
      const fastProcessor = new ChunkProcessor({ maxRetries: 1, retryDelayMs: 10 });
      fastProcessor.setProgressCallback(mockProgressCallback);
      
      mockTranscriptionFn.mockRejectedValue(new Error('Transcription failed'));

      const result = await fastProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('All chunks failed to transcribe');
    }, 10000);

    it('should handle partial transcription failure when continueOnPartialFailure is true', async () => {
      // Use a processor with faster retries for testing
      const fastProcessor = new ChunkProcessor({ maxRetries: 1, retryDelayMs: 10 });
      fastProcessor.setProgressCallback(mockProgressCallback);
      
      mockTranscriptionFn
        .mockResolvedValueOnce({ text: 'First chunk success', confidence: 0.9 })
        .mockRejectedValue(new Error('Second chunk failed'));

      const result = await fastProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(true);
      expect(result.stats.successfulChunks).toBe(1);
      expect(result.stats.failedChunks).toBe(1);
    }, 10000);

    it('should fail on partial transcription failure when continueOnPartialFailure is false', async () => {
      const strictProcessor = new ChunkProcessor({ 
        continueOnPartialFailure: false, 
        maxRetries: 1, 
        retryDelayMs: 10 
      });
      strictProcessor.setProgressCallback(mockProgressCallback);
      
      mockTranscriptionFn
        .mockResolvedValueOnce({ text: 'First chunk success', confidence: 0.9 })
        .mockRejectedValue(new Error('Second chunk failed'));

      const result = await strictProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Only 1 of 2 chunks transcribed successfully');
    }, 10000);

    it('should handle merging failure', async () => {
      MockedTranscriptMerger.mergeChunkResults.mockImplementation(() => {
        throw new Error('Merging failed');
      });

      const result = await processor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Failed to merge chunk results');
    });

    it('should handle empty transcript results', async () => {
      // Use a processor with faster retries for testing
      const fastProcessor = new ChunkProcessor({ maxRetries: 1, retryDelayMs: 10 });
      fastProcessor.setProgressCallback(mockProgressCallback);
      
      mockTranscriptionFn.mockResolvedValue({ text: '', confidence: 0.5 });

      const result = await fastProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('All chunks failed to transcribe');
    }, 10000);

    it('should handle cancellation', async () => {
      // Mock a slow transcription function
      mockTranscriptionFn.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ text: 'test', confidence: 0.9 }), 1000))
      );

      const processingPromise = processor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);
      
      // Cancel after a short delay
      setTimeout(() => processor.cancel(), 100);
      
      const result = await processingPromise;

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Processing was cancelled');
    });
  });

  describe('configuration management', () => {
    it('should update chunking options', () => {
      const newOptions = { chunkDuration: 30, overlapDuration: 3 };
      processor.updateChunkingOptions(newOptions);
      
      const options = processor.getChunkingOptions();
      expect(options.chunkDuration).toBe(30);
      expect(options.overlapDuration).toBe(3);
    });

    it('should update processor config', () => {
      const newConfig = { maxRetries: 5, retryDelayMs: 2000 };
      processor.updateConfig(newConfig);
      
      const config = processor.getConfig();
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelayMs).toBe(2000);
    });
  });

  describe('utility methods', () => {
    it('should estimate processing time correctly', () => {
      const audioDuration = 120; // 2 minutes
      const sampleRate = 16000;
      
      const estimatedTime = processor.estimateProcessingTime(audioDuration, sampleRate);
      
      // Should be reasonable estimate (chunks * time per chunk + overhead)
      expect(estimatedTime).toBeGreaterThan(10000); // At least 10 seconds
      expect(estimatedTime).toBeLessThan(60000); // Less than 60 seconds
    });

    it('should determine when chunking is needed', () => {
      expect(ChunkProcessor.shouldUseChunking(25)).toBe(false);
      expect(ChunkProcessor.shouldUseChunking(30)).toBe(false);
      expect(ChunkProcessor.shouldUseChunking(35)).toBe(true);
      expect(ChunkProcessor.shouldUseChunking(120)).toBe(true);
    });
  });

  describe('error handling and retry logic', () => {
    const mockAudioData = new Float32Array([0.1, 0.2]);
    const sampleRate = 16000;
    const mockChunk: AudioChunk = {
      id: 'chunk-0',
      startTime: 0,
      endTime: 25,
      audioData: new Float32Array([0.1, 0.2]),
      overlapStart: 0,
      overlapEnd: 0
    };

    beforeEach(() => {
      MockedAudioSplitter.validateChunkingParameters.mockImplementation(() => {});
      MockedAudioSplitter.splitAudio.mockReturnValue([mockChunk]);
      MockedTranscriptMerger.mergeChunkResults.mockReturnValue('test result');
    });

    it('should retry failed transcriptions with exponential backoff', async () => {
      const retryProcessor = new ChunkProcessor({ maxRetries: 2, retryDelayMs: 100 });
      retryProcessor.setProgressCallback(mockProgressCallback);

      mockTranscriptionFn
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValueOnce({ text: 'Success', confidence: 0.9 });

      const startTime = Date.now();
      const result = await retryProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(mockTranscriptionFn).toHaveBeenCalledTimes(3);
      
      // Should have waited for retries (100ms + 200ms = 300ms minimum)
      expect(endTime - startTime).toBeGreaterThan(250);
    });

    it('should respect chunk timeout', async () => {
      const timeoutProcessor = new ChunkProcessor({ 
        chunkTimeoutMs: 100, 
        maxRetries: 1, 
        retryDelayMs: 10 
      });
      timeoutProcessor.setProgressCallback(mockProgressCallback);

      // Mock a slow transcription function
      mockTranscriptionFn.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ text: 'test', confidence: 0.9 }), 200))
      );

      const result = await timeoutProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('All chunks failed to transcribe');
    }, 10000);

    it('should handle transcription function returning undefined text', async () => {
      // Use a processor with faster retries for testing
      const fastProcessor = new ChunkProcessor({ maxRetries: 1, retryDelayMs: 10 });
      fastProcessor.setProgressCallback(mockProgressCallback);
      
      mockTranscriptionFn.mockResolvedValue({ text: undefined as any, confidence: 0.9 });

      const result = await fastProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('All chunks failed to transcribe');
    }, 10000);
  });

  describe('progress tracking', () => {
    const mockAudioData = new Float32Array([0.1, 0.2]);
    const sampleRate = 16000;
    const mockChunk: AudioChunk = {
      id: 'chunk-0',
      startTime: 0,
      endTime: 25,
      audioData: new Float32Array([0.1, 0.2]),
      overlapStart: 0,
      overlapEnd: 0
    };

    beforeEach(() => {
      MockedAudioSplitter.validateChunkingParameters.mockImplementation(() => {});
      MockedAudioSplitter.splitAudio.mockReturnValue([mockChunk]);
      MockedTranscriptMerger.mergeChunkResults.mockReturnValue('test result');
      mockTranscriptionFn.mockResolvedValue({ text: 'test', confidence: 0.9 });
    });

    it('should track progress through all phases', async () => {
      await processor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      const progressCalls = mockProgressCallback.mock.calls.map((call: any) => call[0]);
      
      // Should have progress updates for all phases
      expect(progressCalls.some((p: any) => p.phase === 'splitting')).toBe(true);
      expect(progressCalls.some((p: any) => p.phase === 'transcribing')).toBe(true);
      expect(progressCalls.some((p: any) => p.phase === 'merging')).toBe(true);
      
      // Final progress should show completion
      const finalProgress = progressCalls[progressCalls.length - 1];
      expect(finalProgress.chunkProgress).toBe(100);
    });

    it('should update chunk progress during transcription', async () => {
      await processor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      const transcribingProgress = mockProgressCallback.mock.calls
        .map((call: any) => call[0])
        .filter((p: any) => p.phase === 'transcribing');
      
      expect(transcribingProgress.length).toBeGreaterThan(1);
      expect(transcribingProgress.some((p: any) => p.chunkProgress === 0)).toBe(true);
      expect(transcribingProgress.some((p: any) => p.chunkProgress === 100)).toBe(true);
    });
  });

  describe('concurrent processing', () => {
    const mockAudioData = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const sampleRate = 16000;

    const mockChunks: AudioChunk[] = [
      {
        id: 'chunk-0',
        startTime: 0,
        endTime: 25,
        audioData: new Float32Array([0.1, 0.2]),
        overlapStart: 0,
        overlapEnd: 2.5
      },
      {
        id: 'chunk-1',
        startTime: 22.5,
        endTime: 47.5,
        audioData: new Float32Array([0.3, 0.4]),
        overlapStart: 2.5,
        overlapEnd: 2.5
      },
      {
        id: 'chunk-2',
        startTime: 45,
        endTime: 70,
        audioData: new Float32Array([0.5, 0.6]),
        overlapStart: 2.5,
        overlapEnd: 0
      }
    ];

    beforeEach(() => {
      MockedAudioSplitter.validateChunkingParameters.mockImplementation(() => {});
      MockedAudioSplitter.splitAudio.mockReturnValue(mockChunks);
      MockedTranscriptMerger.mergeChunkResults.mockReturnValue('chunk 0 chunk 1 chunk 2');
    });

    it('should process chunks concurrently with maxConcurrency limit', async () => {
      const concurrentProcessor = new ChunkProcessor({}, { maxConcurrency: 2 });
      concurrentProcessor.setProgressCallback(mockProgressCallback);

      let activeTranscriptions = 0;
      let maxConcurrentTranscriptions = 0;

      mockTranscriptionFn.mockImplementation(async () => {
        activeTranscriptions++;
        maxConcurrentTranscriptions = Math.max(maxConcurrentTranscriptions, activeTranscriptions);
        
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 50));
        
        activeTranscriptions--;
        return { text: 'test transcript', confidence: 0.9 };
      });

      const result = await concurrentProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(true);
      expect(result.stats.totalChunks).toBe(3);
      expect(result.stats.successfulChunks).toBe(3);
      
      // Should not exceed maxConcurrency limit
      expect(maxConcurrentTranscriptions).toBeLessThanOrEqual(2);
      expect(maxConcurrentTranscriptions).toBeGreaterThan(1); // Should actually use concurrency
    });

    it('should handle concurrent processing with failures', async () => {
      const concurrentProcessor = new ChunkProcessor({ maxRetries: 1, retryDelayMs: 10 }, { maxConcurrency: 3 });
      concurrentProcessor.setProgressCallback(mockProgressCallback);

      mockTranscriptionFn
        .mockResolvedValueOnce({ text: 'chunk 0 success', confidence: 0.9 })
        .mockRejectedValueOnce(new Error('chunk 1 failed'))
        .mockRejectedValueOnce(new Error('chunk 1 retry failed'))
        .mockResolvedValueOnce({ text: 'chunk 2 success', confidence: 0.8 });

      const result = await concurrentProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(true);
      expect(result.stats.totalChunks).toBe(3);
      expect(result.stats.successfulChunks).toBe(2);
      expect(result.stats.failedChunks).toBe(1);
    }, 10000);

    it('should clean up memory for processed chunks', async () => {
      const concurrentProcessor = new ChunkProcessor({}, { maxConcurrency: 2 });
      concurrentProcessor.setProgressCallback(mockProgressCallback);

      // Create fresh chunks with actual audio data for this test
      const testChunks: AudioChunk[] = [
        {
          id: 'chunk-0',
          startTime: 0,
          endTime: 25,
          audioData: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]),
          overlapStart: 0,
          overlapEnd: 2.5
        },
        {
          id: 'chunk-1',
          startTime: 22.5,
          endTime: 47.5,
          audioData: new Float32Array([0.6, 0.7, 0.8, 0.9, 1.0]),
          overlapStart: 2.5,
          overlapEnd: 0
        }
      ];

      MockedAudioSplitter.splitAudio.mockReturnValue(testChunks);
      const originalAudioDataSizes = testChunks.map(chunk => chunk.audioData.length);

      mockTranscriptionFn.mockResolvedValue({ text: 'test', confidence: 0.9 });

      await concurrentProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      // Check that audio data has been cleaned up (set to empty arrays)
      testChunks.forEach((chunk, index) => {
        expect(chunk.audioData.length).toBeLessThan(originalAudioDataSizes[index]);
        expect(chunk.audioData.length).toBe(0); // Should be completely cleaned up
      });
    });

    it('should aggregate progress across concurrent operations', async () => {
      const concurrentProcessor = new ChunkProcessor({}, { maxConcurrency: 2 });
      concurrentProcessor.setProgressCallback(mockProgressCallback);

      mockTranscriptionFn.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { text: 'test', confidence: 0.9 };
      });

      await concurrentProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      const progressCalls = mockProgressCallback.mock.calls.map((call: any) => call[0]);
      const transcribingProgress = progressCalls.filter((p: any) => p.phase === 'transcribing');

      // Should have progress updates showing concurrent processing
      expect(transcribingProgress.length).toBeGreaterThan(3); // More updates due to concurrent processing
      
      // Should show progress from 0 to 100
      const progressValues = transcribingProgress.map((p: any) => p.chunkProgress);
      expect(Math.min(...progressValues)).toBe(0);
      expect(Math.max(...progressValues)).toBe(100);
    });

    it('should handle cancellation during concurrent processing', async () => {
      const concurrentProcessor = new ChunkProcessor({}, { maxConcurrency: 2 });
      concurrentProcessor.setProgressCallback(mockProgressCallback);

      mockTranscriptionFn.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return { text: 'test', confidence: 0.9 };
      });

      const processingPromise = concurrentProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);
      
      // Cancel after a short delay
      setTimeout(() => concurrentProcessor.cancel(), 100);
      
      const result = await processingPromise;

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('Processing was cancelled');
    });

    it('should respect maxConcurrency of 1 (sequential processing)', async () => {
      const sequentialProcessor = new ChunkProcessor({}, { maxConcurrency: 1 });
      sequentialProcessor.setProgressCallback(mockProgressCallback);

      let activeTranscriptions = 0;
      let maxConcurrentTranscriptions = 0;

      mockTranscriptionFn.mockImplementation(async () => {
        activeTranscriptions++;
        maxConcurrentTranscriptions = Math.max(maxConcurrentTranscriptions, activeTranscriptions);
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        activeTranscriptions--;
        return { text: 'test transcript', confidence: 0.9 };
      });

      const result = await sequentialProcessor.processChunks(mockAudioData, sampleRate, mockTranscriptionFn);

      expect(result.success).toBe(true);
      expect(maxConcurrentTranscriptions).toBe(1); // Should never exceed 1
    });
  });
});