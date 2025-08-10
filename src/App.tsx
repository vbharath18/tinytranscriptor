import { useState, useRef, useCallback, useEffect } from 'react';
import './App.css';
import { env } from '@xenova/transformers';
import BrowserCompatibilityDisplay from './components/BrowserCompatibilityDisplay';
import ModelSelectorComponent from './components/ModelSelectorComponent';
import useAudioRecorder from './hooks/useAudioRecorder';
import useTranscription, { WHISPER_MODELS, type WhisperModelKey } from './hooks/useTranscription';
import { audioBufferToWav } from './utils/audioUtils';
import { getBrowserCompatibility, type BrowserCompatibility } from './utils/browserUtils';
import { copyToClipboard } from './utils/commonUtils';
import { runONNXDiagnostics, generateDiagnosticReport } from './utils/onnxDiagnostics';

// Configure transformers.js environment related to model fetching and execution
env.allowLocalModels = false; // Disallow local models for this web environment
env.allowRemoteModels = true; // Allow fetching models from Hugging Face Hub
env.useBrowserCache = true;   // Cache models in browser's IndexedDB

// Minimal ONNX Runtime configuration - let the library handle backend selection
if (typeof window !== 'undefined') {
  try {
    // Only set essential configuration
    env.backends.onnx.logLevel = 'error';
    console.log('ONNX Runtime configured with minimal settings');
  } catch (configError) {
    console.warn('Failed to configure ONNX Runtime:', configError);
  }
}

