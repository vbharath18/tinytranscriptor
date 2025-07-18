import { useState, useRef, useCallback } from 'react';
import { pipeline } from '@xenova/transformers';

// Available Whisper models with corrected IDs
export const WHISPER_MODELS = {
  'tiny': { id: 'Xenova/whisper-tiny', name: 'Tiny (39MB)', size: '39MB', speed: 'Fastest', accuracy: 'Basic' },
  'tiny.en': { id: 'Xenova/whisper-tiny.en', name: 'Tiny English (39MB)', size: '39MB', speed: 'Fastest', accuracy: 'Basic' },
  'base': { id: 'Xenova/whisper-base', name: 'Base (74MB)', size: '74MB', speed: 'Fast', accuracy: 'Good' },
  'base.en': { id: 'Xenova/whisper-base.en', name: 'Base English (74MB)', size: '74MB', speed: 'Fast', accuracy: 'Good' },
  'small': { id: 'Xenova/whisper-small', name: 'Small (244MB)', size: '244MB', speed: 'Medium', accuracy: 'Better' },
  'small.en': { id: 'Xenova/whisper-small.en', name: 'Small English (244MB)', size: '244MB', speed: 'Medium', accuracy: 'Better' },
  'voxtral': { id: 'mistralai/Voxtral-Mini-3B-2507', name: 'Voxtral Mini (3B)', size: '3GB', speed: 'Slow', accuracy: 'Best' },
} as const;

export type WhisperModelKey = keyof typeof WHISPER_MODELS;

