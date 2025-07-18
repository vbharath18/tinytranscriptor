import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getBrowserCompatibility } from './browserUtils'; // Adjust path as needed

describe('getBrowserCompatibility', () => {
  const originalUserAgent = navigator.userAgent;
  const originalDeviceMemory = (navigator as any).deviceMemory;

  beforeEach(() => {
    // Reset mocks before each test
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36',
      deviceMemory: 8,
    });
    // @ts-ignore
    global.WebAssembly = {}; // Assume WebAssembly is supported by default
  });

  afterEach(() => {
    // Restore original navigator properties
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      value: originalDeviceMemory,
      configurable: true,
      writable: true,
    });
     // @ts-ignore
    delete global.WebAssembly;
  });

  it('should return compatible with no warnings for a standard modern browser', () => {
    const result = getBrowserCompatibility();
    expect(result.isCompatible).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.recommendedModel).toBe('tiny.en');
  });

  it('should detect Firefox and recommend "tiny" model', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:99.0) Gecko/20100101 Firefox/99.0' });
    const result = getBrowserCompatibility();
    expect(result.warnings).toContain('Firefox may experience ONNX Runtime compatibility issues. For a smoother experience, Chrome or Edge are recommended.');
    expect(result.recommendedModel).toBe('tiny');
  });

  it('should detect Safari and recommend "tiny" model', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15' });
    const result = getBrowserCompatibility();
    expect(result.warnings).toContain('Safari may have limitations with WebAssembly or ONNX Runtime. Consider using Chrome or Edge for better performance.');
    expect(result.recommendedModel).toBe('tiny');
  });

  it('should detect low device memory (e.g., 2GB) and recommend "tiny" model', () => {
    Object.defineProperty(navigator, 'deviceMemory', { value: 2 });
    const result = getBrowserCompatibility();
    expect(result.warnings).toContain('Low device memory detected (2GB). Smaller models (like \'tiny\') are strongly recommended for stability.');
    expect(result.recommendedModel).toBe('tiny');
  });

  it('should handle undefined deviceMemory gracefully', () => {
    Object.defineProperty(navigator, 'deviceMemory', { value: undefined, configurable: true, writable: true });
    const result = getBrowserCompatibility();
    // No specific warning for undefined memory, but should not crash
    expect(result.warnings.some(w => w.includes('Low device memory detected'))).toBe(false);
    // If no other flags, should still be tiny.en
    expect(result.recommendedModel).toBe('tiny.en');
  });


  it('should detect mobile device and recommend "tiny" model', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1' });
    const result = getBrowserCompatibility();
    expect(result.warnings).toContain('Mobile device detected. Smaller models (like \'tiny\') are recommended for performance and stability.');
    expect(result.recommendedModel).toBe('tiny');
  });

  it('should detect when WebAssembly is not supported', () => {
    // @ts-ignore
    delete global.WebAssembly; // Simulate WebAssembly not being supported
    const result = getBrowserCompatibility();
    expect(result.isCompatible).toBe(false);
    expect(result.warnings).toContain('WebAssembly is not supported in this browser. Transcription may not work.');
  });

  it('should accumulate multiple warnings', () => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1' }); // Mobile + Safari
    Object.defineProperty(navigator, 'deviceMemory', { value: 1 }); // Low memory
     // @ts-ignore
    delete global.WebAssembly; // No WebAssembly

    const result = getBrowserCompatibility();
    expect(result.isCompatible).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'WebAssembly is not supported in this browser. Transcription may not work.',
      'Safari may have limitations with WebAssembly or ONNX Runtime. Consider using Chrome or Edge for better performance.',
      'Low device memory detected (1GB). Smaller models (like \'tiny\') are strongly recommended for stability.',
      'Mobile device detected. Smaller models (like \'tiny\') are recommended for performance and stability.',
    ]));
    expect(result.warnings.length).toBe(4);
    expect(result.recommendedModel).toBe('tiny'); // Should still be tiny due to multiple flags
  });
});
