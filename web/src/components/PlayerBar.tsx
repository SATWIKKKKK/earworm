import { Heart, ListMusic, Maximize2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { cycleRepeat } from "../actions";
import { audio, previous, seek } from "../engine";
import { usePlayhead } from "../hooks";
import { fmtTime } from "../lib/util";
import { useStore } from "../store";
import { openMenu } from "../ui";
import { Cover, Slider, SourceMark } from "./bits";

const RATES = [0.75, 1, 1.25, 1.5, 2];

export function Transport({ big = false }: { big?: boolean }) {
  const playing = useStore((s) => s.playing);
  const shuffle = useStore((s) => s.shuffle);
  const repeat = useStore((s) => s.repeat);
  const has = useStore((s) => !!s.currentId);
  const s = useStore.getState;
  const sz = big ? 26 : 18;
  return (
    <div className={`transport ${big ? "big" : ""}`}>
      <button className={`icon-btn ${shuffle ? "active" : ""}`} onClick={() => s().toggleShuffle()} aria-label={shuffle ? "Turn off shuffle" : "Turn on shuffle"} aria-pressed={shuffle} title="Shuffle (S)">
        <Shuffle size={sz} strokeWidth={1.75} />
      </button>
      <button className="icon-btn" onClick={previous} disabled={!has} aria-label="Previous" title="Previous">
        <SkipBack size={sz + 2} fill="currentColor" strokeWidth={1.5} />
      </button>
      <button className="play-btn" onClick={() => s().togglePlay()} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"}>
        {playing ? <Pause size={big ? 28 : 18} fill="currentColor" strokeWidth={0} /> : <Play size={big ? 28 : 18} fill="currentColor" strokeWidth={0} className="nudge" />}
      </button>
      <button className="icon-btn" onClick={() => s().next()} disabled={!has} aria-label="Next" title="Next">
        <SkipForward size={sz + 2} fill="currentColor" strokeWidth={1.5} />
      </button>
      <button
        className={`icon-btn ${repeat !== "off" ? "active" : ""}`}
        onClick={cycleRepeat}
        aria-label={repeat === "off" ? "Loop this song" : repeat === "one" ? "Loop all songs" : "Turn off loop"}
        title={repeat === "off" ? "Loop this song (R)" : repeat === "one" ? "Looping this song. Click to loop all (R)" : "Looping all. Click to turn off (R)"}
      >
        {repeat === "one" ? <Repeat1 size={sz} strokeWidth={1.75} /> : <Repeat size={sz} strokeWidth={1.75} />}
      </button>
    </div>
  );
}

export function Seek() {
  const { time, duration: loaded } = usePlayhead();
  const listed = useStore((s) => (s.currentId ? s.tracks[s.currentId]?.duration ?? 0 : 0));
  const duration = loaded || listed; // before the audio's metadata loads, the stored length still lets you seek
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <div className="seek">
      <span className="time">{fmtTime(preview ?? time)}</span>
      <Slider
        className="seek-slider"
        label="Seek"
        value={time}
        max={duration}
        step={5}
        format={fmtTime}
        onChange={setPreview}
        onCommit={(v) => {
          seek(v);
          setPreview(null);
        }}
      />
      <span className="time">{fmtTime(duration)}</span>
    </div>
  );
}

