import { Heart, Library, ListMusic, MoreHorizontal } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { AddBar } from "./components/AddBar";
import { NowPlaying } from "./components/NowPlaying";
import { DialogHost, MenuHost, Toasts } from "./components/Overlays";
import { MiniPlayer, PlayerBar } from "./components/PlayerBar";
import { PlaylistsView } from "./components/PlaylistsView";
import { QueuePanel } from "./components/QueuePanel";
import { Sidebar } from "./components/Sidebar";
import { TrackView } from "./components/TrackView";
import { cycleRepeat, libraryMenu, moveToInstahits } from "./actions";
import { audio, previous, seek } from "./engine";
import { useMedia } from "./hooks";
import { onOldSite, receiveLibraryFromOldSite } from "./lib/backup";
import { extractLinks, importFiles, importLink, refreshOldTracks } from "./importer";
import { useStore, type View } from "./store";
import { toast } from "./toast";

export default function App() {
  const view = useStore((s) => s.view);
  const queueOpen = useStore((s) => s.queueOpen);
  const tint = useStore((s) => (s.currentId ? s.tracks[s.currentId]?.tint : undefined));
  const hasTrack = useStore((s) => !!s.currentId);
  const mobile = useMedia("(max-width: 760px)");
  const [dropping, setDropping] = useState(false);

  useShortcuts();
  useEffect(() => void refreshOldTracks(), []);
  useEffect(
    () =>
      receiveLibraryFromOldSite((n) =>
        toast(n ? `Your ${n} ${n === 1 ? "song is" : "songs are"} here now. Welcome to Instahits!` : "Your songs were already here.", { ms: 8000 }),
      ),
    [],
  );

  // Paste a link anywhere on the page to add it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable]")) return;
      const links = extractLinks(e.clipboardData?.getData("text") ?? "");
      if (links.length) {
        e.preventDefault();
        links.forEach(importLink);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const style = (tint ? { "--tint": tint } : {}) as CSSProperties;

  return (
    <div
      className={`app ${queueOpen && !mobile ? "with-queue" : ""} ${hasTrack ? "has-track" : ""} ${tint ? "tinted" : ""}`}
      style={style}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setDropping(false);
      }}
      onDrop={(e) => {
        if (!dropping) return;
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
        else {
          const links = extractLinks(e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text"));
          if (links.length) links.forEach(importLink);
          else toast("Drop an Instagram or X link, or an audio file.");
        }
      }}
    >
      {!mobile && <Sidebar />}
      <main className="main">
        {mobile && <MobileTop />}
        {onOldSite() && <MoveBanner />}
        <AddBar />
        {view.kind === "playlists" ? <PlaylistsView /> : <TrackView key={JSON.stringify(view)} view={view} />}
      </main>
      {queueOpen && !mobile && <QueuePanel onClose={() => useStore.getState().setQueueOpen(false)} />}
      {mobile ? (
        <div className="mobile-dock">
          <MiniPlayer />
          <MobileNav view={view} />
        </div>
      ) : (
        <PlayerBar />
      )}
      <NowPlaying />
      <MenuHost />
      <DialogHost />
      <Toasts />
      {dropping && (
        <div className="dropzone">
          <p>Drop to add</p>
        </div>
      )}
    </div>
  );
}

function MobileTop() {
  return (
    <div className="mobile-top">
      <div className="brand">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
          <path d="M7 21c0-5 4-10 9-10s9 5 9 10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="16" cy="21" r="2.8" fill="currentColor" />
        </svg>
        Instahits
      </div>
      <button className="icon-btn" onClick={(e) => libraryMenu(e.currentTarget.getBoundingClientRect())} aria-label="Library options" title="Back up or restore your songs">
        <MoreHorizontal size={20} />
      </button>
    </div>
  );
}

/** Only on the old earworm-steel address: carry the library over to Instahits. */
function MoveBanner() {
  return (
    <div className="move-banner">
      <p>
        <strong>Earworm is now Instahits.</strong> Your songs are saved on this address; move them to instahits.vercel.app in one tap.
      </p>
      <button className="btn primary" onClick={moveToInstahits}>
        Move my songs
      </button>
    </div>
  );
}

function MobileNav({ view }: { view: View }) {
  const go = useStore((s) => s.go);
  const tabs: { v: View; label: string; icon: React.ReactNode; on: boolean }[] = [
    { v: { kind: "songs" }, label: "Songs", icon: <Library size={20} strokeWidth={1.75} />, on: view.kind === "songs" || view.kind === "recent" },
    { v: { kind: "liked" }, label: "Liked", icon: <Heart size={20} strokeWidth={1.75} />, on: view.kind === "liked" },
    { v: { kind: "playlists" }, label: "Playlists", icon: <ListMusic size={20} strokeWidth={1.75} />, on: view.kind === "playlists" || view.kind === "playlist" },
  ];
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <button key={t.label} className={t.on ? "on" : ""} onClick={() => go(t.v)} aria-current={t.on ? "page" : undefined}>
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], dialog") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".menu")) return;
      const s = useStore.getState();
      switch (e.key) {
        case " ":
          if (el.closest("button, [role=slider]")) return;
          s.togglePlay();
          break;
        case "ArrowRight":
          if (el.closest("[role=slider]")) return;
          e.shiftKey ? s.next() : seek(audio.currentTime + 5);
          break;
        case "ArrowLeft":
          if (el.closest("[role=slider]")) return;
          e.shiftKey ? previous() : seek(audio.currentTime - 5);
          break;
        case "ArrowUp":
          if (el.closest("[role=row], [role=slider]")) return;
          s.setVolume((s.muted ? 0 : s.volume) + 0.05);
          break;
        case "ArrowDown":
          if (el.closest("[role=row], [role=slider]")) return;
          s.setVolume((s.muted ? 0 : s.volume) - 0.05);
          break;
        case "m":
        case "M":
          s.toggleMute();
          break;
        case "l":
        case "L":
          if (s.currentId) s.toggleLike(s.currentId);
          break;
        case "s":
        case "S":
          s.toggleShuffle();
          break;
        case "r":
        case "R":
          cycleRepeat();
          break;
        case "q":
        case "Q":
          s.setQueueOpen(!s.queueOpen);
          break;
        case "/":
          document.getElementById("filter-input")?.focus();
          break;
        case "Escape":
          if (s.nowPlayingOpen) s.setNowPlayingOpen(false);
          return;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
