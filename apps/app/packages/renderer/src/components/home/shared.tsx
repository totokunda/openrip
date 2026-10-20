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

/** The home screen's page: barely off black, with the accent's hue at the top. */
export const HOME_PAGE_BG = "linear-gradient(180deg, #110d15 0%, #0b0a0d 40%, #090909 100%)";

/** The home screen's drop-down menus and their rows. */
export const homeMenu = "dark p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light";
export const homeMenuRow = "dark h-8 px-2.5 gap-2.5 rounded-[4px] text-[13px] cursor-pointer focus:bg-brand-hover";
/** A small toolbar button over a list (search, view, Trash). */
export const homeTool = "h-6 px-1.5 flex items-center justify-center gap-1 rounded-[4px] bg-[#29292d] hover:bg-[#333338] text-brand-light/85 text-[12px] transition-colors cursor-pointer";

/** "Edited 5 min ago", "Edited yesterday", "Edited 12 Oct". */
export const editedLabel = (ms?: number) => {
  if (!ms) return "Never edited";
  const s = (Date.now() - ms) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  if (s < 60) return "Edited just now";
  if (s < 3600) return `Edited ${rtf.format(-Math.round(s / 60), "minute")}`;
  if (s < 86400) return `Edited ${rtf.format(-Math.round(s / 3600), "hour")}`;
  if (s < 7 * 86400) return `Edited ${rtf.format(-Math.round(s / 86400), "day")}`;
  return `Edited ${new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
};

/** "00:20", or "1:02:05" past an hour. */
export const lengthLabel = (us?: number) => {
  const s = Math.round((us ?? 0) / 1e6);
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** A long name cut in the middle, so its start and end both show ("openrip-c…landscape"). */
export const middle = (name: string, max: number) => {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (max - 1 - head))}`;
};
