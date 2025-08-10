import { useState, useRef, useCallback } from 'react';
import { pipeline } from '@xenova/transformers';

export const WHISPER_MODELS = {
  'tiny': { id: 'Xenova/whisper-tiny', name: 'Tiny (39MB)', size: '39MB', speed: 'Fastest', accuracy: 'Basic' },
  'tiny.en': { id: 'Xenova/whisper-tiny.en', name: 'Tiny English (39MB)', size: '39MB', speed: 'Fastest', accuracy: 'Basic' },
  'base': { id: 'Xenova/whisper-base', name: 'Base (74MB)', size: '74MB', speed: 'Fast', accuracy: 'Good' },
  'base.en': { id: 'Xenova/whisper-base.en', name: 'Base English (74MB)', size: '74MB', speed: 'Fast', accuracy: 'Good' },
  'small': { id: 'Xenova/whisper-small', name: 'Small (244MB)', size: '244MB', speed: 'Medium', accuracy: 'Better' },
  'small.en': { id: 'Xenova/whisper-small.en', name: 'Small English (244MB)', size: '244MB', speed: 'Medium', accuracy: 'Better' },
} as const;

export type WhisperModelKey = keyof typeof WHISPER_MODELS;

const useTranscription = () => {
  const [transcript, setTranscript] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedModel, setSelectedModel] = useState<WhisperModelKey>('tiny.en');
  const [error, setError] = useState<string | null>(null);
  const [audioDebugInfo, setAudioDebugInfo] = useState<any | null>(null);
  const transcriber = useRef<any>(null);
  const currentModelRef = useRef<string | null>(null);

  const initializeTranscriber = useCallback(async (modelKey?: WhisperModelKey) => {
    const modelToUse = modelKey || selectedModel;
    const modelConfig = WHISPER_MODELS[modelToUse];

    if (transcriber.current && currentModelRef.current === modelConfig.id) {
      return transcriber.current;
    }

    if (transcriber.current && currentModelRef.current !== modelConfig.id) {
      transcriber.current = null;
      currentModelRef.current = null;
      if ((window as any).gc) {
        (window as any).gc();
      }
    }

    setModelLoading(true);
    setProgress(0);
    try {
      const progressInterval = setInterval(() => setProgress(prev => Math.min(prev + 5, 80)), 500);
      const fallbackConfigurations = [
        { quantized: true, dtype: 'fp32', revision: 'main', progress_callback: (p: any) => { if (p.status === 'downloading' && p.total) setProgress(Math.min(Math.round((p.loaded / p.total) * 100), 90)); else if (p.status === 'loaded') setProgress(95); } },
        { quantized: true, revision: 'main' },
        { quantized: false, device: 'wasm', dtype: 'fp32' },
        { quantized: true },
        { quantized: false },
        {}
      ];
      let lastError: Error | null = null;
      for (const config of fallbackConfigurations) {
        try {
          const modelLoadingPromise = pipeline('speech-to-text', modelConfig.id, config);
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Model loading timeout')), 120000));
          transcriber.current = await Promise.race([modelLoadingPromise, timeoutPromise]);
          const testAudio = new Float32Array(1600).fill(0.001);
          await transcriber.current(testAudio, { return_timestamps: false, language: modelConfig.id.includes('.en') ? 'english' : undefined, chunk_length_s: 30, stride_length_s: 5 });
          lastError = null;
          break;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          transcriber.current = null;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      if (lastError) throw lastError;
      currentModelRef.current = modelConfig.id;
      clearInterval(progressInterval);
      setProgress(100);
    } catch (err) {
      setError(`Failed to load model: ${err instanceof Error ? err.message : 'Unknown error'}`);
      throw err;
    } finally {
      setModelLoading(false);
      setTimeout(() => setProgress(0), 500);
    }
    return transcriber.current;
  }, [selectedModel]);

  const transcribe = useCallback(async (audioURL: string | null) => {
    if (!audioURL) {
      setError('No audio file available for transcription.');
      return;
    }

    setLoading(true);
    setTranscript('');
    setError(null);
    setAudioDebugInfo(null);

    try {
      let transcriberPipeline = transcriber.current;
      if (!transcriberPipeline || currentModelRef.current !== WHISPER_MODELS[selectedModel].id) {
          transcriberPipeline = await initializeTranscriber();
      }
      if (!transcriberPipeline) {
        throw new Error("Failed to initialize transcription model.");
      }

      const response = await fetch(audioURL);
      if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);
      const audioBlob = await response.blob();
      const arrayBuffer = await audioBlob.arrayBuffer();

      const tempAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedAudioBuffer = await tempAudioContext.decodeAudioData(arrayBuffer);

      const duration = decodedAudioBuffer.duration;
      if (duration > 30) {
        setError('Audio is too long (max 30s). Please use shorter clips.');
        return;
      }
      if (duration < 0.1) {
        setError('Audio is too short (min 0.1s). Please provide longer audio.');
        return;
      }
      setAudioDebugInfo({ duration: duration.toFixed(2), originalSampleRate: decodedAudioBuffer.sampleRate, channels: decodedAudioBuffer.numberOfChannels, originalLength: decodedAudioBuffer.length });

      let audioData = decodedAudioBuffer.getChannelData(0);
      const targetSampleRate = 16000;
      if (decodedAudioBuffer.sampleRate !== targetSampleRate) {
        const offlineContext = new OfflineAudioContext(1, Math.ceil(duration * targetSampleRate), targetSampleRate);
        const source = offlineContext.createBufferSource();
        source.buffer = decodedAudioBuffer;
        source.connect(offlineContext.destination);
        source.start(0);
        const resampledBuffer = await offlineContext.startRendering();
        audioData = resampledBuffer.getChannelData(0);
      }

      const maxAmplitude = Math.max(...Array.from(audioData).map(val => Math.abs(val)));
      setAudioDebugInfo(prev => ({ ...prev, maxAmplitude: maxAmplitude.toFixed(4), processedLength: audioData.length, targetSampleRate }));

      if (maxAmplitude < 0.0001) {
        setError('Audio signal is too weak or silent.');
        return;
      }

      const processedAudio = new Float32Array(audioData);
      const result: any = await transcriberPipeline(processedAudio, { return_timestamps: false });

      const text = result?.text?.trim() || '';
      if (!text) {
        setError('No speech detected.');
        return;
      }
      setTranscript(text);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Transcription failed: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  }, [selectedModel, initializeTranscriber]);

  return {
    transcript,
    setTranscript,
    loading,
    modelLoading,
    progress,
    selectedModel,
    setSelectedModel,
    error,
    audioDebugInfo,
    transcribe,
  };
};

export default useTranscription;