// Custom hook for transcription with progress tracking
const useTranscription = () => {
  const [transcript, setTranscript] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedModel, setSelectedModel] = useState<WhisperModelKey>('tiny.en');
  const transcriber = useRef<any>(null); // Holds the loaded transcription pipeline
  // Stores the ID of the currently loaded model to avoid reloading the same model.
  const currentModelRef = useRef<string | null>(null);

  const initializeTranscriber = useCallback(async (modelKey?: WhisperModelKey) => {
    const modelToUse = modelKey || selectedModel; // Use provided modelKey or the currently selected one
    const modelConfig = WHISPER_MODELS[modelToUse]; // Get configuration for the selected model

    // If the requested model is already loaded, return the existing transcriber instance.
    if (transcriber.current && currentModelRef.current === modelConfig.id) {
      console.log(`Model ${modelConfig.name} is already loaded.`);
      return transcriber.current;
    }

    // If a different model is loaded, or switching models, clear the old one.
    if (transcriber.current && currentModelRef.current !== modelConfig.id) {
      console.log(`Switching model from ${currentModelRef.current} to ${modelConfig.id}`);
      transcriber.current = null; // Allow the old model to be garbage collected
      currentModelRef.current = null;
      // Attempt to explicitly trigger garbage collection if the browser supports it.
      // This can be helpful in resource-constrained environments like mobile browsers.
      if ((window as any).gc) {
        console.log('Attempting to trigger garbage collection...');
        (window as any).gc();
      }
    }

    setModelLoading(true); // Signal that model loading has started
    setProgress(0);
    try {
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setProgress((prev: number) => Math.min(prev + 5, 80));
      }, 500);

      console.log(`Loading Whisper model: ${modelConfig.name} (${modelConfig.id})...`);

      // Defines a series of configurations to attempt when loading the model.
      // This is a progressive fallback strategy with enhanced compatibility options
      const fallbackConfigurations = [
        // Config 1: Most compatible configuration for ONNX Runtime Web
        {
          quantized: true, // Use quantized models first for better compatibility
          dtype: 'fp32',
          revision: 'main',
          progress_callback: (p: any) => {
            if (p.status === 'downloading' && p.total) {
              const percentage = Math.round((p.loaded / p.total) * 100);
              setProgress(Math.min(percentage, 90)); // Cap progress at 90% until fully loaded
            } else if (p.status === 'loaded') {
              setProgress(95);
            }
          }
        },
        // Config 2: Try quantized without specific dtype
        {
          quantized: true,
          revision: 'main'
        },
        // Config 3: Non-quantized with specific device targeting
        {
          quantized: false,
          device: 'wasm',
          dtype: 'fp32'
        },
        // Config 4: Basic quantized fallback
        {
          quantized: true
        },
        // Config 5: Basic non-quantized fallback
        {
          quantized: false
        },
        // Config 6: Absolute minimal configuration
        {}
      ];

      let lastError: Error | null = null;

      for (let i = 0; i < fallbackConfigurations.length; i++) {
        const currentConfig = fallbackConfigurations[i];
        try {
          console.log(`Attempting to load model with configuration ${i + 1}/${fallbackConfigurations.length}:`, currentConfig);

          // Add timeout wrapper for model loading
          const modelLoadingPromise = pipeline(
            'automatic-speech-recognition', // Task type
            modelConfig.id,                 // Model identifier (e.g., "Xenova/whisper-tiny.en")
            currentConfig                   // Configuration options for this attempt
          );

          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Model loading timeout')), 120000) // 2 minute timeout
          );

          transcriber.current = await Promise.race([modelLoadingPromise, timeoutPromise]);

          // After successfully initializing the pipeline, perform a quick test with dummy audio.
          // This helps catch models that load but fail on first inference due to compatibility issues.
          console.log('Model pipeline initialized. Testing with dummy input...');
          try {
            const testAudio = new Float32Array(1600); // 0.1 seconds of silence at 16kHz
            testAudio.fill(0.001); // Fill with very small non-zero values to avoid division by zero issues in some models

            // Test with minimal configuration to avoid inference errors
            const testResult = await transcriber.current(testAudio, {
              task: 'transcribe',
              return_timestamps: false,
              language: modelConfig.id.includes('.en') ? 'english' : undefined,
              chunk_length_s: 30,
              stride_length_s: 5
            });

            console.log(`Model ${modelConfig.name} loaded and passed dummy input test with configuration ${i + 1}`, testResult);
            lastError = null; // Clear any previous errors from failed attempts
            break; // Model loaded successfully, exit the loop
          } catch (testError) {
            console.warn(`Model ${modelConfig.name} failed dummy input test with configuration ${i + 1}:`, testError);
            transcriber.current = null; // Clear partially loaded model
            // Treat test failure as a configuration failure and try the next one.
            throw testError;
          }

        } catch (configError) { // Catches errors from pipeline() or the dummy input test
          console.warn(`Configuration ${i + 1} failed:`, configError);
          lastError = configError instanceof Error ? configError : new Error(String(configError));
          transcriber.current = null;

          // Add delay between attempts to prevent overwhelming the browser
          if (i < fallbackConfigurations.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          // If this is the last configuration, throw the error
          if (i === fallbackConfigurations.length - 1) {
            throw lastError;
          }
        }
      }

      currentModelRef.current = modelConfig.id;
      clearInterval(progressInterval);
      setProgress(100);
      console.log(`Whisper model ${modelConfig.name} loaded successfully`);
    } catch (err) {
      console.error('All model loading configurations failed:', err);

      throw new Error(`Failed to load transcription model ${modelConfig.name}. This may be due to ONNX Runtime compatibility issues. Please try: 1) Using a smaller model (tiny or base), 2) Refreshing the page, 3) Clearing browser cache, or 4) Using a different browser. Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setModelLoading(false);
      setTimeout(() => setProgress(0), 500);
    }

    return transcriber.current;
  }, [selectedModel]);

  return {
    transcript,
    setTranscript,
    loading,
    setLoading,
    modelLoading,
    setModelLoading,
    progress,
    setProgress,
    selectedModel,
    setSelectedModel,
    transcriber,
    initializeTranscriber
  };
};

export default useTranscription;
