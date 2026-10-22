import { create } from "zustand";
import { blobUrl, db, dropUrl, requestPersistence } from "./lib/db";
import { identifySong } from "./lib/identify";
import { coverColor, probeDuration, uid } from "./lib/util";
import { NAMING, useStore, type Source, type Track } from "./store";
import { toast } from "./toast";

export interface Job {
  id: string;
  label: string;
  source: Source;
  state: "working" | "error";
  error?: string;
  url?: string;
}

export const useJobs = create<{ jobs: Job[] }>(() => ({ jobs: [] }));

const setJob = (id: string, patch: Partial<Job>) =>
  useJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
export const dismissJob = (id: string) => useJobs.setState((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));

function sourceOf(url: string): Source | null {
  try {
    const h = new URL(url).hostname.replace(/^(www|m|mobile)\./, "");
    if (h === "instagram.com" || h === "instagr.am") return "instagram";
    if (h === "twitter.com" || h === "x.com") return "x";
  } catch {
    /* fallthrough */
  }
  return null;
}

/** Links to a single post (not a profile, search or home page). */
function isPostLink(url: string, source: Source) {
  try {
    const path = new URL(url).pathname;
    return source === "x" ? /\/status(es)?\/\d+/.test(path) : /\/(p|reel|reels|tv|stories)\/[^/]+/.test(path);
  } catch {
    return false;
  }
}

export function normalizeLink(raw: string) {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}

/** Splits pasted text into links (supports pasting several at once). */
export function extractLinks(text: string) {
  return Array.from(
    new Set(
      (text.match(/(https?:\/\/)?(www\.|m\.|mobile\.)?(instagram\.com|instagr\.am|twitter\.com|x\.com)\/[^\s<>"']+/gi) ?? []).map(
        normalizeLink,
      ),
    ),
  );
}

export async function importLink(rawUrl: string) {
  const url = normalizeLink(rawUrl);
  const source = sourceOf(url);
  const jobId = uid();
  if (!source) {
    toast("Paste an Instagram or X (Twitter) post link.");
    return;
  }
  if (!isPostLink(url, source)) {
    toast("That's not a link to a post. Open the post, tap Share, then Copy link.");
    return;
  }
  const dupe = Object.values(useStore.getState().tracks).find((t) => t.url && sameLink(t.url, url));
  if (dupe) {
    toast(`Already in your library as “${dupe.title}”.`);
    return;
  }
  if (useJobs.getState().jobs.some((j) => j.state === "working" && j.url && sameLink(j.url, url))) {
    toast("Already adding that one.");
    return;
  }
  useJobs.setState((s) => ({ jobs: [{ id: jobId, label: prettyLink(url), source, state: "working", url }, ...s.jobs] }));

  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => ({ error: "The server sent back something unexpected." }));
    if (!res.ok) throw new Error(data.error || "Couldn't pull audio from that link.");

    const audioBlob = await downloadMedia(data);

    const id = uid();
    let hasCover = false;
    let tint: string | undefined;
    // the song's artwork when Instagram tagged one, else the post's thumbnail
    for (const src of new Set([data.cover, data.postCover].filter(Boolean))) {
      try {
        const cr = await fetch(via(src));
        const coverBlob = cr.ok ? await cr.blob() : null;
        if (coverBlob?.size && coverBlob.type.startsWith("image/")) {
          await db.put("covers", id, coverBlob);
          hasCover = true;
          tint = (await coverColor(coverBlob)) ?? undefined;
          break;
        }
      } catch {
        /* a missing cover isn't worth failing the import over */
      }
    }
    await db.put("audio", id, audioBlob);
    requestPersistence();

    const track: Track = {
      id,
      title: data.title,
      artist: data.artist,
      handle: data.handle,
      source,
      url,
      duration: data.duration || (await probeDuration(audioBlob)),
      addedAt: Date.now(),
      plays: 0,
      hasCover,
      tint,
      size: audioBlob.size,
      caption: data.caption || undefined,
      song: !!data.song,
      named: NAMING,
      video: !!data.video,
    };
    useStore.getState().addTrack(track);
    dismissJob(jobId);
    const short = track.title.length > 40 ? track.title.slice(0, 38).trimEnd() + "…" : track.title;
    toast(`Added “${short}”`, { action: { label: "Play", run: () => playOne(id) } });
    if (!track.song) nameFromAudio(id);
  } catch (e) {
    setJob(jobId, { state: "error", error: friendlyError(e) });
  }
}

const via = (u: string) => `/api/media?u=${encodeURIComponent(u)}`;

