// Asks /api/identify (Shazam) which song a track is. The browser decodes the
// audio itself and sends ~12 s of 16 kHz mono WAV, so the server needs no ffmpeg
// and the upload stays around 400 KB.

const RATE = 16000;
const CLIP = 12; // seconds per attempt

export async function identifySong(blob: Blob): Promise<{ title: string; artist: string } | null> {
  const pcm = await decode(blob);
  if (!pcm) return null;
  // reels usually start on the hook; longer tracks get a second try from further in
  const starts = pcm.length > RATE * 30 ? [0, Math.floor(pcm.length * 0.35)] : [0];
  for (const start of starts) {
    const res = await fetch("/api/identify", {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wav(pcm.subarray(start, start + RATE * CLIP)),
    });
    if (!res.ok) return null;
    const r = await res.json().catch(() => ({}));
    if (r.title) return { title: String(r.title), artist: String(r.artist || "") };
  }
  return null;
}

async function decode(blob: Blob): Promise<Float32Array | null> {
  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) return null;
  try {
    // 44.1 kHz works everywhere (Safari rejects low context rates); we downsample ourselves
    const buf = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
    return downsample(mono(buf), buf.sampleRate);
  } catch {
    return null;
  }
}

function mono(buf: AudioBuffer) {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

/** Box-filter downsample: averaging each window doubles as a crude low-pass. */
function downsample(src: Float32Array, from: number) {
  const ratio = from / RATE;
  const out = new Float32Array(Math.floor(src.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += src[j];
    out[i] = sum / (b - a);
  }
  return out;
}

function wav(pcm: Float32Array) {
  const v = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([v.buffer], { type: "audio/wav" });
}
