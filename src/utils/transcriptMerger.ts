/**
 * TranscriptMerger utility class for combining chunk transcription results
 * 
 * This class handles the merging of multiple chunk transcription results into
 * a single coherent transcript, with intelligent handling of overlapping segments
 * to prevent duplicate text and maintain natural flow.
 */

import type { ChunkResult } from '../types/chunking';

/**
 * Represents a word with timing and confidence information for alignment
 */
interface WordAlignment {
  word: string;
  normalizedWord: string;
  confidence?: number;
  estimatedStartTime: number;
  estimatedEndTime: number;
  chunkId: string;
}

/**
 * Represents an overlap region between two chunks with alignment information
 */
interface OverlapRegion {
  chunk1Id: string;
  chunk2Id: string;
  chunk1Words: WordAlignment[];
  chunk2Words: WordAlignment[];
  overlapStartTime: number;
  overlapEndTime: number;
  alignmentScore: number;
}

/**
 * Utility class for merging transcription results from audio chunks
 */
export class TranscriptMerger {
  /**
   * Merges multiple chunk results into a single transcript in chronological order
   * Uses intelligent alignment for better accuracy in overlap regions
   * 
   * @param results Array of chunk results to merge
   * @returns Combined transcript text
   */
  static mergeChunkResults(results: ChunkResult[]): string {
    if (!results || results.length === 0) {
      return '';
    }

    // Sort results by start time to ensure chronological order
    const sortedResults = [...results].sort((a, b) => a.startTime - b.startTime);

    if (sortedResults.length === 1) {
      return sortedResults[0].transcript.trim();
    }

    // Use intelligent alignment for better merging
    const alignedResults = this.alignTranscripts(sortedResults);
    
    let mergedTranscript = alignedResults[0].transcript.trim();

    // Process each subsequent chunk
    for (let i = 1; i < alignedResults.length; i++) {
      const currentChunk = alignedResults[i];
      const previousChunk = alignedResults[i - 1];

      // Check if there's an overlap between chunks
      const hasOverlap = currentChunk.overlapStart > 0 && 
                        currentChunk.startTime < previousChunk.endTime;

      const currentTranscript = currentChunk.transcript.trim();
      
      // Skip empty transcripts
      if (currentTranscript.length === 0) {
        continue;
      }

      if (hasOverlap) {
        // Use confidence-based merging for overlapping regions
        const deduplicatedText = this.mergeWithConfidence(
          mergedTranscript,
          currentTranscript,
          previousChunk,
          currentChunk
        );
        mergedTranscript = deduplicatedText;
      } else {
        // No overlap, simply append with a space
        mergedTranscript += ' ' + currentTranscript;
      }
    }

    return mergedTranscript.trim();
  }

  /**
   * Aligns transcripts using timing-based analysis to improve overlap detection
   * 
   * @param results Array of chunk results to align
   * @returns Aligned chunk results with improved timing information
   */
  static alignTranscripts(results: ChunkResult[]): ChunkResult[] {
    if (!results || results.length <= 1) {
      return results || [];
    }

    const alignedResults = [...results];

    // Process each pair of adjacent chunks for alignment
    for (let i = 0; i < alignedResults.length - 1; i++) {
      const currentChunk = alignedResults[i];
      const nextChunk = alignedResults[i + 1];

      // Check if chunks have potential overlap
      if (nextChunk.overlapStart > 0 && nextChunk.startTime < currentChunk.endTime) {
        const overlapRegion = this.analyzeOverlapRegion(currentChunk, nextChunk);
        
        if (overlapRegion.alignmentScore > 0.5) {
          // Adjust timing based on alignment analysis
          const adjustedTiming = this.calculateOptimalTiming(overlapRegion);
          
          // Update chunk timing for better alignment
          if (adjustedTiming.adjustCurrentEnd) {
            alignedResults[i] = {
              ...currentChunk,
              endTime: adjustedTiming.currentEndTime
            };
          }
          
          if (adjustedTiming.adjustNextStart) {
            alignedResults[i + 1] = {
              ...nextChunk,
              startTime: adjustedTiming.nextStartTime
            };
          }
        }
      }
    }

    return alignedResults;
  }

