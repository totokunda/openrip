import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { useClipStore } from "@/lib/clip";
import { usePlayerStore } from "@/lib/player";
import { useViewportStore } from "@/lib/viewport";
import { addGuide, guideAtFromPercent, guideAtFromPixels, guidePercent, guidePixels, moveGuide, removeGuide } from "@/lib/guides";
import type { Guide } from "@/lib/types";
import { MENU_CHECK_ROW, MENU_PANEL, MENU_ROW, TickGlyph, useOwnerDocument } from "./player-ui";

/** CapCut draws its guides in its accent; OpenRip in its own. */
const GUIDE_COLOUR = "#ae81ce";

/** Where a guide is drawn in the canvas area (px from its left or top). */
export function guideScreen(axis: Guide["axis"], at: number): number {
  const { position, scale, contentBounds } = useViewportStore.getState();
  const b = contentBounds ?? { x: 0, y: 0, width: 0, height: 0 };
  return axis === "x" ? position.x + (b.x + at * b.width) * scale : position.y + (b.y + at * b.height) * scale;
}

/** The guide fraction under a point of the canvas area. */
function atFromScreen(axis: Guide["axis"], px: number): number {
  const { position, scale, contentBounds } = useViewportStore.getState();
  const b = contentBounds;
  if (!b || !b.width || !b.height || !scale) return 0.5;
  return axis === "x" ? ((px - position.x) / scale - b.x) / b.width : ((px - position.y) / scale - b.y) / b.height;
}

/**
 * Drag a guide (`id`; or a new one, made once the pointer is over the canvas area, when dragged
 * out of a ruler) with the pointer of `e`. Let go outside the canvas area (back on a ruler),
 * it's deleted. `area` is the canvas area's element. One press, one step for undo.
 */
export function dragGuide(e: React.PointerEvent, axis: Guide["axis"], id: string | null, area: HTMLElement) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture?.(e.pointerId);
  let guide = id;
  const local = (ev: PointerEvent | React.PointerEvent) => {
    const r = area.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top, inside: ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom };
  };
  const move = (ev: PointerEvent) => {
    const p = local(ev);
    const at = atFromScreen(axis, axis === "x" ? p.x : p.y);
    if (!guide) {
      if (!p.inside) return;
      guide = addGuide(axis, at);
      return;
    }
    moveGuide(guide, at);
  };
  const up = (ev: PointerEvent) => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", up);
    target.releasePointerCapture?.(ev.pointerId);
    if (guide && !local(ev).inside) removeGuide(guide);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}

/**
 * The project's guides over the canvas area: 1 px lines across it in the accent. Each can be
 * dragged (off the area to delete it) and right-clicked for Edit guide and Delete guide, as in
 * CapCut. Hidden with Show guides off (⌘;).
 */
const Guides: React.FC = () => {
  const guides = useClipStore((s) => s.guides ?? []);
  const show = usePlayerStore((s) => s.showGuides);
  // Redrawn as the view moves.
  useViewportStore((s) => s.position);
  useViewportStore((s) => s.scale);
  useViewportStore((s) => s.contentBounds);
  const [rootRef, doc] = useOwnerDocument<HTMLDivElement>();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  if (!show) return <div ref={rootRef} className="hidden" />;
  return (
    <div
      ref={(el) => {
        rootRef(el);
        setRoot(el);
      }}
      data-testid="player-guides"
      className="absolute inset-0 pointer-events-none z-[15] overflow-hidden"
    >
      {guides.map((g) => {
        const at = guideScreen(g.axis, g.at);
        const horizontal = g.axis === "y";
        return (
          <div
            key={g.id}
            data-testid="player-guide"
            data-guide={g.id}
            data-axis={g.axis}
            data-at={g.at}
            className="absolute pointer-events-auto"
            style={
              horizontal
                ? { left: 0, right: 0, top: at - 3, height: 7, cursor: "row-resize" }
                : { top: 0, bottom: 0, left: at - 3, width: 7, cursor: "col-resize" }
            }
            onPointerDown={(e) => {
              if (e.button !== 0 || !root) return;
              dragGuide(e, g.axis, g.id, root);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ id: g.id, x: e.clientX, y: e.clientY });
            }}
          >
            <div className="absolute" style={{ background: GUIDE_COLOUR, ...(horizontal ? { left: 0, right: 0, top: 3, height: 1 } : { top: 0, bottom: 0, left: 3, width: 1 }) }} />
          </div>
        );
      })}
      {menu && doc && (
        <GuideMenu
          doc={doc}
          at={menu}
          onClose={() => setMenu(null)}
          onEdit={() => {
            setEditing(menu.id);
            setMenu(null);
          }}
          onDelete={() => {
            removeGuide(menu.id);
            setMenu(null);
          }}
        />
      )}
      {editing && doc && <GuideDialog doc={doc} id={editing} onClose={() => setEditing(null)} />}
    </div>
  );
};

/** A guide's right-click menu, at the pointer: Edit guide, Delete guide. */
const GuideMenu: React.FC<{ doc: Document; at: { x: number; y: number }; onClose: () => void; onEdit: () => void; onDelete: () => void }> = ({ doc, at, onClose, onEdit, onDelete }) => (
  <Menu.Root open onOpenChange={(o) => !o && onClose()} modal={false}>
    {createPortal(
      <Menu.Trigger asChild>
        <span aria-hidden style={{ position: "fixed", left: at.x, top: at.y, width: 1, height: 1, pointerEvents: "none" }} />
      </Menu.Trigger>,
      doc.body,
    )}
    <Menu.Portal container={doc.body}>
      <Menu.Content data-testid="guide-menu" align="start" side="bottom" sideOffset={2} className={`${MENU_PANEL} w-[180px]`}>
        <Menu.Item data-testid="guide-edit" className={MENU_ROW} onSelect={onEdit}>
          Edit guide
        </Menu.Item>
        <Menu.Item data-testid="guide-delete" className={MENU_ROW} onSelect={onDelete}>
          Delete guide
        </Menu.Item>
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>
);

