import { Plus } from "lucide-react";
import { newPlaylist } from "../actions";
import { useStore } from "../store";
import { Cover } from "./bits";
import { playlistMenu } from "./Sidebar";

export function PlaylistsView() {
  const playlists = useStore((s) => s.playlists);
  const tracks = useStore((s) => s.tracks);
  const go = useStore((s) => s.go);

  return (
    <section className="view">
      <header className="view-head">
        <div className="view-titles">
          <h1>Playlists</h1>
          <p className="meta">{playlists.length === 0 ? "None yet" : `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}`}</p>
        </div>
      </header>
      <div className="pl-grid">
        {playlists.map((p) => {
          const ts = p.trackIds.map((id) => tracks[id]).filter(Boolean);
          return (
            <button
              key={p.id}
              className="pl-tile"
              onClick={() => go({ kind: "playlist", id: p.id })}
              onContextMenu={(e) => {
                e.preventDefault();
                playlistMenu(e, p.id);
              }}
            >
              <div className={`mosaic ${ts.length < 4 ? "one" : ""}`}>
                {ts.length < 4 ? <Cover track={ts[0] ?? null} /> : ts.slice(0, 4).map((t) => <Cover key={t.id} track={t} />)}
              </div>
              <span className="pl-name">{p.name}</span>
              <span className="pl-count">{ts.length === 1 ? "1 song" : `${ts.length} songs`}</span>
            </button>
          );
        })}
        <button className="pl-tile new" onClick={() => newPlaylist()}>
          <div className="mosaic one new-art">
            <Plus size={28} strokeWidth={1.5} />
          </div>
          <span className="pl-name">New playlist</span>
        </button>
      </div>
    </section>
  );
}
