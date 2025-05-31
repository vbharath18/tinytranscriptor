// This file will contain audio utility functions.

/**
 * Converts an AudioBuffer to a WAV ArrayBuffer.
 * @param buffer The AudioBuffer to convert.
 * @returns ArrayBuffer representing the WAV file.
 */
export const audioBufferToWav = (buffer: AudioBuffer): ArrayBuffer => {
  const numChannels = 1; // Mono audio
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16; // 16-bit for better compatibility

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const data = buffer.getChannelData(0); // Assuming mono, get the first channel
  const length = data.length;
  const dataLength = length * bytesPerSample;

  // Total size of WAV file (header + data)
  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);

  // Helper function to write strings to DataView
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true); // ChunkSize
  writeString(8, 'WAVE');

  // "fmt " sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitDepth, true); // BitsPerSample

  // "data" sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataLength, true); // Subchunk2Size (data length)

  // Write actual PCM data
  let offset = 44;
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i])); // Clamp to [-1, 1]
    // Convert to 16-bit signed integer
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += bytesPerSample;
  }

  return arrayBuffer;
};
