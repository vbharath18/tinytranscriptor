/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true, // Allows using Vitest globals (describe, test, expect) without importing
    environment: 'jsdom', // Simulates a browser environment for testing
    // Optional: if setup files are needed, uncomment and create the file
    setupFiles: './src/test/setupTests.ts',
  },
});
