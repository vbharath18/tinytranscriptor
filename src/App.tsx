import { useState, useRef, useCallback, useEffect } from 'react';
import './App.css';
import { pipeline, env } from '@xenova/transformers';
import BrowserCompatibilityDisplay from './components/BrowserCompatibilityDisplay';
import ModelSelectorComponent from './components/ModelSelectorComponent';

// Configure transformers.js environment
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

// Configure ONNX Runtime Web settings with enhanced error prevention
if (typeof window !== 'undefined') {
  // Set ONNX Runtime Web execution providers with safe defaults
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.simd = false; // Disable SIMD to prevent errors
  env.backends.onnx.wasm.proxy = false;
  
  // Additional ONNX Runtime configuration
  env.backends.onnx.logLevel = 'warning';
  env.backends.onnx.executionProviders = ['wasm'];
  
  // WebAssembly optimization settings
  env.backends.onnx.wasm.wasmPaths = undefined; // Use default paths
  env.backends.onnx.wasm.initTimeout = 30000; // 30 second timeout
}

// Custom hook for audio recording with visualization
const useAudioRecorder = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const stopAudioLevelMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const startAudioLevelMonitoring = useCallback((stream: MediaStream) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const updateAudioLevel = () => {
      if (!analyserRef.current) return;
      
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(average / 255);
      
      // Update duration
      if (startTimeRef.current) {
        setRecordingDuration((Date.now() - startTimeRef.current) / 1000);
      }
      
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    };
    
    updateAudioLevel();
  }, []);

  const cleanupRecording = useCallback(() => {
    stopAudioLevelMonitoring();
    if (mediaRecorderRef.current?.stream) {
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    setRecordingDuration(0);
    startTimeRef.current = null;
  }, [stopAudioLevelMonitoring]);

  return {
    isRecording,
    setIsRecording,
    recordingDuration,
    audioLevel,
    mediaRecorderRef,
    audioChunks,
    startAudioLevelMonitoring,
    cleanupRecording,
    startTimeRef
  };
};

// Available Whisper models with corrected IDs
// Exporting WHISPER_MODELS and WhisperModelKey for use in child components
export const WHISPER_MODELS = {
  'tiny': { id: 'Xenova/whisper-tiny', name: 'Tiny (39MB)', size: '39MB', speed: 'Fastest', accuracy: 'Basic' },
  'tiny.en': { id: 'Xenova/whisper-tiny.en', name: 'Tiny English (39MB)', size: '39MB', speed: 'Fastest', accuracy: 'Basic' },
  'base': { id: 'Xenova/whisper-base', name: 'Base (74MB)', size: '74MB', speed: 'Fast', accuracy: 'Good' },
  'base.en': { id: 'Xenova/whisper-base.en', name: 'Base English (74MB)', size: '74MB', speed: 'Fast', accuracy: 'Good' },
  'small': { id: 'Xenova/whisper-small', name: 'Small (244MB)', size: '244MB', speed: 'Medium', accuracy: 'Better' },
  'small.en': { id: 'Xenova/whisper-small.en', name: 'Small English (244MB)', size: '244MB', speed: 'Medium', accuracy: 'Better' },
  // Removed larger models that may not be fully supported yet
} as const;

export type WhisperModelKey = keyof typeof WHISPER_MODELS; // Exported type

