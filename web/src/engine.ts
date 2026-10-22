// Owns the single <audio> element and keeps it in sync with the store.
import { blobUrl } from "./lib/db";
import { useStore } from "./store";

export const audio = new Audio();
audio.preload = "auto";

type Listener = () => void;
const timeListeners = new Set<Listener>();
export function onTime(fn: Listener) {
  timeListeners.add(fn);
  return () => void timeListeners.delete(fn);
}

let loadedId: string | null = null;
let loadedNonce = -1;
let countedFor: string | null = null; // play counted once per start, after 10s or half the track
let saveTick = 0;

async function load(id: string, nonce: number, startAt: number, autoplay: boolean) {
  loadedId = id;
  loadedNonce = nonce;
  countedFor = null;
  const url = await blobUrl("audio", id);
  if (loadedId !== id || loadedNonce !== nonce) return; // superseded
  if (!url) {
    useStore.getState().setPlaying(false);
    return;
  }
  if (audio.src !== url) audio.src = url;
  try {
    audio.currentTime = startAt;
  } catch {
    /* metadata not loaded yet; handled below */
  }
  if (startAt) audio.addEventListener("loadedmetadata", () => (audio.currentTime = startAt), { once: true });
  if (autoplay) audio.play().catch(() => useStore.getState().setPlaying(false));
  updateMediaSession();
}

export function initEngine() {
  const s0 = useStore.getState();
  audio.volume = s0.muted ? 0 : s0.volume;
  audio.playbackRate = s0.rate;
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
      if (s.playing) audio.play().catch(() => useStore.getState().setPlaying(false));
      else audio.pause();
    }
    if (s.volume !== p.volume || s.muted !== p.muted) audio.volume = s.muted ? 0 : s.volume;
    if (s.rate !== p.rate) audio.playbackRate = s.rate;
    if (s.tracks !== p.tracks && s.currentId && s.tracks[s.currentId] !== p.tracks[s.currentId]) updateMediaSession();
  });

  audio.addEventListener("timeupdate", () => {
    timeListeners.forEach((f) => f());
    const s = useStore.getState();
    const id = s.currentId;
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
  audio.addEventListener("durationchange", () => {
    timeListeners.forEach((f) => f());
    const s = useStore.getState();
    const t = s.currentId ? s.tracks[s.currentId] : null;
    if (t && isFinite(audio.duration) && Math.abs(t.duration - audio.duration) > 1) s.updateTrack(t.id, { duration: audio.duration });
  });
  audio.addEventListener("ended", () => {
    const s = useStore.getState();
    if (s.repeat === "one") {
      audio.currentTime = 0;
      countedFor = null;
      audio.play();
    } else s.next(true);
  });
  audio.addEventListener("pause", () => {
    if (!audio.ended && useStore.getState().playing) useStore.getState().setPlaying(false);
  });
  audio.addEventListener("play", () => {
    if (!useStore.getState().playing) useStore.getState().setPlaying(true);
  });

  window.addEventListener("pagehide", () => useStore.setState({ resumeAt: audio.currentTime }));

  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    const st = () => useStore.getState();
    ms.setActionHandler("play", () => st().setPlaying(true));
    ms.setActionHandler("pause", () => st().setPlaying(false));
    ms.setActionHandler("nexttrack", () => st().next());
    ms.setActionHandler("previoustrack", () => previous());
    ms.setActionHandler("seekto", (d) => d.seekTime != null && seek(d.seekTime));
    ms.setActionHandler("seekbackward", (d) => seek(audio.currentTime - (d.seekOffset || 10)));
    ms.setActionHandler("seekforward", (d) => seek(audio.currentTime + (d.seekOffset || 10)));
  }
}

export function seek(t: number) {
  if (!isFinite(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(t, audio.duration - 0.05));
  timeListeners.forEach((f) => f());
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
    album: s.context?.label ?? "Earworm",
    artwork: art ? [{ src: art, sizes: "512x512", type: "image/jpeg" }] : [],
  });
}
