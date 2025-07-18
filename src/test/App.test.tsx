import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App'; // Adjust path if App.tsx is not in src/
import React from 'react'; // Import React

// Define mock audio data and expected transcript
const MOCK_AUDIO_DATA = new Float32Array([0.1, 0.2, 0.3, 0.2, 0.1]); // Simplified example
const MOCK_EXPECTED_TRANSCRIPT = "test"; // The model will be mocked to return this

// Helper to create a Blob from Float32Array for testing
const createAudioBlob = (audioData: Float32Array): Blob => {
    // Convert Float32Array to Int16Array (simulating 16-bit PCM)
    const buffer = new ArrayBuffer(audioData.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < audioData.length; i++) {
        view.setInt16(i * 2, audioData[i] * 0x7FFF, true); // Convert to 16-bit PCM
    }
    return new Blob([buffer], { type: 'audio/wav' });
};

// To be assigned within the mock factory and used in tests
let mockTranscribe: ReturnType<typeof vi.fn>;

// Mock WHISPER_MODELS used in App.tsx and ModelSelectorComponent
vi.mock('../hooks/useTranscription', async (importOriginal) => {
  const actual = await importOriginal();
  const mockTranscribeFn = vi.fn().mockResolvedValue({ text: 'mocked transcription' });
  mockTranscribe = mockTranscribeFn;
  const useTranscription = vi.fn(() => ({
    transcript: '',
    loading: false,
    modelLoading: false,
    progress: 0,
    selectedModel: 'tiny.en',
    setSelectedModel: vi.fn(),
    initializeTranscriber: vi.fn().mockResolvedValue(mockTranscribeFn),
    setTranscript: vi.fn(),
    setLoading: vi.fn(),
    setModelLoading: vi.fn(),
    setProgress: vi.fn(),
    transcriber: { current: mockTranscribeFn },
  }));
  return {
    ...actual,
    __esModule: true,
    default: useTranscription,
    WHISPER_MODELS: {
      'tiny.en': { id: 'Xenova/whisper-tiny.en', name: 'Tiny English (39MB)', size: '39MB', speed: 'Fastest', accuracy: 'Basic' },
      'base.en': { id: 'Xenova/whisper-base.en', name: 'Base English (74MB)', size: '74MB', speed: 'Fast', accuracy: 'Good' },
      'voxtral': { id: 'mistralai/Voxtral-Mini-3B-2507', name: 'Voxtral Mini (3B)', size: '3GB', speed: 'Slow', accuracy: 'Best' },
    },
  };
});

// Mock for audioUtils audioBufferToWav if its internals become problematic in JSDOM
vi.mock('../utils/audioUtils', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        audioBufferToWav: vi.fn((buffer: AudioBuffer) => {
            // Return a minimal valid WAV header ArrayBuffer
            const byteLength = 44; // Minimal WAV header
            const wavBuffer = new ArrayBuffer(byteLength);
            const view = new DataView(wavBuffer);
            // RIFF chunk descriptor
            view.setUint32(0, 0x52494646, false); // "RIFF"
            view.setUint32(4, 36, true);          // Chunk size (36 + data size, here 0)
            view.setUint32(8, 0x57415645, false); // "WAVE"
            // fmt sub-chunk
            view.setUint32(12, 0x666d7420, false); // "fmt "
            view.setUint32(16, 16, true);         // Subchunk1Size (16 for PCM)
            view.setUint16(20, 1, true);          // AudioFormat (1 for PCM)
            view.setUint16(22, 1, true);          // NumChannels (1 for mono)
            view.setUint32(24, 16000, true);      // SampleRate
            view.setUint32(28, 16000 * 2, true);  // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
            view.setUint16(32, 2, true);          // BlockAlign (NumChannels * BitsPerSample/8)
            view.setUint16(34, 16, true);         // BitsPerSample
            // data sub-chunk (optional if data size is 0)
            view.setUint32(36, 0x64617461, false); // "data"
            view.setUint32(40, 0, true);          // Subchunk2Size (data size, 0 for no data)
            return wavBuffer;
        }),
    };
});


// Mock for commonUtils copyToClipboard
vi.mock('../utils/commonUtils', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        copyToClipboard: vi.fn().mockResolvedValue(true),
    };
});

// Mock for browserUtils getBrowserCompatibility
vi.mock('../utils/browserUtils', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getBrowserCompatibility: vi.fn().mockReturnValue({
            isCompatible: true,
            missingFeatures: [],
            unsupportedFeatures: [],
            recommendedModel: 'tiny.en', // Default recommended model
            warnings: [],
            details: {
                isChrome: true, // Simulate Chrome for full compatibility
                isFirefox: false,
                isSafari: false,
                isEdge: false,
                isOpera: false,
                isChromiumBased: true,
                isMobile: false,
                supportsWasm: true,
                supportsSimd: true, // Assume SIMD is supported by default in tests
                supportsSharedArrayBuffer: true,
                supportsMediaRecorder: true,
                supportsOpusInWebM: true,
                supportsAudioContext: true,
                supportsOfflineAudioContext: true,
            }
        }),
    };
});

