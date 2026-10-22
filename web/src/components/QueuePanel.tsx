import { X } from "lucide-react";
import { trackMenu } from "../actions";
import { useStore, type Track } from "../store";
import { Bars, Cover } from "./bits";

export function QueuePanel({ onClose, inSheet = false }: { onClose?: () => void; inSheet?: boolean }) {
  const tracks = useStore((s) => s.tracks);
  const currentId = useStore((s) => s.currentId);
  const userQueue = useStore((s) => s.userQueue);
  const contextIds = useStore((s) => s.contextIds);
  const pos = useStore((s) => s.pos);
  const ctx = useStore((s) => s.context);
  const playing = useStore((s) => s.playing);
  const repeat = useStore((s) => s.repeat);
  const st = useStore.getState;

  const cur = currentId ? tracks[currentId] : null;
  const after = contextIds.map((id, i) => ({ id, i })).slice(pos + 1).filter((x) => tracks[x.id]);
  const wrap = repeat === "all" ? contextIds.map((id, i) => ({ id, i })).slice(0, Math.max(0, pos)).filter((x) => tracks[x.id]) : [];
  const upNext = [...after, ...wrap].slice(0, 80);

  return (
    <aside className={`queue ${inSheet ? "in-sheet" : ""}`} aria-label="Queue">
      {!inSheet && (
        <div className="queue-head">
          <h2>Queue</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close queue">
            <X size={16} />
          </button>
        </div>
      )}
      <div className="queue-body">
        <h3>Now playing</h3>
        {cur ? <QRow t={cur} current playing={playing} /> : <p className="q-empty">Pick a song to start.</p>}

        {userQueue.length > 0 && (
          <>
            <div className="q-sec">
              <h3>Next in queue</h3>
              <button className="text-btn" onClick={() => st().clearQueue()}>
                Clear
              </button>
            </div>
            {userQueue.map((id, i) =>
              tracks[id] ? (
                <QRow key={`${id}-${i}`} t={tracks[id]} onPlay={() => st().jumpToQueued(i)} onRemove={() => st().removeFromQueue(i)} />
              ) : null,
            )}
          </>
        )}

        {upNext.length > 0 && (
          <>
            <div className="q-sec">
              <h3>Next from {ctx?.label ?? "Songs"}</h3>
            </div>
            {upNext.map(({ id, i }) => (
              <QRow key={`${id}-c${i}`} t={tracks[id]} onPlay={() => st().jumpToContext(i)} />
            ))}
          </>
        )}
        {cur && !userQueue.length && !upNext.length && <p className="q-empty">Nothing after this. Turn on repeat to keep it going.</p>}
      </div>
    </aside>
  );
}

function QRow({ t, current, playing, onPlay, onRemove }: { t: Track; current?: boolean; playing?: boolean; onPlay?: () => void; onRemove?: () => void }) {
  return (
    <div
      className={`q-row ${current ? "current" : ""}`}
      onClick={onPlay}
      onKeyDown={(e) => e.key === "Enter" && onPlay?.()}
      role={onPlay ? "button" : undefined}
      tabIndex={onPlay ? 0 : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        trackMenu(e, t.id);
      }}
    >
      <Cover track={t} size={40} />
      <div className="np-text">
        <span className="np-title">{t.title}</span>
        <span className="np-artist">{t.artist}</span>
      </div>
      {current && playing && <Bars />}
      {onRemove && (
        <button
          className="icon-btn sm q-remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${t.title} from queue`}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
