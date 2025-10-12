/**
 * ChunkProcessor class for orchestrating the complete audio chunking workflow
 * 
 * This class manages the end-to-end process of splitting long audio files into chunks,
 * transcribing each chunk, and merging the results into a coherent transcript.
 * It provides progress tracking, error handling, and retry logic for robust processing.
 */

import type { 
  AudioChunk, 
  ChunkResult, 
  ChunkingProgress, 
  ChunkingOptions 
} from '../types/chunking';
import { DEFAULT_CHUNKING_OPTIONS, ChunkingError } from '../types/chunking';
import { AudioSplitter } from './audioSplitter';
import { TranscriptMerger } from './transcriptMerger';

/**
 * Configuration for the ChunkProcessor
 */
export interface ChunkProcessorConfig {
  /** Maximum number of retry attempts for failed chunks */
  maxRetries: number;
  
  /** Base delay for exponential backoff in milliseconds */
  retryDelayMs: number;
  
  /** Whether to continue processing if some chunks fail */
  continueOnPartialFailure: boolean;
  
  /** Timeout for individual chunk processing in milliseconds */
  chunkTimeoutMs: number;
}

/**
 * Default configuration for ChunkProcessor
 */
export const DEFAULT_CHUNK_PROCESSOR_CONFIG: ChunkProcessorConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  continueOnPartialFailure: true,
  chunkTimeoutMs: 60000, // 60 seconds per chunk
};

/**
 * Represents the result of chunk processing with success/failure information
 */
export interface ChunkProcessingResult {
  /** Whether the processing completed successfully */
  success: boolean;
  
  /** The final merged transcript (if successful) */
  transcript: string;
  
  /** Individual chunk results */
  chunkResults: ChunkResult[];
  
  /** Any errors that occurred during processing */
  errors: ChunkingError[];
  
  /** Processing statistics */
  stats: {
    totalChunks: number;
    successfulChunks: number;
    failedChunks: number;
    totalProcessingTime: number;
    retryAttempts: number;
    memoryCleanupEvents: number;
  };
}



/**
 * Progress callback function type
 */
export type ProgressCallback = (progress: ChunkingProgress) => void;

/**
 * Transcription function type that matches the existing useTranscription pattern
 */
export type TranscriptionFunction = (audioData: Float32Array) => Promise<{ text: string; confidence?: number }>;

/**
 * ChunkProcessor manages the complete chunking workflow for long audio transcription
 */
export class ChunkProcessor {
  private config: ChunkProcessorConfig;
  private chunkingOptions: ChunkingOptions;
  private progressCallback?: ProgressCallback;
  private abortController?: AbortController;
  
  constructor(
    config: Partial<ChunkProcessorConfig> = {},
    chunkingOptions: Partial<ChunkingOptions> = {}
  ) {
    this.config = { ...DEFAULT_CHUNK_PROCESSOR_CONFIG, ...config };
    this.chunkingOptions = { ...DEFAULT_CHUNKING_OPTIONS, ...chunkingOptions };
  }
  
