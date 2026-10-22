export const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 16);

export function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function fmtTotal(sec: number) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} hr ${m % 60} min`;
}

export function fmtAdded(ts: number) {
  const diff = Date.now() - ts;
  const day = 86_400_000;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)} hr ago`;
  if (diff < 2 * day) return "Yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function looksLikeLink(s: string) {
  return /^(https?:\/\/)?(www\.|m\.|mobile\.)?(instagram\.com|instagr\.am|twitter\.com|x\.com)\//i.test(s.trim());
}

/** Picks a usable accent from cover art: the most common saturated hue, clamped for contrast. */
export async function coverColor(blob: Blob): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      const [h, s, l] = rgbToHsl(r, g, b);
      if (s < 0.18 || l < 0.12 || l > 0.9) continue;
      const key = Math.round(h * 18);
      const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      const w = s; // favour saturated pixels
      e.n += w;
      e.r += r * w;
      e.g += g * w;
      e.b += b * w;
      buckets.set(key, e);
    }
    let best: { n: number; r: number; g: number; b: number } | null = null;
    for (const v of buckets.values()) if (!best || v.n > best.n) best = v;
    if (!best || best.n < 20) return null;
    const [h, s] = rgbToHsl(best.r / best.n, best.g / best.n, best.b / best.n);
    // "hue sat%" — lightness is chosen per theme in CSS so it always has contrast
    return `${Math.round(h * 360)} ${Math.round(Math.min(Math.max(s, 0.35), 0.7) * 100)}%`;
  } catch {
    return null;
  }
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export async function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(blob);
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      resolve(isFinite(a.duration) ? a.duration : 0);
      URL.revokeObjectURL(url);
    };
    a.onerror = () => {
      resolve(0);
      URL.revokeObjectURL(url);
    };
    a.src = url;
  });
}
