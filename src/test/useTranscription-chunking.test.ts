import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import useTranscription from '../hooks/useTranscription';
import { DEFAULT_CHUNKING_OPTIONS } from '../types/chunking';

describe('useTranscription - Chunking State', () => {
  it('should initialize with correct chunking state', () => {
    const { result } = renderHook(() => useTranscription());

    expect(result.current.isChunking).toBe(false);
    expect(result.current.chunkingProgress).toBe(null);
    expect(result.current.chunkResults).toEqual([]);
    expect(result.current.chunkingOptions).toEqual(DEFAULT_CHUNKING_OPTIONS);
  });

  it('should provide chunking state management functions', () => {
    const { result } = renderHook(() => useTranscription());

    expect(typeof result.current.setChunkingOptions).toBe('function');
    expect(typeof result.current.resetChunkingState).toBe('function');
    expect(typeof result.current.updateChunkingProgress).toBe('function');
    expect(typeof result.current.addChunkResult).toBe('function');
    expect(typeof result.current.setChunkingState).toBe('function');
  });

  it('should update chunking options correctly', () => {
    const { result } = renderHook(() => useTranscription());

    const newOptions = {
      ...DEFAULT_CHUNKING_OPTIONS,
      chunkDuration: 30,
      maxConcurrency: 3,
    };

    act(() => {
      result.current.setChunkingOptions(newOptions);
    });

    expect(result.current.chunkingOptions).toEqual(newOptions);
  });

  it('should manage chunking state correctly', () => {
    const { result } = renderHook(() => useTranscription());

    // Start chunking
    act(() => {
      result.current.setChunkingState(true);
    });

    expect(result.current.isChunking).toBe(true);

    // Stop chunking
    act(() => {
      result.current.setChunkingState(false);
    });

    expect(result.current.isChunking).toBe(false);
    expect(result.current.chunkingProgress).toBe(null);
  });

  it('should update chunking progress correctly', () => {
    const { result } = renderHook(() => useTranscription());

    const progress = {
      totalChunks: 5,
      completedChunks: 2,
      currentChunk: 2,
      phase: 'transcribing' as const,
      chunkProgress: 50,
    };

    act(() => {
      result.current.updateChunkingProgress(progress);
    });

    expect(result.current.chunkingProgress).toEqual(progress);
  });

  it('should add chunk results correctly', () => {
    const { result } = renderHook(() => useTranscription());

    const chunkResult = {
      id: 'chunk-1',
      transcript: 'Hello world',
      startTime: 0,
      endTime: 25,
      overlapStart: 0,
      overlapEnd: 2.5,
    };

    act(() => {
      result.current.addChunkResult(chunkResult);
    });

    expect(result.current.chunkResults).toHaveLength(1);
    expect(result.current.chunkResults[0]).toEqual(chunkResult);

    // Add another chunk result
    const chunkResult2 = {
      id: 'chunk-2',
      transcript: 'This is a test',
      startTime: 22.5,
      endTime: 47.5,
      overlapStart: 2.5,
      overlapEnd: 2.5,
    };

    act(() => {
      result.current.addChunkResult(chunkResult2);
    });

    expect(result.current.chunkResults).toHaveLength(2);
    expect(result.current.chunkResults[1]).toEqual(chunkResult2);
  });

  it('should reset chunking state correctly', () => {
    const { result } = renderHook(() => useTranscription());

    // Set up some chunking state
    act(() => {
      result.current.setChunkingState(true);
      result.current.updateChunkingProgress({
        totalChunks: 3,
        completedChunks: 1,
        currentChunk: 1,
        phase: 'transcribing',
        chunkProgress: 75,
      });
      result.current.addChunkResult({
        id: 'chunk-1',
        transcript: 'Test',
        startTime: 0,
        endTime: 25,
        overlapStart: 0,
        overlapEnd: 2.5,
      });
    });

    // Verify state is set
    expect(result.current.isChunking).toBe(true);
    expect(result.current.chunkingProgress).not.toBe(null);
    expect(result.current.chunkResults).toHaveLength(1);

    // Reset state
    act(() => {
      result.current.resetChunkingState();
    });

    // Verify state is reset
    expect(result.current.isChunking).toBe(false);
    expect(result.current.chunkingProgress).toBe(null);
    expect(result.current.chunkResults).toEqual([]);
  });

  it('should maintain backward compatibility with existing API', () => {
    const { result } = renderHook(() => useTranscription());

    // All existing properties should still be available
    expect(result.current.transcript).toBeDefined();
    expect(result.current.setTranscript).toBeDefined();
    expect(result.current.loading).toBeDefined();
    expect(result.current.modelLoading).toBeDefined();
    expect(result.current.progress).toBeDefined();
    expect(result.current.selectedModel).toBeDefined();
    expect(result.current.setSelectedModel).toBeDefined();
    expect(result.current.error).toBeDefined();
    expect(result.current.audioDebugInfo).toBeDefined();
    expect(result.current.transcribe).toBeDefined();

    // Existing properties should have correct initial values
    expect(result.current.transcript).toBe('');
    expect(result.current.loading).toBe(false);
    expect(result.current.modelLoading).toBe(false);
    expect(result.current.progress).toBe(0);
    expect(result.current.selectedModel).toBe('tiny.en');
    expect(result.current.error).toBe(null);
    expect(result.current.audioDebugInfo).toBe(null);
    expect(typeof result.current.transcribe).toBe('function');
  });
});