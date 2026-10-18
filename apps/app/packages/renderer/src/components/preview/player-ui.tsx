import React, { useCallback, useState } from "react";

/**
 * Pieces the player's menus, popovers and overlays share. Anything they show over the canvas
 * goes into the panel's own document (a popped-out player lives in another window), so each
 * finds it from an element of its own (`useOwnerDocument`) rather than the global `document`.
 */

/** A ref for an element of the component, and the document that element is in once mounted. */
export function useOwnerDocument<T extends HTMLElement>(): readonly [(el: T | null) => void, Document | null] {
  const [doc, setDoc] = useState<Document | null>(null);
  const ref = useCallback((el: T | null) => {
    if (el) setDoc((d) => (d === el.ownerDocument ? d : el.ownerDocument));
  }, []);
  return [ref, doc] as const;
}

/** A menu or popover panel, as CapCut's: the header colour, a hairline and a soft shadow. */
export const MENU_PANEL =
  "dark z-[120] flex flex-col p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] outline-none";
/** A menu row: 32 px apart, the hover a 28 px #404040 band. Text 20 px in from the menu's edge. */
export const MENU_ROW =
  "relative flex h-7 my-0.5 items-center gap-2 rounded-[4px] pl-4 pr-3 text-[13px] text-brand-light outline-none cursor-pointer select-none data-[highlighted]:bg-brand-hover data-[state=open]:bg-brand-hover data-[disabled]:opacity-40 data-[disabled]:cursor-default";
/** A row with a tick column: the tick in the accent 12 px in, the text after it. */
export const MENU_CHECK_ROW = MENU_ROW.replace("pl-4", "pl-8");
export const MENU_SEPARATOR = "h-px my-1 mx-1 bg-[#434343]";

/** A shortcut at a row's right, in grey. */
export const Keys: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="ml-auto pl-4 text-[12px] text-[#7a7a7a] tracking-[0.08em] tabular-nums">{children}</span>
);

// The player's glyphs, drawn for OpenRip (stroke icons on a 16 px grid, `currentColor`).

export const MenuGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 13 11" className={className} fill="none" stroke="currentColor" strokeWidth={1.1} aria-hidden>
    <path d="M0 0.75h13M0 5.5h13M0 10.25h13" />
  </svg>
);

export const ChevronGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 8 12" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 1.5 6.2 6 2 10.5" />
  </svg>
);

export const TickGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 12 12" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 6.4 4.8 9 10 3.2" />
  </svg>
);

/** Zoom: a magnifier in a frame's corners (the bottom bar's button for the zoom popover). */
export const ZoomGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 17 17" className={className} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M1 5V2.2C1 1.5 1.5 1 2.2 1H5M12 1h2.8c.7 0 1.2.5 1.2 1.2V5M16 12v2.8c0 .7-.5 1.2-1.2 1.2H12M5 16H2.2C1.5 16 1 15.5 1 14.8V12" />
    <circle cx="8" cy="8" r="3.4" />
    <path d="m10.5 10.5 2.6 2.6" />
  </svg>
);

/** A magnifier with − or +, the zoom popover's buttons. */
export const ZoomStepGlyph: React.FC<{ plus?: boolean; className?: string }> = ({ plus, className }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" aria-hidden>
    <circle cx="7.2" cy="7.2" r="5.6" />
    <path d="m11.4 11.4 3.2 3.2M4.7 7.2h5" />
    {plus && <path d="M7.2 4.7v5" />}
  </svg>
);

/** Full screen: four outward corners. */
export const FullscreenGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 13 13" className={className} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M1 4.5V1h3.5M8.5 1H12v3.5M12 8.5V12H8.5M4.5 12H1V8.5" />
    <path d="M1 1l3.4 3.4M12 1 8.6 4.4M12 12 8.6 8.6M1 12l3.4-3.4" />
  </svg>
);

/** Leave full screen: four inward arrows. */
export const ExitFullscreenGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 13 13" className={className} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4.6 1v3.6H1M8.4 1v3.6H12M8.4 12V8.4H12M4.6 12V8.4H1" />
    <path d="M1 1l3.4 3.4M12 1 8.6 4.4M12 12 8.6 8.6M1 12l3.4-3.4" />
  </svg>
);

/** The safe-area overlay's toggle: a phone's frame with the title-safe box inside. */
export const SafeAreaGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 14 16" className={className} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" aria-hidden>
    <rect x="0.8" y="0.8" width="12.4" height="14.4" rx="2" />
    <rect x="3.6" y="3.8" width="6.8" height="8.4" rx="0.6" strokeDasharray="1.6 1.2" />
  </svg>
);

/** Play and pause, filled. */
export const PlayGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 10 12" className={className} fill="currentColor" aria-hidden>
    <path d="M1 1.2c0-.8.9-1.3 1.6-.9l6.6 4.2c.6.4.6 1.3 0 1.7L2.6 11.7C1.9 12.1 1 11.6 1 10.8Z" />
  </svg>
);

export const PauseGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 10 12" className={className} fill="currentColor" aria-hidden>
    <rect x="1" y="0.5" width="2.8" height="11" rx="0.8" />
    <rect x="6.2" y="0.5" width="2.8" height="11" rx="0.8" />
  </svg>
);
