import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** A local file as the renderer can show it (the `app://` scheme serves any path); `v` busts the cache of a rewritten file. */
export const fileUrl = (path: string, v?: number | string) => `app://user-data${encodeURI(path)}${v != null ? `?v=${v}` : ""}`;

/** "13.2K", "1.4M", "2.1G": a file's size as the home screen shows it. */
export const sizeText = (bytes?: number) => {
  if (bytes == null) return "–";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
};

/** "00:20", or "1:02:05" past an hour; from seconds. */
export const clockText = (seconds?: number) => {
  const s = Math.round(seconds ?? 0);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
};

export type MenuItem = { label: string; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void; testId?: string } | "separator";

/** A right-click menu at the pointer, as CapCut's (a small dark card of rows). Returns what to spread on the element and the menu to render. */
export function useContextMenu(items: (key: string) => MenuItem[]) {
  const [at, setAt] = useState<{ x: number; y: number; key: string } | null>(null);
  const open = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAt({ x: e.clientX, y: e.clientY, key });
  };
  const menu = at ? <ContextMenu x={at.x} y={at.y} items={items(at.key)} onClose={() => setAt(null)} /> : null;
  return { open, menu, close: () => setAt(null) };
}

const ContextMenu: React.FC<{ x: number; y: number; items: MenuItem[]; onClose: () => void }> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the menu closes: the dialog under it doesn't see the key.
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("contextmenu", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("contextmenu", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      className="dark fixed z-[300] min-w-[184px] p-1 rounded-[8px] bg-[#2b2b2d] border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] text-brand-light select-none"
      style={{ left: pos.x, top: pos.y, pointerEvents: "auto" }}
    >
      {items.map((it, i) =>
        it === "separator" ? (
          <div key={i} className="h-px bg-white/10 mx-1 my-1" />
        ) : (
          <button
            key={i}
            role="menuitem"
            type="button"
            disabled={it.disabled}
            data-testid={it.testId}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={cn(
              "w-full h-8 px-3 flex items-center justify-between gap-6 rounded-[4px] text-[13px] text-left cursor-pointer hover:bg-white/10 disabled:opacity-40 disabled:cursor-default",
              it.danger && "text-red-400",
            )}
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="text-brand-light/50 text-[12px]">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
};
