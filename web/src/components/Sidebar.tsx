import { Clock3, Heart, Library, Plus, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { newPlaylist } from "../actions";
import { fmtBytes } from "../lib/util";
import { storageEstimate } from "../lib/db";
import { sameView, useStore, type View } from "../store";
import { toast } from "../toast";
import { ask, openMenu } from "../ui";

const I = { size: 18, strokeWidth: 1.75 };

export function Sidebar() {
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const playlists = useStore((s) => s.playlists);
  const songs = useStore((s) => s.order.length);
  const liked = useStore((s) => Object.keys(s.liked).filter((id) => s.tracks[id]).length);
  const ctx = useStore((s) => (s.playing ? s.context?.view : null));

  const Item = ({ v, icon, label, n }: { v: View; icon: React.ReactNode; label: string; n?: number }) => (
    <button className={`nav-item ${sameView(view, v) ? "on" : ""}`} onClick={() => go(v)}>
      {icon}
      <span className="nav-label">{label}</span>
      {ctx && sameView(ctx, v) ? <Volume2 size={14} strokeWidth={2} className="nav-playing" /> : n ? <span className="nav-count">{n}</span> : null}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <path d="M7 21c0-5 4-10 9-10s9 5 9 10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="16" cy="21" r="2.8" fill="currentColor" />
        </svg>
        Earworm
      </div>

      <nav className="nav">
        <Item v={{ kind: "songs" }} icon={<Library {...I} />} label="Songs" n={songs} />
        <Item v={{ kind: "liked" }} icon={<Heart {...I} />} label="Liked" n={liked} />
        <Item v={{ kind: "recent" }} icon={<Clock3 {...I} />} label="Recently played" />
      </nav>

      <div className="side-head">
        <button className="side-title" onClick={() => go({ kind: "playlists" })}>
          Playlists
        </button>
        <button className="icon-btn sm" onClick={() => newPlaylist()} aria-label="New playlist" title="New playlist">
          <Plus size={16} strokeWidth={2} />
        </button>
      </div>
      <div className="playlist-nav">
        {playlists.length === 0 && <p className="side-empty">Group songs you replay together.</p>}
        {playlists.map((p) => (
          <button
            key={p.id}
            className={`nav-item pl ${view.kind === "playlist" && view.id === p.id ? "on" : ""}`}
            onClick={() => go({ kind: "playlist", id: p.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              playlistMenu(e, p.id);
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("text/earworm-track")) return;
              e.preventDefault();
              e.currentTarget.classList.add("drop");
            }}
            onDragLeave={(e) => e.currentTarget.classList.remove("drop")}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("drop");
              const id = e.dataTransfer.getData("text/earworm-track");
              if (!id) return;
              const n = useStore.getState().addToPlaylist(p.id, [id]);
              toast(n ? `Added to ${p.name}.` : `Already in ${p.name}.`);
            }}
          >
            <span className="nav-label">{p.name}</span>
            {ctx?.kind === "playlist" && ctx.id === p.id ? (
              <Volume2 size={14} strokeWidth={2} className="nav-playing" />
            ) : (
              <span className="nav-count">{p.trackIds.length}</span>
            )}
          </button>
        ))}
      </div>
      <Storage />
    </aside>
  );
}

function Storage() {
  const n = useStore((s) => s.order.length);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    storageEstimate().then(setEst);
  }, [n]);
  if (!est || !n) return null;
  return <div className="storage">{fmtBytes(est.usage)} saved on this device</div>;
}

export function playlistMenu(e: { clientX: number; clientY: number } | DOMRect, id: string) {
  const s = useStore.getState();
  const p = s.playlists.find((x) => x.id === id);
  if (!p) return;
  openMenu(e, [
    {
      label: "Rename",
      run: async () => {
        const r = await ask({ title: "Rename playlist", fields: [{ name: "name", label: "Name", value: p.name }], confirm: "Save" });
        if (r?.name.trim()) useStore.getState().renamePlaylist(id, r.name.trim());
      },
    },
    {
      label: "Add to queue",
      disabled: !p.trackIds.length,
      run: () => useStore.getState().addToQueue(p.trackIds.filter((t) => useStore.getState().tracks[t])),
    },
    "sep",
    {
      label: "Delete playlist",
      danger: true,
      run: async () => {
        const r = await ask({
          title: `Delete ${p.name}?`,
          body: "The songs stay in your library.",
          confirm: "Delete",
          danger: true,
        });
        if (r) useStore.getState().deletePlaylist(id);
      },
    },
  ]);
}
