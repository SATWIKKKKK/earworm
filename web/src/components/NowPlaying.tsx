import { ChevronDown, ExternalLink, ListMusic, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trackMenu } from "../actions";
import { useStore } from "../store";
import { Cover, SourceMark } from "./bits";
import { LikeButton, Seek, Transport } from "./PlayerBar";
import { QueuePanel } from "./QueuePanel";

export function NowPlaying() {
  const open = useStore((s) => s.nowPlayingOpen);
  const t = useStore((s) => (s.currentId ? s.tracks[s.currentId] : null));
  const ctx = useStore((s) => s.context);
  const [showQueue, setShowQueue] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => useStore.getState().setNowPlayingOpen(false);

  // swipe down to close on touch screens
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
    else setShowQueue(false);
  }, [open]);

  if (!open || !t) return null;

  return (
    <div
      className="sheet"
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      onKeyDown={(e) => e.key === "Escape" && close()}
      onTouchStart={(e) => (startY.current = e.touches[0].clientY)}
      onTouchEnd={(e) => {
        if (startY.current != null && e.changedTouches[0].clientY - startY.current > 120 && !showQueue) close();
        startY.current = null;
      }}
    >
      <div className="sheet-top">
        <button className="icon-btn" onClick={close} aria-label="Close">
          <ChevronDown size={24} strokeWidth={1.75} />
        </button>
        <div className="sheet-from">
          <span>Playing from</span>
          <strong>{ctx?.label ?? "Songs"}</strong>
        </div>
        <button className="icon-btn" onClick={(e) => trackMenu(e.currentTarget.getBoundingClientRect(), t.id)} aria-label="More options">
          <MoreHorizontal size={22} />
        </button>
      </div>

      <div className="sheet-main">
        {showQueue ? (
          <QueuePanel inSheet />
        ) : (
          <div className="sheet-art">
            <Cover track={t} className="big" />
          </div>
        )}
        <div className="sheet-controls">
          <div className="sheet-meta">
            <div className="np-text">
              <h2 className="sheet-title">{t.title}</h2>
              <span className="np-artist">
                <SourceMark source={t.source} size={12} />
                {t.artist}
                {t.handle && t.handle !== t.artist ? <span className="handle">@{t.handle}</span> : null}
              </span>
            </div>
            <LikeButton id={t.id} size={24} />
          </div>
          <Seek />
          <Transport big />
          <div className="sheet-extra">
            {t.url ? (
              <a className="text-btn" href={t.url} target="_blank" rel="noopener">
                <ExternalLink size={15} /> Original post
              </a>
            ) : (
              <span />
            )}
            <button className={`icon-btn ${showQueue ? "active" : ""}`} onClick={() => setShowQueue((v) => !v)} aria-pressed={showQueue} aria-label="Queue">
              <ListMusic size={20} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