// Custom hook for transcription with progress tracking
const useTranscription = () => {
  const [transcript, setTranscript] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedModel, setSelectedModel] = useState<WhisperModelKey>('tiny.en');
  const transcriber = useRef<any>(null);
  const currentModelRef = useRef<string | null>(null);

  const initializeTranscriber = useCallback(async (modelKey?: WhisperModelKey) => {
    const modelToUse = modelKey || selectedModel;
    const modelConfig = WHISPER_MODELS[modelToUse];
    
    // Check if we need to reload the model
    if (transcriber.current && currentModelRef.current === modelConfig.id) {
      return transcriber.current;
    }
    
    // Clear existing model if switching
    if (transcriber.current && currentModelRef.current !== modelConfig.id) {
      transcriber.current = null;
      // Force garbage collection if available
      if (window.gc) {
        window.gc();
      }
    }
    
    setModelLoading(true);
    setProgress(0);
    try {
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setProgress((prev: number) => Math.min(prev + 5, 80));
      }, 500);

      console.log(`Loading Whisper model: ${modelConfig.name}...`);
      
      // Progressive fallback strategy for ONNX Runtime compatibility
      const fallbackConfigurations = [
        // Configuration 1: Minimal with specific ONNX settings
        {
          quantized: false,
          revision: 'main',
          progress_callback: (progress: any) => {
            if (progress.status === 'downloading' && progress.total) {
              const percentage = Math.round((progress.loaded / progress.total) * 100);
              setProgress(Math.min(percentage, 90));
            }
          }
        },
        // Configuration 2: Even more minimal
        {
          quantized: false
        },
        // Configuration 3: Basic fallback
        {
          quantized: false
        },
        // Configuration 4: Absolute minimal
        {}
      ];
      
      let lastError: Error | null = null;
      
      for (let i = 0; i < fallbackConfigurations.length; i++) {
        try {
          console.log(`Trying configuration ${i + 1}/${fallbackConfigurations.length} for ${modelConfig.name}...`);
          
          transcriber.current = await pipeline(
            'automatic-speech-recognition', 
            modelConfig.id,
            fallbackConfigurations[i]
          );
          
          // Test the model with a dummy input to ensure it works
          try {
            const testAudio = new Float32Array(1600); // 0.1 seconds at 16kHz
            testAudio.fill(0.001); // Small non-zero values
            
            await transcriber.current(testAudio, {
              task: 'transcribe',
              return_timestamps: false
            });
            
            console.log(`Model ${modelConfig.name} loaded and tested successfully with configuration ${i + 1}`);
            break;
          } catch (testError) {
            console.warn(`Model test failed with configuration ${i + 1}:`, testError);
            transcriber.current = null;
            throw testError;
          }
          
        } catch (configError) {
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

// Utility functions
const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
};

function App() {
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordingCompleted, setRecordingCompleted] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [audioDebugInfo, setAudioDebugInfo] = useState<any>(null);
  const [browserCompatibility, setBrowserCompatibility] = useState<{
    isCompatible: boolean;
    warnings: string[];
    recommendedModel: WhisperModelKey;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const audioRecorder = useAudioRecorder();
  const transcription = useTranscription();

  // Browser compatibility check
  useEffect(() => {
    const checkBrowserCompatibility = () => {
      const warnings: string[] = [];
      let recommendedModel: WhisperModelKey = 'tiny.en';
      let isCompatible = true;

      // Check WebAssembly support
      if (typeof WebAssembly === 'undefined') {
        warnings.push('WebAssembly is not supported in this browser.');
        isCompatible = false;
      }

      // Check for known problematic browsers
      const userAgent = navigator.userAgent.toLowerCase();
      
      if (userAgent.includes('firefox')) {
        warnings.push('Firefox may have ONNX Runtime compatibility issues. Chrome or Edge are recommended.');
        recommendedModel = 'tiny';
      }
      
      if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
        warnings.push('Safari may have limited WebAssembly support. Consider using Chrome or Edge.');
        recommendedModel = 'tiny';
      }

      // Check available memory (rough estimate)
      const memoryInfo = (navigator as any).deviceMemory;
      if (memoryInfo && memoryInfo < 4) {
        warnings.push('Low device memory detected. Smaller models are recommended.');
        recommendedModel = 'tiny';
      }

      // Check if running on mobile
      const isMobile = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
      if (isMobile) {
        warnings.push('Mobile device detected. Smaller models work better on mobile.');
        recommendedModel = 'tiny';
      }

      setBrowserCompatibility({ isCompatible, warnings, recommendedModel });

      // Auto-set recommended model if user hasn't changed it
      if (transcription.selectedModel === 'tiny.en' && recommendedModel !== 'tiny.en') {
        transcription.setSelectedModel(recommendedModel);
      }
    };

    checkBrowserCompatibility();
  }, [transcription]);

  // Audio configuration
  const audioConfig = {
    audio: {
      channelCount: 1,
      sampleRate: 44100, // Higher sample rate for better quality, we'll downsample later
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioRecorder.cleanupRecording();
      if (audioURL) {
        URL.revokeObjectURL(audioURL);
      }
    };
  }, [audioRecorder.cleanupRecording, audioURL]);

  // Improved audio buffer to WAV conversion with proper 16-bit PCM
  const audioBufferToWav = useCallback((buffer: AudioBuffer): ArrayBuffer => {
    const numChannels = 1;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16; // 16-bit for better compatibility
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const data = buffer.getChannelData(0);
    const length = data.length;
    const dataLength = length * bytesPerSample;
    const arrayBuffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Convert float32 to int16
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, data[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
    
    return arrayBuffer;
  }, []);

  // Start recording with audio visualization
  const startRecording = useCallback(async () => {
    setError(null);
    transcription.setTranscript('');
    setRecordingCompleted(false);
    setCopySuccess(false);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia(audioConfig);
      
      // Start audio level monitoring and timer
      audioRecorder.startAudioLevelMonitoring(stream);
      audioRecorder.startTimeRef.current = Date.now();
      
      // Check for supported MIME types
      const options: MediaRecorderOptions = { audioBitsPerSecond: 128000 };
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options.mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options.mimeType = 'audio/mp4';
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      audioRecorder.mediaRecorderRef.current = mediaRecorder;
      audioRecorder.audioChunks.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioRecorder.audioChunks.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioRecorder.audioChunks.current, { 
            type: options.mimeType || 'audio/webm' 
          });
          
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          // Resample to 16kHz if needed
          const targetSampleRate = 16000;
          let processedBuffer = audioBuffer;
          
          if (audioBuffer.sampleRate !== targetSampleRate) {
            const offlineContext = new OfflineAudioContext(1, 
              Math.ceil(audioBuffer.duration * targetSampleRate), 
              targetSampleRate
            );
            const source = offlineContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(offlineContext.destination);
            source.start(0);
            processedBuffer = await offlineContext.startRendering();
          }
          
          const wavBuffer = audioBufferToWav(processedBuffer);
          const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
          
          // Revoke previous URL to prevent memory leaks
          if (audioURL) {
            URL.revokeObjectURL(audioURL);
          }
          
          const url = URL.createObjectURL(wavBlob);
          setAudioURL(url);
          setRecordingCompleted(true);
          audioRecorder.setIsRecording(false);
          
          audioRecorder.cleanupRecording();
        } catch (err) {
          console.error('Recording processing error:', err);
          setError('Failed to process recording. Please try again.');
          audioRecorder.setIsRecording(false);
          audioRecorder.cleanupRecording();
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        setError('Recording error occurred. Please try again.');
        audioRecorder.setIsRecording(false);
        audioRecorder.cleanupRecording();
      };

      mediaRecorder.start(1000);
      audioRecorder.setIsRecording(true);
    } catch (err) {
      console.error('getUserMedia error:', err);
      setError('Microphone access denied or not available. Please check your browser permissions.');
      audioRecorder.setIsRecording(false);
    }
  }, [audioConfig, audioBufferToWav, audioURL, audioRecorder, transcription]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (audioRecorder.mediaRecorderRef.current && audioRecorder.isRecording) {
      audioRecorder.mediaRecorderRef.current.stop();
    }
  }, [audioRecorder.isRecording, audioRecorder.mediaRecorderRef]);

  // Handle file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    transcription.setTranscript('');
    setError(null);
    setCopySuccess(false);
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (audioURL) {
        URL.revokeObjectURL(audioURL);
      }
      setAudioURL(URL.createObjectURL(file));
      setRecordingCompleted(false);
    }
  };

  // Transcribe audio
  const transcribeAudio = useCallback(async () => {
    if (!audioURL) return;
    
    transcription.setLoading(true);
    transcription.setTranscript('');
    setError(null);
    setCopySuccess(false);

    try {
      const model = await transcription.initializeTranscriber();
      if (!model) {
        setError('Transcription model not available.');
        return;
      }

      const response = await fetch(audioURL);
      const audioBlob = await response.blob();
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Check audio duration first
      const duration = audioBuffer.duration;
      if (duration > 30) {
        setError('Audio is too long. Please use clips shorter than 30 seconds.');
        return;
      }
      
      if (duration < 0.1) {
        setError('Audio is too short. Please record at least 0.1 seconds.');
        return;
      }

      console.log(`Processing audio: ${duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels} channels`);

      // Store debug info
      setAudioDebugInfo({
        duration: duration.toFixed(2),
        originalSampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
        originalLength: audioBuffer.length,
      });

      // Get audio data - ensure we have the right format
      let audioData = audioBuffer.getChannelData(0); // Get first channel
      
      // Resample to 16kHz if needed (Whisper expects 16kHz)
      const targetSampleRate = 16000;
      if (audioBuffer.sampleRate !== targetSampleRate) {
        console.log(`Resampling from ${audioBuffer.sampleRate}Hz to ${targetSampleRate}Hz`);
        const offlineContext = new OfflineAudioContext(
          1, 
          Math.ceil(audioBuffer.duration * targetSampleRate), 
          targetSampleRate
        );
        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineContext.destination);
        source.start(0);
        const resampledBuffer = await offlineContext.startRendering();
        audioData = resampledBuffer.getChannelData(0);
      }

      // Check if audio has any meaningful signal
      const maxAmplitude = Math.max(...Array.from(audioData).map(Math.abs));
      const rmsAmplitude = Math.sqrt(audioData.reduce((sum, sample) => sum + sample * sample, 0) / audioData.length);
      
      console.log(`Audio stats: max amplitude: ${maxAmplitude.toFixed(4)}, RMS: ${rmsAmplitude.toFixed(4)}`);
      
      // Update debug info
      setAudioDebugInfo((prev: any) => ({
        ...prev,
        maxAmplitude: maxAmplitude.toFixed(4),
        rmsAmplitude: rmsAmplitude.toFixed(4),
        processedLength: audioData.length,
        targetSampleRate: targetSampleRate,
      }));
      
      if (maxAmplitude < 0.0001) {
        setError('Audio signal is too weak. Please speak louder or check your microphone.');
        return;
      }

      // Normalize audio if it's too quiet but above threshold
      if (maxAmplitude < 0.1 && maxAmplitude > 0.0001) {
        console.log('Normalizing quiet audio...');
        const normalizationFactor = 0.5 / maxAmplitude;
        audioData = audioData.map(sample => sample * normalizationFactor);
        console.log(`Audio normalized with factor: ${normalizationFactor.toFixed(2)}`);
      }

      console.log(`Transcribing audio: ${duration.toFixed(2)}s, ${targetSampleRate}Hz, ${audioData.length} samples`);

      // Ensure audio data is properly formatted and within valid range
      const processedAudio = new Float32Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        // Clamp values to [-1, 1] range and ensure no NaN/Infinity values
        const sample = audioData[i];
        if (isNaN(sample) || !isFinite(sample)) {
          processedAudio[i] = 0;
        } else {
          processedAudio[i] = Math.max(-1, Math.min(1, sample));
        }
      }

      // Additional validation to prevent ONNX Runtime errors
      if (processedAudio.length === 0) {
        setError('Audio processing failed: empty audio data.');
        return;
      }

      // Ensure minimum audio length for Whisper
      const minSamples = 160; // 0.01 seconds at 16kHz
      if (processedAudio.length < minSamples) {
        setError('Audio is too short for processing. Please record at least 0.01 seconds.');
        return;
      }

      // Transcribe with improved error handling and timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Transcription timeout')), 60000); // Increased timeout
      });

      try {
        console.log('Starting transcription with processed audio...');
        
        // Progressive transcription configurations for better compatibility
        const transcriptionConfigs = [
          // Config 1: Standard with safety options
          {
            task: 'transcribe',
            language: transcription.selectedModel.includes('.en') ? 'english' : undefined,
            return_timestamps: false,
            chunk_length_s: 10, // Reduced chunk size
            stride_length_s: 2,
            force_full_sequences: false,
            suppress_tokens: [-1], // Suppress end token issues
          },
          // Config 2: Minimal options
          {
            task: 'transcribe',
            language: transcription.selectedModel.includes('.en') ? 'english' : undefined,
            return_timestamps: false,
            chunk_length_s: 30,
          },
          // Config 3: Absolute minimal
          {
            task: 'transcribe',
            return_timestamps: false,
          },
          // Config 4: Basic fallback
          {}
        ];

        let result = null;
        let lastTranscriptionError: Error | null = null;

        for (let i = 0; i < transcriptionConfigs.length; i++) {
          try {
            console.log(`Trying transcription configuration ${i + 1}/${transcriptionConfigs.length}...`);
            
            const transcriptionPromise = model(processedAudio, transcriptionConfigs[i]);
            result = await Promise.race([transcriptionPromise, timeoutPromise]);
            
            console.log(`Transcription successful with configuration ${i + 1}:`, result);
            break;
            
          } catch (configError) {
            console.warn(`Transcription configuration ${i + 1} failed:`, configError);
            lastTranscriptionError = configError instanceof Error ? configError : new Error(String(configError));
            
            // Check for ONNX Runtime specific errors
            if (configError instanceof Error && 
                (configError.message.includes('OrtRun') || 
                 configError.message.includes('error code = 6') ||
                 configError.message.includes('Session'))) {
              console.error('ONNX Runtime error detected:', configError);
              
              // If this is an ONNX error and we're not on the last config, continue
              if (i < transcriptionConfigs.length - 1) {
                continue;
              } else {
                // Last config failed with ONNX error
                throw new Error('ONNX Runtime execution failed. This model may be incompatible with your browser. Please try: 1) Using a smaller model (tiny or base), 2) Refreshing the page, 3) Using a different browser, or 4) Clearing browser cache.');
              }
            }
            
            // If this is the last configuration, throw the error
            if (i === transcriptionConfigs.length - 1) {
              throw lastTranscriptionError;
            }
          }
        }
        
        if (!result) {
          throw new Error('All transcription configurations failed');
        }
        
        console.log('Raw transcription result:', result);
        
        // Handle different result formats from Whisper
        let text = '';
        if (typeof result === 'string') {
          text = result;
        } else if (result && typeof result === 'object') {
          if (Array.isArray(result)) {
            text = result.map(r => r.text || r).join(' ');
          } else if (result.text) {
            text = result.text;
          } else if (result.chunks) {
            text = result.chunks.map((chunk: any) => chunk.text).join(' ');
          }
        }
        
        if (!text || text.trim().length === 0 || text.trim() === '') {
          // Try with more basic configuration if first attempt fails
          console.log('Empty result, trying with basic configuration...');
          
          const retryResult = await model(processedAudio, {
            task: 'transcribe',
            language: transcription.selectedModel.includes('.en') ? 'english' : undefined,
            return_timestamps: false,
          });
          
          console.log('Retry transcription result:', retryResult);
          
          let retryText = '';
          if (typeof retryResult === 'string') {
            retryText = retryResult;
          } else if (retryResult && typeof retryResult === 'object') {
            if (Array.isArray(retryResult)) {
              retryText = retryResult.map(r => r.text || r).join(' ');
            } else if (retryResult.text) {
              retryText = retryResult.text;
            }
          }
          
          if (!retryText || retryText.trim().length === 0) {
            setError('No speech detected in the audio. Try speaking more clearly, closer to the microphone, or in a quieter environment.');
            return;
          }
          
          text = retryText;
        }
        
        // Clean up the transcript
        const cleanedText = text.trim().replace(/^\[.*?\]\s*/, ''); // Remove timestamp markers
        transcription.setTranscript(cleanedText);
        console.log('Transcription completed:', cleanedText);
        
      } catch (transcriptionError) {
        console.error('Transcription execution error:', transcriptionError);
        
        // Check for specific ONNX Runtime errors
        if (transcriptionError instanceof Error) {
          if (transcriptionError.message.includes('OrtRun') || 
              transcriptionError.message.includes('error code = 6') ||
              transcriptionError.message.includes('Session') ||
              transcriptionError.message.includes('backend')) {
            setError('ONNX Runtime execution error detected. This may be a compatibility issue. Please try: 1) Using a smaller model (tiny or base), 2) Refreshing the page, 3) Using a different browser (Chrome/Edge recommended), 4) Clearing browser cache, or 5) Checking if WebAssembly is enabled in your browser.');
            return;
          } else if (transcriptionError.message.includes('out of memory') || transcriptionError.message.includes('OOM')) {
            setError('Not enough memory to run this model. Try using a smaller model (tiny or base).');
            return;
          } else if (transcriptionError.message.includes('WebAssembly') || transcriptionError.message.includes('wasm')) {
            setError('WebAssembly error. Please ensure WebAssembly is enabled in your browser and try refreshing the page.');
            return;
          }
        }
        
        throw transcriptionError; // Re-throw if it's not a known ONNX error
      }
      
    } catch (err) {
      console.error('Transcription error:', err);
      if (err instanceof Error) {
        if (err.message === 'Transcription timeout') {
          setError('Transcription timed out. Try with a shorter audio clip or a smaller model.');
        } else if (err.message.includes('OrtRun') || 
                   err.message.includes('error code = 6') ||
                   err.message.includes('Session') ||
                   err.message.includes('backend')) {
          setError('ONNX Runtime execution failed. This appears to be a compatibility issue. Solutions: 1) Try the "tiny" or "base" model, 2) Refresh the page, 3) Clear browser cache (Ctrl+Shift+Delete), 4) Use Chrome or Edge browser, 5) Check if WebAssembly is enabled, 6) Try recording shorter/clearer audio.');
        } else if (err.message.includes('out of memory') || err.message.includes('OOM')) {
          setError('Not enough memory to run this model. Please try using a smaller model (tiny or base).');
        } else if (err.message.includes('network') || err.message.includes('fetch')) {
          setError('Network error loading model. Please check your connection and try again.');
        } else if (err.message.includes('WebAssembly') || err.message.includes('wasm')) {
          setError('WebAssembly error. Please ensure WebAssembly is enabled in your browser settings and refresh the page.');
        } else if (err.message.includes('incompatible') || err.message.includes('ONNX Runtime execution failed')) {
          setError('Model compatibility issue detected. Please try: 1) Using the "tiny" model, 2) Refreshing the page, 3) Using Chrome or Edge browser, 4) Clearing browser cache.');
        } else {
          setError(`Transcription failed: ${err.message}. Try using a smaller model or refreshing the page.`);
        }
      } else {
        setError('Transcription failed. Make sure your audio is clear and try again with a smaller model if the issue persists.');
      }
    } finally {
      transcription.setLoading(false);
    }
  }, [audioURL, transcription]);

  // Download audio file
  const downloadAudio = useCallback(() => {
    if (audioURL) {
      const link = document.createElement('a');
      link.href = audioURL;
      link.download = `recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.wav`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [audioURL]);

  // Clear all data and reset state
  const clearAll = useCallback(() => {
    if (audioURL) {
      URL.revokeObjectURL(audioURL);
    }
    setAudioURL(null);
    transcription.setTranscript('');
    setError(null);
    setCopySuccess(false);
    setRecordingCompleted(false);
    setAudioDebugInfo(null);
    audioRecorder.cleanupRecording();
  }, [audioURL, transcription, audioRecorder]);

  // Copy transcript to clipboard
  const handleCopyTranscript = async () => {
    if (transcription.transcript) {
      const success = await copyToClipboard(transcription.transcript);
      setCopySuccess(success);
      if (success) {
        setTimeout(() => setCopySuccess(false), 2000);
      }
    }
  };

  // ONNX Runtime diagnostic function
  const runONNXDiagnostic = useCallback(async () => {
    console.log('🔍 Running ONNX Runtime diagnostic...');
    
    const diagnosticResults = {
      webAssembly: typeof WebAssembly !== 'undefined',
      transformersEnv: !!env,
      backendConfig: env.backends?.onnx,
      userAgent: navigator.userAgent,
      memory: (navigator as any).deviceMemory || 'unknown',
      hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
    };
    
    console.log('📊 Diagnostic Results:', diagnosticResults);
    
    try {
      // Try to load the smallest model for testing
      console.log('🧪 Testing tiny model loading...');
      const testModel = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        quantized: false
      });
      
      // Test with minimal audio
      const testAudio = new Float32Array(1600); // 0.1 seconds at 16kHz
      testAudio.fill(0.001);
      
      console.log('🧪 Testing model execution...');
      const result = await testModel(testAudio, { task: 'transcribe' });
      
      console.log('✅ ONNX Runtime diagnostic PASSED');
      console.log('📝 Test result:', result);
      
      setError('✅ ONNX Runtime diagnostic passed! The system appears to be working correctly. Try transcribing your audio again.');
      
    } catch (diagnosticError) {
      console.error('❌ ONNX Runtime diagnostic FAILED:', diagnosticError);
      
      if (diagnosticError instanceof Error) {
        if (diagnosticError.message.includes('OrtRun') || diagnosticError.message.includes('error code = 6')) {
          setError('❌ ONNX Runtime diagnostic failed with error code 6. This confirms a compatibility issue. Solutions: 1) Use Chrome/Edge browser, 2) Enable WebAssembly in browser settings, 3) Clear browser cache completely, 4) Try incognito mode, 5) Update your browser.');
        } else {
          setError(`❌ ONNX Runtime diagnostic failed: ${diagnosticError.message}. This may indicate a browser compatibility issue.`);
        }
      }
    }
  }, []);

  return (
    <div className="container">
      <h1>TinyTranscriptor</h1>
      
      {/* Browser Compatibility Warnings - Replaced with component */}
      <BrowserCompatibilityDisplay 
        browserCompatibility={browserCompatibility} 
        whisperModels={WHISPER_MODELS} 
      />
      
      <div className="controls">
        <button 
          onClick={startRecording} 
          disabled={audioRecorder.isRecording || transcription.modelLoading}
          className={audioRecorder.isRecording ? 'recording' : ''}
        >
          {transcription.modelLoading ? 'Loading...' : audioRecorder.isRecording ? 'Recording...' : 'Record'}
        </button>
        <button onClick={stopRecording} disabled={!audioRecorder.isRecording}>
          Stop
        </button>
        <input 
          type="file" 
          accept="audio/*"
          onChange={handleFileChange}
          disabled={transcription.modelLoading} 
        />
        <button 
          onClick={transcribeAudio} 
          disabled={!audioURL || transcription.loading || transcription.modelLoading}
        >
          {transcription.loading ? 'Transcribing...' : transcription.modelLoading ? 'Loading Model...' : 'Transcribe'}
        </button>
        {audioURL && (
          <>
            <button 
              onClick={downloadAudio}
              className="secondary-button"
              title="Download audio file"
            >
              📥 Download
            </button>
            <button 
              onClick={clearAll}
              className="secondary-button danger"
              title="Clear all data"
            >
              🗑️ Clear All
            </button>
            <button 
              onClick={runONNXDiagnostic}
              className="secondary-button diagnostic"
              title="Run ONNX Runtime diagnostic test"
            >
              🔍 Test ONNX
            </button>
          </>
        )}
      </div>
      
      {/* Model Selection - Replaced with component */}
      <ModelSelectorComponent 
        selectedModel={transcription.selectedModel}
        setSelectedModel={transcription.setSelectedModel}
        modelLoading={transcription.modelLoading}
        transcriptionLoading={transcription.loading}
        whisperModels={WHISPER_MODELS}
      />
        
      {/* Status Messages */}
      {transcription.modelLoading && (
        <div className="model-loading">
          <div className="loading-text">Loading {WHISPER_MODELS[transcription.selectedModel].name}...</div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${transcription.progress}%` }}
            ></div>
          </div>
          <div className="loading-subtext">
            Downloading {WHISPER_MODELS[transcription.selectedModel].size} model - This may take a moment on first load
          </div>
        </div>
      )}

      {recordingCompleted && !audioRecorder.isRecording && (
        <div className="status-indicator status-completed">
          ✓ Recording completed! You can now play or transcribe.
        </div>
      )}

      {audioURL && (
        <div className="audio-container">
          <audio
            ref={audioRef}
            src={audioURL}
            key={audioURL}
            controls
            preload="auto"
          >
            Your browser does not support the audio element.
          </audio>
        </div>
      )}

      {audioURL && !transcription.loading && !transcription.modelLoading && (
        <div className="audio-debug">
          <details>
            <summary>🔧 Audio Debug Info</summary>
            <div className="debug-content">
              {audioDebugInfo ? (
                <>
                  <p><strong>Duration:</strong> {audioDebugInfo.duration}s</p>
                  <p><strong>Sample Rate:</strong> {audioDebugInfo.originalSampleRate}Hz → {audioDebugInfo.targetSampleRate}Hz</p>
                  <p><strong>Channels:</strong> {audioDebugInfo.channels}</p>
                  <p><strong>Audio Length:</strong> {audioDebugInfo.originalLength} → {audioDebugInfo.processedLength} samples</p>
                  <p><strong>Max Amplitude:</strong> {audioDebugInfo.maxAmplitude}</p>
                  <p><strong>RMS Amplitude:</strong> {audioDebugInfo.rmsAmplitude}</p>
                  <p style={{color: parseFloat(audioDebugInfo.maxAmplitude) < 0.01 ? '#ff4757' : '#2ed573'}}>
                    Signal Strength: {parseFloat(audioDebugInfo.maxAmplitude) < 0.01 ? 'Weak ⚠️' : 'Good ✅'}
                  </p>
                </>
              ) : (
                <p>Audio file loaded. Click "Transcribe" to see debug info.</p>
              )}
            </div>
          </details>
        </div>
      )}

      {transcription.transcript && (
        <div className="transcript">
          <div className="transcript-header">
            <h2>Transcript</h2>
            <button 
              onClick={handleCopyTranscript}
              className="copy-button"
              title="Copy to clipboard"
            >
              {copySuccess ? '✓ Copied!' : '📋 Copy'}
            </button>
          </div>
          <p>{transcription.transcript}</p>
        </div>
      )}

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      <footer>
        Powered by transformers.js, ONNX Runtime, and OpenAI Whisper tiny
      </footer>
    </div>
  );
}

export default App;