  /**
   * Sets the progress callback function
   * 
   * @param callback Function to call with progress updates
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }
  
  /**
   * Processes audio chunks through the complete workflow
   * 
   * @param audioData The audio data to process
   * @param sampleRate The sample rate of the audio
   * @param transcriptionFn Function to transcribe individual chunks
   * @returns Promise resolving to the processing result
   */
  async processChunks(
    audioData: Float32Array,
    sampleRate: number,
    transcriptionFn: TranscriptionFunction
  ): Promise<ChunkProcessingResult> {
    const startTime = Date.now();
    this.abortController = new AbortController();
    const errors: ChunkingError[] = [];
    let retryAttempts = 0;
    let memoryCleanupEvents = 0;
    
    try {
      // Validate input parameters
      this.validateInputs(audioData, sampleRate);
      
      // Phase 1: Split audio into chunks
      this.updateProgress({
        totalChunks: 0,
        completedChunks: 0,
        currentChunk: 0,
        phase: 'splitting',
        chunkProgress: 0
      });
      
      const chunks = await this.splitAudioIntoChunks(audioData, sampleRate);
      
      if (chunks.length === 0) {
        throw new ChunkingError(
          'No chunks were created from the audio data',
          'splitting',
          {
            context: { 
              audioDuration: audioData.length / sampleRate,
              audioLength: audioData.length,
              sampleRate,
              chunkingOptions: this.chunkingOptions
            },
            recoverable: false
          }
        );
      }
      
      // Phase 2: Transcribe chunks
      this.updateProgress({
        totalChunks: chunks.length,
        completedChunks: 0,
        currentChunk: 0,
        phase: 'transcribing',
        chunkProgress: 0
      });
      
      const { chunkResults, transcriptionErrors, totalRetries } = await this.transcribeChunks(chunks, transcriptionFn);
      errors.push(...transcriptionErrors);
      retryAttempts = totalRetries;
      
      // Phase 3: Merge results
      this.updateProgress({
        totalChunks: chunks.length,
        completedChunks: chunkResults.filter(r => r !== null).length,
        currentChunk: chunks.length,
        phase: 'merging',
        chunkProgress: 0
      });
      
      const mergedTranscript = await this.mergeChunkResults(chunkResults);
      
      // Calculate final statistics
      const successfulResults = chunkResults.filter(r => r !== null);
      const processingTime = Date.now() - startTime;
      
      const result: ChunkProcessingResult = {
        success: successfulResults.length > 0,
        transcript: mergedTranscript,
        chunkResults: successfulResults,
        errors,
        stats: {
          totalChunks: chunks.length,
          successfulChunks: successfulResults.length,
          failedChunks: chunks.length - successfulResults.length,
          totalProcessingTime: processingTime,
          retryAttempts,
          memoryCleanupEvents
        }
      };
      
      // Final progress update
      this.updateProgress({
        totalChunks: chunks.length,
        completedChunks: successfulResults.length,
        currentChunk: chunks.length,
        phase: 'merging',
        chunkProgress: 100
      });
      
      return result;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Ensure we have a ChunkingError
      const chunkingError = error instanceof ChunkingError 
        ? error 
        : new ChunkingError(
            error instanceof Error ? error.message : String(error),
            'validation',
            { 
              originalError: error instanceof Error ? error : undefined,
              context: { 
                audioDuration: audioData.length / sampleRate,
                audioLength: audioData.length,
                sampleRate 
              },
              recoverable: false
            }
          );
      
      // Perform emergency cleanup
      try {
        await this.emergencyCleanup();
        memoryCleanupEvents++;
      } catch (cleanupError) {
        console.warn('Emergency cleanup failed:', cleanupError);
      }
      
      return {
        success: false,
        transcript: '',
        chunkResults: [],
        errors: [chunkingError, ...errors],
        stats: {
          totalChunks: 0,
          successfulChunks: 0,
          failedChunks: 0,
          totalProcessingTime: processingTime,
          retryAttempts,
          memoryCleanupEvents
        }
      };
    } finally {
      try {
        await this.cleanup();
        memoryCleanupEvents++;
      } catch (cleanupError) {
        console.warn('Final cleanup failed:', cleanupError);
      }
    }
  }
  
  /**
   * Cancels the current processing operation
   */
  cancel(): void {
    try {
      if (this.abortController && !this.abortController.signal.aborted) {
        this.abortController.abort();
        console.info('ChunkProcessor: Processing cancelled by user');
      }
    } catch (error) {
      console.warn('Error during cancellation:', error);
    }
  }
  
  /**
   * Gets a summary of errors from a processing result
   * 
   * @param result The processing result to analyze
   * @returns Error summary with categorized information
   */
  static getErrorSummary(result: ChunkProcessingResult): {
    totalErrors: number;
    errorsByPhase: Record<string, number>;
    recoverableErrors: number;
    criticalErrors: number;
    retryableErrors: number;
    timeoutErrors: number;
    emptyResultErrors: number;
    mostCommonError: string | null;
  } {
    const errors = result.errors;
    const summary = {
      totalErrors: errors.length,
      errorsByPhase: {} as Record<string, number>,
      recoverableErrors: 0,
      criticalErrors: 0,
      retryableErrors: 0,
      timeoutErrors: 0,
      emptyResultErrors: 0,
      mostCommonError: null as string | null
    };
    
    if (errors.length === 0) {
      return summary;
    }
    
    const errorMessages: Record<string, number> = {};
    
    for (const error of errors) {
      // Count by phase
      summary.errorsByPhase[error.phase] = (summary.errorsByPhase[error.phase] || 0) + 1;
      
      // Count by type
      if (error.recoverable) {
        summary.recoverableErrors++;
      } else {
        summary.criticalErrors++;
      }
      
      // Count specific error types
      if (error.context?.isTimeout) {
        summary.timeoutErrors++;
      }
      
      if (error.context?.isEmptyResult) {
        summary.emptyResultErrors++;
      }
      
      if (error.attemptNumber && error.attemptNumber > 1) {
        summary.retryableErrors++;
      }
      
      // Track most common error message
      const baseMessage = error.message.split(':')[0]; // Get base message without details
      errorMessages[baseMessage] = (errorMessages[baseMessage] || 0) + 1;
    }
    
    // Find most common error
    let maxCount = 0;
    for (const [message, count] of Object.entries(errorMessages)) {
      if (count > maxCount) {
        maxCount = count;
        summary.mostCommonError = message;
      }
    }
    
    return summary;
  }
  
