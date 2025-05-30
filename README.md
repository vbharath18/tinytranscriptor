# TinyTranscriptor

TinyTranscriptor is a React app that uses transformers.js and the OpenAI Whisper tiny model to transcribe audio to text in the browser. It leverages ONNX Runtime for efficient model inference.

## Features
- Record or upload audio files
- Transcribe audio using Whisper tiny model (runs in-browser)
- Modern, responsive UI

## Getting Started

1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the development server:
   ```sh
   npm run dev
   ```
3. Open your browser at [http://localhost:5173](http://localhost:5173)

## Tech Stack
- React + TypeScript
- Vite
- [transformers.js](https://huggingface.co/docs/transformers.js/v3.0.0/index)
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime)
- [OpenAI Whisper](https://github.com/openai/whisper)

## Notes
- All transcription runs locally in your browser. No audio is sent to a server.
- For best results, use short, clear audio clips.

---

Replace this README with more details as you customize the app!