// Mock for @xenova/transformers pipeline
vi.mock('@xenova/transformers', async (importOriginal) => {
  const actual = await importOriginal();
  // Assign to the top-level mockTranscribe
  mockTranscribe = vi.fn().mockImplementation(async (audioDataOrUrl: Float32Array | string, options: any) => {
      console.log('Initial mockTranscribe (factory scope) called with:', audioDataOrUrl);
      // This default implementation will be overridden in beforeEach
      return { text: "Default mock response from factory", chunks: [{text: "Default mock response from factory", timestamp: [0, null]}]};
  });
  return {
    ...actual,
    pipeline: vi.fn().mockImplementation(async (task, modelId, options) => {
      console.log(`Mock pipeline factory called with task: ${task}, modelId: ${modelId}`);
      if (options && options.progress_callback) {
        options.progress_callback({ status: 'downloading', name: modelId, file: 'config.json', progress: 0, loaded: 0, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 10));
        options.progress_callback({ status: 'progress', name: modelId, file: 'model.onnx', progress: 50, loaded: 50, total: 100 });
        await new Promise(resolve => setTimeout(resolve, 10));
        options.progress_callback({ status: 'loaded', name: modelId, file: 'model.onnx' });
      }
      return mockTranscribe; // Return the assignable mock function
    }),
    env: { // Mock env settings used in App.tsx
        allowLocalModels: false,
        allowRemoteModels: true,
        useBrowserCache: true,
        backends: {
            onnx: {
                wasm: {
                    numThreads: 1,
                    simd: false,
                    proxy: false,
                    wasmPaths: undefined,
                    initTimeout: 30000,
                },
                logLevel: 'warning',
                executionProviders: ['wasm'],
            }
        }
    }
  };
});