  /**
   * Validates input parameters
   * 
   * @param audioData The audio data to validate
   * @param sampleRate The sample rate to validate
   */
  private validateInputs(audioData: Float32Array, sampleRate: number): void {
    if (!audioData || audioData.length === 0) {
      throw new ChunkingError(
        'Audio data cannot be empty',
        'validation',
        {
          context: { audioDataType: typeof audioData, audioLength: audioData?.length || 0 },
          recoverable: false
        }
      );
    }
    
    if (sampleRate <= 0) {
      throw new ChunkingError(
        'Sample rate must be positive',
        'validation',
        {
          context: { sampleRate, sampleRateType: typeof sampleRate },
          recoverable: false
        }
      );
    }
    
    // Validate audio duration
    const duration = audioData.length / sampleRate;
    if (duration < 0.1) {
      throw new ChunkingError(
        'Audio duration is too short for chunking',
        'validation',
        {
          context: { duration, minDuration: 0.1, audioLength: audioData.length, sampleRate },
          recoverable: false
        }
      );
    }
    
    // Validate chunking options
    try {
      AudioSplitter.validateChunkingParameters(audioData, sampleRate, this.chunkingOptions);
    } catch (error) {
      throw new ChunkingError(
        'Invalid chunking parameters',
        'validation',
        {
          originalError: error instanceof Error ? error : undefined,
          context: { 
            chunkingOptions: this.chunkingOptions,
            audioDuration: duration,
            audioLength: audioData.length,
            sampleRate
          },
          recoverable: false
        }
      );
    }
  }
  
  /**
   * Splits audio into chunks using AudioSplitter
   * 
   * @param audioData The audio data to split
   * @param sampleRate The sample rate of the audio
   * @returns Promise resolving to array of audio chunks
   */
  private async splitAudioIntoChunks(
    audioData: Float32Array,
    sampleRate: number
  ): Promise<AudioChunk[]> {
    try {
      this.updateProgress({
        totalChunks: 0,
        completedChunks: 0,
        currentChunk: 0,
        phase: 'splitting',
        chunkProgress: 50
      });
      
      const chunks = AudioSplitter.splitAudio(audioData, sampleRate, this.chunkingOptions);
      
      // Validate chunks were created successfully
      if (!chunks || chunks.length === 0) {
        throw new ChunkingError(
          'Audio splitter returned no chunks',
          'splitting',
          {
            context: {
              audioDuration: audioData.length / sampleRate,
              audioLength: audioData.length,
              sampleRate,
              chunkingOptions: this.chunkingOptions
            },
            recoverable: false
          }
        );
      }
      
      // Validate chunk integrity
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk.audioData || chunk.audioData.length === 0) {
          throw new ChunkingError(
            `Chunk ${i} has empty audio data`,
            'splitting',
            {
              chunkId: chunk.id,
              chunkIndex: i,
              context: {
                chunkStartTime: chunk.startTime,
                chunkEndTime: chunk.endTime,
                totalChunks: chunks.length
              },
              recoverable: false
            }
          );
        }
      }
      
      this.updateProgress({
        totalChunks: chunks.length,
        completedChunks: 0,
        currentChunk: 0,
        phase: 'splitting',
        chunkProgress: 100
      });
      