// Static audio configuration for recording - defined outside component to prevent re-creation on renders
const audioConfig = {
  audio: {
    channelCount: 1,       // Mono audio
    sampleRate: 44100,     // Standard sample rate; will be downsampled for Whisper if needed
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
};

function App() {
  // State for managing the URL of the recorded or uploaded audio
  const [audioURL, setAudioURL] = useState<string | null>(null);
  // State to indicate that recording has completed and audio is processed
  const [recordingCompleted, setRecordingCompleted] = useState(false);
  // State for "Copied!" UI feedback
  const [copySuccess, setCopySuccess] = useState(false);
  // State for browser compatibility information
  const [browserCompatibility, setBrowserCompatibility] = useState<BrowserCompatibility | null>(null);

  // Ref for the <audio> element to allow direct interaction if needed
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Custom hooks for managing audio recording and transcription logic
  const audioRecorder = useAudioRecorder();
  const transcription = useTranscription();

  // Effect hook to check browser compatibility once on component mount
  useEffect(() => {
    const compatibility = getBrowserCompatibility();
    setBrowserCompatibility(compatibility);

    // Automatically select the recommended model if the user hasn't changed from the default 'tiny.en'
    if (compatibility.recommendedModel &&
        transcription.selectedModel === 'tiny.en' &&
        compatibility.recommendedModel !== 'tiny.en') {
      transcription.setSelectedModel(compatibility.recommendedModel);
    }
  }, [transcription.selectedModel, transcription.setSelectedModel]); // Re-run if model selection logic changes

  // Effect hook for cleaning up resources on component unmount
  useEffect(() => {
    return () => {
      audioRecorder.cleanupRecording(); // Stop media tracks and clear refs in the audio recorder hook
      if (audioURL) {
        URL.revokeObjectURL(audioURL); // Revoke object URL to free memory
      }
    };
  }, [audioRecorder.cleanupRecording, audioURL]);

  // Callback to handle starting an audio recording
  const startRecording = useCallback(async () => {
    transcription.setTranscript(''); // Clear previous transcript
    setRecordingCompleted(false);
    setCopySuccess(false);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia(audioConfig);
      
      audioRecorder.startAudioLevelMonitoring(stream); // Start visualizing audio levels
      if(audioRecorder.startTimeRef) audioRecorder.startTimeRef.current = Date.now(); // Reset recording timer
      
      // Determine supported MIME type for MediaRecorder, preferring Opus in WebM
      const options: MediaRecorderOptions = { audioBitsPerSecond: 128000 };
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options.mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) { // Less common for this use case
        options.mimeType = 'audio/mp4';
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      if(audioRecorder.mediaRecorderRef) audioRecorder.mediaRecorderRef.current = mediaRecorder;
      if(audioRecorder.audioChunks) audioRecorder.audioChunks.current = [];

      // Event handler for when audio data becomes available
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioRecorder.audioChunks?.current.push(event.data);
        }
      };

      // Event handler for when recording stops
      mediaRecorder.onstop = async () => {
        try {
          // Combine recorded audio chunks into a single Blob
          const audioBlob = new Blob(audioRecorder.audioChunks?.current || [], {
            type: options.mimeType || 'audio/webm' 
          });
          
          // Decode the Blob into an AudioBuffer for processing (e.g., resampling)
          const tempAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const arrayBuffer = await audioBlob.arrayBuffer();
          const decodedAudioBuffer = await tempAudioContext.decodeAudioData(arrayBuffer);
          
          // Resample to 16kHz if the original sample rate differs (Whisper requirement)
          const targetSampleRate = 16000;
          let processedBuffer = decodedAudioBuffer;
          if (decodedAudioBuffer.sampleRate !== targetSampleRate) {
            console.log(`Resampling audio from ${decodedAudioBuffer.sampleRate}Hz to ${targetSampleRate}Hz`);
            const offlineContext = new OfflineAudioContext(
              1, // Mono
              Math.ceil(decodedAudioBuffer.duration * targetSampleRate),
              targetSampleRate
            );
            const source = offlineContext.createBufferSource();
            source.buffer = decodedAudioBuffer;
            source.connect(offlineContext.destination);
            source.start(0);
            processedBuffer = await offlineContext.startRendering();
          }
          
          // Convert the processed AudioBuffer to a WAV file Blob
          const wavBuffer = audioBufferToWav(processedBuffer);
          const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
          
          if (audioURL) URL.revokeObjectURL(audioURL); // Clean up previous audio URL
          
          const newAudioURL = URL.createObjectURL(wavBlob);
          setAudioURL(newAudioURL);
          setRecordingCompleted(true);
          audioRecorder.setIsRecording(false);
          audioRecorder.cleanupRecording(); // Stop monitoring, release tracks
        } catch (err) {
          console.error('Recording processing error:', err);
          // Use the hook's error state
        }
      };

      // Event handler for errors from MediaRecorder
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        audioRecorder.setIsRecording(false);
        audioRecorder.cleanupRecording();
      };

      mediaRecorder.start(1000); // Start recording, collect data in 1-second chunks (or when buffer full)
      audioRecorder.setIsRecording(true);
    } catch (err) {
      console.error('getUserMedia error:', err);
      audioRecorder.setIsRecording(false); // Ensure recording state is reset
    }
  }, [audioConfig, audioURL, audioRecorder, transcription]);

  // Callback to stop the current recording
  const stopRecording = useCallback(() => {
    if (audioRecorder.mediaRecorderRef?.current && audioRecorder.isRecording) {
      audioRecorder.mediaRecorderRef.current.stop(); // This will trigger mediaRecorder.onstop
    }
  }, [audioRecorder.isRecording, audioRecorder.mediaRecorderRef]);

  // Callback to handle file selection for transcription
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    transcription.setTranscript('');
    setCopySuccess(false);

    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (audioURL) URL.revokeObjectURL(audioURL); // Clean up previous audio URL

      setAudioURL(URL.createObjectURL(file));
      setRecordingCompleted(false); // File upload is not "recording completed"
    }
  };

  // Callback to download the current audio file
  const downloadAudio = useCallback(() => {
    if (audioURL) {
      const link = document.createElement('a');
      link.href = audioURL;
      link.download = `recording-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.wav`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [audioURL]);

  // Callback to clear all data and reset application state
  const clearAll = useCallback(() => {
    if (audioURL) URL.revokeObjectURL(audioURL);
    setAudioURL(null);
    transcription.setTranscript('');
    setCopySuccess(false);
    setRecordingCompleted(false);
    audioRecorder.cleanupRecording();
  }, [audioURL, transcription, audioRecorder]);

  // Callback to handle copying the transcript to clipboard
  const handleCopyTranscript = async () => {
    if (transcription.transcript) {
      const success = await copyToClipboard(transcription.transcript);
      setCopySuccess(success);
      if (success) setTimeout(() => setCopySuccess(false), 2000); // Show "Copied!" for 2s
    }
  };

  // Callback to run ONNX Runtime diagnostic tests
  const runONNXDiagnostic = useCallback(async () => {
    console.log('🔍 Running comprehensive ONNX Runtime diagnostic...');
    
    try {
      const report = await generateDiagnosticReport();
      console.log(report);
      
      // Show success message with basic info
      const diagnostics = runONNXDiagnostics();
    } catch (diagnosticError) {
      console.error('❌ ONNX Runtime diagnostic failed:', diagnosticError);
    }
  }, []);

  return (
    <div className="container">
      <h1>TinyTranscriptor</h1>
      
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
          {transcription.modelLoading ? 'Loading Model...' : audioRecorder.isRecording ? 'Recording...' : 'Record Audio'}
        </button>
        <button onClick={stopRecording} disabled={!audioRecorder.isRecording}>
          Stop Recording
        </button>
        <label htmlFor="audio-upload" className="file-upload-label secondary-button">
          📤 Upload Audio File
          <input
            id="audio-upload"
            type="file"
            accept="audio/*" // Accept all audio types
            onChange={handleFileChange}
            disabled={transcription.modelLoading || audioRecorder.isRecording}
            className="visually-hidden"
          />
        </label>
        <button 
          onClick={() => transcription.transcribe(audioURL)}
          disabled={!audioURL || transcription.loading || transcription.modelLoading || audioRecorder.isRecording}
        >
          {transcription.loading ? 'Transcribing...' : transcription.modelLoading ? 'Model Loading...' : 'Transcribe Audio'}
        </button>
        {audioURL && (
          <>
            <button onClick={downloadAudio} className="secondary-button" title="Download audio file">
              📥 Download Audio
            </button>
            <button onClick={clearAll} className="secondary-button danger" title="Clear all data">
              🗑️ Clear All
            </button>
            <button onClick={runONNXDiagnostic} className="secondary-button diagnostic" title="Run ONNX Runtime diagnostic test">
              🔍 Test ONNX Runtime
            </button>
          </>
        )}
      </div>
      
      <ModelSelectorComponent 
        selectedModel={transcription.selectedModel}
        setSelectedModel={transcription.setSelectedModel}
        modelLoading={transcription.modelLoading || audioRecorder.isRecording} // Disable model selection during recording too
        transcriptionLoading={transcription.loading}
        whisperModels={WHISPER_MODELS}
      />
        
      {transcription.modelLoading && transcription.selectedModel && WHISPER_MODELS[transcription.selectedModel] && (
        <div className="model-loading">
          <div className="loading-text">Loading {WHISPER_MODELS[transcription.selectedModel].name}...</div>
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ width: `${transcription.progress}%` }}
            ></div>
          </div>
          <div className="loading-subtext">
            ({WHISPER_MODELS[transcription.selectedModel].size}) - This may take a moment on first load.
          </div>
        </div>
      )}

      {recordingCompleted && !audioRecorder.isRecording && (
        <div className="status-indicator status-completed">
          ✓ Recording completed! Ready to play or transcribe.
        </div>
      )}

      {audioURL && (
        <div className="audio-container">
          <audio ref={audioRef} src={audioURL} key={audioURL} controls preload="auto" data-testid="audio-player">
            Your browser does not support the audio element.
          </audio>
        </div>
      )}

      {audioURL && !transcription.loading && !transcription.modelLoading && (
        <div className="audio-debug">
          <details>
            <summary>🔧 Audio Debug Information</summary>
            <div className="debug-content">
              {transcription.audioDebugInfo ? (
                <>
                  <p><strong>Duration:</strong> {transcription.audioDebugInfo.duration}s</p>
                  <p><strong>Sample Rate:</strong> {transcription.audioDebugInfo.originalSampleRate}Hz → {transcription.audioDebugInfo.targetSampleRate || 'N/A'}Hz</p>
                  <p><strong>Channels:</strong> {transcription.audioDebugInfo.channels}</p>
                  <p><strong>Data Length:</strong> {transcription.audioDebugInfo.originalLength} samples → {transcription.audioDebugInfo.processedLength || 'N/A'} samples</p>
                  <p><strong>Max Amplitude:</strong> {transcription.audioDebugInfo.maxAmplitude}</p>
                  <p><strong>RMS Amplitude:</strong> {transcription.audioDebugInfo.rmsAmplitude}</p>
                  <p style={{color: parseFloat(transcription.audioDebugInfo.maxAmplitude) < 0.01 ? '#ff4757' : '#2ed573'}}>
                    Signal Strength: {parseFloat(transcription.audioDebugInfo.maxAmplitude) < 0.01 ? 'Weak ⚠️' : 'Good ✅'}
                  </p>
                </>
              ) : (
                <p>Audio file loaded. Click "Transcribe Audio" to process and see detailed debug info.</p>
              )}
            </div>
          </details>
        </div>
      )}

      {transcription.transcript && (
        <div className="transcript" data-testid="transcript-container">
          <div className="transcript-header">
            <h2>Transcript</h2>
            <button onClick={handleCopyTranscript} className="copy-button" title="Copy to clipboard">
              {copySuccess ? '✓ Copied!' : '📋 Copy Transcript'}
            </button>
          </div>
          <p>{transcription.transcript}</p>
        </div>
      )}

      {transcription.error && (
        <div className="error">
          <p><strong>Error:</strong> {transcription.error}</p>
        </div>
      )}

      <footer>
        Powered by <a href="https://github.com/xenova/transformers.js" target="_blank" rel="noopener noreferrer">🤗 Transformers.js</a>, ONNX Runtime, and OpenAI Whisper.
      </footer>
    </div>
  );
}

export default App;
