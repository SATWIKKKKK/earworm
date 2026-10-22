// Mirrors in-app navigation into browser history, so the browser/phone back
// button (and back swipe) steps through pages and closes Now Playing instead of
// leaving the site.
import { create } from "zustand";
import { sameView, useStore, type View } from "./store";

interface Entry {
  view: View;
  np?: boolean; // Now Playing open
  depth: number; // in-app entries behind this one
}

/** How many in-app pages are behind the current one. */
export const useNavDepth = create<{ depth: number }>(() => ({ depth: 0 }));

let applying = false; // true while a popstate is being applied to the store
let replaceNext = false; // the next navigation replaces the current entry

export function initNav() {
  const s0 = useStore.getState();
  const start: Entry = { view: s0.view, depth: 0 };
  history.replaceState(start, "");
  if (s0.nowPlayingOpen) history.pushState({ ...start, np: true, depth: 1 }, "");

  window.addEventListener("popstate", (e) => {
    let st = e.state as Entry | null;
    if (!st?.view) return;
    const v = st.view;
    if (v.kind === "playlist" && !useStore.getState().playlists.some((p) => p.id === v.id)) {
      // that playlist was deleted since; skip past it
      if (st.depth > 0) return history.back();
      st = { view: { kind: "playlists" }, depth: 0 };
      history.replaceState(st, "");
    }
    applying = true;
    useStore.setState({ view: st.view, nowPlayingOpen: !!st.np });
    applying = false;
    useNavDepth.setState({ depth: st.depth });
  });

  useStore.subscribe((s, p) => {
    if (applying) return;
    const viewChanged = !sameView(s.view, p.view);
    if (!viewChanged && s.nowPlayingOpen === p.nowPlayingOpen) return;
    const cur = (history.state as Entry | null) ?? { view: p.view, depth: 0 };
    if (p.nowPlayingOpen && !s.nowPlayingOpen && !viewChanged && cur.np) {
      // closed from the UI: drop the Now Playing entry rather than stacking another page
      history.back();
      return;
    }
    // navigating away from Now Playing replaces its entry; anything else is a new page
    const replace = replaceNext || (cur.np && !s.nowPlayingOpen);
    replaceNext = false;
    const depth = replace ? cur.depth : cur.depth + 1;
    const next: Entry = { view: s.view, np: s.nowPlayingOpen || undefined, depth };
    if (replace) history.replaceState(next, "");
    else history.pushState(next, "");
    useNavDepth.setState({ depth });
  });
}

/** Where "Back" goes when there's no in-app history (e.g. right after a reload). */
function parentOf(v: View): View {
  return v.kind === "playlist" ? { kind: "playlists" } : { kind: "songs" };
}

export function goBack() {
  if (useNavDepth.getState().depth > 0) return history.back();
  replaceNext = true; // otherwise Back from the parent would return here
  useStore.getState().go(parentOf(useStore.getState().view));
}
