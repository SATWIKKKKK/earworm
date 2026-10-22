import { ChevronLeft } from "lucide-react";
import type { CSSProperties, PointerEvent as RPE } from "react";
import { useRef, useState } from "react";
import { useCover } from "../hooks";
import { goBack } from "../nav";
import type { Source, Track } from "../store";

export function SourceMark({ source, size = 12 }: { source: Source; size?: number }) {
  if (source === "x")
    return (
      <svg className="src" width={size} height={size} viewBox="0 0 24 24" aria-label="X">
        <path fill="currentColor" d="M17.7 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.7 3Zm-1.1 16.2h1.7L7.3 4.7H5.5l11.1 14.5Z" />
      </svg>
    );
  if (source === "instagram")
    return (
      <svg className="src" width={size} height={size} viewBox="0 0 24 24" aria-label="Instagram" fill="none" stroke="currentColor" strokeWidth="2.2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.3" cy="6.7" r="0.6" fill="currentColor" />
      </svg>
    );
  return (
    <svg className="src" width={size} height={size} viewBox="0 0 24 24" aria-label="File" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </svg>
  );
}

/** Cover art, or a quiet placeholder built from the track's own tint. */
export function Cover({ track, size, className = "" }: { track: Track | null | undefined; size?: number; className?: string }) {
  const url = useCover(track?.id, track?.hasCover);
  const style: CSSProperties = size ? { width: size, height: size } : {};
  if (track && !url) {
    const hue = track.tint ? track.tint.split(" ")[0] : String(hash(track.id) % 360);
    (style as Record<string, string>)["--ph-h"] = hue;
  }
  return (
    <div className={`cover ${url ? "" : "cover-ph"} ${className}`} style={style}>
      {url ? <img src={url} alt="" draggable={false} /> : track ? <SourceMark source={track.source} size={Math.max(12, (size ?? 48) / 3.4)} /> : null}
    </div>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Horizontal slider used for seeking and volume. Pointer + keyboard. */
export function Slider({
  value,
  max,
  onChange,
  onCommit,
  label,
  step,
  className = "",
  format,
}: {
  value: number;
  max: number;
  onChange?: (v: number) => void;
  onCommit: (v: number) => void;
  label: string;
  step: number;
  className?: string;
  format?: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const v = drag ?? value;
  const pct = max > 0 ? Math.min(100, (v / max) * 100) : 0;

  const at = (e: RPE) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * max;
  };

  return (
    <div
      ref={ref}
      className={`slider ${drag != null ? "dragging" : ""} ${className}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(v)}
      aria-valuetext={format?.(v)}
      style={{ "--p": `${pct}%` } as CSSProperties}
      onPointerDown={(e) => {
        if (!max) return;
        ref.current!.setPointerCapture(e.pointerId);
        const x = at(e);
        setDrag(x);
        onChange?.(x);
      }}
      onPointerMove={(e) => {
        if (drag == null) return;
        const x = at(e);
        setDrag(x);
        onChange?.(x);
      }}
      onPointerUp={(e) => {
        if (drag == null) return;
        onCommit(at(e));
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onCommit(Math.min(max, value + step));
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onCommit(Math.max(0, value - step));
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="slider-track">
        <div className="slider-fill" />
      </div>
      <div className="slider-thumb" />
    </div>
  );
}

export function BackButton() {
  return (
    <button className="back-btn" onClick={goBack}>
      <ChevronLeft size={18} strokeWidth={2} />
      Back
    </button>
  );
}

export function Bars() {
  return (
    <span className="bars" aria-label="Playing">
      <i />
      <i />
      <i />
    </span>
  );
}
