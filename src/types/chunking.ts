/**
 * Audio chunking types and interfaces for handling long audio transcription
 * 
 * This module defines all the core types used in the audio chunking system
 * that enables transcription of audio files longer than 30 seconds.
 */

/**
 * Represents a single audio chunk with timing and overlap information
 */
export interface AudioChunk {
  /** Unique identifier for this chunk */
  id: string;
  
  /** Start time of the chunk in seconds */
  startTime: number;
  
  /** End time of the chunk in seconds */
  endTime: number;
  
  /** The actual audio data for this chunk */
  audioData: Float32Array;
  
  /** Duration of overlap with the previous chunk in seconds */
  overlapStart: number;
  
  /** Duration of overlap with the next chunk in seconds */
  overlapEnd: number;
}

/**
 * Represents the transcription result from a single audio chunk
 */
export interface ChunkResult {
  /** Unique identifier matching the corresponding AudioChunk */
  id: string;
  
  /** The transcribed text for this chunk */
  transcript: string;
  
  /** Optional confidence score for the transcription (0-1) */
  confidence?: number;
  
  /** Start time of the chunk in seconds */
  startTime: number;
  
  /** End time of the chunk in seconds */
  endTime: number;
  
  /** Duration of overlap with the previous chunk in seconds */
  overlapStart: number;
  
  /** Duration of overlap with the next chunk in seconds */
  overlapEnd: number;
}

/**
 * Tracks the progress of the chunking operation across all phases
 */
export interface ChunkingProgress {
  /** Total number of chunks to be processed */
  totalChunks: number;
  
  /** Number of chunks that have been completed */
  completedChunks: number;
  
  /** Index of the chunk currently being processed (0-based) */
  currentChunk: number;
  
  /** Current phase of the chunking operation */
  phase: 'splitting' | 'transcribing' | 'merging';
  
  /** Progress within the current chunk as a percentage (0-100) */
  chunkProgress: number;
}

/**
 * Configuration options for the audio chunking process
 */
export interface ChunkingOptions {
  /** Duration of each chunk in seconds (default: 25) */
  chunkDuration: number;
  
  /** Duration of overlap between adjacent chunks in seconds (default: 2.5) */
  overlapDuration: number;
  
  /** Maximum number of chunks to process concurrently (default: 2) */
  maxConcurrency: number;
  
  /** Audio level threshold for silence detection (0-1, default: 0.01) */
  silenceThreshold: number;
  
  /** Whether to prefer splitting at natural silence boundaries (default: true) */
  preferSilenceBoundaries: boolean;
}

/**
 * Default chunking configuration values
 */
export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  chunkDuration: 25,
  overlapDuration: 2.5,
  maxConcurrency: 2,
  silenceThreshold: 0.01,
  preferSilenceBoundaries: true,
};

/**
 * Type guard to check if an object is a valid AudioChunk
 */
export function isAudioChunk(obj: any): obj is AudioChunk {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.startTime === 'number' &&
    typeof obj.endTime === 'number' &&
    obj.audioData instanceof Float32Array &&
    typeof obj.overlapStart === 'number' &&
    typeof obj.overlapEnd === 'number'
  );
}

/**
 * Type guard to check if an object is a valid ChunkResult
 */
export function isChunkResult(obj: any): obj is ChunkResult {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.id === 'string' &&
    typeof obj.transcript === 'string' &&
    typeof obj.startTime === 'number' &&
    typeof obj.endTime === 'number' &&
    typeof obj.overlapStart === 'number' &&
    typeof obj.overlapEnd === 'number' &&
    (obj.confidence === undefined || typeof obj.confidence === 'number')
  );
}

/**
 * Type guard to check if an object is a valid ChunkingProgress
 */
export function isChunkingProgress(obj: any): obj is ChunkingProgress {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.totalChunks === 'number' &&
    typeof obj.completedChunks === 'number' &&
    typeof obj.currentChunk === 'number' &&
    ['splitting', 'transcribing', 'merging'].includes(obj.phase) &&
    typeof obj.chunkProgress === 'number'
  );
}

/**
 * Enhanced error class for chunking operations with specific context
 */
export class ChunkingError extends Error {
  /** The phase during which the error occurred */
  public readonly phase: 'splitting' | 'transcribing' | 'merging' | 'validation' | 'cleanup';
  
  /** The chunk ID if the error is chunk-specific */
  public readonly chunkId?: string;
  
  /** The chunk index if the error is chunk-specific */
  public readonly chunkIndex?: number;
  
  /** The attempt number if this was a retry */
  public readonly attemptNumber?: number;
  
  /** The original error that caused this chunking error */
  public readonly originalError?: Error;
  
  /** Additional context information */
  public readonly context?: Record<string, any>;
  
  /** Whether this error is recoverable */
  public readonly recoverable: boolean;
  
  constructor(
    message: string,
    phase: ChunkingError['phase'],
    options: {
      chunkId?: string;
      chunkIndex?: number;
      attemptNumber?: number;
      originalError?: Error;
      context?: Record<string, any>;
      recoverable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'ChunkingError';
    this.phase = phase;
    this.chunkId = options.chunkId;
    this.chunkIndex = options.chunkIndex;
    this.attemptNumber = options.attemptNumber;
    this.originalError = options.originalError;
    this.context = options.context;
    this.recoverable = options.recoverable ?? true;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChunkingError);
    }
  }
  
  /**
   * Creates a detailed error message with context
   */
  getDetailedMessage(): string {
    let message = `[${this.phase.toUpperCase()}] ${this.message}`;
    
    if (this.chunkId) {
      message += ` (Chunk: ${this.chunkId}`;
      if (this.chunkIndex !== undefined) {
        message += ` #${this.chunkIndex}`;
      }
      message += ')';
    }
    
    if (this.attemptNumber !== undefined) {
      message += ` (Attempt: ${this.attemptNumber})`;
    }
    
    if (this.originalError) {
      message += ` - Original: ${this.originalError.message}`;
    }
    
    if (this.context && Object.keys(this.context).length > 0) {
      const contextStr = Object.entries(this.context)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
      message += ` - Context: {${contextStr}}`;
    }
    
    return message;
  }
  
  /**
   * Converts this error to a plain object for serialization
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      phase: this.phase,
      chunkId: this.chunkId,
      chunkIndex: this.chunkIndex,
      attemptNumber: this.attemptNumber,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        stack: this.originalError.stack
      } : undefined,
      context: this.context,
      recoverable: this.recoverable,
      stack: this.stack
    };
  }
}