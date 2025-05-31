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
  // Removed larger models that may not be fully supported yet
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
      // This is a progressive fallback strategy: if one configuration fails (e.g., due to browser
      // limitations or ONNX runtime issues), the next, potentially less restrictive, configuration is tried.
      const fallbackConfigurations = [
        // Config 1: Standard configuration. Assumes full support for features.
        // 'quantized: false' typically means using FP32 models, which are larger but sometimes more stable.
        // 'revision: 'main'' ensures the latest model version from the main branch.
        // 'progress_callback' provides download progress updates.
        {
          quantized: false, // Use non-quantized (FP32) model version
          revision: 'main', // Use the main branch of the model repository
          progress_callback: (p: any) => {
            if (p.status === 'downloading' && p.total) {
              const percentage = Math.round((p.loaded / p.total) * 100);
              setProgress(Math.min(percentage, 90)); // Cap progress at 90% until fully loaded
            } else if (p.status === 'loaded') {
              // Model files downloaded, not yet fully initialized by pipeline
              setProgress(95);
            }
          }
        },
        // Config 2: Simplified configuration, still preferring non-quantized.
        // Removes progress_callback and revision pinning if they cause issues.
        {
          quantized: false
        },
        // Config 3: Basic fallback, often defaults to quantized models if available for the model ID.
        // This might be necessary if FP32 models are too large or not supported.
        // (Note: Xenova's transformers.js might automatically pick quantized if not specified and available)
        {
          // No specific options, rely on pipeline defaults which might include quantized models.
        },
        // Config 4: Absolute minimal, relying entirely on pipeline defaults.
        // This is the last resort if all other configurations fail.
        {}
      ];

      let lastError: Error | null = null;

      for (let i = 0; i < fallbackConfigurations.length; i++) {
        const currentConfig = fallbackConfigurations[i];
        try {
          console.log(`Attempting to load model with configuration ${i + 1}/${fallbackConfigurations.length}:`, currentConfig);

          transcriber.current = await pipeline(
            'automatic-speech-recognition', // Task type
            modelConfig.id,                 // Model identifier (e.g., "Xenova/whisper-tiny.en")
            currentConfig                   // Configuration options for this attempt
          );

          // After successfully initializing the pipeline, perform a quick test with dummy audio.
          // This helps catch models that load but fail on first inference due to compatibility issues.
          console.log('Model pipeline initialized. Testing with dummy input...');
          try {
            const testAudio = new Float32Array(1600); // 0.1 seconds of silence at 16kHz
            testAudio.fill(0.001); // Fill with very small non-zero values to avoid division by zero issues in some models

            await transcriber.current(testAudio, {
              task: 'transcribe',       // Standard task for Whisper
              return_timestamps: false // Timestamps not needed for this test
            });

            console.log(`Model ${modelConfig.name} loaded and passed dummy input test with configuration ${i + 1}`);
            lastError = null; // Clear any previous errors from failed attempts
            break; // Model loaded successfully, exit the loop
          } catch (testError) {
            console.warn(`Model ${modelConfig.name} failed dummy input test with configuration ${i + 1}:`, testError);
            transcriber.current = null; // Clear partially loaded model
            // Treat test failure as a configuration failure and try the next one.
            // Re-throw to be caught by the outer catch specific to this configuration attempt.
            throw testError;
          }

        } catch (configError) { // Catches errors from pipeline() or the dummy input test
          console.warn(`Configuration ${i + 1} failed:`, configError);
          lastError = configError instanceof Error ? configError : new Error(String(configError));
          transcriber.current = null;

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
