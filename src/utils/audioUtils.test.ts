import { describe, it, expect, vi } from 'vitest';
import { audioBufferToWav } from './audioUtils'; // Assuming audioUtils.ts is in the same directory or adjust path

// Mock AudioBuffer
const mockGetChannelData = vi.fn();

// Use a Vitest mock to represent the AudioBuffer constructor and its methods
vi.stubGlobal('AudioBuffer', vi.fn(() => ({
  sampleRate: 16000, // Default mock sample rate
  numberOfChannels: 1,
  length: 0,
  duration: 0,
  getChannelData: mockGetChannelData,
})));


describe('audioBufferToWav', () => {
  it('should correctly generate a WAV header', () => {
    const sampleRate = 44100;
    const numSamples = 0; // No actual data for this test, just header
    const mockAudioBufferInstance = {
      sampleRate: sampleRate,
      numberOfChannels: 1,
      length: numSamples,
      duration: numSamples / sampleRate,
      getChannelData: vi.fn(() => new Float32Array(numSamples)),
    };

    const wavBuffer = audioBufferToWav(mockAudioBufferInstance as unknown as AudioBuffer);
    const view = new DataView(wavBuffer);

    // RIFF chunk descriptor
    expect(view.getUint8(0)).toBe(0x52); // 'R'
    expect(view.getUint8(1)).toBe(0x49); // 'I'
    expect(view.getUint8(2)).toBe(0x46); // 'F'
    expect(view.getUint8(3)).toBe(0x46); // 'F'

    // ChunkSize: 36 + dataLength (dataLength is 0 here)
    expect(view.getUint32(4, true)).toBe(36 + numSamples * 2);

    // WAVE format
    expect(view.getUint8(8)).toBe(0x57); // 'W'
    expect(view.getUint8(9)).toBe(0x41); // 'A'
    expect(view.getUint8(10)).toBe(0x56); // 'V'
    expect(view.getUint8(11)).toBe(0x45); // 'E'

    // "fmt " sub-chunk
    expect(view.getUint8(12)).toBe(0x66); // 'f'
    expect(view.getUint8(13)).toBe(0x6d); // 'm'
    expect(view.getUint8(14)).toBe(0x74); // 't'
    expect(view.getUint8(15)).toBe(0x20); // ' '
    expect(view.getUint32(16, true)).toBe(16); // Subchunk1Size (16 for PCM)
    expect(view.getUint16(20, true)).toBe(1);  // AudioFormat (1 for PCM)
    expect(view.getUint16(22, true)).toBe(1);  // NumChannels (mono)
    expect(view.getUint32(24, true)).toBe(sampleRate); // SampleRate
    expect(view.getUint32(28, true)).toBe(sampleRate * 1 * 2); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    expect(view.getUint16(32, true)).toBe(1 * 2); // BlockAlign (NumChannels * BitsPerSample/8)
    expect(view.getUint16(34, true)).toBe(16); // BitsPerSample (16-bit)

    // "data" sub-chunk
    expect(view.getUint8(36)).toBe(0x64); // 'd'
    expect(view.getUint8(37)).toBe(0x61); // 'a'
    expect(view.getUint8(38)).toBe(0x74); // 't'
    expect(view.getUint8(39)).toBe(0x61); // 'a'
    expect(view.getUint32(40, true)).toBe(numSamples * 2); // Subchunk2Size (data length)
  });

  it('should correctly convert Float32Array data to Int16', () => {
    const sampleData = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const expectedInt16Data = [0, 16383, -16384, 32767, -32768]; // 0.5 * 32767, -0.5 * 32768, etc.

    const mockAudioBufferInstance = {
      sampleRate: 16000,
      numberOfChannels: 1,
      length: sampleData.length,
      duration: sampleData.length / 16000,
      getChannelData: vi.fn(() => sampleData),
    };

    const wavBuffer = audioBufferToWav(mockAudioBufferInstance as unknown as AudioBuffer);
    const view = new DataView(wavBuffer);

    // Check data part
    for (let i = 0; i < expectedInt16Data.length; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(expectedInt16Data[i]);
    }
  });

  it('should handle empty audio data', () => {
    const sampleData = new Float32Array([]);
    const mockAudioBufferInstance = {
      sampleRate: 16000,
      numberOfChannels: 1,
      length: sampleData.length,
      duration: 0,
      getChannelData: vi.fn(() => sampleData),
    };
    const wavBuffer = audioBufferToWav(mockAudioBufferInstance as unknown as AudioBuffer);
    const view = new DataView(wavBuffer);
    expect(view.getUint32(4, true)).toBe(36); // ChunkSize
    expect(view.getUint32(40, true)).toBe(0);  // Subchunk2Size
    expect(wavBuffer.byteLength).toBe(44); // Only header
  });
});
