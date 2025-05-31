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

// Example: Mocking MediaRecorder
// if (typeof window !== 'undefined' && !window.MediaRecorder) {
//   window.MediaRecorder = vi.fn().mockImplementation(() => ({
//     start: vi.fn(),
//     stop: vi.fn(),
//     ondataavailable: vi.fn(),
//     onerror: vi.fn(),
//     state: 'inactive',
//     isTypeSupported: vi.fn((mimeType: string) => {
//       if (mimeType === 'audio/webm' || mimeType === 'audio/webm;codecs=opus' || mimeType === 'audio/mp4') {
//         return true;
//       }
//       return false;
//     }),
//     // ... other methods and properties
//   }));
// }
console.log('Global test setup file loaded.');
