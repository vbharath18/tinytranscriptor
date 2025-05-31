import type { WhisperModelKey } from '../hooks/useTranscription';

/**
 * Represents the browser compatibility information.
 */
export interface BrowserCompatibility {
  /** Whether the browser is deemed compatible for core functionality. */
  isCompatible: boolean;
  /** A list of warning messages based on browser checks. */
  warnings: string[];
  /** The recommended Whisper model key based on compatibility checks. */
  recommendedModel: WhisperModelKey;
}

/**
 * Checks browser compatibility for features like WebAssembly, specific browser engines,
 * device memory, and mobile status to determine overall compatibility and recommend a model.
 * @returns An object containing compatibility status, warnings, and a recommended model.
 */
export const getBrowserCompatibility = (): BrowserCompatibility => {
  const warnings: string[] = [];
  let recommendedModel: WhisperModelKey = 'tiny.en'; // Default recommended model
  let isCompatible = true;

  // Check WebAssembly support, crucial for ONNX Runtime.
  if (typeof WebAssembly === 'undefined') {
    warnings.push('WebAssembly is not supported in this browser. Transcription may not work.');
    isCompatible = false;
  }

  // Check for known problematic browsers or those requiring specific considerations.
  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes('firefox')) {
    warnings.push('Firefox may experience ONNX Runtime compatibility issues. For a smoother experience, Chrome or Edge are recommended.');
    // 'tiny' (multilingual) might be a more stable default for Firefox if ONNX issues are frequent.
    recommendedModel = 'tiny';
  }

  if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
    warnings.push('Safari may have limitations with WebAssembly or ONNX Runtime. Consider using Chrome or Edge for better performance.');
    recommendedModel = 'tiny';
  }

  // Estimate device memory. navigator.deviceMemory is not universally supported and is a rough estimate.
  const memoryInfo = (navigator as any).deviceMemory;
  if (typeof memoryInfo === 'number' && memoryInfo < 4) { // Assuming memoryInfo is in GB
    warnings.push(`Low device memory detected (${memoryInfo}GB). Smaller models (like 'tiny') are strongly recommended for stability.`);
    recommendedModel = 'tiny';
  }

  // Check if running on a mobile device.
  const isMobile = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  if (isMobile) {
    warnings.push('Mobile device detected. Smaller models (like \'tiny\') are recommended for performance and stability.');
    recommendedModel = 'tiny';
  }

  // Note: The logic for `recommendedModel` prioritizes 'tiny' if any potential issue is detected.
  // If 'tiny.en' was the default and no issues were flagged, it would remain 'tiny.en'.

  return { isCompatible, warnings, recommendedModel };
};
