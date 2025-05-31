import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard } from './commonUtils'; // Adjust path as needed

describe('copyToClipboard', () => {
  // Store original navigator properties to restore them after tests
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    // Mock navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn(() => Promise.resolve()),
      },
      writable: true,
      configurable: true,
    });

    // Mock document.execCommand for fallback testing
    document.execCommand = vi.fn(() => true);
  });

  afterEach(() => {
    // Restore original properties
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
    document.execCommand = originalExecCommand;
    vi.clearAllMocks(); // Clear mocks to prevent interference between tests
  });

  it('should use navigator.clipboard.writeText and return true on success', async () => {
    const textToCopy = 'Hello, Vitest!';
    const result = await copyToClipboard(textToCopy);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(textToCopy);
    expect(result).toBe(true);
  });

  it('should return false if navigator.clipboard.writeText throws an error', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Copy failed'));

    const textToCopy = 'Test failure';
    // Suppress console.error for this specific test case
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await copyToClipboard(textToCopy);

    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to copy to clipboard:', expect.any(Error));

    consoleErrorSpy.mockRestore(); // Restore console.error
  });

  describe('Fallback mechanism (document.execCommand)', () => {
    beforeEach(() => {
      // Simulate navigator.clipboard being undefined to trigger fallback
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      });
       // Spy on document.body.appendChild and removeChild
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => ({} as Node));
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => ({} as Node));
    });

    it('should use document.execCommand if navigator.clipboard is not available and return true on success', async () => {
      const textToCopy = 'Fallback success';
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});


      const result = await copyToClipboard(textToCopy);

      expect(consoleWarnSpy).toHaveBeenCalledWith('Clipboard API not available.');
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(consoleLogSpy).toHaveBeenCalledWith('Fallback: Text copied to clipboard.');
      expect(result).toBe(true);

      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should return false if document.execCommand fails', async () => {
      vi.mocked(document.execCommand).mockReturnValueOnce(false); // Simulate execCommand failure
      const textToCopy = 'Fallback failure';
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await copyToClipboard(textToCopy);

      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Fallback: Copying text command was unsuccessful.');
      expect(result).toBe(false);
      consoleErrorSpy.mockRestore();
    });

    it('should return false if document.execCommand throws an error', async () => {
      vi.mocked(document.execCommand).mockImplementationOnce(() => {
        throw new Error('ExecCommand error');
      });
      const textToCopy = 'Fallback error';
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await copyToClipboard(textToCopy);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Fallback: Oops, unable to copy', expect.any(Error));
      expect(result).toBe(false);
      consoleErrorSpy.mockRestore();
    });
  });
});
