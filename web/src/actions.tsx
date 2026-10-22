import { ArrowDownToLine, ExternalLink, Heart, ListEnd, ListPlus, ListStart, Pencil, Plus, Trash2, X } from "lucide-react";
import { db } from "./lib/db";
import { useStore, type View } from "./store";
import { toast } from "./toast";
import { ask, openMenu, type MenuEntry } from "./ui";

const I = { size: 16, strokeWidth: 1.75 };

export async function newPlaylist(trackIds: string[] = [], go = true) {
  const s = useStore.getState();
  const r = await ask({
    title: "New playlist",
    fields: [{ name: "name", label: "Name", value: `Playlist ${s.playlists.length + 1}` }],
    confirm: "Create",
  });
  if (!r?.name.trim()) return null;
  const id = s.createPlaylist(r.name.trim(), trackIds);
  if (trackIds.length) toast(`Added to ${r.name.trim()}.`);
  if (go) s.go({ kind: "playlist", id });
  return id;
}

export function addToPlaylistItems(ids: string[]): MenuEntry[] {
  const s = useStore.getState();
  return [
    { label: "New playlist", icon: <Plus {...I} />, run: () => newPlaylist(ids, false) },
    ...(s.playlists.length ? (["sep"] as MenuEntry[]) : []),
    ...s.playlists.map((p) => ({
      label: p.name,
      run: () => {
        const n = useStore.getState().addToPlaylist(p.id, ids);
        toast(n ? `Added to ${p.name}.` : `Already in ${p.name}.`);
      },
    })),
  ];
}

export async function editTrack(id: string) {
  const t = useStore.getState().tracks[id];
  if (!t) return;
  const r = await ask({
    title: "Edit details",
    fields: [
      { name: "title", label: "Title", value: t.title },
      { name: "artist", label: "Artist", value: t.artist },
    ],
    confirm: "Save",
  });
  if (r) useStore.getState().updateTrack(id, { title: r.title.trim() || t.title, artist: r.artist.trim() || t.artist, edited: true });
}

/** Cycles loop off -> this song -> everything, and says which one is on. */
export function cycleRepeat() {
  useStore.getState().cycleRepeat();
  const s = useStore.getState();
  toast(s.repeat === "one" ? "Looping this song" : s.repeat === "all" ? `Looping ${s.context?.label ?? "all songs"}` : "Loop off");
}

export async function deleteTrack(id: string) {
  const t = useStore.getState().tracks[id];
  if (!t) return;
  const r = await ask({
    title: "Delete from library?",
    body: `“${t.title}” will be removed from your library and every playlist. You can add the link again later.`,
    confirm: "Delete",
    danger: true,
  });
  if (r) {
    await useStore.getState().deleteTrack(id);
    toast("Deleted.");
  }
}

export async function downloadTrack(id: string) {
  const t = useStore.getState().tracks[id];
  const blob = await db.get("audio", id);
  if (!t || !blob) return;
  const ext = blob.type.includes("mpeg") ? "mp3" : blob.type.startsWith("audio/mp4") ? "m4a" : blob.type.split("/")[1]?.split(";")[0] || "audio";
  const name = `${t.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 80) || "track"}.${ext}`;
  // iPhone browsers ignore download links; their share sheet has "Save to Files"
  const file = new File([blob], name, { type: blob.type });
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function trackMenu(e: { clientX: number; clientY: number } | DOMRect, id: string, where?: { view: View; index: number }) {
  const s = useStore.getState();
  const t = s.tracks[id];
  if (!t) return;
  const liked = !!s.liked[id];
  const items: MenuEntry[] = [
    { label: "Play next", icon: <ListStart {...I} />, run: () => (s.playNext([id]), toast("Playing next.")) },
    { label: "Add to queue", icon: <ListEnd {...I} />, run: () => (s.addToQueue([id]), toast("Added to queue.")) },
    "sep",
    { label: liked ? "Remove from Liked" : "Add to Liked", icon: <Heart {...I} />, run: () => s.toggleLike(id) },
    { label: "Add to playlist", icon: <ListPlus {...I} />, sub: addToPlaylistItems([id]) },
  ];
  if (where?.view.kind === "playlist") {
    const pid = where.view.id;
    items.push({ label: "Remove from this playlist", icon: <X {...I} />, run: () => s.removeFromPlaylist(pid, where.index) });
  }
  items.push(
    "sep",
    { label: "Edit details", icon: <Pencil {...I} />, run: () => editTrack(id) },
    { label: "Download", icon: <ArrowDownToLine {...I} />, run: () => downloadTrack(id) },
  );
  if (t.url) items.push({ label: t.source === "x" ? "Open post on X" : "Open on Instagram", icon: <ExternalLink {...I} />, run: () => window.open(t.url, "_blank", "noopener") });
  items.push("sep", { label: "Delete from library", icon: <Trash2 {...I} />, danger: true, run: () => deleteTrack(id) });
  openMenu(e, items);
}
