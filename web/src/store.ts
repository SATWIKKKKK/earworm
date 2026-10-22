import { create } from "zustand";
import { persist } from "zustand/middleware";
import { db, forgetUrl } from "./lib/db";
import { shuffled, uid } from "./lib/util";

export type Source = "instagram" | "x" | "file";

export interface Track {
  id: string;
  title: string;
  artist: string;
  handle?: string;
  source: Source;
  url?: string;
  duration: number;
  addedAt: number;
  plays: number;
  lastPlayedAt?: number;
  hasCover: boolean;
  tint?: string; // "hue sat%"
  size?: number;
  caption?: string; // the post's text, when the title is something else
  song?: boolean; // title/artist name a real song (Instagram's tag or Shazam), not the caption
  edited?: boolean; // the user renamed it; never overwrite
  named?: number; // NAMING version the track was last refreshed with (missing on old tracks)
  video?: boolean; // the saved file is the post's video (with sound), not audio only
}

/** Bump to refresh tracks saved by an older version (names, and Instagram media:
 * v2 replaces the fragmented audio-only files iPhones can't play with the video). */
export const NAMING = 2;

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export type View =
  | { kind: "songs" }
  | { kind: "liked" }
  | { kind: "recent" }
  | { kind: "playlists" }
  | { kind: "playlist"; id: string };

export type Repeat = "off" | "all" | "one";

export interface PlayContext {
  label: string;
  view: View;
}

interface State {
  // library
  tracks: Record<string, Track>;
  order: string[]; // newest first
  liked: Record<string, number>;
  playlists: Playlist[];

  // navigation
  view: View;
  queueOpen: boolean;
  nowPlayingOpen: boolean;

  // playback
  currentId: string | null;
  context: PlayContext | null;
  contextIds: string[]; // play order (shuffled when shuffle is on)
  contextBase: string[]; // original order
  pos: number; // index of current within contextIds (-1 if playing from the user queue)
  userQueue: string[];
  history: string[];
  playing: boolean;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  muted: boolean;
  rate: number;
  resumeAt: number;
  nonce: number; // bumps whenever a track (re)starts

  // library actions
  addTrack: (t: Track) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  deleteTrack: (id: string) => Promise<void>;
  toggleLike: (id: string) => void;
  createPlaylist: (name: string, trackIds?: string[]) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (pid: string, ids: string[]) => number;
  removeFromPlaylist: (pid: string, index: number) => void;
  movePlaylistItem: (pid: string, from: number, to: number) => void;

  // navigation actions
  go: (v: View) => void;
  setQueueOpen: (v: boolean) => void;
  setNowPlayingOpen: (v: boolean) => void;

  // playback actions
  playList: (ids: string[], startId: string | null, ctx: PlayContext, opts?: { shuffle?: boolean }) => void;
  togglePlay: (onlyPlay?: boolean) => void;
  setPlaying: (p: boolean) => void;
  next: (auto?: boolean) => void;
  prev: (currentTime: number) => "restart" | "moved";
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setRate: (r: number) => void;
  addToQueue: (ids: string[]) => void;
  playNext: (ids: string[]) => void;
  removeFromQueue: (i: number) => void;
  clearQueue: () => void;
  jumpToQueued: (i: number) => void;
  jumpToContext: (i: number) => void;
  markPlayed: (id: string) => void;
  setResumeAt: (t: number) => void;
}

