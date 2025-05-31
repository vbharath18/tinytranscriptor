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

  // Check for SharedArrayBuffer support (important for ONNX Runtime performance)
  if (typeof SharedArrayBuffer === 'undefined') {
    warnings.push('SharedArrayBuffer is not available. This may affect performance. Consider enabling it or using a different browser.');
  }

  // Check for WebGL support (can improve ONNX Runtime performance)
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      warnings.push('WebGL is not supported. Consider using a browser with WebGL support for better performance.');
    }
  } catch (e) {
    warnings.push('Unable to check WebGL support.');
  }

  // Check for known problematic browsers or those requiring specific considerations.
  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes('firefox')) {
    warnings.push('Firefox may experience ONNX Runtime compatibility issues. Chrome or Edge are recommended for best experience.');
    recommendedModel = 'tiny';
  }

  if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
    warnings.push('Safari may have limitations with WebAssembly or ONNX Runtime. Chrome or Edge are recommended.');
    recommendedModel = 'tiny';
  }

  // Chrome on mobile can have memory constraints
  if (userAgent.includes('chrome') && userAgent.includes('mobile')) {
    warnings.push('Mobile Chrome detected. Consider using the tiny model for better performance.');
    recommendedModel = 'tiny';
  }

  // Estimate device memory. navigator.deviceMemory is not universally supported and is a rough estimate.
  const memoryInfo = (navigator as any).deviceMemory;
  if (typeof memoryInfo === 'number') {
    if (memoryInfo < 2) {
      warnings.push(`Very low device memory detected (${memoryInfo}GB). Only tiny models are recommended.`);
      recommendedModel = 'tiny';
      isCompatible = false; // Mark as potentially incompatible
    } else if (memoryInfo < 4) {
      warnings.push(`Low device memory detected (${memoryInfo}GB). Smaller models (like 'tiny') are strongly recommended for stability.`);
      recommendedModel = 'tiny';
    }
  }

  // Check if running on a mobile device.
  const isMobile = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
    if (isMobile) {
    warnings.push('Mobile device detected. Smaller models (like \'tiny\') are recommended for performance and stability.');
    recommendedModel = 'tiny';
  }

  // Check for older browsers that might have WebAssembly issues
  if (userAgent.includes('edge/') && !userAgent.includes('edg/')) { // Old Edge
    warnings.push('Legacy Edge detected. Consider upgrading to modern Edge (Chromium-based) for better compatibility.');
    isCompatible = false;
  }

  // Note: The logic for `recommendedModel` prioritizes 'tiny' if any potential issue is detected.
  // If 'tiny.en' was the default and no issues were flagged, it would remain 'tiny.en'.

  return {
    isCompatible,
    warnings,
    recommendedModel
  };
};