      return chunks;
      
    } catch (error) {
      if (error instanceof ChunkingError) {
        throw error;
      }
      
      throw new ChunkingError(
        'Failed to split audio into chunks',
        'splitting',
        {
          originalError: error instanceof Error ? error : undefined,
          context: {
            audioDuration: audioData.length / sampleRate,
            audioLength: audioData.length,
            sampleRate,
            chunkingOptions: this.chunkingOptions
          },
          recoverable: false
        }
      );
    }
  }
  
  /**
   * Transcribes all chunks with error handling and retry logic
   * Uses concurrent processing with configurable limits and queue management
   * 
   * @param chunks Array of audio chunks to transcribe
   * @param transcriptionFn Function to transcribe individual chunks
   * @returns Promise resolving to transcription results with errors
   */
  private async transcribeChunks(
    chunks: AudioChunk[],
    transcriptionFn: TranscriptionFunction
  ): Promise<{
    chunkResults: (ChunkResult | null)[];
    transcriptionErrors: ChunkingError[];
    totalRetries: number;
  }> {
    const results: (ChunkResult | null)[] = new Array(chunks.length).fill(null);
    const errors: ChunkingError[] = [];
    let totalRetries = 0;
    
    // Use concurrent processing with configurable limits
    const maxConcurrency = this.chunkingOptions.maxConcurrency;
    const processingQueue = new ChunkProcessingQueue(maxConcurrency);
    
    // Track progress across concurrent operations
    const progressTracker = new ConcurrentProgressTracker(chunks.length);
    
    try {
      // Create processing tasks for all chunks
      const processingTasks = chunks.map((chunk, index) => 
        this.createChunkProcessingTask(chunk, index, transcriptionFn, progressTracker, results, errors)
      );
      
      // Process chunks concurrently with queue management
      await processingQueue.processAll(processingTasks, this.abortController?.signal);
      
      // Collect retry statistics
      totalRetries = errors.reduce((sum, error) => {
        return sum + (error.attemptNumber || 0);
      }, 0);
      
      // Check if we have enough successful results to continue
      const successfulResults = results.filter(r => r !== null);
      if (successfulResults.length === 0) {
        if (this.abortController?.signal.aborted) {
          throw new ChunkingError(
            'Processing was cancelled by user',
            'transcribing',
            {
              context: {
                totalChunks: chunks.length,
                processedChunks: 0,
                cancelledAt: Date.now()
              },
              recoverable: false
            }
          );
        }
        
        throw new ChunkingError(
          'All chunks failed to transcribe',
          'transcribing',
          {
            context: {
              totalChunks: chunks.length,
              failedChunks: chunks.length,
              totalRetries,
              maxRetries: this.config.maxRetries,
              chunkTimeoutMs: this.config.chunkTimeoutMs
            },
            recoverable: false
          }
        );
      }
      
      if (!this.config.continueOnPartialFailure && successfulResults.length < chunks.length) {
        throw new ChunkingError(
          `Partial transcription failure: only ${successfulResults.length} of ${chunks.length} chunks succeeded`,
          'transcribing',
          {
            context: {
              totalChunks: chunks.length,
              successfulChunks: successfulResults.length,
              failedChunks: chunks.length - successfulResults.length,
              continueOnPartialFailure: this.config.continueOnPartialFailure,
              totalRetries
            },
            recoverable: false
          }
        );
      }
      
      return {
        chunkResults: results,
        transcriptionErrors: errors,
        totalRetries
      };
      
    } finally {
      // Clean up processing queue and progress tracker
      try {
        processingQueue.cleanup();
        progressTracker.cleanup();
      } catch (cleanupError) {
        console.warn('Failed to cleanup transcription resources:', cleanupError);
      }
    }
  }
  
  /**
   * Transcribes a single chunk with retry logic
   * 
   * @param chunk The audio chunk to transcribe
   * @param transcriptionFn Function to transcribe the chunk
   * @param chunkIndex Index of the chunk for progress tracking
   * @param signal Optional abort signal for cancellation
   * @param errors Array to collect errors
   * @returns Promise resolving to chunk result or null if failed
   */
  private async transcribeChunkWithRetry(
    chunk: AudioChunk,
    transcriptionFn: TranscriptionFunction,
    chunkIndex: number,
    errors: ChunkingError[],
    signal?: AbortSignal
  ): Promise<ChunkResult | null> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (this.abortController?.signal.aborted || signal?.aborted) {
        errors.push(new ChunkingError(
          'Chunk transcription cancelled',
          'transcribing',
          {
            chunkId: chunk.id,
            chunkIndex,
            attemptNumber: attempt,
            context: {
              startTime: chunk.startTime,
              endTime: chunk.endTime,
              duration: chunk.endTime - chunk.startTime,
              audioDataLength: chunk.audioData.length
            },
            recoverable: false
          }
        ));
        return null;
      }
      
      try {
        // Update progress for this attempt
        const attemptProgress = (attempt / (this.config.maxRetries + 1)) * 100;
        this.updateProgress({
          totalChunks: 0, // Will be filled by caller
          completedChunks: 0, // Will be filled by caller
          currentChunk: chunkIndex,
          phase: 'transcribing',
          chunkProgress: attemptProgress
        });
        
        // Validate chunk before processing
        if (!chunk.audioData || chunk.audioData.length === 0) {
          throw new Error('Chunk has no audio data');
        }
        
        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Chunk transcription timeout')), this.config.chunkTimeoutMs);
        });
        
        // Race between transcription and timeout
        const transcriptionPromise = transcriptionFn(chunk.audioData);
        const result = await Promise.race([transcriptionPromise, timeoutPromise]);
        
        // Validate transcription result
        if (!result) {
          throw new Error('Transcription function returned null/undefined');
        }
        
        // Create chunk result
        const chunkResult: ChunkResult = {
          id: chunk.id,
          transcript: result?.text || '',
          confidence: result?.confidence,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          overlapStart: chunk.overlapStart,
          overlapEnd: chunk.overlapEnd
        };
        
        // Validate result
        if (!chunkResult.transcript.trim()) {
          throw new Error('Empty transcript returned from transcription');
        }
        
        // Success - clean up chunk memory immediately
        this.cleanupChunkMemory(chunk);
        
        return chunkResult;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Create detailed error for this attempt
        const chunkingError = new ChunkingError(
          `Chunk transcription attempt ${attempt + 1} failed: ${lastError.message}`,
          'transcribing',
          {
            chunkId: chunk.id,
            chunkIndex,
            attemptNumber: attempt + 1,
            originalError: lastError,
            context: {
              startTime: chunk.startTime,
              endTime: chunk.endTime,
              duration: chunk.endTime - chunk.startTime,
              audioDataLength: chunk.audioData.length,
              timeoutMs: this.config.chunkTimeoutMs,
              isTimeout: lastError.message.includes('timeout'),
              isEmptyResult: lastError.message.includes('Empty transcript')
            },
            recoverable: attempt < this.config.maxRetries
          }
        );
        
        errors.push(chunkingError);
        
        // Don't retry if cancelled
        if (this.abortController?.signal.aborted || signal?.aborted) {
          return null;
        }
        
        // Wait before retry (exponential backoff)
        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }
    
    // All attempts failed - clean up chunk memory
    this.cleanupChunkMemory(chunk);
    
    // Log final failure
    console.warn(`Chunk ${chunk.id} failed after ${this.config.maxRetries + 1} attempts:`, lastError);
    return null;
  }
  
  /**
   * Merges chunk results into a single transcript
   * 
   * @param chunkResults Array of chunk results (may contain nulls for failed chunks)
   * @returns Promise resolving to merged transcript
   */
  private async mergeChunkResults(chunkResults: (ChunkResult | null)[]): Promise<string> {
    try {
      this.updateProgress({
        totalChunks: 0, // Will be filled by caller
        completedChunks: 0, // Will be filled by caller
        currentChunk: 0, // Will be filled by caller
        phase: 'merging',
        chunkProgress: 50
      });
      
      // Filter out null results and sort by start time
      const validResults = chunkResults
        .filter((result): result is ChunkResult => result !== null)
        .sort((a, b) => a.startTime - b.startTime);
      
      if (validResults.length === 0) {
        throw new ChunkingError(
          'No valid chunk results to merge',
          'merging',
          {
            context: {
              totalChunkResults: chunkResults.length,
              nullResults: chunkResults.filter(r => r === null).length,
              validResults: validResults.length
            },
            recoverable: false
          }
        );
      }
      
      // Validate chunk results before merging
      for (let i = 0; i < validResults.length; i++) {
        const result = validResults[i];
        if (!result.transcript || result.transcript.trim().length === 0) {
          throw new ChunkingError(
            `Chunk result ${i} has empty transcript`,
            'merging',
            {
              chunkId: result.id,
              chunkIndex: i,
              context: {
                startTime: result.startTime,
                endTime: result.endTime,
                confidence: result.confidence,
                transcriptLength: result.transcript?.length || 0
              },
              recoverable: false
            }
          );
        }
      }
      
      const mergedTranscript = TranscriptMerger.mergeChunkResults(validResults);
      
      // Validate merged result
      if (!mergedTranscript || mergedTranscript.trim().length === 0) {
        throw new ChunkingError(
          'Merged transcript is empty',
          'merging',
          {
            context: {
              validChunks: validResults.length,
              totalTranscriptLength: validResults.reduce((sum, r) => sum + (r.transcript?.length || 0), 0),
              mergedLength: mergedTranscript?.length || 0
            },
            recoverable: false
          }
        );
      }
      
      this.updateProgress({
        totalChunks: 0, // Will be filled by caller
        completedChunks: 0, // Will be filled by caller
        currentChunk: 0, // Will be filled by caller
        phase: 'merging',
        chunkProgress: 100
      });
      
      return mergedTranscript;
      
    } catch (error) {
      if (error instanceof ChunkingError) {
        throw error;
      }
      
      throw new ChunkingError(
        'Failed to merge chunk results',
        'merging',
        {
          originalError: error instanceof Error ? error : undefined,
          context: {
            totalChunkResults: chunkResults.length,
            validResults: chunkResults.filter(r => r !== null).length,
            nullResults: chunkResults.filter(r => r === null).length
          },
          recoverable: false
        }
      );
    }
  }
  
  /**
   * Updates progress and calls the progress callback if set
   * 
   * @param progress Current progress information
   */
  private updateProgress(progress: ChunkingProgress): void {
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
  }
  
  /**
   * Utility function to sleep for a specified duration
   * 
   * @param ms Duration to sleep in milliseconds
   * @returns Promise that resolves after the specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Cleans up resources and resets state
   */
  private async cleanup(): Promise<void> {
    try {
      // Cancel any ongoing operations
      if (this.abortController && !this.abortController.signal.aborted) {
        this.abortController.abort();
      }
      
      // Clear abort controller
      this.abortController = undefined;
      
      // Force garbage collection if available (mainly for testing)
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      } else if (typeof window !== 'undefined' && (window as any).gc) {
        (window as any).gc();
      }
      
    } catch (error) {
      console.warn('Error during cleanup:', error);
    }
  }
  
  /**
   * Emergency cleanup for critical error situations
   */
  private async emergencyCleanup(): Promise<void> {
    try {
      // Immediately abort all operations
      if (this.abortController && !this.abortController.signal.aborted) {
        this.abortController.abort();
      }
      
      // Clear progress callback to prevent further updates
      this.progressCallback = undefined;
      
      // Force immediate garbage collection if available
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
      } else if (typeof window !== 'undefined' && (window as any).gc) {
        (window as any).gc();
      }
      
      // Small delay to allow cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      // Emergency cleanup should never throw
      console.error('Emergency cleanup failed:', error);
    }
  }
  
  /**
   * Gets the current chunking options
   * 
   * @returns Current chunking options
   */
  getChunkingOptions(): ChunkingOptions {
    return { ...this.chunkingOptions };
  }
  
  /**
   * Updates the chunking options
   * 
   * @param options New chunking options (partial)
   */
  updateChunkingOptions(options: Partial<ChunkingOptions>): void {
    this.chunkingOptions = { ...this.chunkingOptions, ...options };
  }
  
  /**
   * Gets the current processor configuration
   * 
   * @returns Current processor configuration
   */
  getConfig(): ChunkProcessorConfig {
    return { ...this.config };
  }
  
  /**
   * Updates the processor configuration
   * 
   * @param config New configuration (partial)
   */
  updateConfig(config: Partial<ChunkProcessorConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Estimates the processing time for given audio duration
   * 
   * @param audioDuration Duration of audio in seconds
   * @param sampleRate Sample rate of the audio
   * @returns Estimated processing time in milliseconds
   */
  estimateProcessingTime(audioDuration: number, sampleRate: number): number {
    // Rough estimation based on chunk size and processing overhead
    const chunkDuration = this.chunkingOptions.chunkDuration;
    const estimatedChunks = Math.ceil(audioDuration / chunkDuration);
    
    // Assume ~2-3 seconds per chunk for transcription + overhead
    const timePerChunk = 3000; // 3 seconds in milliseconds
    const splittingTime = 1000; // 1 second for splitting
    const mergingTime = 500; // 0.5 seconds for merging
    
    return (estimatedChunks * timePerChunk) + splittingTime + mergingTime;
  }
  
  /**
   * Checks if the given audio duration requires chunking
   * 
   * @param audioDuration Duration of audio in seconds
   * @returns True if chunking is needed, false otherwise
   */
  static shouldUseChunking(audioDuration: number): boolean {
    // Use chunking for audio longer than 30 seconds
    return audioDuration > 30;
  }
  
  /**
   * Creates a processing task for a single chunk
   * 
   * @param chunk The audio chunk to process
   * @param index Index of the chunk in the array
   * @param transcriptionFn Function to transcribe the chunk
   * @param progressTracker Progress tracker for concurrent operations
   * @param results Array to store results
   * @param errors Array to collect errors
   * @returns Processing task function
   */
  private createChunkProcessingTask(
    chunk: AudioChunk,
    index: number,
    transcriptionFn: TranscriptionFunction,
    progressTracker: ConcurrentProgressTracker,
    results: (ChunkResult | null)[],
    errors: ChunkingError[]
  ): ChunkProcessingTask {
    return async (signal?: AbortSignal) => {
      try {
        // Update progress for this chunk starting
        progressTracker.startChunk(index);
        this.updateProgressFromTracker(progressTracker);
        
        const result = await this.transcribeChunkWithRetry(chunk, transcriptionFn, index, errors, signal);
        
        if (result) {
          results[index] = result;
          progressTracker.completeChunk(index, true);
        } else {
          progressTracker.completeChunk(index, false);
        }
        
        // Update overall progress
        this.updateProgressFromTracker(progressTracker);
        
      } catch (error) {
        // Create error for unexpected failures in task processing
        const chunkingError = new ChunkingError(
          `Unexpected error in chunk processing task: ${error instanceof Error ? error.message : String(error)}`,
          'transcribing',
          {
            chunkId: chunk.id,
            chunkIndex: index,
            originalError: error instanceof Error ? error : undefined,
            context: {
              startTime: chunk.startTime,
              endTime: chunk.endTime,
              audioDataLength: chunk.audioData.length
            },
            recoverable: false
          }
        );
        
        errors.push(chunkingError);
        progressTracker.completeChunk(index, false);
        this.updateProgressFromTracker(progressTracker);
        
        // Clean up chunk memory on error
        this.cleanupChunkMemory(chunk);
        
        // Don't throw - let the queue handle the error gracefully
        console.warn(`Chunk ${chunk.id} processing failed:`, error);
      }
    };
  }
  
  /**
   * Updates progress based on concurrent progress tracker
   * 
   * @param progressTracker The progress tracker to get progress from
   */
  private updateProgressFromTracker(progressTracker: ConcurrentProgressTracker): void {
    const progress = progressTracker.getProgress();
    this.updateProgress({
      totalChunks: progress.totalChunks,
      completedChunks: progress.completedChunks,
      currentChunk: progress.activeChunks.length > 0 ? Math.min(...progress.activeChunks) : progress.completedChunks,
      phase: 'transcribing',
      chunkProgress: progress.overallProgress
    });
  }
  
  /**
   * Cleans up memory used by a chunk
   * 
   * @param chunk The chunk to clean up
   */
  private cleanupChunkMemory(chunk: AudioChunk): void {
    try {
      // Clear the audio data to free memory
      // Note: We can't actually free the Float32Array memory directly in JS,
      // but we can help the GC by clearing references
      if (chunk.audioData) {
        const originalLength = chunk.audioData.length;
        
        // Set to a small empty array to reduce memory footprint
        (chunk as any).audioData = new Float32Array(0);
        
        // Log memory cleanup for debugging
        if (originalLength > 0) {
          console.debug(`Cleaned up chunk ${chunk.id} memory: ${originalLength} samples freed`);
        }
      }
    } catch (error) {
      // Memory cleanup should not fail the operation
      console.warn(`Failed to cleanup memory for chunk ${chunk.id}:`, error);
    }
  }
}

