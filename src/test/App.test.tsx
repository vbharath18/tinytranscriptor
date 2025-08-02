import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';
import React from 'react';
import useTranscription, { WHISPER_MODELS } from '../hooks/useTranscription';
import * as browserUtils from '../utils/browserUtils';

// Mock the hook to control its output for testing
vi.mock('../hooks/useTranscription');
const mockedUseTranscription = vi.mocked(useTranscription);

// Define a unique transcript to avoid conflicts with other UI text
const MOCK_EXPECTED_TRANSCRIPT = "This is the successfully transcribed text.";

describe('App Component Tests', () => {
  // This object will hold the mock state and setters for the useTranscription hook
  let mockTranscriptionState: any;

  beforeEach(() => {
    // Reset the mock state before each test
    mockTranscriptionState = {
      transcript: '',
      loading: false,
      modelLoading: false,
      error: null,
      audioDebugInfo: null,
      selectedModel: 'tiny.en',
      progress: 0,
      // Mock the functions returned by the hook
      setTranscript: vi.fn((text) => { mockTranscriptionState.transcript = text; }),
      setLoading: vi.fn((loading) => { mockTranscriptionState.loading = loading; }),
      setSelectedModel: vi.fn((model) => { mockTranscriptionState.selectedModel = model; }),
      transcribe: vi.fn(),
    };

    // Return the controlled state from the mock
    mockedUseTranscription.mockReturnValue(mockTranscriptionState);

    // Mock other utilities
    vi.spyOn(browserUtils, 'getBrowserCompatibility').mockReturnValue({
      isCompatible: true,
      warnings: [],
      recommendedModel: 'tiny.en',
    } as browserUtils.BrowserCompatibility);

    // Mock global APIs
    vi.stubGlobal('navigator', {
        ...global.navigator,
        mediaDevices: {
            getUserMedia: vi.fn().mockResolvedValue({
                getTracks: () => [{ stop: vi.fn() }],
            }),
        },
    });
    vi.stubGlobal('URL', {
        ...global.URL,
        createObjectURL: vi.fn((blob) => `blob:${blob.size}`),
        revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render the component correctly with initial state', () => {
    render(<App />);
    expect(screen.getByText('TinyTranscriptor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record audio/i })).toBeInTheDocument();
    // The upload element is a label, not a button
    expect(screen.getByText(/upload audio file/i)).toBeInTheDocument();
  });

  it('should call the transcribe function when the button is clicked', async () => {
    const { rerender } = render(<App />);

    // Simulate having an audio file ready
    await act(async () => {
      // Find the hidden file input through its label
      const fileInput = screen.getByLabelText(/upload audio file/i);
      const testFile = new File([''], 'test.wav', {type: 'audio/wav'});
      fireEvent.change(fileInput, { target: { files: [testFile] } });
    });

    // Re-render to reflect the state change of audioURL being set
    rerender(<App />);

    const transcribeButton = await screen.findByRole('button', { name: /transcribe audio/i });
    expect(transcribeButton).toBeEnabled();
    fireEvent.click(transcribeButton);

    // Expect the hook's transcribe function to have been called
    expect(mockTranscriptionState.transcribe).toHaveBeenCalled();
    expect(mockTranscriptionState.transcribe).toHaveBeenCalledWith(expect.stringContaining('blob:'));
  });

  it('should display the transcript when the hook provides it', () => {
    // Set the transcript in the mock state
    mockTranscriptionState.transcript = MOCK_EXPECTED_TRANSCRIPT;

    render(<App />);

    // The transcript container and the text should be visible
    const container = screen.getByTestId('transcript-container');
    expect(container).toBeInTheDocument();
    expect(container).toHaveTextContent(MOCK_EXPECTED_TRANSCRIPT);
  });

  it('should display an error message when the hook provides one', () => {
    const errorMessage = "This is a test error.";
    mockTranscriptionState.error = errorMessage;

    render(<App />);

    // The error message should be visible
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it('should show loading state when transcription is in progress', () => {
    mockTranscriptionState.loading = true;

    render(<App />);

    // The "Transcribe Audio" button should show "Transcribing..."
    const transcribeButton = screen.getByRole('button', { name: /transcribing.../i });
    expect(transcribeButton).toBeInTheDocument();
    expect(transcribeButton).toBeDisabled();
  });
});
