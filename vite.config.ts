import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      allow: [
        // Allow serving files from the project root
        path.resolve(__dirname),
        // Allow serving files from onnxruntime-web's dist directory
        path.resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
      ],
    },
  },
})
