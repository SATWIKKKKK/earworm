import { useEffect, useRef, useState } from "react";
import { audio } from "../engine";
import { useCover } from "../hooks";
import { blobUrl } from "../lib/db";
import { useStore, type Track } from "../store";

const DRIFT = 0.35; // seconds the picture may wander from the sound before it's snapped back

/**
 * The post's own video, muted and slaved to the audio element. Sound stays on
 * <audio> because iPhones pause <video> in the background; the picture just
 * follows: play/pause, seeks, loops and speed changes all carry over.
 */
export function PostVideo({ track }: { track: Track }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const poster = useCover(track.id, track.hasCover);

  useEffect(() => {
    let live = true;
    blobUrl("audio", track.id).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [track.id]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !url) return;
    v.muted = true; // React doesn't reliably set the muted attribute, and iOS won't autoplay without it
    const follow = (snap: boolean) => {
      if (snap || Math.abs(v.currentTime - audio.currentTime) > DRIFT) v.currentTime = audio.currentTime;
      if (v.playbackRate !== audio.playbackRate) v.playbackRate = audio.playbackRate;
      if (audio.paused) {
        if (!v.paused) v.pause();
      } else if (v.paused) v.play().catch(() => {});
    };
    const drift = () => follow(false);
    const snap = () => follow(true);
    const shown = () => document.visibilityState === "visible" && snap();
    const events = ["play", "pause", "ratechange", "timeupdate"] as const;
    events.forEach((e) => audio.addEventListener(e, drift));
    audio.addEventListener("seeked", snap);
    v.addEventListener("loadedmetadata", snap);
    document.addEventListener("visibilitychange", shown);
    snap();
    return () => {
      events.forEach((e) => audio.removeEventListener(e, drift));
      audio.removeEventListener("seeked", snap);
      v.removeEventListener("loadedmetadata", snap);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [url]);

  return (
    <video
      ref={ref}
      className="post-video"
      src={url ?? undefined}
      poster={poster ?? undefined}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      onClick={() => useStore.getState().togglePlay()}
      aria-label="Original video. Tap to play or pause"
    />
  );
}