  /**
   * Removes duplicate text from overlapping segments between two transcripts
   * 
   * @param text1 The first transcript (already processed)
   * @param text2 The second transcript (to be merged)
   * @param overlapDuration Duration of overlap in seconds
   * @returns Combined text with duplicates removed
   */
  static removeOverlapDuplicates(
    text1: string, 
    text2: string, 
    overlapDuration: number
  ): string {
    if (!text1 || !text2) {
      return (text1 || '') + (text2 || '');
    }

    const words1 = text1.split(/\s+/);
    const words2 = text2.split(/\s+/);

    if (words1.length === 0) return text2;
    if (words2.length === 0) return text1;

    // Estimate overlap region size based on average speaking rate
    // Assume ~150 words per minute average speaking rate
    const estimatedOverlapWords = Math.max(1, Math.floor((overlapDuration / 60) * 150));
    
    // Look for the best overlap match within a reasonable window
    const searchWindow = Math.min(estimatedOverlapWords * 2, Math.min(words1.length, words2.length));
    
    let bestOverlapLength = 0;
    let bestOverlapStart1 = words1.length;
    let bestOverlapStart2 = 0;

    // Search for the longest matching sequence in the overlap region
    for (let start1 = Math.max(0, words1.length - searchWindow); start1 < words1.length; start1++) {
      for (let start2 = 0; start2 < Math.min(searchWindow, words2.length); start2++) {
        const overlapLength = this.findMatchingSequenceLength(
          words1, start1, words2, start2
        );
        
        if (overlapLength > bestOverlapLength) {
          bestOverlapLength = overlapLength;
          bestOverlapStart1 = start1;
          bestOverlapStart2 = start2;
        }
      }
    }

    // If we found a good overlap (at least 2 words), use it
    if (bestOverlapLength >= 2) {
      const beforeOverlap = words1.slice(0, bestOverlapStart1).join(' ');
      const afterOverlap = words2.slice(bestOverlapStart2 + bestOverlapLength).join(' ');
      // Use the overlap text from the second transcript to preserve its punctuation
      const overlapText = words2.slice(bestOverlapStart2, bestOverlapStart2 + bestOverlapLength).join(' ');
      
      return [beforeOverlap, overlapText, afterOverlap]
        .filter(part => part.trim().length > 0)
        .join(' ');
    }

    // No significant overlap found, use simple word-based deduplication
    return this.simpleWordDeduplication(text1, text2);
  }

  /**
   * Finds the length of matching word sequence between two arrays starting at given positions
   * 
   * @param words1 First word array
   * @param start1 Starting position in first array
   * @param words2 Second word array
   * @param start2 Starting position in second array
   * @returns Length of matching sequence
   */
  private static findMatchingSequenceLength(
    words1: string[], 
    start1: number, 
    words2: string[], 
    start2: number
  ): number {
    let length = 0;
    const maxLength = Math.min(words1.length - start1, words2.length - start2);
    
    for (let i = 0; i < maxLength; i++) {
      if (this.normalizeWord(words1[start1 + i]) === this.normalizeWord(words2[start2 + i])) {
        length++;
      } else {
        break;
      }
    }
    
    return length;
  }

  /**
   * Normalizes a word for comparison by removing punctuation and converting to lowercase
   * 
   * @param word Word to normalize
   * @returns Normalized word
   */
  private static normalizeWord(word: string): string {
    return word.toLowerCase().replace(/[^\w]/g, '');
  }

  /**
   * Merges transcripts using confidence scores for better accuracy in overlap regions
   * 
   * @param text1 First transcript (already processed)
   * @param text2 Second transcript (to be merged)
   * @param chunk1 First chunk with confidence information
   * @param chunk2 Second chunk with confidence information
   * @returns Combined text with confidence-based merging
   */
  private static mergeWithConfidence(
    text1: string,
    text2: string,
    chunk1: ChunkResult,
    chunk2: ChunkResult
  ): string {
    if (!text1 || !text2) {
      return (text1 || '') + (text2 || '');
    }

    const words1 = this.createWordAlignments(text1, chunk1);
    const words2 = this.createWordAlignments(text2, chunk2);

    // Find the best overlap region using word-level analysis
    const overlapAnalysis = this.findWordLevelOverlap(words1, words2, chunk2.overlapStart);
    
    // Only use word-level alignment if we found a meaningful overlap (at least 2 words)
    if (overlapAnalysis.overlapLength >= 2) {
      return this.mergeWithWordLevelAlignment(words1, words2, overlapAnalysis);
    }

    // Fallback to simple deduplication for small or no overlaps
    return this.simpleWordDeduplication(text1, text2);
  }

  /**
   * Creates word alignments with estimated timing and confidence information
   * 
   * @param text Transcript text
   * @param chunk Chunk result with timing and confidence
   * @returns Array of word alignments
   */
  private static createWordAlignments(text: string, chunk: ChunkResult): WordAlignment[] {
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const chunkDuration = chunk.endTime - chunk.startTime;
    const wordsPerSecond = words.length / chunkDuration;
    
    return words.map((word, index) => {
      const wordStartTime = chunk.startTime + (index / wordsPerSecond);
      const wordEndTime = chunk.startTime + ((index + 1) / wordsPerSecond);
      
      return {
        word,
        normalizedWord: this.normalizeWord(word),
        confidence: chunk.confidence,
        estimatedStartTime: wordStartTime,
        estimatedEndTime: wordEndTime,
        chunkId: chunk.id
      };
    });
  }

