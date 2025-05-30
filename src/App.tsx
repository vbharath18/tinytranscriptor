import { useState, useRef, useCallback, useEffect } from 'react';
import './App.css';
import { pipeline, env } from '@xenova/transformers';

// Disable local models to ensure we use the ONNX version
env.allowLocalModels = false;

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

// Custom hook for transcription with progress tracking
const useTranscription = () => {
  const [transcript, setTranscript] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const transcriber = useRef<any>(null);

  const initializeTranscriber = useCallback(async () => {
    if (!transcriber.current) {
      setModelLoading(true);
      setProgress(0);
      try {
        // Simulate progress for better UX
        const progressInterval = setInterval(() => {
          setProgress((prev: number) => Math.min(prev + 8, 85));
        }, 300);

        console.log('Loading Whisper model...');
        transcriber.current = await pipeline(
          'automatic-speech-recognition', 
          'Xenova/whisper-tiny.en', 
          {
            quantized: false,
            progress_callback: (progress: any) => {
              if (progress.status === 'downloading') {
                const percentage = Math.round((progress.loaded / progress.total) * 100);
                setProgress(Math.min(percentage, 90));
              }
            }
          }
        );
        
        clearInterval(progressInterval);
        setProgress(100);
        console.log('Whisper model loaded successfully');
      } catch (err) {
        console.error('Model loading error:', err);
        // Try fallback without quantization
        try {
          console.log('Trying fallback model configuration...');
          transcriber.current = await pipeline(
            'automatic-speech-recognition', 
            'Xenova/whisper-tiny.en',
            {
              quantized: false
            }
          );
          setProgress(100);
          console.log('Fallback model loaded successfully');
        } catch (fallbackErr) {
          console.error('Fallback model loading failed:', fallbackErr);
          throw new Error('Failed to load transcription model. Please refresh and try again.');
        }
      } finally {
        setModelLoading(false);
        setTimeout(() => setProgress(0), 500);
      }
    }
    return transcriber.current;
  }, []);

  return {
    transcript,
    setTranscript,
    loading,
    setLoading,
    modelLoading,
    setModelLoading,
    progress,
    setProgress,
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const audioRecorder = useAudioRecorder();
  const transcription = useTranscription();

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

      // Transcribe with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Transcription timeout')), 45000);
      });

      const transcriptionPromise = model(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'english',
        task: 'transcribe',
        return_timestamps: false,
        force_full_sequences: false,
      });

      const result = await Promise.race([transcriptionPromise, timeoutPromise]);
      
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
        // Check if we got a valid but empty result
        console.log('Empty transcription result, trying alternative processing...');
        
        // Try with different audio preprocessing
        const processedAudio = audioData.map(sample => Math.max(-1, Math.min(1, sample)));
        
        const retryResult = await model(processedAudio, {
          chunk_length_s: 30,
          stride_length_s: 5,
          task: 'transcribe',
          return_timestamps: false,
          force_full_sequences: true,
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
      
    } catch (err) {
      console.error('Transcription error:', err);
      if (err instanceof Error) {
        if (err.message === 'Transcription timeout') {
          setError('Transcription timed out. Try with a shorter audio clip.');
        } else if (err.message.includes('network') || err.message.includes('fetch')) {
          setError('Network error loading model. Please check your connection and try again.');
        } else {
          setError(`Transcription failed: ${err.message}`);
        }
      } else {
        setError('Transcription failed. Make sure your audio is clear and try again.');
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

  return (
    <div className="container">
      <h1>TinyTranscriptor</h1>
      
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
          </>
        )}
      </div>
      
      {/* Recording status and visualization */}
      {audioRecorder.isRecording && (
        <div className="recording-status">
          <div className="recording-indicator">
            <span className="recording-dot"></span>
            Recording... {formatDuration(audioRecorder.recordingDuration)}
          </div>
          <div className="audio-visualizer">
            <div 
              className="audio-level"
              style={{ width: `${audioRecorder.audioLevel * 100}%` }}
            ></div>
          </div>
        </div>
      )}

      {/* Model loading progress */}
      {transcription.modelLoading && (
        <div className="model-loading">
          <div className="loading-text">Loading Whisper model...</div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${transcription.progress}%` }}
            ></div>
          </div>
          <div className="loading-subtext">This may take a moment on first load</div>
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