const sameView = (a: View, b: View) => a.kind === b.kind && (a.kind !== "playlist" || (b as { id: string }).id === a.id);
export { sameView };

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      tracks: {},
      order: [],
      liked: {},
      playlists: [],
      view: { kind: "songs" },
      queueOpen: false,
      nowPlayingOpen: false,
      currentId: null,
      context: null,
      contextIds: [],
      contextBase: [],
      pos: -1,
      userQueue: [],
      history: [],
      playing: false,
      shuffle: false,
      repeat: "off",
      volume: 0.8,
      muted: false,
      rate: 1,
      resumeAt: 0,
      nonce: 0,

      addTrack: (t) => set((s) => ({ tracks: { ...s.tracks, [t.id]: t }, order: [t.id, ...s.order] })),

      updateTrack: (id, patch) =>
        set((s) => (s.tracks[id] ? { tracks: { ...s.tracks, [id]: { ...s.tracks[id], ...patch } } } : s)),

      deleteTrack: async (id) => {
        const s = get();
        if (s.currentId === id) {
          set({ playing: false });
          get().next();
          if (get().currentId === id) set({ currentId: null, pos: -1, nowPlayingOpen: false });
        }
        const strip = (a: string[]) => a.filter((x) => x !== id);
        set((s) => {
          const tracks = { ...s.tracks };
          delete tracks[id];
          const liked = { ...s.liked };
          delete liked[id];
          const contextIds = strip(s.contextIds);
          const cur = s.currentId;
          return {
            tracks,
            liked,
            order: strip(s.order),
            playlists: s.playlists.map((p) => ({ ...p, trackIds: strip(p.trackIds) })),
            userQueue: strip(s.userQueue),
            history: strip(s.history),
            contextIds,
            contextBase: strip(s.contextBase),
            pos: cur ? contextIds.indexOf(cur) : -1,
          };
        });
        forgetUrl("audio", id);
        forgetUrl("covers", id);
        await Promise.all([db.del("audio", id), db.del("covers", id)]);
      },

      toggleLike: (id) =>
        set((s) => {
          const liked = { ...s.liked };
          if (liked[id]) delete liked[id];
          else liked[id] = Date.now();
          return { liked };
        }),

      createPlaylist: (name, trackIds = []) => {
        const id = uid();
        set((s) => ({ playlists: [...s.playlists, { id, name, trackIds, createdAt: Date.now() }] }));
        return id;
      },
      renamePlaylist: (id, name) =>
        set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)) })),
      deletePlaylist: (id) =>
        set((s) => ({
          playlists: s.playlists.filter((p) => p.id !== id),
          view: s.view.kind === "playlist" && s.view.id === id ? { kind: "playlists" } : s.view,
        })),
      addToPlaylist: (pid, ids) => {
        let added = 0;
        set((s) => ({
          playlists: s.playlists.map((p) => {
            if (p.id !== pid) return p;
            const fresh = ids.filter((i) => !p.trackIds.includes(i));
            added = fresh.length;
            return { ...p, trackIds: [...p.trackIds, ...fresh] };
          }),
        }));
        return added;
      },
      removeFromPlaylist: (pid, index) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === pid ? { ...p, trackIds: p.trackIds.filter((_, i) => i !== index) } : p,
          ),
        })),
      movePlaylistItem: (pid, from, to) =>
        set((s) => ({
          playlists: s.playlists.map((p) => {
            if (p.id !== pid) return p;
            const a = p.trackIds.slice();
            const [x] = a.splice(from, 1);
            a.splice(to, 0, x);
            return { ...p, trackIds: a };
          }),
        })),

      go: (view) => set({ view, nowPlayingOpen: false }),
      setQueueOpen: (queueOpen) => set({ queueOpen }),
      setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),

      playList: (ids, startId, ctx, opts) => {
        if (!ids.length) return;
        const shuffle = opts?.shuffle ?? get().shuffle;
        let order = ids.slice();
        let start = startId ?? (shuffle ? order[Math.floor(Math.random() * order.length)] : order[0]);
        if (shuffle) order = [start, ...shuffled(order.filter((x) => x !== start))];
        pushHistory(get().currentId);
        set({
          context: ctx,
          contextBase: ids.slice(),
          contextIds: order,
          pos: order.indexOf(start),
          currentId: start,
          playing: true,
          shuffle,
          resumeAt: 0,
          nonce: get().nonce + 1,
        });
      },

      togglePlay: (onlyPlay = false) => {
        const s = get();
        if (!s.currentId) {
          const ids = s.order;
          if (ids.length) get().playList(ids, null, { label: "Songs", view: { kind: "songs" } });
          return;
        }
        set({ playing: onlyPlay || !s.playing });
      },
      setPlaying: (playing) => set({ playing }),

      next: (auto = false) => {
        const s = get();
        if (auto && s.repeat === "one" && s.currentId) {
          set({ resumeAt: 0, playing: true, currentId: s.currentId });
          return;
        }
        pushHistory(s.currentId);
        if (s.userQueue.length) {
          const [head, ...rest] = s.userQueue;
          set({ currentId: head, userQueue: rest, playing: true, resumeAt: 0, nonce: get().nonce + 1 });
          return;
        }
        const n = s.pos + 1;
        if (n < s.contextIds.length) {
          set({ pos: n, currentId: s.contextIds[n], playing: true, resumeAt: 0, nonce: get().nonce + 1 });
        } else if (s.contextIds.length && (s.repeat === "all" || !auto)) {
          // manual skip at end wraps like Spotify does with repeat off, but stops playback.
          // The order is kept (even shuffled) so the engine can have the first song ready.
          set({ pos: 0, currentId: s.contextIds[0], playing: s.repeat === "all", resumeAt: 0, nonce: get().nonce + 1 });
        } else {
          set({ playing: false, resumeAt: 0, nonce: get().nonce + 1 });
        }
      },

      prev: (t) => {
        const s = get();
        if (t > 3 || !s.currentId) return "restart";
        if (s.pos > 0) {
          set({ pos: s.pos - 1, currentId: s.contextIds[s.pos - 1], playing: true, resumeAt: 0, nonce: get().nonce + 1 });
          return "moved";
        }
        const h = s.history.at(-1);
        if (h && s.tracks[h]) {
          set({ currentId: h, history: s.history.slice(0, -1), playing: true, resumeAt: 0, nonce: get().nonce + 1 });
          return "moved";
        }
        return "restart";
      },

      toggleShuffle: () =>
        set((s) => {
          const shuffle = !s.shuffle;
          if (!s.contextBase.length) return { shuffle };
          const cur = s.currentId;
          let order: string[];
          if (shuffle) order = cur && s.contextBase.includes(cur) ? [cur, ...shuffled(s.contextBase.filter((x) => x !== cur))] : shuffled(s.contextBase);
          else order = s.contextBase.slice();
          return { shuffle, contextIds: order, pos: cur ? order.indexOf(cur) : -1 };
        }),

      // one before all: "loop" most often means "play this again"
      cycleRepeat: () => set((s) => ({ repeat: s.repeat === "off" ? "one" : s.repeat === "one" ? "all" : "off" })),
      setVolume: (v) => set({ volume: Math.min(1, Math.max(0, v)), muted: v <= 0 }),
      toggleMute: () => set((s) => ({ muted: !s.muted, volume: s.muted && s.volume === 0 ? 0.5 : s.volume })),
      setRate: (rate) => set({ rate }),

      addToQueue: (ids) => set((s) => ({ userQueue: [...s.userQueue, ...ids] })),
      playNext: (ids) => set((s) => ({ userQueue: [...ids, ...s.userQueue] })),
      removeFromQueue: (i) => set((s) => ({ userQueue: s.userQueue.filter((_, j) => j !== i) })),
      clearQueue: () => set({ userQueue: [] }),
      jumpToQueued: (i) => {
        const s = get();
        pushHistory(s.currentId);
        set({ currentId: s.userQueue[i], userQueue: s.userQueue.slice(i + 1), playing: true, resumeAt: 0, nonce: get().nonce + 1 });
      },
      jumpToContext: (i) => {
        const s = get();
        pushHistory(s.currentId);
        set({ pos: i, currentId: s.contextIds[i], playing: true, resumeAt: 0, nonce: get().nonce + 1 });
      },

      markPlayed: (id) =>
        set((s) =>
          s.tracks[id]
            ? { tracks: { ...s.tracks, [id]: { ...s.tracks[id], plays: s.tracks[id].plays + 1, lastPlayedAt: Date.now() } } }
            : s,
        ),
      setResumeAt: (resumeAt) => set({ resumeAt }),
    }),
    {
      name: "earworm",
      version: 1,
      partialize: (s) => ({
        tracks: s.tracks,
        order: s.order,
        liked: s.liked,
        playlists: s.playlists,
        view: s.view,
        currentId: s.currentId,
        context: s.context,
        contextIds: s.contextIds,
        contextBase: s.contextBase,
        pos: s.pos,
        userQueue: s.userQueue,
        shuffle: s.shuffle,
        repeat: s.repeat,
        volume: s.volume,
        muted: s.muted,
        rate: s.rate,
        resumeAt: s.resumeAt,
        queueOpen: s.queueOpen,
      }),
    },
  ),
);

function pushHistory(id: string | null) {
  if (!id) return;
  const h = useStore.getState().history;
  useStore.setState({ history: [...h.slice(-49), id] });
}

// ---------- derived helpers ----------

export function idsForView(s: Pick<State, "order" | "liked" | "playlists" | "tracks">, v: View): string[] {
  switch (v.kind) {
    case "songs":
      return s.order;
    case "liked":
      return Object.entries(s.liked)
        .filter(([id]) => s.tracks[id])
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
    case "recent":
      return Object.values(s.tracks)
        .filter((t) => t.lastPlayedAt)
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
        .slice(0, 50)
        .map((t) => t.id);
    case "playlist":
      return s.playlists.find((p) => p.id === v.id)?.trackIds.filter((id) => s.tracks[id]) ?? [];
    default:
      return [];
  }
}

export function viewLabel(s: Pick<State, "playlists">, v: View) {
  switch (v.kind) {
    case "songs":
      return "Songs";
    case "liked":
      return "Liked";
    case "recent":
      return "Recently played";
    case "playlists":
      return "Playlists";
    case "playlist":
      return s.playlists.find((p) => p.id === v.id)?.name ?? "Playlist";
  }
}
