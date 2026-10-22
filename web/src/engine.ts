// Owns the single <audio> element and keeps it in sync with the store.
import { blobUrl, blobUrlNow } from "./lib/db";
import { useStore } from "./store";
import { toast } from "./toast";

export const audio = new Audio();
audio.preload = "auto";

type Listener = () => void;
const timeListeners = new Set<Listener>();
export function onTime(fn: Listener) {
  timeListeners.add(fn);
  return () => void timeListeners.delete(fn);
}

// React reads the playhead through useSyncExternalStore, which needs the same
// value on every read until we say it changed. Safari's currentTime moves on
// every read while playing, which sent React into an endless re-render (error #185).
let snapshot = "0|NaN";
export const playheadSnapshot = () => snapshot;
function tick() {
  snapshot = `${audio.currentTime}|${audio.duration}`;
  timeListeners.forEach((f) => f());
}

let loadedId: string | null = null;
let loadedNonce = -1;
let countedFor: string | null = null; // play counted once per start, after 10s or half the track
let lastTime = 0;
let saveTick = 0;
let finished = false; // the list ran out with repeat off; a seek or play starts it again

function play() {
  audio.play().catch((e: DOMException) => {
    // AbortError just means another track was loaded before this one started
    if (e.name !== "AbortError") useStore.getState().setPlaying(false);
  });
}

function load(id: string, nonce: number, startAt: number, autoplay: boolean) {
  loadedId = id;
  loadedNonce = nonce;
  countedFor = null;
  // Switch in this same task when the audio is already resolved: after "ended" in a
  // background tab or on a locked phone, the browser may suspend us before an
  // IndexedDB read comes back, and the next song would never start.
  const now = blobUrlNow("audio", id);
  if (now !== undefined) return attach(id, now, startAt, autoplay);
  blobUrl("audio", id).then((url) => {
    if (loadedId === id && loadedNonce === nonce) attach(id, url, startAt, autoplay);
  });
}

function attach(id: string, url: string | null, startAt: number, autoplay: boolean) {
  if (!url) {
    useStore.getState().setPlaying(false);
    toast("This song's audio isn't saved on this device anymore. Delete it and add the link again.");
    return;
  }
  if (audio.src !== url) audio.src = url;
  try {
    audio.currentTime = startAt;
  } catch {
    /* metadata not loaded yet; handled below */
  }
  if (startAt) audio.addEventListener("loadedmetadata", () => loadedId === id && (audio.currentTime = startAt), { once: true });
  if (autoplay) play();
  updateMediaSession();
  prefetchNext();
}

/** Resolves the audio that plays after this one, so load() can switch to it synchronously. */
function prefetchNext() {
  const s = useStore.getState();
  const next = s.userQueue[0] ?? s.contextIds[s.pos + 1] ?? (s.repeat === "all" ? s.contextIds[0] : undefined);
  if (next) blobUrl("audio", next);
}

