import { create } from "zustand";
import { db, requestPersistence } from "./lib/db";
import { coverColor, probeDuration, uid } from "./lib/util";
import { useStore, type Source, type Track } from "./store";
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
  const dupe = Object.values(useStore.getState().tracks).find((t) => t.url && sameLink(t.url, url));
  if (dupe) {
    toast(`Already in your library as “${dupe.title}”.`);
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

    const via = (u: string) => `/api/media?u=${encodeURIComponent(u)}`;
    const audioRes = await fetch(via(data.media));
    if (!audioRes.ok) {
      const e = await audioRes.json().catch(() => null);
      throw new Error(e?.error || "The audio couldn't be downloaded. Try again.");
    }
    const raw = await audioRes.blob();
    if (!raw.size) throw new Error("The audio came back empty. Try again.");
    const audioBlob = raw.type.startsWith("audio/") || raw.type.startsWith("video/") ? raw : new Blob([raw], { type: data.mime || "audio/mp4" });

    const id = uid();
    let hasCover = false;
    let tint: string | undefined;
    if (data.cover) {
      try {
        const cr = await fetch(via(data.cover));
        const coverBlob = cr.ok ? await cr.blob() : null;
        if (coverBlob?.size && coverBlob.type.startsWith("image/")) {
          await db.put("covers", id, coverBlob);
          hasCover = true;
          tint = (await coverColor(coverBlob)) ?? undefined;
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
    };
    useStore.getState().addTrack(track);
    dismissJob(jobId);
    const short = track.title.length > 40 ? track.title.slice(0, 38).trimEnd() + "…" : track.title;
    toast(`Added “${short}”`, { action: { label: "Play", run: () => playOne(id) } });
  } catch (e) {
    const msg = e instanceof TypeError ? "Can't reach the server. Is it running?" : (e as Error).message;
    setJob(jobId, { state: "error", error: msg });
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
    });
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
