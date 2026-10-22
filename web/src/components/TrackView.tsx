import { Clock3, Heart, MoreHorizontal, Pause, Play, Search, Shuffle } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { addToPlaylistItems, trackMenu } from "../actions";
import { useMedia } from "../hooks";
import { fmtAdded, fmtTime, fmtTotal } from "../lib/util";
import { idsForView, sameView, useStore, viewLabel, type Track, type View } from "../store";
import { openMenu } from "../ui";
import { BackButton, Bars, Cover, SourceMark } from "./bits";
import { playlistMenu } from "./Sidebar";

type Sort = "custom" | "added" | "title" | "artist" | "plays" | "duration";
const SORTS: { k: Sort; label: string }[] = [
  { k: "custom", label: "Custom order" },
  { k: "added", label: "Recently added" },
  { k: "title", label: "Title" },
  { k: "artist", label: "Artist" },
  { k: "plays", label: "Most played" },
  { k: "duration", label: "Length" },
];

export function TrackView({ view }: { view: View }) {
  const tracks = useStore((s) => s.tracks);
  const order = useStore((s) => s.order);
  const liked = useStore((s) => s.liked);
  const playlists = useStore((s) => s.playlists);
  const playing = useStore((s) => s.playing);
  const context = useStore((s) => s.context);
  const shuffle = useStore((s) => s.shuffle);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("custom");
  const [selected, setSelected] = useState<string | null>(null);
  const coarse = useMedia("(pointer: coarse)");

  const base = useMemo(() => idsForView({ tracks, order, liked, playlists }, view), [tracks, order, liked, playlists, view]);
  const rows = useMemo(() => {
    let r = base.map((id, index) => ({ id, index, t: tracks[id] })).filter((x) => x.t);
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter(({ t }) => `${t.title} ${t.artist} ${t.handle ?? ""} ${t.caption ?? ""}`.toLowerCase().includes(needle));
    const cmp: Record<Sort, ((a: Track, b: Track) => number) | null> = {
      custom: null,
      added: (a, b) => b.addedAt - a.addedAt,
      title: (a, b) => a.title.localeCompare(b.title),
      artist: (a, b) => a.artist.localeCompare(b.artist),
      plays: (a, b) => b.plays - a.plays,
      duration: (a, b) => b.duration - a.duration,
    };
    const f = cmp[sort];
    if (f) r = r.slice().sort((a, b) => f(a.t, b.t));
    return r;
  }, [base, tracks, q, sort]);

  const label = viewLabel({ playlists }, view);
  const playlist = view.kind === "playlist" ? playlists.find((p) => p.id === view.id) : null;
  const total = rows.reduce((a, r) => a + (r.t.duration || 0), 0);
  const ctxHere = !!context && sameView(context.view, view);
  const playingHere = ctxHere && playing;
  const canReorder = view.kind === "playlist" && sort === "custom" && !q;

  const playFrom = (id: string | null, opts?: { shuffle?: boolean }) => {
    const ids = rows.map((r) => r.id);
    useStore.getState().playList(ids, id, { label, view }, opts);
  };

  const onHeaderPlay = () => {
    const s = useStore.getState();
    if (ctxHere && s.currentId) s.togglePlay();
    else playFrom(null);
  };

  const [dragOver, setDragOver] = useState<number | null>(null);
  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    setDragOver(null);
    const from = Number(e.dataTransfer.getData("text/earworm-index"));
    if (playlist && Number.isFinite(from) && from !== to) useStore.getState().movePlaylistItem(playlist.id, from, to > from ? to - 1 : to);
  };

  return (
    <section className="view">
      {view.kind !== "songs" && <BackButton />}
      <header className="view-head">
        {playlist && <Mosaic ids={playlist.trackIds} />}
        <div className="view-titles">
          <h1>{label}</h1>
          <p className="meta">
            {base.length === 0 ? "No songs yet" : `${base.length} ${base.length === 1 ? "song" : "songs"}, ${fmtTotal(base.reduce((a, id) => a + (tracks[id]?.duration || 0), 0))}`}
          </p>
        </div>
      </header>

      {base.length > 0 && (
        <div className="toolbar">
          <button className="play-big" onClick={onHeaderPlay} aria-label={playingHere ? "Pause" : `Play ${label}`}>
            {playingHere ? <Pause size={22} fill="currentColor" strokeWidth={0} /> : <Play size={22} fill="currentColor" strokeWidth={0} className="nudge" />}
          </button>
          <button
            className={`icon-btn ${ctxHere && shuffle ? "active" : ""}`}
            onClick={() => (ctxHere ? useStore.getState().toggleShuffle() : playFrom(null, { shuffle: true }))}
            aria-label={ctxHere ? (shuffle ? "Turn off shuffle" : "Turn on shuffle") : `Shuffle ${label}`}
            title={ctxHere ? "Shuffle" : `Shuffle ${label}`}
          >
            <Shuffle size={20} strokeWidth={1.75} />
          </button>
          {playlist && (
            <button className="icon-btn" aria-label="Playlist options" onClick={(e) => playlistMenu(e.currentTarget.getBoundingClientRect(), playlist.id)}>
              <MoreHorizontal size={20} />
            </button>
          )}
          <div className="toolbar-right">
            <label className="filter">
              <Search size={15} strokeWidth={2} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label}`} id="filter-input" />
            </label>
            <button
              className="sort-btn"
              onClick={(e) =>
                openMenu(
                  e.currentTarget.getBoundingClientRect(),
                  SORTS.filter((x) => !(view.kind === "songs" && x.k === "added")).map((x) => ({
                    label: x.k === "custom" ? customLabel(view) : x.label,
                    hint: sort === x.k ? "✓" : undefined,
                    run: () => setSort(x.k),
                  })),
                )
              }
            >
              {sort === "custom" ? customLabel(view) : SORTS.find((x) => x.k === sort)!.label}
            </button>
          </div>
        </div>
      )}

      {base.length === 0 ? (
        <Empty view={view} />
      ) : rows.length === 0 ? (
        <p className="empty-line">Nothing here matches “{q}”.</p>
      ) : (
        <div className="tracks" role="grid" aria-label={label}>
          <div className="tr head" role="row">
            <span className="c-num">#</span>
            <span className="c-title">Title</span>
            <span className="c-added">{view.kind === "recent" ? "Last played" : "Added"}</span>
            <span className="c-plays">Plays</span>
            <span className="c-like" />
            <span className="c-time" aria-label="Length">
              <Clock3 size={15} strokeWidth={1.75} />
            </span>
            <span className="c-more" />
          </div>
          {rows.map(({ id, index, t }, i) => (
            <Row
              key={`${id}-${index}`}
              t={t}
              n={i + 1}
              liked={!!liked[id]}
              selected={selected === id}
              view={view}
              index={index}
              dateLabel={view.kind === "recent" ? fmtAdded(t.lastPlayedAt ?? t.addedAt) : view.kind === "liked" ? fmtAdded(liked[id]) : fmtAdded(t.addedAt)}
              onSelect={() => setSelected(id)}
              onPlay={() => playFrom(id, { shuffle: false })}
              playingFromHere={ctxHere}
              coarse={coarse}
              draggableRow
              reorder={canReorder}
              dragOver={dragOver === index}
              onDragOverRow={(e) => {
                if (!canReorder || !e.dataTransfer.types.includes("text/earworm-index")) return;
                e.preventDefault();
                setDragOver(index);
              }}
              onDropRow={(e) => onDrop(e, index)}
            />
          ))}
          {canReorder && (
            <div
              className={`drop-tail ${dragOver === base.length ? "over" : ""}`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes("text/earworm-index")) return;
                e.preventDefault();
                setDragOver(base.length);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(e, base.length)}
            />
          )}
          <p className="list-foot">{rows.length !== base.length ? `${rows.length} of ${base.length} songs, ${fmtTotal(total)}` : ""}</p>
        </div>
      )}
    </section>
  );
}

function Row(p: {
  t: Track;
  n: number;
  liked: boolean;
  selected: boolean;
  view: View;
  index: number;
  dateLabel: string;
  onSelect: () => void;
  onPlay: () => void;
  playingFromHere: boolean;
  coarse: boolean;
  draggableRow: boolean;
  reorder: boolean;
  dragOver: boolean;
  onDragOverRow: (e: DragEvent) => void;
  onDropRow: (e: DragEvent) => void;
}) {
  const { t } = p;
  const isCurrent = useStore((s) => s.currentId === t.id);
  const playing = useStore((s) => s.playing && s.currentId === t.id);
  const toggleLike = useStore((s) => s.toggleLike);

  return (
    <div
      className={`tr ${isCurrent ? "current" : ""} ${p.selected ? "selected" : ""} ${p.dragOver ? "drag-over" : ""}`}
      role="row"
      tabIndex={0}
      aria-selected={p.selected}
      draggable={p.draggableRow && !p.coarse}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/earworm-track", t.id);
        if (p.reorder) e.dataTransfer.setData("text/earworm-index", String(p.index));
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      onDragOver={p.onDragOverRow}
      onDrop={p.onDropRow}
      onClick={(e) => {
        if (e.detail > 1) return; // second click of a double-click: the first one already played it
        // the song already playing from this list opens its page; anything else plays
        if (isCurrent && p.playingFromHere) useStore.getState().setNowPlayingOpen(true);
        else p.onPlay();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") p.onPlay();
        else if (e.key === "ArrowDown") (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
        else if (e.key === "ArrowUp") (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onFocus={p.onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        trackMenu(e, t.id, { view: p.view, index: p.index });
      }}
    >
      <span className="c-num">
        <span className="num">{playing ? <Bars /> : p.n}</span>
        <button
          className="row-play"
          tabIndex={-1}
          aria-label={playing ? `Pause ${t.title}` : `Play ${t.title}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isCurrent) useStore.getState().togglePlay();
            else p.onPlay();
          }}
        >
          {playing ? <Pause size={15} fill="currentColor" strokeWidth={0} /> : <Play size={15} fill="currentColor" strokeWidth={0} />}
        </button>
      </span>
      <span className="c-title">
        <Cover track={t} size={40} />
        <span className="title-text">
          <span className="t-title">{t.title}</span>
          <span className="t-artist">
            <SourceMark source={t.source} size={11} />
            {t.artist}
          </span>
        </span>
      </span>
      <span className="c-added">{p.dateLabel}</span>
      <span className="c-plays">{t.plays || ""}</span>
      <span className="c-like">
        <button
          className={`like ${p.liked ? "on" : ""}`}
          aria-label={p.liked ? "Remove from Liked" : "Add to Liked"}
          aria-pressed={p.liked}
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(t.id);
          }}
        >
          <Heart size={16} strokeWidth={1.9} fill={p.liked ? "currentColor" : "none"} />
        </button>
      </span>
      <span className="c-time">{t.duration ? fmtTime(t.duration) : ""}</span>
      <span className="c-more">
        <button
          className="icon-btn sm more"
          aria-label={`More options for ${t.title}`}
          onClick={(e) => {
            e.stopPropagation();
            trackMenu(e.currentTarget.getBoundingClientRect(), t.id, { view: p.view, index: p.index });
          }}
        >
          <MoreHorizontal size={18} />
        </button>
      </span>
    </div>
  );
}

