import { create } from "zustand";

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let n = 0;

export function toast(text: string, opts?: { action?: Toast["action"]; ms?: number }) {
  const id = ++n;
  // one at a time: stacked toasts cover the track list
  useToasts.setState({ toasts: [{ id, text, action: opts?.action }] });
  setTimeout(() => dismissToast(id), opts?.ms ?? 3800);
}

export function dismissToast(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
