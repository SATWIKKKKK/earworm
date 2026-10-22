import { useEffect, useState, useSyncExternalStore } from "react";
import { blobUrl } from "./lib/db";
import { onTime, playheadSnapshot } from "./engine";

export function useCover(id: string | null | undefined, has: boolean | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (id && has) blobUrl("covers", id).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id, has]);
  return url;
}

export function usePlayhead() {
  const v = useSyncExternalStore(onTime, playheadSnapshot);
  const [t, d] = v.split("|").map(Number);
  return { time: t || 0, duration: isFinite(d) ? d : 0 };
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [q]);
  return m;
}