describe('App Component E2E Transcription Tests', () => {
  let blobUrlStore: Map<string, Blob>;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    blobUrlStore = new Map<string, Blob>();

    // Configure mockTranscribe for expected behavior
    mockTranscribe.mockImplementation(async (audioDataOrUrl: Float32Array | string, options: any) => {
        console.log('Mock transcribe (beforeEach scope) called with audio data/URL:', audioDataOrUrl, 'Options:', options);
        // Simulate some processing delay
        await new Promise(resolve => setTimeout(resolve, 50));
        // Check if the audioData seems plausible (has some length or is a blob URL)
        const isAudioDataValid = typeof audioDataOrUrl === 'string' ? audioDataOrUrl.startsWith('blob:') : (audioDataOrUrl && audioDataOrUrl.length > 0);
        if (isAudioDataValid) {
            return { text: MOCK_EXPECTED_TRANSCRIPT, chunks: [{ text: MOCK_EXPECTED_TRANSCRIPT, timestamp: [0, null] }] };
        }
        return { text: "Error: No audio data", chunks: [{text: "Error: No audio data", timestamp: [0, null]}]};
    });

    // Mock global AudioContext and OfflineAudioContext
    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(() => ({
      decodeAudioData: vi.fn().mockImplementation(async (arrayBuffer: ArrayBuffer) => {
        if (arrayBuffer && arrayBuffer.byteLength > 0) {
            // Dynamically create AudioBuffer based on the received arrayBuffer
            // Assuming 16kHz, 16-bit mono for calculation from byteLength
            const numChannels = 1;
            const bytesPerSample = 2; // 16-bit
            const sampleRate = 16000;
            const frameCount = arrayBuffer.byteLength / (bytesPerSample * numChannels);
            return {
                duration: frameCount / sampleRate,
                sampleRate: sampleRate,
                numberOfChannels: numChannels,
                length: frameCount,
                getChannelData: vi.fn(() => new Float32Array(frameCount)), // Return dummy data of correct length
            };
        }
        throw new Error("Mock decodeAudioData: Empty or invalid ArrayBuffer");
      }),
      createBufferSource: vi.fn(() => ({
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      })),
      destination: { maxChannelCount: 2 }, // Mock destination with property
      currentTime: 0,
      close: vi.fn().mockResolvedValue(undefined),
      suspend: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      createGain: vi.fn(() => ({
        gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
       createMediaStreamSource: vi.fn(() => ({ // Added mock for createMediaStreamSource
            connect: vi.fn(),
            disconnect: vi.fn(),
        })),
    })));

    vi.stubGlobal('OfflineAudioContext', vi.fn().mockImplementation((channels, length, sampleRate) => ({
        startRendering: vi.fn().mockImplementation(async () => {
            // 'length' here is frameCount
             return {
                duration: length / sampleRate,
                sampleRate: sampleRate,
                numberOfChannels: channels,
                length: length,
                getChannelData: vi.fn(() => new Float32Array(length)), // Return dummy data of correct length
            };
        }),
        createBufferSource: vi.fn(() => ({
            buffer: null,
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null,
        })),
        destination: { maxChannelCount: channels },
        currentTime: 0,
        length: length,
        sampleRate: sampleRate,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
         createGain: vi.fn(() => ({
            gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
            connect: vi.fn(),
            disconnect: vi.fn(),
        })),
    })));

    // Mock URL.createObjectURL and URL.revokeObjectURL using the blobUrlStore
    vi.stubGlobal('URL', {
        createObjectURL: vi.fn((blob: Blob) => {
            const url = `blob:http://localhost/${Math.random().toString(36).substring(2)}`;
            blobUrlStore.set(url, blob);
            return url;
        }),
        revokeObjectURL: vi.fn((url: string) => {
            blobUrlStore.delete(url);
        }),
        canParse: vi.fn(() => true)
    });

    // Mock fetch to retrieve blobs from blobUrlStore
    global.fetch = vi.fn().mockImplementation(async (input: string | URL | Request) => {
        const urlString = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input as Request).url);
        if (urlString.startsWith('blob:') && blobUrlStore.has(urlString)) {
            const blob = blobUrlStore.get(urlString);
            if (blob) {
                return Promise.resolve(new Response(await blob.arrayBuffer(), { // Serve the actual blob content
                    status: 200,
                    headers: { 'Content-Type': blob.type || 'audio/wav' },
                }));
            }
        }
        console.warn(`Mock fetch unhandled URL: ${urlString}`);
        return Promise.reject(new Error(`Unhandled fetch URL in test: ${urlString}`));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test Case 1: Successful transcription from simulated recording', async () => {
    render(<App />);

    // 1. Simulate clicking the "Record Audio" button
    const recordButton = screen.getByRole('button', { name: /record audio/i });
    expect(recordButton).toBeInTheDocument();
    fireEvent.click(recordButton);

    // Verify getUserMedia and MediaRecorder.start were called (via mocks in setupTests.ts)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });

    // Wait for MediaRecorder instance to be created and start to be called
    await waitFor(() => {
        const mediaRecorderInstance = (window as any).getLatestMediaRecorderInstance();
        expect(mediaRecorderInstance).toBeDefined();
        expect(mediaRecorderInstance.start).toHaveBeenCalled();
        expect(mediaRecorderInstance.state).toBe('recording');
    });

    // 2. Simulate MediaRecorder providing data
    const mediaRecorderInstance = (window as any).getLatestMediaRecorderInstance();
    expect(mediaRecorderInstance).toBeDefined();

    const audioBlob = createAudioBlob(MOCK_AUDIO_DATA);
    // Directly call the _simulateDataAvailable helper on the mock instance
    mediaRecorderInstance._simulateDataAvailable(audioBlob);

    // 3. Simulate clicking the "Stop Recording" button
    // The button text changes to "Stop Recording"
    const stopButton = screen.getByRole('button', { name: /stop recording/i });
    expect(stopButton).toBeInTheDocument();
    fireEvent.click(stopButton);

    // Verify MediaRecorder.stop was called
    expect(mediaRecorderInstance.stop).toHaveBeenCalled();
    await waitFor(() => expect(mediaRecorderInstance.state).toBe('inactive'));

    // 4. Wait for "Transcribe Audio" button to become enabled and click it
    const transcribeButton = await screen.findByRole('button', { name: /transcribe audio/i });
    expect(transcribeButton).toBeEnabled();
    fireEvent.click(transcribeButton);

    // 5. Wait for the MOCK_EXPECTED_TRANSCRIPT to appear
    await waitFor(() => {
      expect(screen.getByText(new RegExp(MOCK_EXPECTED_TRANSCRIPT, "i"))).toBeInTheDocument();
    }, { timeout: 5000 }); // Increased timeout for transcription process simulation

    // 6. Verify the pipeline (and thus mockTranscribe) was called
    // The pipeline mock itself is called by transformers.js, then it returns mockTranscribe.
    // So we check if mockTranscribe was called.
    expect(mockTranscribe).toHaveBeenCalled();
    // Check if it was called with something that looks like our audio data (URL or Float32Array)
    // In the recording case, App.tsx converts the blob to Float32Array via decodeAudioData
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.any(Float32Array), // App decodes the blob to Float32Array
      expect.anything()
    );
  });

  it('Test Case 2: Successful transcription from file upload', async () => {
    render(<App />);

    // 1. Create a File object
    const audioBlob = createAudioBlob(MOCK_AUDIO_DATA);
    const testFile = new File([audioBlob], "test-audio.wav", { type: "audio/wav" });

    // 2. Simulate file input
    const fileInput = screen.getByLabelText(/upload audio file/i) as HTMLInputElement; // Assuming a label exists
    expect(fileInput).toBeInTheDocument();

    // Simulate user selecting a file
    await waitFor(() => {
        fireEvent.change(fileInput, { target: { files: [testFile] } });
    });

    // Check if the audio player source is updated (optional, but good check)
    // This depends on App.tsx creating an object URL and setting it to an <audio> element
    await waitFor(() => {
        const audioElement = screen.getByTestId('audio-player') as HTMLAudioElement; // Assuming data-testid="audio-player"
        expect(audioElement.src).toMatch(/^blob:/);
    });

    // 3. Wait for "Transcribe Audio" button to become enabled and click it
    const transcribeButton = await screen.findByRole('button', { name: /transcribe audio/i });
    expect(transcribeButton).toBeEnabled();
    fireEvent.click(transcribeButton);

    // 4. Wait for the MOCK_EXPECTED_TRANSCRIPT to appear
    await waitFor(() => {
      expect(screen.getByText(new RegExp(MOCK_EXPECTED_TRANSCRIPT, "i"))).toBeInTheDocument();
    }, { timeout: 5000 });

    // 5. Verify the pipeline (and thus mockTranscribe) was called
    expect(mockTranscribe).toHaveBeenCalled();
    // In the file upload case, App.tsx passes the blob URL directly to the pipeline
     expect(mockTranscribe).toHaveBeenCalledWith(
      expect.stringMatching(/^blob:/), // The object URL
      expect.anything()
    );
  });

  it('Test Case 3: Handling of very short audio (<0.1s)', async () => {
    render(<App />);
    // Audio duration is arrayBuffer.byteLength / (16000 * 2)
    // For duration < 0.1s, byteLength < 3200. Let's use 100 bytes.
    // App.tsx MIN_AUDIO_DURATION_S is 0.1
    const VERY_SHORT_AUDIO_ARRAYBUFFER = new ArrayBuffer(100);
    const shortAudioBlob = new Blob([VERY_SHORT_AUDIO_ARRAYBUFFER], { type: 'audio/wav' });
    const shortAudioFile = new File([shortAudioBlob], "short.wav", { type: "audio/wav" });

    const fileInput = screen.getByLabelText(/upload audio file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [shortAudioFile] } });

    // Wait for audio to be processed and UI to update (e.g., audio player ready)
    await waitFor(() => {
        const audioElement = screen.getByTestId('audio-player') as HTMLAudioElement;
        expect(audioElement.src).toMatch(/^blob:/);
    });

    const transcribeButton = screen.getByRole('button', { name: /transcribe audio/i });
    expect(transcribeButton).toBeEnabled(); // Should be enabled as a file is loaded
    fireEvent.click(transcribeButton);

    // Check for error message
    // Assuming App.tsx uses a specific error message like: `Audio is too short. Minimum duration is ${MIN_AUDIO_DURATION_S}s.`
    // The MIN_AUDIO_DURATION_S is 0.1 in App.tsx.
    await waitFor(() => {
      expect(screen.getByText(/audio is too short/i)).toBeInTheDocument();
      expect(screen.getByText(/minimum duration is 0.1s/i)).toBeInTheDocument();
    });

    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it('Test Case 4: Handling of audio exceeding max duration (>30s)', async () => {
    render(<App />);
    // Audio duration is arrayBuffer.byteLength / (16000 * 2)
    // For duration > 30s, byteLength > 30 * 32000 = 960000.
    // App.tsx MAX_AUDIO_DURATION_S is 30
    const LONG_AUDIO_ARRAYBUFFER = new ArrayBuffer(16000 * 2 * 35); // Approx 35 seconds
    const longAudioBlob = new Blob([LONG_AUDIO_ARRAYBUFFER], { type: 'audio/wav' });
    const longAudioFile = new File([longAudioBlob], "long.wav", { type: "audio/wav" });

    const fileInput = screen.getByLabelText(/upload audio file/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [longAudioFile] } });

    await waitFor(() => {
        const audioElement = screen.getByTestId('audio-player') as HTMLAudioElement;
        expect(audioElement.src).toMatch(/^blob:/);
    });

    const transcribeButton = screen.getByRole('button', { name: /transcribe audio/i });
    expect(transcribeButton).toBeEnabled();
    fireEvent.click(transcribeButton);

    // Check for error message
    // Assuming App.tsx uses a specific error message like: `Audio is too long. Maximum duration is ${MAX_AUDIO_DURATION_S}s.`
    await waitFor(() => {
      expect(screen.getByText(/audio is too long/i)).toBeInTheDocument();
      expect(screen.getByText(/maximum duration is 30s/i)).toBeInTheDocument();
    });

    expect(mockTranscribe).not.toHaveBeenCalled();
  });
});
