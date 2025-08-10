/**
 * ONNX Runtime diagnostic utilities to help identify and resolve compatibility issues
 */

export interface ONNXDiagnostics {
  webAssemblySupported: boolean;
  sharedArrayBufferSupported: boolean;
  webGLSupported: boolean;
  deviceMemory: number | 'unknown';
  hardwareConcurrency: number;
  userAgent: string;
  isSecureContext: boolean;
  recommendations: string[];
  compatibilityScore: number; // 0-100, higher is better
}

/**
 * Runs comprehensive ONNX Runtime diagnostics
 */
export const runONNXDiagnostics = (): ONNXDiagnostics => {
  const recommendations: string[] = [];
  let compatibilityScore = 100;

  // Check WebAssembly support
  const webAssemblySupported = typeof WebAssembly !== 'undefined';
  if (!webAssemblySupported) {
    recommendations.push('Enable WebAssembly in your browser settings');
    compatibilityScore -= 50;
  }

  // Check SharedArrayBuffer support
  const sharedArrayBufferSupported = typeof SharedArrayBuffer !== 'undefined';
  if (!sharedArrayBufferSupported) {
    recommendations.push('SharedArrayBuffer not available - consider enabling cross-origin isolation');
    compatibilityScore -= 10;
  }

  // Check WebGL support
  let webGLSupported = false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    webGLSupported = !!gl;
    if (!webGLSupported) {
      recommendations.push('WebGL not supported - consider using a browser with WebGL support');
      compatibilityScore -= 5;
    }
  } catch (e) {
    recommendations.push('Unable to test WebGL support');
    compatibilityScore -= 5;
  }

  // Check device memory
  const deviceMemory = (navigator as any).deviceMemory || 'unknown';
  if (typeof deviceMemory === 'number' && deviceMemory < 2) {
    recommendations.push('Low device memory detected - use only tiny models');
    compatibilityScore -= 30;
  } else if (typeof deviceMemory === 'number' && deviceMemory < 4) {
    recommendations.push('Limited device memory - prefer smaller models');
    compatibilityScore -= 15;
  }

  // Check hardware concurrency
  const hardwareConcurrency = navigator.hardwareConcurrency || 1;
  if (hardwareConcurrency < 2) {
    recommendations.push('Limited CPU cores - expect slower performance');
    compatibilityScore -= 10;
  }

  // Check secure context
  const isSecureContext = window.isSecureContext;
  if (!isSecureContext) {
    recommendations.push('Not in secure context (HTTPS) - some features may be limited');
    compatibilityScore -= 5;
  }

  // Browser-specific recommendations
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('firefox')) {
    recommendations.push('Firefox detected - if issues persist, try Chrome or Edge');
    compatibilityScore -= 5;
  } else if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
    recommendations.push('Safari detected - for best compatibility, use Chrome or Edge');
    compatibilityScore -= 10;
  } else if (userAgent.includes('edge/') && !userAgent.includes('edg/')) {
    recommendations.push('Legacy Edge detected - upgrade to modern Edge for better support');
    compatibilityScore -= 20;
  }

  // Mobile device detection
  const isMobile = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  if (isMobile) {
    recommendations.push('Mobile device detected - use tiny models for best performance');
    compatibilityScore -= 10;
  }

  // General recommendations if score is low
  if (compatibilityScore < 70) {
    recommendations.push('Consider clearing browser cache and restarting browser');
    recommendations.push('Try incognito/private browsing mode');
    recommendations.push('Ensure browser is up to date');
  }

  return {
    webAssemblySupported,
    sharedArrayBufferSupported,
    webGLSupported,
    deviceMemory,
    hardwareConcurrency,
    userAgent,
    isSecureContext,
    recommendations,
    compatibilityScore: Math.max(0, compatibilityScore)
  };
};

/**
 * Attempts to preload and test ONNX Runtime
 */
export const testONNXRuntime = async (): Promise<{ success: boolean; error?: string; performance?: number }> => {
  try {
    const startTime = performance.now();
    const modelId = 'Xenova/whisper-tiny';
    const options = { quantized: true };

    // Dynamic import to avoid loading ONNX if not needed
    const { pipeline, AutoTokenizer, AutoModelForSpeechSeq2Seq } = await import('@xenova/transformers');
    
    console.log('🧪 Testing ONNX Runtime with minimal model (explicit loading)...');
    
    // Explicitly load tokenizer and model to bypass faulty routing
    const tokenizer = await AutoTokenizer.from_pretrained(modelId, options);
    const model = await AutoModelForSpeechSeq2Seq.from_pretrained(modelId, options);
    
    // Create pipeline with pre-loaded components
    const testPipeline = await pipeline('automatic-speech-recognition', model, { tokenizer });

    // Test with minimal audio data
    const testAudio = new Float32Array(1600); // 0.1 seconds at 16kHz
    testAudio.fill(0.001);
    
    const result = await testPipeline(testAudio, {
      return_timestamps: false,
      chunk_length_s: 30
    });
    
    const endTime = performance.now();
    const performanceMs = endTime - startTime;
    
    console.log('✅ ONNX Runtime test successful:', result);
    
    return {
      success: true,
      performance: performanceMs
    };
  } catch (error) {
    console.error('❌ ONNX Runtime test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

/**
 * Generates a detailed diagnostic report
 */
export const generateDiagnosticReport = async (): Promise<string> => {
  const diagnostics = runONNXDiagnostics();
  const onnxTest = await testONNXRuntime();
  
  let report = '=== ONNX Runtime Diagnostic Report ===\n\n';
  
  report += `Compatibility Score: ${diagnostics.compatibilityScore}/100\n`;
  report += `WebAssembly Support: ${diagnostics.webAssemblySupported ? '✅' : '❌'}\n`;
  report += `SharedArrayBuffer Support: ${diagnostics.sharedArrayBufferSupported ? '✅' : '⚠️'}\n`;
  report += `WebGL Support: ${diagnostics.webGLSupported ? '✅' : '⚠️'}\n`;
  report += `Device Memory: ${diagnostics.deviceMemory} GB\n`;
  report += `CPU Cores: ${diagnostics.hardwareConcurrency}\n`;
  report += `Secure Context: ${diagnostics.isSecureContext ? '✅' : '⚠️'}\n`;
  report += `ONNX Runtime Test: ${onnxTest.success ? '✅' : '❌'}\n`;
  
  if (onnxTest.performance) {
    report += `Performance: ${onnxTest.performance.toFixed(0)}ms\n`;
  }
  
  if (onnxTest.error) {
    report += `Error: ${onnxTest.error}\n`;
  }
  
  report += '\n=== Recommendations ===\n';
  diagnostics.recommendations.forEach((rec, index) => {
    report += `${index + 1}. ${rec}\n`;
  });
  
  report += '\n=== Browser Info ===\n';
  report += `User Agent: ${diagnostics.userAgent}\n`;
  
  return report;
};
