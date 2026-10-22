import { create } from "zustand";
import type { ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  run?: () => void;
  sub?: MenuEntry[];
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}
export type MenuEntry = MenuItem | "sep";

interface MenuState {
  open: null | { x: number; y: number; items: MenuEntry[]; align?: "left" | "right" };
}
export const useMenu = create<MenuState>(() => ({ open: null }));

export function openMenu(e: { clientX: number; clientY: number } | DOMRect, items: MenuEntry[]) {
  if ("clientX" in e) useMenu.setState({ open: { x: e.clientX, y: e.clientY, items } });
  else useMenu.setState({ open: { x: e.right, y: e.bottom + 4, items, align: "right" } });
}
export const closeMenu = () => useMenu.setState({ open: null });

export interface Field {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
}
interface DialogState {
  open: null | {
    title: string;
    body?: string;
    fields?: Field[];
    confirm: string;
    danger?: boolean;
    resolve: (v: Record<string, string> | null) => void;
  };
}
export const useDialog = create<DialogState>(() => ({ open: null }));

export function ask(opts: { title: string; body?: string; fields?: Field[]; confirm: string; danger?: boolean }) {
  return new Promise<Record<string, string> | null>((resolve) => {
    useDialog.setState({ open: { ...opts, resolve } });
  });
}
