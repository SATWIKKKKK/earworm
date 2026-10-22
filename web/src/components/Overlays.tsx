import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { dismissToast, useToasts } from "../toast";
import { closeMenu, useDialog, useMenu, type MenuEntry, type MenuItem } from "../ui";

export function MenuHost() {
  const open = useMenu((s) => s.open);
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<MenuItem | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => setSub(null), [open]);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let x = open.align === "right" ? open.x - r.width : open.x;
    let y = open.y;
    x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
    if (y + r.height > innerHeight - 8) y = Math.max(8, (open.align === "right" ? open.y - 8 : open.y) - r.height - (open.align === "right" ? 36 : 0));
    setPos({ x, y });
    ref.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open, sub]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && closeMenu();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        sub ? setSub(null) : closeMenu();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    const away = () => closeMenu();
    // phones fire resize when the browser toolbar slides in or out, often right
    // under the finger tapping a menu item; only a width change means the layout moved
    const width = innerWidth;
    const resized = () => innerWidth !== width && closeMenu();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", resized);
    window.addEventListener("wheel", away, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", resized);
      window.removeEventListener("wheel", away);
    };
  }, [open, sub]);

  if (!open) return null;
  const items: MenuEntry[] = sub ? [{ label: sub.label, run: () => setSub(null), icon: <ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /> }, "sep", ...(sub.sub ?? [])] : open.items;

  return (
    <div className="menu" ref={ref} role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it === "sep" ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`${it.danger ? "danger" : ""} ${sub && i === 0 ? "back" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              if (it.sub) return setSub(it);
              if (sub && i === 0) return setSub(null);
              closeMenu();
              it.run?.();
            }}
          >
            <span className="mi-icon">{it.icon}</span>
            <span className="mi-label">{it.label}</span>
            {it.sub ? <ChevronRight size={16} /> : it.hint ? <span className="mi-hint">{it.hint}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}

export function DialogHost() {
  const open = useDialog((s) => s.open);
  const [vals, setVals] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    setVals(Object.fromEntries((open.fields ?? []).map((f) => [f.name, f.value ?? ""])));
    ref.current?.showModal();
    requestAnimationFrame(() => {
      const inp = ref.current?.querySelector("input");
      if (inp) inp.select();
      else ref.current?.querySelector<HTMLButtonElement>(".btn.primary, .btn.danger")?.focus();
    });
  }, [open]);

  if (!open) return null;
  const done = (v: Record<string, string> | null) => {
    ref.current?.close();
    open.resolve(v);
    useDialog.setState({ open: null });
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        done(null);
      }}
      onClick={(e) => e.target === ref.current && done(null)}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          done(vals);
        }}
      >
        <h2>{open.title}</h2>
        {open.body && <p>{open.body}</p>}
        {open.fields?.map((f) => (
          <label key={f.name} className="field">
            <span>{f.label}</span>
            <input value={vals[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))} />
          </label>
        ))}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={() => done(null)}>
            Cancel
          </button>
          <button type="submit" className={`btn ${open.danger ? "danger" : "primary"}`}>
            {open.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.action && (
            <button
              className="text-btn"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