export function initEngine() {
  const s0 = useStore.getState();
  // Resolve every song's audio up front so a tap can start playback in the same
  // task; iOS only lets audio start inside the tap itself.
  s0.order.forEach((id) => blobUrl("audio", id));
  audio.volume = s0.muted ? 0 : s0.volume;
  audio.playbackRate = s0.rate;
  audio.loop = s0.repeat === "one";
  if (s0.currentId) {
    useStore.setState({ playing: false });
    load(s0.currentId, s0.nonce, s0.resumeAt, false);
  }

  useStore.subscribe((s, p) => {
    if (s.currentId && (s.currentId !== loadedId || s.nonce !== loadedNonce)) {
      load(s.currentId, s.nonce, s.resumeAt, s.playing);
    } else if (!s.currentId && loadedId) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      loadedId = null;
    } else if (s.playing !== p.playing) {
      if (s.playing) play();
      else audio.pause();
    }
    if (s.volume !== p.volume || s.muted !== p.muted) audio.volume = s.muted ? 0 : s.volume;
    if (s.rate !== p.rate) audio.playbackRate = s.rate;
    // repeat-one loops natively, so it keeps going even when the page's scripts are paused
    if (s.repeat !== p.repeat) audio.loop = s.repeat === "one";
    if (s.userQueue !== p.userQueue || s.contextIds !== p.contextIds || s.repeat !== p.repeat) prefetchNext();
    if (s.tracks !== p.tracks && s.currentId && s.tracks[s.currentId] !== p.tracks[s.currentId]) updateMediaSession();
    if (s.order !== p.order) s.order.forEach((id) => blobUrl("audio", id));
  });

  audio.addEventListener("timeupdate", () => {
    tick();
    const s = useStore.getState();
    const id = s.currentId;
    if (audio.currentTime + 1 < lastTime) countedFor = null; // looped (or seeked back): counts as another play
    lastTime = audio.currentTime;
    if (id && countedFor !== id && (audio.currentTime > 10 || (audio.duration && audio.currentTime > audio.duration / 2))) {
      countedFor = id;
      s.markPlayed(id);
    }
    if (++saveTick % 8 === 0) useStore.setState({ resumeAt: audio.currentTime });
    if ("mediaSession" in navigator && audio.duration && isFinite(audio.duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          position: Math.min(audio.currentTime, audio.duration),
          playbackRate: audio.playbackRate,
        });
      } catch {
        /* ignore */
      }
    }
  });
  for (const ev of ["seeked", "loadedmetadata", "emptied", "play", "pause"]) audio.addEventListener(ev, tick);
  audio.addEventListener("durationchange", () => {
    tick();
    const s = useStore.getState();
    const t = s.currentId ? s.tracks[s.currentId] : null;
    if (t && isFinite(audio.duration) && Math.abs(t.duration - audio.duration) > 1) s.updateTrack(t.id, { duration: audio.duration });
  });
  audio.addEventListener("ended", () => {
    const s = useStore.getState();
    if (s.repeat === "one") {
      // audio.loop normally handles this; kept for browsers that fire ended anyway
      audio.currentTime = 0;
      play();
      return;
    }
    s.next(true);
    finished = !useStore.getState().playing;
  });
  audio.addEventListener("pause", () => {
    if (!audio.ended && useStore.getState().playing) useStore.getState().setPlaying(false);
    setSessionState("paused");
  });
  audio.addEventListener("play", () => {
    finished = false;
    if (!useStore.getState().playing) useStore.getState().setPlaying(true);
    setSessionState("playing");
  });
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    useStore.getState().setPlaying(false);
    toast("This song couldn't be played in this browser. If it keeps happening, delete it and add the link again.");
  });

  window.addEventListener("pagehide", () => useStore.setState({ resumeAt: audio.currentTime }));

  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    const st = () => useStore.getState();
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      // headphone/lock-screen play also has to work after the list ran out
      ["play", () => st().togglePlay(true)],
      ["pause", () => st().setPlaying(false)],
      ["stop", () => (st().setPlaying(false), seek(0))],
      ["nexttrack", () => st().next()],
      ["previoustrack", () => previous()],
      ["seekto", (d) => d.seekTime != null && seek(d.seekTime)],
      ["seekbackward", (d) => seek(audio.currentTime - (d.seekOffset || 10))],
      ["seekforward", (d) => seek(audio.currentTime + (d.seekOffset || 10))],
    ];
    for (const [action, fn] of handlers) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* action not supported by this browser */
      }
    }
  }
}

function setSessionState(state: MediaSessionPlaybackState) {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state;
}

export function seek(t: number) {
  const s = useStore.getState();
  const d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (s.currentId && s.tracks[s.currentId]?.duration) || 0;
  if (!d || !audio.getAttribute("src")) return;
  audio.currentTime = Math.max(0, Math.min(t, d - 0.05));
  // dragging the playhead after the song finished should play from there
  if (finished && !s.playing) s.setPlaying(true);
  tick();
}

export function previous() {
  if (useStore.getState().prev(audio.currentTime) === "restart") seek(0);
}

async function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const s = useStore.getState();
  const t = s.currentId ? s.tracks[s.currentId] : null;
  if (!t) return;
  const art = t.hasCover ? await blobUrl("covers", t.id) : null;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: s.context?.label ?? "Instahits",
    artwork: art ? [{ src: art, sizes: "512x512", type: "image/jpeg" }] : [],
  });
}