type Units = "pixels" | "percent";

/**
 * Edit guide, as CapCut's dialog: Units (Pixels or Percent) and the position (Y for a
 * horizontal guide, X for a vertical one; 0 is the canvas's middle, y upwards), OK and Cancel.
 */
const GuideDialog: React.FC<{ doc: Document; id: string; onClose: () => void }> = ({ doc, id, onClose }) => {
  const guide = useClipStore((s) => (s.guides ?? []).find((g) => g.id === id));
  const [units, setUnits] = useState<Units>("pixels");
  const [text, setText] = useState("");
  const value = (u: Units, g: Guide) => (u === "pixels" ? String(Math.round(guidePixels(g))) : String(Math.round(guidePercent(g) * 10) / 10));
  useEffect(() => {
    if (guide) setText(value(units, guide));
    // Only when the dialog opens or the units change: typing keeps its text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, guide?.id]);
  if (!guide) return null;
  const parsed = Number(text);
  const step = (d: number) => setText(String((Number.isFinite(parsed) ? parsed : 0) + d * (units === "pixels" ? 1 : 0.1)).replace(/(\.\d)\d+$/, "$1"));
  const ok = () => {
    if (Number.isFinite(parsed)) moveGuide(id, units === "pixels" ? guideAtFromPixels(guide.axis, parsed) : guideAtFromPercent(guide.axis, parsed));
    onClose();
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal container={doc.body}>
        <Dialog.Overlay className="fixed inset-0 z-[130]" />
        <Dialog.Content
          data-testid="guide-dialog"
          aria-describedby={undefined}
          className="dark fixed z-[131] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[302px] rounded-[10px] bg-brand-background border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_16px_48px_rgba(0,0,0,0.6)] text-brand-light outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              ok();
            }
          }}
        >
          <div className="relative h-9 flex items-center justify-center border-b border-brand-hairline">
            <Dialog.Close aria-label="Close" className="absolute left-3 w-3 h-3 rounded-full bg-[#ec5f59] hover:brightness-110 cursor-pointer" />
            <Dialog.Title className="text-[13px] font-semibold text-brand-lighter">Edit guide</Dialog.Title>
          </div>
          <div className="px-5 pt-4 pb-3 grid grid-cols-[64px_1fr] gap-y-3 items-center text-[13px]">
            <span>Units</span>
            <UnitsSelect doc={doc} value={units} onChange={setUnits} />
            <span>Position</span>
            <div className="flex items-center gap-1">
              <div className="h-6 w-[78px] flex items-center gap-2 rounded-[4px] bg-brand px-2">
                <span className="text-brand-light/80">{guide.axis === "y" ? "Y" : "X"}</span>
                <input
                  data-testid="guide-position"
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full min-w-0 bg-transparent outline-none tabular-nums text-brand-lighter"
                />
              </div>
              <div className="flex flex-col h-6 justify-center text-brand-light/70">
                <button type="button" aria-label="Up" onClick={() => step(1)} className="h-3 leading-none text-[8px] hover:text-brand-light cursor-pointer">▲</button>
                <button type="button" aria-label="Down" onClick={() => step(-1)} className="h-3 leading-none text-[8px] hover:text-brand-light cursor-pointer">▼</button>
              </div>
              {units === "percent" && <span className="text-brand-light/60 text-[12px]">%</span>}
            </div>
          </div>
          <div className="px-5 pt-3 pb-4 flex gap-3 border-t border-brand-hairline">
            <button type="button" data-testid="guide-ok" onClick={ok} className="flex-1 h-7 rounded-[4px] bg-brand-accent text-white text-[13px] hover:brightness-110 cursor-pointer">
              OK
            </button>
            <Dialog.Close className="flex-1 h-7 rounded-[4px] bg-brand-button text-brand-light text-[13px] hover:bg-brand-hover cursor-pointer">Cancel</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

/** The Units field: Pixels or Percent, a menu with a tick, as CapCut's. */
const UnitsSelect: React.FC<{ doc: Document; value: Units; onChange: (u: Units) => void }> = ({ doc, value, onChange }) => (
  <Menu.Root modal={false}>
    <Menu.Trigger data-testid="guide-units" className="h-6 w-full flex items-center justify-between rounded-[4px] bg-brand-background-light px-2 text-[13px] text-brand-lighter cursor-pointer outline-none">
      {value === "pixels" ? "Pixels" : "Percent"}
      <svg viewBox="0 0 10 6" className="w-2.5 h-1.5" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
        <path d="M1 1l4 4 4-4" />
      </svg>
    </Menu.Trigger>
    <Menu.Portal container={doc.body}>
      <Menu.Content align="start" sideOffset={4} className={`${MENU_PANEL} z-[140] w-[var(--radix-dropdown-menu-trigger-width)]`}>
        {(["pixels", "percent"] as Units[]).map((u) => (
          <Menu.Item key={u} data-testid={`guide-units-${u}`} className={MENU_CHECK_ROW} onSelect={() => onChange(u)}>
            {value === u && <TickGlyph className="absolute left-3 w-3 h-3 text-brand-accent" />}
            {u === "pixels" ? "Pixels" : "Percent"}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>
);

export default Guides;