/**
 * Type definition for chunk processing tasks
 */
type ChunkProcessingTask = (signal?: AbortSignal) => Promise<void>;

/**
 * Queue manager for concurrent chunk processing
 */
class ChunkProcessingQueue {
  private maxConcurrency: number;
  private activePromises: Set<Promise<void>> = new Set();
  private pendingTasks: ChunkProcessingTask[] = [];
  private isProcessing = false;
  
  constructor(maxConcurrency: number) {
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }
  
  /**
   * Processes all tasks with concurrency limits
   * 
   * @param tasks Array of processing tasks
   * @param signal Optional abort signal
   */
  async processAll(tasks: ChunkProcessingTask[], signal?: AbortSignal): Promise<void> {
    if (this.isProcessing) {
      throw new Error('Queue is already processing tasks');
    }
    
    this.isProcessing = true;
    this.pendingTasks = [...tasks];
    
    try {
      // Start initial batch of tasks
      while (this.activePromises.size < this.maxConcurrency && this.pendingTasks.length > 0) {
        if (signal?.aborted) {
          throw new Error('Processing was cancelled');
        }
        this.startNextTask(signal);
      }
      
      // Wait for all tasks to complete
      while (this.activePromises.size > 0 || this.pendingTasks.length > 0) {
        if (signal?.aborted) {
          throw new Error('Processing was cancelled');
        }
        
        // Wait for at least one task to complete
        if (this.activePromises.size > 0) {
          await Promise.race(this.activePromises);
        }
        
        // Start more tasks if we have capacity and pending tasks
        while (this.activePromises.size < this.maxConcurrency && this.pendingTasks.length > 0) {
          if (signal?.aborted) {
            throw new Error('Processing was cancelled');
          }
          this.startNextTask(signal);
        }
      }
      
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Starts the next task from the queue
   * 
   * @param signal Optional abort signal
   */
  private startNextTask(signal?: AbortSignal): void {
    const task = this.pendingTasks.shift();
    if (!task) return;
    
    const promise = task(signal)
      .finally(() => {
        this.activePromises.delete(promise);
      });
    
    this.activePromises.add(promise);
  }
  
  /**
   * Cleans up the queue resources
   */
  cleanup(): void {
    this.pendingTasks = [];
    this.activePromises.clear();
    this.isProcessing = false;
  }
  
  /**
   * Gets the current queue status
   */
  getStatus(): { active: number; pending: number; maxConcurrency: number } {
    return {
      active: this.activePromises.size,
      pending: this.pendingTasks.length,
      maxConcurrency: this.maxConcurrency
    };
  }
}

/**
 * Progress tracker for concurrent chunk processing
 */
class ConcurrentProgressTracker {
  private totalChunks: number;
  private completedChunks = 0;
  private failedChunks = 0;
  private activeChunks: Set<number> = new Set();
  private chunkStartTimes: Map<number, number> = new Map();
  
  constructor(totalChunks: number) {
    this.totalChunks = totalChunks;
  }
  
  /**
   * Marks a chunk as started
   * 
   * @param chunkIndex Index of the chunk
   */
  startChunk(chunkIndex: number): void {
    this.activeChunks.add(chunkIndex);
    this.chunkStartTimes.set(chunkIndex, Date.now());
  }
  
  /**
   * Marks a chunk as completed
   * 
   * @param chunkIndex Index of the chunk
   * @param success Whether the chunk was processed successfully
   */
  completeChunk(chunkIndex: number, success: boolean): void {
    this.activeChunks.delete(chunkIndex);
    this.chunkStartTimes.delete(chunkIndex);
    
    if (success) {
      this.completedChunks++;
    } else {
      this.failedChunks++;
    }
  }
  
  /**
   * Gets the current progress information
   */
  getProgress(): {
    totalChunks: number;
    completedChunks: number;
    failedChunks: number;
    activeChunks: number[];
    overallProgress: number;
  } {
    const processedChunks = this.completedChunks + this.failedChunks;
    const overallProgress = this.totalChunks > 0 ? (processedChunks / this.totalChunks) * 100 : 0;
    
    return {
      totalChunks: this.totalChunks,
      completedChunks: this.completedChunks,
      failedChunks: this.failedChunks,
      activeChunks: Array.from(this.activeChunks).sort(),
      overallProgress: Math.round(overallProgress)
    };
  }
  
  /**
   * Gets processing statistics
   */
  getStats(): {
    averageProcessingTime: number;
    activeChunkCount: number;
    successRate: number;
  } {
    const processedChunks = this.completedChunks + this.failedChunks;
    const successRate = processedChunks > 0 ? (this.completedChunks / processedChunks) * 100 : 0;
    
    return {
      averageProcessingTime: 0, // Would need to track completion times for this
      activeChunkCount: this.activeChunks.size,
      successRate: Math.round(successRate)
    };
  }
  
  /**
   * Cleans up the progress tracker
   */
  cleanup(): void {
    this.activeChunks.clear();
    this.chunkStartTimes.clear();
  }
}