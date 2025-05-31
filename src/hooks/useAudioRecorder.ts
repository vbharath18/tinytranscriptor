import { useState, useRef, useCallback } from 'react';

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
    // Use standard AudioContext or webkitAudioContext for Safari compatibility
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    // fftSize determines the number of bins in the frequency data.
    // A smaller size (e.g., 256) is suitable for basic audio level visualization.
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

export default useAudioRecorder;
