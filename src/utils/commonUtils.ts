// This file will contain common utility functions.

/**
 * Copies the given text to the clipboard.
 * @param text The text to copy.
 * @returns True if successful, false otherwise.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    // Check if clipboard API is available
    if (!navigator.clipboard) {
      console.warn('Clipboard API not available.');
      // Fallback for older browsers (less secure, requires user interaction)
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed'; // Prevent scrolling to bottom of page in MS Edge.
      textArea.style.left = '-9999px'; // Move out of screen
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          console.log('Fallback: Text copied to clipboard.');
          return true;
        } else {
          console.error('Fallback: Copying text command was unsuccessful.');
          return false;
        }
      } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
        return false;
      } finally {
        document.body.removeChild(textArea);
      }
    }

    // Use modern clipboard API
    await navigator.clipboard.writeText(text);
    console.log('Text copied to clipboard.');
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
};
