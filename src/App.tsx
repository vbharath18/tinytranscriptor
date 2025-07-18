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

// Configure ONNX Runtime Web settings for compatibility and stability
if (typeof window !== 'undefined') { // Ensure this runs only in browser environment
  // Enhanced ONNX Runtime configuration for better compatibility
  try {
    // Conservative settings for maximum browser compatibility
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.simd = false;
    env.backends.onnx.wasm.proxy = false;
    
    // Set log level to 'error' to reduce console noise
    env.backends.onnx.logLevel = 'error';
    
    // Primary execution provider
    env.backends.onnx.executionProviders = ['wasm'];
    
    // WebAssembly optimization settings
    env.backends.onnx.wasm.wasmPaths = undefined;
    env.backends.onnx.wasm.initTimeout = 60000; // Increased timeout to 60 seconds
    
    console.log('ONNX Runtime configured for maximum compatibility');
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
  // State for displaying error messages to the user
  const [error, setError] = useState<string | null>(null);
  // State to indicate that recording has completed and audio is processed
  const [recordingCompleted, setRecordingCompleted] = useState(false);
  // State for "Copied!" UI feedback
  const [copySuccess, setCopySuccess] = useState(false);
  // State for storing and displaying audio debugging information
  const [audioDebugInfo, setAudioDebugInfo] = useState<any | null>(null); // Consider defining a stricter type
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
    setError(null); // Clear previous errors
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
          setError('Failed to process recording. Please try again.');
          audioRecorder.setIsRecording(false);
          audioRecorder.cleanupRecording();
        }
      };

      // Event handler for errors from MediaRecorder
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        setError('An error occurred during recording. Please try again.');
        audioRecorder.setIsRecording(false);
        audioRecorder.cleanupRecording();
      };

      mediaRecorder.start(1000); // Start recording, collect data in 1-second chunks (or when buffer full)
      audioRecorder.setIsRecording(true);
    } catch (err) {
      console.error('getUserMedia error:', err);
      setError('Microphone access denied or not available. Please check your browser permissions and ensure your microphone is working.');
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
    setError(null);
    setCopySuccess(false);
    setAudioDebugInfo(null); // Clear debug info for new file

    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (audioURL) URL.revokeObjectURL(audioURL); // Clean up previous audio URL

      setAudioURL(URL.createObjectURL(file));
      setRecordingCompleted(false); // File upload is not "recording completed"
    }
  };

  // Callback to initiate audio transcription
  const transcribeAudio = useCallback(async () => {
    if (!audioURL) {
      setError('No audio file available for transcription. Please record or upload audio.');
      return;
    }
    
    transcription.setLoading(true);
    transcription.setTranscript('');
    setError(null);
    setCopySuccess(false);
    setAudioDebugInfo(null); // Clear previous debug info

    try {
      // Define model fallback order: start with user's selection, fallback to smaller models
      const modelFallbackOrder: WhisperModelKey[] = [
        transcription.selectedModel, // Start with user's selected model
        ...(['tiny.en', 'tiny', 'base.en', 'base'] as WhisperModelKey[])
          .filter(model => model !== transcription.selectedModel && WHISPER_MODELS[model])
      ];

      let transcriberPipeline: any = null;
      let successfulModel: WhisperModelKey | null = null;
      let lastModelError: Error | null = null;

      // Step 1: Try to initialize models in fallback order
      for (let i = 0; i < modelFallbackOrder.length; i++) {
        const modelToTry = modelFallbackOrder[i];
        try {
          console.log(`Attempting to load model: ${WHISPER_MODELS[modelToTry].name} (${i + 1}/${modelFallbackOrder.length})`);
          transcriberPipeline = await transcription.initializeTranscriber(modelToTry);
          
          if (transcriberPipeline) {
            successfulModel = modelToTry;
            console.log(`Successfully loaded model: ${WHISPER_MODELS[modelToTry].name}`);
            
            // Update selected model if we had to fallback
            if (modelToTry !== transcription.selectedModel) {
              console.log(`Model fallback: ${WHISPER_MODELS[transcription.selectedModel].name} → ${WHISPER_MODELS[modelToTry].name}`);
              transcription.setSelectedModel(modelToTry);
            }
            break;
          }
        } catch (modelError) {
          console.warn(`Failed to load ${WHISPER_MODELS[modelToTry].name}:`, modelError);
          lastModelError = modelError instanceof Error ? modelError : new Error(String(modelError));
          
          // Add delay between model attempts
          if (i < modelFallbackOrder.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      }

      if (!transcriberPipeline || !successfulModel) {
        const errorMessage = `Failed to load any transcription model. Last error: ${lastModelError?.message || 'Unknown error'}. Please try: 1) Refreshing the page, 2) Clearing browser cache, 3) Using a different browser (Chrome/Edge recommended), or 4) Trying incognito mode.`;
        setError(errorMessage);
        return;
      }

      // Step 2: Fetch audio data from the URL (recorded or uploaded)
      console.log('Fetching audio data from URL:', audioURL);
      const response = await fetch(audioURL);
      if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);
      const audioBlob = await response.blob();
      const arrayBuffer = await audioBlob.arrayBuffer();

      // --- Audio Pre-processing for Transcription ---
      const tempAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedAudioBuffer = await tempAudioContext.decodeAudioData(arrayBuffer);
      
      const duration = decodedAudioBuffer.duration;
      if (duration > 30) { // Limit duration for this demo to manage resources
        setError('Audio is too long (max 30s). Please use shorter clips.');
        return;
      }
      if (duration < 0.1) {
        setError('Audio is too short (min 0.1s). Please provide longer audio.');
        return;
      }
      console.log(`Initial audio for transcription: ${duration.toFixed(2)}s, ${decodedAudioBuffer.sampleRate}Hz`);
      setAudioDebugInfo({
        duration: duration.toFixed(2),
        originalSampleRate: decodedAudioBuffer.sampleRate,
        channels: decodedAudioBuffer.numberOfChannels,
        originalLength: decodedAudioBuffer.length,
      });

      let audioData = decodedAudioBuffer.getChannelData(0); // Ensure mono
      const targetSampleRate = 16000; // Whisper models expect 16kHz
      if (decodedAudioBuffer.sampleRate !== targetSampleRate) {
        console.log(`Resampling audio for transcription from ${decodedAudioBuffer.sampleRate}Hz to ${targetSampleRate}Hz`);
        const offlineContext = new OfflineAudioContext(1, Math.ceil(duration * targetSampleRate), targetSampleRate);
        const source = offlineContext.createBufferSource();
        source.buffer = decodedAudioBuffer;
        source.connect(offlineContext.destination);
        source.start(0);
        const resampledBuffer = await offlineContext.startRendering();
        audioData = resampledBuffer.getChannelData(0);
      }

      // --- Audio Quality Checks ---
      const maxAmplitude = Math.max(...Array.from(audioData).map(val => Math.abs(val)));
      const rmsAmplitude = Math.sqrt(audioData.reduce((sum, val) => sum + val * val, 0) / audioData.length);
      console.log(`Processed audio for transcription: max amplitude: ${maxAmplitude.toFixed(4)}, RMS: ${rmsAmplitude.toFixed(4)}`);
      setAudioDebugInfo((prev: any) => ({ ...(prev || {}), maxAmplitude: maxAmplitude.toFixed(4), rmsAmplitude: rmsAmplitude.toFixed(4), processedLength: audioData.length, targetSampleRate }));
      
      if (maxAmplitude < 0.0001) {
        setError('Audio signal is too weak or silent. Please use clearer audio.');
        return;
      }
      if (maxAmplitude > 0.0001 && maxAmplitude < 0.1) {
        console.log('Normalizing quiet audio for transcription...');
        const normalizationFactor = 0.5 / maxAmplitude;
        audioData = audioData.map(sample => sample * normalizationFactor);
      }

      const processedAudio = new Float32Array(audioData); // Ensure Float32Array format
      if (processedAudio.length === 0) {
        setError('Audio processing failed: resulting audio data is empty.');
        return;
      }
      const minSamples = 160; // ~0.01s at 16kHz
      if (processedAudio.length < minSamples) {
        setError('Audio is too short for effective transcription (min 0.1s).');
        return;
      }

      // --- Transcription Process ---
      try {
        console.log('Starting transcription pipeline with processed audio...');
        // Define a series of configurations to try for transcription for robustness
        const transcriptionConfigs = [
          // Config 1: Most compatible settings
          { 
            task: 'transcribe', 
            language: transcription.selectedModel.includes('.en') ? 'english' : undefined, 
            return_timestamps: false, 
            chunk_length_s: 30,
            stride_length_s: 5,
            normalize: true
          },
          // Config 2: Simplified with smaller chunks
          { 
            task: 'transcribe', 
            language: transcription.selectedModel.includes('.en') ? 'english' : undefined, 
            return_timestamps: false, 
            chunk_length_s: 10,
            stride_length_s: 2
          },
          // Config 3: Basic configuration
          { 
            task: 'transcribe', 
            language: transcription.selectedModel.includes('.en') ? 'english' : undefined, 
            return_timestamps: false 
          },
          // Config 4: Minimal fallback
          { 
            task: 'transcribe', 
            return_timestamps: false 
          },
          // Config 5: Absolute minimal
          {}
        ];
        
        let result = null;
        for (let i = 0; i < transcriptionConfigs.length; i++) {
          try {
            console.log(`Attempting transcription with configuration ${i + 1}/${transcriptionConfigs.length}...`);
            
            // Add timeout for each transcription attempt
            const transcriptionPromise = transcriberPipeline(processedAudio, transcriptionConfigs[i]);
            const timeoutPromise = new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Transcription timeout')), 60000)
            );
            
            result = await Promise.race([transcriptionPromise, timeoutPromise]);
            console.log(`Transcription successful with configuration ${i + 1}.`);
            break;
          } catch (configError) {
            console.warn(`Transcription config ${i + 1} failed:`, configError);
            
            // Add delay between attempts to prevent overwhelming the system
            if (i < transcriptionConfigs.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            if (i === transcriptionConfigs.length - 1) throw configError; // Re-throw last error
          }
        }
        if (!result) throw new Error('All transcription configurations failed.');
        
        // --- Post-processing Transcription Result ---
        let text = '';
        if (typeof result === 'string') text = result;
        else if (result && typeof result === 'object') {
          if (Array.isArray((result as any).chunks)) text = (result as any).chunks.map((chunk: any) => chunk.text).join(' ');
          else if ((result as any).text) text = (result as any).text;
          else if (Array.isArray(result)) text = result.map(r => (typeof r === 'string' ? r : r.text || '')).join(' ');
        }
        
        if (!text || text.trim().length === 0) { // Retry with basic config if empty
          console.log('Initial transcription result empty, retrying with basic config...');
          const retryResult: any = await transcriberPipeline(processedAudio, { task: 'transcribe', language: transcription.selectedModel.includes('.en') ? 'english' : undefined, return_timestamps: false });
          text = retryResult?.text || '';
        }
        
        if (!text || text.trim().length === 0) {
          setError('No speech detected. Please try speaking more clearly or in a quieter environment.');
          return;
        }
        const cleanedText = text.trim().replace(/^\[.*?\]\s*/, ''); // Remove potential timestamp artifacts
        transcription.setTranscript(cleanedText);
        console.log('Transcription completed. Final text:', cleanedText);
      } catch (transcriptionError) {
        console.error('Transcription execution error:', transcriptionError);
        
        // Enhanced error handling with specific recovery suggestions
        if (transcriptionError instanceof Error) {
          const errorMsg = transcriptionError.message.toLowerCase();
          
          if (errorMsg.includes('ortrun') || errorMsg.includes('error code = 6') || errorMsg.includes('session') || errorMsg.includes('backend')) {
            setError('ONNX Runtime error during transcription. Try: 1) Refresh the page, 2) Use a smaller model (tiny), 3) Clear browser cache, or 4) Try a different browser (Chrome/Edge recommended).');
            return;
          } else if (errorMsg.includes('out of memory') || errorMsg.includes('oom') || errorMsg.includes('memory')) {
            setError('Out of memory during transcription. Try: 1) Use the tiny model, 2) Close other browser tabs, 3) Refresh the page, or 4) Use shorter audio clips.');
            return;
          } else if (errorMsg.includes('webassembly') || errorMsg.includes('wasm')) {
            setError('WebAssembly error during transcription. Try: 1) Enable WebAssembly in browser settings, 2) Refresh the page, or 3) Use a different browser.');
            return;
          } else if (errorMsg.includes('timeout')) {
            setError('Transcription timed out. Try: 1) Use a shorter audio clip (under 30s), 2) Use the tiny model, or 3) Refresh and try again.');
            return;
          } else if (errorMsg.includes('network') || errorMsg.includes('fetch') || errorMsg.includes('load')) {
            setError('Network error loading model. Try: 1) Check internet connection, 2) Refresh the page, or 3) Clear browser cache.');
            return;
          }
        }
        throw transcriptionError; // Re-throw for the main catch block
      }
    } catch (err) { // Main catch block for transcribeAudio
      console.error('Overall transcription error:', err);
      
      if (err instanceof Error) {
        const errorMsg = err.message.toLowerCase();
        
        // More specific error messages based on error content
        if (errorMsg.includes('timeout')) {
          setError('Transcription timed out. Try a shorter clip (under 30s), use the tiny model, or refresh the page.');
        } else if (errorMsg.includes('ortrun') || errorMsg.includes('onnx') || errorMsg.includes('backend')) {
          setError('ONNX Runtime failed. This is usually a browser compatibility issue. Try: 1) Use Chrome or Edge, 2) Enable WebAssembly, 3) Clear cache and refresh, or 4) Try incognito mode.');
        } else if (errorMsg.includes('memory') || errorMsg.includes('oom')) {
          setError('Out of memory. Try: 1) Use the tiny model, 2) Close other tabs, 3) Use shorter audio, or 4) Refresh the page.');
        } else if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
          setError('Network error. Check your internet connection and try again.');
        } else if (errorMsg.includes('webassembly') || errorMsg.includes('wasm')) {
          setError('WebAssembly error. Ensure WebAssembly is enabled in your browser and try again.');
        } else {
          setError(`Transcription failed: ${err.message}. Try using the tiny model, refreshing the page, or using a different browser.`);
        }
      } else {
        setError('An unknown transcription error occurred. Try refreshing the page or using a different browser.');
      }
    } finally {
      transcription.setLoading(false);
    }
  }, [audioURL, transcription.initializeTranscriber, transcription.selectedModel, transcription.setLoading, transcription.setTranscript]);

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
    setError(null);
    setCopySuccess(false);
    setRecordingCompleted(false);
    setAudioDebugInfo(null);
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
      if (diagnostics.compatibilityScore > 70) {
        setError(`✅ ONNX Diagnostic: System compatibility score ${diagnostics.compatibilityScore}/100. Check console for detailed report.`);
      } else {
        setError(`⚠️ ONNX Diagnostic: Compatibility issues detected (score: ${diagnostics.compatibilityScore}/100). Check console for recommendations.`);
      }
    } catch (diagnosticError) {
      console.error('❌ ONNX Runtime diagnostic failed:', diagnosticError);
      setError(`❌ ONNX Diagnostic FAILED: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)}. This indicates serious compatibility issues.`);
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
        <input 
          type="file" 
          accept="audio/*" // Accept all audio types
          onChange={handleFileChange}
          disabled={transcription.modelLoading || audioRecorder.isRecording}
        />
        <button 
          onClick={transcribeAudio} 
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
          <audio ref={audioRef} src={audioURL} key={audioURL} controls preload="auto">
            Your browser does not support the audio element.
          </audio>
        </div>
      )}

      {audioURL && !transcription.loading && !transcription.modelLoading && (
        <div className="audio-debug">
          <details>
            <summary>🔧 Audio Debug Information</summary>
            <div className="debug-content">
              {audioDebugInfo ? (
                <>
                  <p><strong>Duration:</strong> {audioDebugInfo.duration}s</p>
                  <p><strong>Sample Rate:</strong> {audioDebugInfo.originalSampleRate}Hz → {audioDebugInfo.targetSampleRate || 'N/A'}Hz</p>
                  <p><strong>Channels:</strong> {audioDebugInfo.channels}</p>
                  <p><strong>Data Length:</strong> {audioDebugInfo.originalLength} samples → {audioDebugInfo.processedLength || 'N/A'} samples</p>
                  <p><strong>Max Amplitude:</strong> {audioDebugInfo.maxAmplitude}</p>
                  <p><strong>RMS Amplitude:</strong> {audioDebugInfo.rmsAmplitude}</p>
                  <p style={{color: parseFloat(audioDebugInfo.maxAmplitude) < 0.01 ? '#ff4757' : '#2ed573'}}>
                    Signal Strength: {parseFloat(audioDebugInfo.maxAmplitude) < 0.01 ? 'Weak ⚠️' : 'Good ✅'}
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
        <div className="transcript">
          <div className="transcript-header">
            <h2>Transcript</h2>
            <button onClick={handleCopyTranscript} className="copy-button" title="Copy to clipboard">
              {copySuccess ? '✓ Copied!' : '📋 Copy Transcript'}
            </button>
          </div>
          <p>{transcription.transcript}</p>
        </div>
      )}

      {error && (
        <div className="error">
          <p><strong>Error:</strong> {error}</p>
        </div>
      )}

      <footer>
        Powered by <a href="https://github.com/xenova/transformers.js" target="_blank" rel="noopener noreferrer">🤗 Transformers.js</a>, ONNX Runtime, and OpenAI Whisper.
      </footer>
    </div>
  );
}

export default App;
