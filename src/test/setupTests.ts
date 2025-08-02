// Import Jest DOM custom matchers to extend Vitest's `expect`
import '@testing-library/jest-dom';

// This file can be used for global test setup, mocks, etc.
// For example, mocking browser APIs not available in JSDOM:
// import { vi } from 'vitest';

// Example: Mocking navigator.clipboard if tests require it globally
// Object.defineProperty(navigator, 'clipboard', {
//   value: {
//     writeText: vi.fn(() => Promise.resolve()),
//     readText: vi.fn(() => Promise.resolve('')),
//   },
//   writable: true,
//   configurable: true,
// });

// Polyfill Blob.arrayBuffer for JSDOM environment, which is missing this method.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as ArrayBuffer);
      };
      reader.onerror = () => {
        reject(reader.error);
      };
      // FileReader can read a Blob directly, no need for the .text() intermediate step.
      reader.readAsArrayBuffer(this);
    });
  };
}

// Mocking MediaRecorder
if (typeof window !== 'undefined') {
  // Store the most recent MediaRecorder instance to allow tests to interact with it
  let currentMediaRecorderInstance: any;

  if (!window.MediaRecorder) {
    const MediaRecorderMock = vi.fn().mockImplementation((stream: MediaStream, options?: MediaRecorderOptions) => {
      const instance = {
        stream: stream,
        mimeType: options?.mimeType || 'audio/webm',
        state: 'inactive' as RecordingState,
        ondataavailable: null as ((event: BlobEvent) => void) | null,
        onstop: null as (() => void) | null,
        onerror: null as ((event: Event) => void) | null,
        start: vi.fn(function(timeslice?: number) {
          this.state = 'recording';
          console.log('Mock MediaRecorder: start called', timeslice);
        }),
        stop: vi.fn(function() {
          this.state = 'inactive';
          console.log('Mock MediaRecorder: stop called');
          if (this.onstop) {
            this.onstop();
          }
        }),
        pause: vi.fn(function() {
          if (this.state === 'recording') {
            this.state = 'paused';
          }
        }),
        resume: vi.fn(function() {
          if (this.state === 'paused') {
            this.state = 'recording';
          }
        }),
        isTypeSupported: vi.fn((mimeType: string) => {
          console.log('Mock MediaRecorder: isTypeSupported called with', mimeType);
          return mimeType === 'audio/webm' || mimeType === 'audio/webm;codecs=opus' || mimeType === 'audio/mp4';
        }),
        // Test helper methods
        _simulateDataAvailable: function(data: Blob) {
          if (this.ondataavailable && this.state === 'recording') {
            const event = new BlobEvent('dataavailable', { data });
            this.ondataavailable(event);
          }
        },
        _simulateError: function(error: Error) {
            if (this.onerror) {
                const event = new Event('error');
                (event as any).error = error;
                this.onerror(event);
            }
        },
        _getEventListeners: function() {
            return {
                ondataavailable: this.ondataavailable,
                onstop: this.onstop,
                onerror: this.onerror,
            };
        }
      };
      currentMediaRecorderInstance = instance;
      return instance;
    });

    // Static method
    MediaRecorderMock.isTypeSupported = vi.fn((mimeType: string) => {
        console.log('Mock MediaRecorder: Static isTypeSupported called with', mimeType);
        return mimeType === 'audio/webm' || mimeType === 'audio/webm;codecs=opus' || mimeType === 'audio/mp4';
    });

    (window as any).MediaRecorder = MediaRecorderMock;
    (window as any).BlobEvent = class BlobEvent extends Event {
        data: Blob;
        constructor(type: string, eventInitDict: { data: Blob }) {
            super(type);
            this.data = eventInitDict.data;
        }
    };
    // Helper for tests to get the current instance
    (window as any).getLatestMediaRecorderInstance = () => currentMediaRecorderInstance;
  }

  // Mocking navigator.mediaDevices.getUserMedia
  if (!navigator.mediaDevices) {
    (navigator as any).mediaDevices = {};
  }
  navigator.mediaDevices.getUserMedia = vi.fn(() =>
    Promise.resolve({
      getTracks: vi.fn(() => [{ stop: vi.fn() }]), // Mock MediaStream with getTracks
    })
  );
}

console.log('Global test setup file loaded and mocks applied.');