function Mosaic({ ids }: { ids: string[] }) {
  const tracks = useStore((s) => s.tracks);
  const ts = ids.map((id) => tracks[id]).filter(Boolean).slice(0, 4);
  if (ts.length < 4)
    return (
      <div className="mosaic one">
        <Cover track={ts[0] ?? null} />
      </div>
    );
  return (
    <div className="mosaic">
      {ts.map((t) => (
        <Cover key={t.id} track={t} />
      ))}
    </div>
  );
}

function Empty({ view }: { view: View }) {
  const go = useStore((s) => s.go);
  if (view.kind === "songs")
    return (
      <div className="empty">
        <h2>Your library is empty</h2>
        <p>Paste a link to an Instagram reel or an X post with video. The sound is saved on this device, so it keeps playing even if the post disappears.</p>
        <button className="btn" onClick={() => document.getElementById("link-input")?.focus()}>
          Paste a link
        </button>
      </div>
    );
  if (view.kind === "liked")
    return (
      <div className="empty">
        <h2>Nothing liked yet</h2>
        <p>Tap the heart on a song to keep it here.</p>
        <button className="btn" onClick={() => go({ kind: "songs" })}>
          Go to Songs
        </button>
      </div>
    );
  if (view.kind === "recent")
    return (
      <div className="empty">
        <h2>Nothing played yet</h2>
        <p>Songs you listen to show up here.</p>
      </div>
    );
  return (
    <div className="empty">
      <h2>This playlist is empty</h2>
      <p>Open the ••• menu on any song and choose “Add to playlist”.</p>
      <button className="btn" onClick={() => go({ kind: "songs" })}>
        Browse songs
      </button>
    </div>
  );
}

function customLabel(v: View) {
  return v.kind === "playlist" ? "Custom order" : v.kind === "recent" ? "Last played" : v.kind === "liked" ? "Recently liked" : "Recently added";
}

export { addToPlaylistItems };