export function LikeButton({ id, size = 18 }: { id: string; size?: number }) {
  const liked = useStore((s) => !!s.liked[id]);
  return (
    <button
      className={`like ${liked ? "on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        useStore.getState().toggleLike(id);
      }}
      aria-label={liked ? "Remove from Liked" : "Add to Liked"}
      aria-pressed={liked}
      title="Like (L)"
    >
      <Heart size={size} strokeWidth={1.9} fill={liked ? "currentColor" : "none"} />
    </button>
  );
}

export function PlayerBar() {
  const t = useStore((s) => (s.currentId ? s.tracks[s.currentId] : null));
  const volume = useStore((s) => s.volume);
  const muted = useStore((s) => s.muted);
  const rate = useStore((s) => s.rate);
  const queueOpen = useStore((s) => s.queueOpen);
  const ctx = useStore((s) => s.context);
  const go = useStore((s) => s.go);
  const v = muted ? 0 : volume;
  const VolIcon = v === 0 ? VolumeX : v < 0.34 ? Volume : v < 0.67 ? Volume1 : Volume2;

  return (
    <footer className="player" aria-label="Player">
      <div className="np">
        {t ? (
          <>
            <button className="np-cover" onClick={() => useStore.getState().setNowPlayingOpen(true)} aria-label="Open now playing">
              <Cover track={t} size={52} />
            </button>
            <div className="np-text">
              <button className="np-title" onClick={() => ctx && go(ctx.view)} title={ctx ? `Playing from ${ctx.label}` : undefined}>
                {t.title}
              </button>
              <span className="np-artist">
                <SourceMark source={t.source} size={11} />
                {t.artist}
              </span>
            </div>
            <LikeButton id={t.id} />
          </>
        ) : (
          <span className="np-idle">Nothing playing</span>
        )}
      </div>

      <div className="center">
        <Transport />
        <Seek />
      </div>

      <div className="right">
        <button
          className={`rate ${rate !== 1 ? "active" : ""}`}
          onClick={(e) =>
            openMenu(
              e.currentTarget.getBoundingClientRect(),
              RATES.map((r) => ({ label: `${r}×`, hint: r === rate ? "✓" : undefined, run: () => useStore.getState().setRate(r) })),
            )
          }
          aria-label={`Playback speed ${rate}×`}
          title="Playback speed"
        >
          {rate}×
        </button>
        <button className={`icon-btn ${queueOpen ? "active" : ""}`} onClick={() => useStore.getState().setQueueOpen(!queueOpen)} aria-label="Queue" aria-pressed={queueOpen} title="Queue (Q)">
          <ListMusic size={18} strokeWidth={1.75} />
        </button>
        <div className="vol">
          <button className="icon-btn" onClick={() => useStore.getState().toggleMute()} aria-label={muted ? "Unmute" : "Mute"} title="Mute (M)">
            <VolIcon size={18} strokeWidth={1.75} />
          </button>
          <Slider
            className="vol-slider"
            label="Volume"
            value={v * 100}
            max={100}
            step={5}
            format={(x) => `${Math.round(x)}%`}
            onChange={(x) => {
              audio.volume = x / 100;
            }}
            onCommit={(x) => useStore.getState().setVolume(x / 100)}
          />
        </div>
        <button className="icon-btn" disabled={!t} onClick={() => useStore.getState().setNowPlayingOpen(true)} aria-label="Full screen player" title="Full screen">
          <Maximize2 size={16} strokeWidth={1.75} />
        </button>
      </div>
    </footer>
  );
}

/** Compact bar for phones; opens the full player when tapped. */
export function MiniPlayer() {
  const t = useStore((s) => (s.currentId ? s.tracks[s.currentId] : null));
  const playing = useStore((s) => s.playing);
  const { time, duration } = usePlayhead();
  if (!t) return null;
  return (
    <div className="mini" onClick={() => useStore.getState().setNowPlayingOpen(true)} role="button" tabIndex={0} aria-label="Open now playing">
      <Cover track={t} size={40} />
      <div className="np-text">
        <span className="np-title">{t.title}</span>
        <span className="np-artist">{t.artist}</span>
      </div>
      <LikeButton id={t.id} size={20} />
      <button
        className="icon-btn"
        onClick={(e) => {
          e.stopPropagation();
          useStore.getState().togglePlay();
        }}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={22} fill="currentColor" strokeWidth={0} /> : <Play size={22} fill="currentColor" strokeWidth={0} />}
      </button>
      <div className="mini-progress" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
    </div>
  );
}