/** Fetches the post's media file (found by /api/extract) through our proxy. */
async function downloadMedia(data: { media: string; mime?: string }) {
  const res = await fetch(via(data.media));
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new Error(e?.error || "The audio couldn't be downloaded. Try again.");
  }
  const raw = await res.blob();
  if (!raw.size) throw new Error("The audio came back empty. Try again.");
  return raw.type.startsWith("audio/") || raw.type.startsWith("video/") ? raw : new Blob([raw], { type: data.mime || "audio/mp4" });
}

function friendlyError(e: unknown) {
  if (e instanceof TypeError) return "Can't reach the server. Check your connection and try again.";
  if ((e as DOMException)?.name === "QuotaExceededError") return "Your browser is out of space for songs. Delete a few and try again.";
  return (e as Error)?.message || "Something went wrong. Try again.";
}

/** Recognises the song from the audio itself and renames the track if it finds one. */
async function nameFromAudio(id: string) {
  const blob = await db.get("audio", id).catch(() => undefined);
  const hit = blob ? await identifySong(blob).catch(() => null) : null;
  const t = useStore.getState().tracks[id];
  if (!hit || !t || t.edited) return;
  useStore.getState().updateTrack(id, {
    title: hit.title,
    artist: hit.artist || t.artist,
    song: true,
    caption: t.caption ?? (t.source === "file" ? undefined : t.title),
  });
}

let refreshing = false;

/**
 * Brings songs saved by older versions up to date, once each (see NAMING):
 * names (Instagram's song tag, then Shazam, then the caption) unless the user
 * renamed it, and Instagram media, which used to be a fragmented audio-only
 * file that iPhones won't play; it's replaced with the post's video.
 */
export async function refreshOldTracks() {
  if (refreshing) return;
  refreshing = true;
  try {
    const old = Object.values(useStore.getState().tracks).filter((t) => (t.named ?? 0) < NAMING);
    for (const t of old) {
      if (!navigator.onLine) return;
      const patch: Partial<Track> = { named: NAMING };
      let d: { title?: string; artist?: string; handle?: string; caption?: string; song?: boolean; video?: boolean; media?: string; mime?: string } | null = null;
      if (t.url) {
        try {
          const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: t.url }) });
          d = res.ok ? await res.json().catch(() => null) : null;
        } catch {
          return; // offline or server down: try again next visit
        }
      }
      if (d?.video && d.media && !t.video) {
        try {
          const blob = await downloadMedia({ media: d.media, mime: d.mime });
          await db.put("audio", t.id, blob);
          dropUrl("audio", t.id); // if it's loaded right now, the old file keeps playing until the next song
          blobUrl("audio", t.id);
          Object.assign(patch, { video: true, size: blob.size });
        } catch {
          /* keep the old file; the post may be gone */
        }
      } else if (!t.video) {
        const blob = await db.get("audio", t.id).catch(() => undefined);
        if (blob?.type.startsWith("video/")) patch.video = true;
      }
      const cur = useStore.getState().tracks[t.id];
      if (!cur) continue;
      if (!cur.edited && d?.title) Object.assign(patch, { title: d.title, artist: d.artist, handle: d.handle, caption: d.caption || undefined, song: !!d.song });
      useStore.getState().updateTrack(t.id, patch);
      if (!cur.edited && !(patch.song ?? cur.song)) await nameFromAudio(t.id);
    }
  } finally {
    refreshing = false;
  }
}

export async function importFiles(files: FileList | File[]) {
  const list = Array.from(files).filter((f) => f.type.startsWith("audio/") || f.type.startsWith("video/"));
  if (!list.length) {
    toast("Drop audio or video files to add them.");
    return;
  }
  for (const f of list) {
    const id = uid();
    await db.put("audio", id, f);
    const duration = await probeDuration(f);
    useStore.getState().addTrack({
      id,
      title: f.name.replace(/\.[^.]+$/, ""),
      artist: "Your files",
      source: "file",
      duration,
      addedAt: Date.now(),
      plays: 0,
      hasCover: false,
      size: f.size,
      named: NAMING,
      video: f.type.startsWith("video/"),
    });
    nameFromAudio(id);
  }
  requestPersistence();
  toast(list.length === 1 ? "Added 1 file." : `Added ${list.length} files.`);
}

export function retryJob(j: Job) {
  dismissJob(j.id);
  if (j.url) importLink(j.url);
}

function playOne(id: string) {
  const s = useStore.getState();
  s.playList(s.order, id, { label: "Songs", view: { kind: "songs" } }, { shuffle: false });
}

function sameLink(a: string, b: string) {
  const key = (u: string) => {
    try {
      const x = new URL(u);
      return x.hostname.replace(/^(www|m|mobile)\./, "").replace("x.com", "twitter.com") + x.pathname.replace(/\/$/, "");
    } catch {
      return u;
    }
  };
  return key(a) === key(b);
}

function prettyLink(u: string) {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/$/, "");
  } catch {
    return u;
  }
}
