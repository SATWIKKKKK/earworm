// Moving a whole library somewhere else. Browsers keep each site's storage
// separate, so after the move from earworm-steel.vercel.app to
// instahits.vercel.app the songs have to be carried over: either handed from
// the old tab to the new one with postMessage, or through a backup file.

import { useStore, type Playlist, type Track } from "../store";
import { db } from "./db";

export const OLD_ORIGIN = "https://earworm-steel.vercel.app";
export const NEW_ORIGIN = "https://instahits.vercel.app";
export const onOldSite = () => location.origin === OLD_ORIGIN;

interface LibraryState {
  tracks: Record<string, Track>;
  order: string[];
  liked: Record<string, number>;
  playlists: Playlist[];
}
interface FileEntry {
  store: "audio" | "covers";
  id: string;
}
export interface Library {
  state: LibraryState;
  files: (FileEntry & { blob: Blob })[];
}

export async function collectLibrary(): Promise<Library> {
  const { tracks, order, liked, playlists } = useStore.getState();
  const files: Library["files"] = [];
  for (const t of Object.values(tracks)) {
    const audio = await db.get("audio", t.id);
    if (audio) files.push({ store: "audio", id: t.id, blob: audio });
    const cover = t.hasCover ? await db.get("covers", t.id) : undefined;
    if (cover) files.push({ store: "covers", id: t.id, blob: cover });
  }
  return { state: { tracks, order, liked, playlists }, files };
}

/** Adds a library to this one; songs already here are skipped. Returns how many songs were added. */
export async function restoreLibrary(lib: Library): Promise<number> {
  const s = useStore.getState();
  const have = new Set(Object.values(s.tracks).map((t) => t.url ?? t.id));
  const audioIds = new Set(lib.files.filter((f) => f.store === "audio").map((f) => f.id));
  const fresh = Object.values(lib.state.tracks).filter((t) => !s.tracks[t.id] && !have.has(t.url ?? t.id) && audioIds.has(t.id));
  const freshIds = new Set(fresh.map((t) => t.id));
  for (const f of lib.files) if (freshIds.has(f.id)) await db.put(f.store, f.id, f.blob);

  useStore.setState((cur) => {
    const tracks = { ...cur.tracks };
    fresh.forEach((t) => (tracks[t.id] = t));
    const order = [...cur.order, ...lib.state.order.filter((id) => freshIds.has(id))].sort((a, b) => tracks[b].addedAt - tracks[a].addedAt);
    const liked = { ...cur.liked };
    for (const [id, at] of Object.entries(lib.state.liked)) if (freshIds.has(id)) liked[id] = at;
    const known = new Set(cur.playlists.map((p) => p.id));
    const playlists = [
      ...cur.playlists,
      ...lib.state.playlists.filter((p) => !known.has(p.id)).map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => tracks[id]) })),
    ];
    return { tracks, order, liked, playlists };
  });
  return fresh.length;
}

// ---------- backup file: [4-byte header length][JSON header][file bytes...] ----------

const MAGIC = "instahits-backup-1";

export function packLibrary(lib: Library): Blob {
  const header = new TextEncoder().encode(
    JSON.stringify({ magic: MAGIC, state: lib.state, files: lib.files.map((f) => ({ store: f.store, id: f.id, type: f.blob.type, size: f.blob.size })) }),
  );
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, header.length);
  return new Blob([len, header, ...lib.files.map((f) => f.blob)], { type: "application/octet-stream" });
}

export async function unpackLibrary(file: Blob): Promise<Library> {
  const bad = new Error("That isn't an Instahits backup file.");
  if (file.size < 4) throw bad;
  const len = new DataView(await file.slice(0, 4).arrayBuffer()).getUint32(0);
  let head: { magic?: string; state: LibraryState; files: (FileEntry & { type: string; size: number })[] };
  try {
    head = JSON.parse(await file.slice(4, 4 + len).text());
  } catch {
    throw bad;
  }
  if (head.magic !== MAGIC) throw bad;
  let at = 4 + len;
  const files = head.files.map((f) => {
    const blob = file.slice(at, at + f.size, f.type);
    at += f.size;
    return { store: f.store, id: f.id, blob };
  });
  return { state: head.state, files };
}

// ---------- hand-off from the old address to the new one ----------

const READY = "instahits:ready";
const LIBRARY = "instahits:library";
const RECEIVED = "instahits:received";

/** On the old site, inside a tap: opens Instahits and hands it the library. */
export function sendLibraryToNewSite(done: (count: number) => void, failed: (why: string) => void) {
  const opened = window.open(`${NEW_ORIGIN}/#receive-library`, "_blank");
  if (!opened) return failed("Your browser blocked the new tab. Allow pop-ups for this site and try again.");
  const win: Window = opened;
  const lib = collectLibrary();
  const timer = setTimeout(() => {
    removeEventListener("message", onMessage);
    failed("Instahits didn't answer. Check your connection and try again.");
  }, 60_000);
  async function onMessage(e: MessageEvent) {
    if (e.origin !== NEW_ORIGIN || e.source !== win) return;
    if (e.data?.type === READY) win.postMessage({ type: LIBRARY, lib: await lib }, NEW_ORIGIN);
    else if (e.data?.type === RECEIVED) {
      clearTimeout(timer);
      removeEventListener("message", onMessage);
      done(Number(e.data.count) || 0);
    }
  }
  addEventListener("message", onMessage);
}

/** On the new site: if the old site opened us to move a library, take it. */
export function receiveLibraryFromOldSite(onReceived: (count: number) => void) {
  if (location.origin !== NEW_ORIGIN || location.hash !== "#receive-library" || !window.opener) return;
  history.replaceState(history.state, "", location.pathname);
  addEventListener("message", async function onMessage(e: MessageEvent) {
    if (e.origin !== OLD_ORIGIN || e.data?.type !== LIBRARY) return;
    removeEventListener("message", onMessage);
    const count = await restoreLibrary(e.data.lib as Library);
    (e.source as Window | null)?.postMessage({ type: RECEIVED, count }, OLD_ORIGIN);
    onReceived(count);
  });
  window.opener.postMessage({ type: READY }, OLD_ORIGIN);
}
