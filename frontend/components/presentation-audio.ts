// Only the compact mono PCM file is uploaded. No video is captured or encoded.
export function makeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  const frames = Math.floor((size * 16000) / sampleRate);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const text = (position: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(position + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  // Average each source window when the browser uses a higher device sample rate.
  for (let i = 0; i < frames; i++) {
    const start = Math.floor((i * sampleRate) / 16000);
    const end = Math.min(
      size,
      Math.max(start + 1, Math.floor(((i + 1) * sampleRate) / 16000)),
    );
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(44 + i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