  /**
   * Finds word-level overlap between two sets of word alignments
   * 
   * @param words1 First set of word alignments
   * @param words2 Second set of word alignments
   * @param overlapDuration Expected overlap duration in seconds
   * @returns Overlap analysis result
   */
  private static findWordLevelOverlap(
    words1: WordAlignment[],
    words2: WordAlignment[],
    overlapDuration: number
  ): { overlapLength: number; start1: number; start2: number; confidence: number } {
    if (words1.length === 0 || words2.length === 0) {
      return { overlapLength: 0, start1: 0, start2: 0, confidence: 0 };
    }

    // Estimate overlap region size based on timing
    const estimatedOverlapWords = Math.max(1, Math.floor(overlapDuration * 2.5)); // ~2.5 words per second
    const searchWindow = Math.min(estimatedOverlapWords * 2, Math.min(words1.length, words2.length));
    
    let bestMatch = { overlapLength: 0, start1: 0, start2: 0, confidence: 0 };

    // Search for the best matching sequence
    for (let start1 = Math.max(0, words1.length - searchWindow); start1 < words1.length; start1++) {
      for (let start2 = 0; start2 < Math.min(searchWindow, words2.length); start2++) {
        const matchResult = this.calculateWordSequenceMatch(words1, start1, words2, start2);
        
        if (matchResult.length > bestMatch.overlapLength || 
           (matchResult.length === bestMatch.overlapLength && matchResult.confidence > bestMatch.confidence)) {
          bestMatch = {
            overlapLength: matchResult.length,
            start1,
            start2,
            confidence: matchResult.confidence
          };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Calculates the quality of a word sequence match between two alignments
   * 
   * @param words1 First word alignment array
   * @param start1 Starting position in first array
   * @param words2 Second word alignment array
   * @param start2 Starting position in second array
   * @returns Match result with length and confidence
   */
  private static calculateWordSequenceMatch(
    words1: WordAlignment[],
    start1: number,
    words2: WordAlignment[],
    start2: number
  ): { length: number; confidence: number } {
    let length = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;
    
    const maxLength = Math.min(words1.length - start1, words2.length - start2);
    
    for (let i = 0; i < maxLength; i++) {
      const word1 = words1[start1 + i];
      const word2 = words2[start2 + i];
      
      if (word1.normalizedWord === word2.normalizedWord) {
        length++;
        
        // Calculate confidence for this match
        if (word1.confidence !== undefined && word2.confidence !== undefined) {
          totalConfidence += Math.max(word1.confidence, word2.confidence);
          confidenceCount++;
        } else if (word1.confidence !== undefined) {
          totalConfidence += word1.confidence;
          confidenceCount++;
        } else if (word2.confidence !== undefined) {
          totalConfidence += word2.confidence;
          confidenceCount++;
        }
      } else {
        break;
      }
    }
    
    const averageConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0.8; // Default confidence
    return { length, confidence: averageConfidence };
  }

  /**
   * Merges word alignments using word-level analysis for optimal results
   * 
   * @param words1 First set of word alignments
   * @param words2 Second set of word alignments
   * @param overlapAnalysis Analysis of the overlap region
   * @returns Merged transcript text
   */
  private static mergeWithWordLevelAlignment(
    words1: WordAlignment[],
    words2: WordAlignment[],
    overlapAnalysis: { overlapLength: number; start1: number; start2: number; confidence: number }
  ): string {
    const beforeOverlap = words1.slice(0, overlapAnalysis.start1).map(w => w.word);
    const afterOverlap = words2.slice(overlapAnalysis.start2 + overlapAnalysis.overlapLength).map(w => w.word);
    
    // Choose overlap text based on confidence
    const overlapWords1 = words1.slice(overlapAnalysis.start1, overlapAnalysis.start1 + overlapAnalysis.overlapLength);
    const overlapWords2 = words2.slice(overlapAnalysis.start2, overlapAnalysis.start2 + overlapAnalysis.overlapLength);
    
    const overlapText = this.selectBestOverlapText(overlapWords1, overlapWords2);
    
    return [
      beforeOverlap.join(' '),
      overlapText,
      afterOverlap.join(' ')
    ].filter(part => part.trim().length > 0).join(' ');
  }

  /**
   * Selects the best overlap text based on confidence scores
   * 
   * @param words1 First set of overlap words
   * @param words2 Second set of overlap words
   * @returns Best overlap text
   */
  private static selectBestOverlapText(words1: WordAlignment[], words2: WordAlignment[]): string {
    const result: string[] = [];
    
    for (let i = 0; i < Math.min(words1.length, words2.length); i++) {
      const word1 = words1[i];
      const word2 = words2[i];
      
      // Select word with higher confidence, or prefer second chunk if equal
      // This preserves the original punctuation and case from the selected chunk
      if (word1.confidence !== undefined && word2.confidence !== undefined) {
        result.push(word1.confidence > word2.confidence ? word1.word : word2.word);
      } else if (word1.confidence !== undefined) {
        result.push(word1.word);
      } else if (word2.confidence !== undefined) {
        result.push(word2.word);
      } else {
        // No confidence info, prefer second chunk (more recent) to maintain flow
        result.push(word2.word);
      }
    }
    
    return result.join(' ');
  }

  /**
   * Analyzes the overlap region between two chunks for alignment purposes
   * 
   * @param chunk1 First chunk
   * @param chunk2 Second chunk
   * @returns Overlap region analysis
   */
  private static analyzeOverlapRegion(chunk1: ChunkResult, chunk2: ChunkResult): OverlapRegion {
    const words1 = this.createWordAlignments(chunk1.transcript, chunk1);
    const words2 = this.createWordAlignments(chunk2.transcript, chunk2);
    
    const overlapStartTime = Math.max(chunk1.startTime, chunk2.startTime - chunk2.overlapStart);
    const overlapEndTime = Math.min(chunk1.endTime, chunk2.startTime + chunk2.overlapStart);
    
    // Filter words that fall within the overlap region
    const overlapWords1 = words1.filter(w => 
      w.estimatedStartTime >= overlapStartTime && w.estimatedEndTime <= overlapEndTime
    );
    const overlapWords2 = words2.filter(w => 
      w.estimatedStartTime >= overlapStartTime && w.estimatedEndTime <= overlapEndTime
    );
    
    // Calculate alignment score based on word similarity in overlap region
    const alignmentScore = this.calculateAlignmentScore(overlapWords1, overlapWords2);
    
    return {
      chunk1Id: chunk1.id,
      chunk2Id: chunk2.id,
      chunk1Words: overlapWords1,
      chunk2Words: overlapWords2,
      overlapStartTime,
      overlapEndTime,
      alignmentScore
    };
  }

  /**
   * Calculates alignment score between two sets of words
   * 
   * @param words1 First set of words
   * @param words2 Second set of words
   * @returns Alignment score (0-1)
   */
  private static calculateAlignmentScore(words1: WordAlignment[], words2: WordAlignment[]): number {
    if (words1.length === 0 || words2.length === 0) {
      return 0;
    }
    
    const normalized1 = words1.map(w => w.normalizedWord);
    const normalized2 = words2.map(w => w.normalizedWord);
    
    // Calculate Jaccard similarity
    const set1 = new Set(normalized1);
    const set2 = new Set(normalized2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Calculates optimal timing adjustments based on overlap analysis
   * 
   * @param overlapRegion Analyzed overlap region
   * @returns Timing adjustment recommendations
   */
  private static calculateOptimalTiming(overlapRegion: OverlapRegion): {
    adjustCurrentEnd: boolean;
    adjustNextStart: boolean;
    currentEndTime: number;
    nextStartTime: number;
  } {
    // For now, use conservative approach - don't adjust timing unless alignment is very strong
    const shouldAdjust = overlapRegion.alignmentScore > 0.8;
    
    return {
      adjustCurrentEnd: false,
      adjustNextStart: false,
      currentEndTime: overlapRegion.overlapStartTime,
      nextStartTime: overlapRegion.overlapEndTime
    };
  }

  /**
   * Simple word-based deduplication fallback when sophisticated overlap detection fails
   * 
   * @param text1 First transcript
   * @param text2 Second transcript
   * @returns Combined text with simple deduplication
   */
  private static simpleWordDeduplication(text1: string, text2: string): string {
    const words1 = text1.split(/\s+/);
    const words2 = text2.split(/\s+/);
    
    // Look for common ending/beginning words (up to 5 words)
    const maxCheck = Math.min(5, words1.length, words2.length);
    let overlapFound = 0;
    
    for (let i = 1; i <= maxCheck; i++) {
      const ending = words1.slice(-i).map(w => this.normalizeWord(w));
      const beginning = words2.slice(0, i).map(w => this.normalizeWord(w));
      
      if (ending.join(' ') === beginning.join(' ')) {
        overlapFound = i;
      }
    }
    
    if (overlapFound > 0) {
      const beforeOverlap = words1.slice(0, -overlapFound).join(' ');
      const afterOverlap = words2.join(' ');
      
      return [beforeOverlap, afterOverlap]
        .filter(part => part.trim().length > 0)
        .join(' ');
    }
    
    // No overlap found, just concatenate
    return text1 + ' ' + text2;
  }
}