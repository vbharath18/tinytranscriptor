# Audio Chunking Design Document

## Overview

This design implements audio chunking functionality to enable transcription of audio files longer than 30 seconds. The solution extends the existing `useTranscription` hook with intelligent audio splitting, parallel processing, and seamless transcript merging while maintaining the current API and user experience.

## Architecture

### High-Level Flow
1. **Audio Analysis**: Determine if chunking is needed based on duration
2. **Intelligent Splitting**: Split audio into overlapping chunks with silence detection
3. **Parallel Processing**: Process chunks concurrently with progress tracking
4. **Transcript Merging**: Combine results with overlap deduplication
5. **Error Handling**: Graceful failure recovery and retry logic

### Core Components
- **ChunkProcessor**: Manages the chunking workflow
- **AudioSplitter**: Handles intelligent audio segmentation
- **TranscriptMerger**: Combines chunk results seamlessly
- **ProgressTracker**: Provides detailed progress information

## Components and Interfaces

### 1. Audio Chunking Types

```typescript
interface AudioChunk {
  id: string;
  startTime: number;
  endTime: number;
  audioData: Float32Array;
  overlapStart: number;
  overlapEnd: number;
}

interface ChunkResult {
  id: string;
  transcript: string;
  confidence?: number;
  startTime: number;
  endTime: number;
  overlapStart: number;
  overlapEnd: number;
}

interface ChunkingProgress {
  totalChunks: number;
  completedChunks: number;
  currentChunk: number;
  phase: 'splitting' | 'transcribing' | 'merging';
  chunkProgress: number;
}
```

### 2. AudioSplitter Utility

```typescript
class AudioSplitter {
  static splitAudio(
    audioData: Float32Array, 
    sampleRate: number, 
    options: ChunkingOptions
  ): AudioChunk[];
  
  static findSilenceBoundaries(
    audioData: Float32Array, 
    sampleRate: number
  ): number[];
  
  static createOverlappingChunks(
    audioData: Float32Array,
    boundaries: number[],
    chunkSize: number,
    overlapSize: number
  ): AudioChunk[];
}
```

### 3. TranscriptMerger Utility

```typescript
class TranscriptMerger {
  static mergeChunkResults(results: ChunkResult[]): string;
  
  static removeOverlapDuplicates(
    text1: string, 
    text2: string, 
    overlapDuration: number
  ): string;
  
  static alignTranscripts(
    results: ChunkResult[]
  ): ChunkResult[];
}
```

### 4. Enhanced useTranscription Hook

The existing hook will be extended with:

```typescript
interface TranscriptionState {
  // Existing state...
  isChunking: boolean;
  chunkingProgress: ChunkingProgress | null;
  chunkResults: ChunkResult[];
}

interface ChunkingOptions {
  chunkDuration: number;      // Default: 25 seconds
  overlapDuration: number;    // Default: 2.5 seconds  
  maxConcurrency: number;     // Default: 2
  silenceThreshold: number;   // Default: 0.01
  preferSilenceBoundaries: boolean; // Default: true
}
```

## Data Models

### ChunkingConfiguration
- **chunkDuration**: Optimal chunk size (25s default for 30s model limit with buffer)
- **overlapDuration**: Overlap between chunks (2.5s default for context preservation)
- **maxConcurrency**: Maximum parallel chunks (2 default to prevent memory issues)
- **silenceThreshold**: Audio level threshold for silence detection
- **preferSilenceBoundaries**: Whether to split at natural pauses

### ProcessingState
- **phase**: Current processing phase (splitting/transcribing/merging)
- **totalChunks**: Total number of chunks to process
- **completedChunks**: Number of completed chunks
- **currentChunk**: Currently processing chunk index
- **chunkProgress**: Progress within current chunk (0-100)

## Error Handling

### Chunk-Level Error Recovery
1. **Retry Logic**: Failed chunks retry up to 3 times with exponential backoff
2. **Graceful Degradation**: Skip failed chunks after retries, continue with others
3. **Partial Results**: Return partial transcription if some chunks succeed
4. **Error Aggregation**: Collect and report all chunk errors for debugging

### Memory Management
1. **Chunk Cleanup**: Release processed chunk audio data immediately
2. **Concurrent Limits**: Limit parallel processing to prevent memory exhaustion
3. **Progress Cleanup**: Clear intermediate results after merging

### User Feedback
1. **Detailed Progress**: Show current phase and chunk progress
2. **Error Messages**: Clear, actionable error descriptions
3. **Recovery Options**: Allow users to retry failed operations

## Testing Strategy

### Unit Tests
1. **AudioSplitter Tests**
   - Verify correct chunk boundaries
   - Test silence detection accuracy
   - Validate overlap calculations
   - Test edge cases (very short/long audio)

2. **TranscriptMerger Tests**
   - Test overlap removal algorithms
   - Verify transcript alignment
   - Test with various overlap scenarios
   - Validate final transcript quality

3. **ChunkProcessor Tests**
   - Test progress tracking accuracy
   - Verify error handling and recovery
   - Test concurrent processing limits
   - Validate memory cleanup

### Integration Tests
1. **End-to-End Chunking**
   - Test with various audio lengths (30s-300s)
   - Verify transcript quality vs non-chunked baseline
   - Test with different models and configurations
   - Validate progress reporting accuracy

2. **Error Scenarios**
   - Test network failures during processing
   - Test memory pressure scenarios
   - Test partial chunk failures
   - Verify graceful degradation

### Performance Tests
1. **Memory Usage**: Monitor memory consumption during chunking
2. **Processing Speed**: Compare chunked vs sequential processing
3. **Accuracy Metrics**: Measure transcript quality with chunking
4. **Concurrent Load**: Test multiple simultaneous chunking operations

## Implementation Phases

### Phase 1: Core Chunking Infrastructure
- Implement AudioSplitter with basic time-based splitting
- Create ChunkProcessor with sequential processing
- Add basic progress tracking
- Integrate with existing useTranscription hook

### Phase 2: Intelligent Splitting
- Add silence detection for natural boundaries
- Implement overlap handling and deduplication
- Enhance TranscriptMerger with alignment algorithms
- Add configurable chunking options

### Phase 3: Performance Optimization
- Implement concurrent chunk processing
- Add memory management and cleanup
- Optimize chunk size based on model performance
- Add adaptive chunking based on audio characteristics

### Phase 4: Error Handling & Polish
- Implement comprehensive error recovery
- Add detailed progress reporting
- Enhance user feedback and error messages
- Add performance monitoring and optimization