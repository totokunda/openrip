import React from "react";
import { ResizablePanel } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { useContextMenuStore } from "@/lib/context-menu";
import { dockPanel, focusPanelWindow, movePanelWindow, popOutPanel, type PanelId } from "@/lib/panel-windows";

type ShellProps = React.ComponentProps<typeof ResizablePanel> & {
  /** In a window of its own (lib/panel-windows.ts): it fills that window instead. */
  detached?: boolean;
};

/**
 * A panel's outer box: one of the editor's resizable panels, or, pulled out into a window of
 * its own, a box filling that window (same classes, same test id).
 */
export const PanelShell: React.FC<ShellProps> = ({ detached, id, order, defaultSize, minSize, maxSize, collapsible, collapsedSize, onCollapse, onExpand, onResize, className, children, ...rest }) =>
  detached ? (
    <div {...(rest as React.HTMLAttributes<HTMLDivElement>)} data-panel-window={id} className={cn(className, "flex-1 min-w-0 min-h-0 h-full")}>
      {children}
    </div>
  ) : (
    <ResizablePanel
      id={id}
      order={order}
      defaultSize={defaultSize}
      minSize={minSize}
      maxSize={maxSize}
      collapsible={collapsible}
      collapsedSize={collapsedSize}
      onCollapse={onCollapse}
      onExpand={onExpand}
      onResize={onResize}
      className={className}
      {...rest}
    >
      {children}
    </ResizablePanel>
  );

/** The window strip a panel window draws above its panel, and the gutter round it (PanelWindows.tsx). */
export const WINDOW_STRIP = 34;
export const WINDOW_GUTTER = 8;

/** Presses that belong to a control with its own drag or menu, not to the header. */
const OWN_GESTURE = "input, textarea, select, [role=slider], [aria-haspopup], [data-no-popout]";

/** The header's menu, on a right-click: Pop out, or Dock back when the panel is out. */
export function openPanelMenu(id: PanelId, detached: boolean, x: number, y: number) {
  useContextMenuStore.getState().openMenu({
    position: { x, y },
    target: { type: "panel", panel: id },
    groups: [
      {
        id: "panel",
        items: detached
          ? [{ id: "panel-dock", label: "Dock back", action: "dockPanel" }]
          : [{ id: "panel-pop-out", label: "Pop out", action: "popOutPanel" }],
      },
    ],
  });
}

/**
 * A panel's header strip (its name, tab row or toolbar): dragged out of the editor's window it
 * pulls the panel out into a window of its own, which follows the pointer until it's let go;
 * a right-click offers Pop out (Dock back when it's out). `within` narrows the strip to part of
 * the element the handlers are on (the inspector's top 42 px).
 */
export function panelHeaderHandlers(id: PanelId, detached: boolean, within?: (e: React.MouseEvent<HTMLElement>) => boolean) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (detached || e.button !== 0 || (within && !within(e))) return;
      if ((e.target as Element).closest?.(OWN_GESTURE)) return;
      tearOff(id, e);
    },
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      if (e.defaultPrevented || (within && !within(e))) return;
      if ((e.target as Element).closest?.("input, textarea")) return;
      e.preventDefault();
      openPanelMenu(id, detached, e.clientX, e.clientY);
    },
  };
}

/** The top `px` of the element the event's handler is on. */
export const topStrip = (px: number) => (e: React.MouseEvent<HTMLElement>) => e.clientY - e.currentTarget.getBoundingClientRect().top <= px;

function tearOff(id: PanelId, e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const view = el.ownerDocument.defaultView ?? window;
  const panel = (el.closest("[data-panel-id]") as HTMLElement | null) ?? el;
  const box = panel.getBoundingClientRect();
  // Where the pointer holds the panel, kept in the new window (under its strip and gutter).
  const grab = { x: e.clientX - box.left + WINDOW_GUTTER, y: e.clientY - box.top + WINDOW_STRIP };
  const start = { x: e.clientX, y: e.clientY };
  const pointerId = e.pointerId;
  let captured = false;
  let out = false;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    if (!captured && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) {
      captured = true;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // The press ended already.
      }
    }
    const at = { x: ev.screenX - grab.x, y: ev.screenY - grab.y };
    if (out) {
      movePanelWindow(id, at.x, at.y);
      return;
    }
    const margin = 4;
    if (ev.clientX < -margin || ev.clientY < -margin || ev.clientX > view.innerWidth + margin || ev.clientY > view.innerHeight + margin) {
      out = true;
      popOutPanel(id, at);
    }
  };
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    view.removeEventListener("pointermove", move, true);
    view.removeEventListener("pointerup", end, true);
    view.removeEventListener("pointercancel", end, true);
    if (out) focusPanelWindow(id);
  };
  // On its window, which sees them first (the element captures the pointer once it moves, so
  // they keep coming once it's outside the window).
  view.addEventListener("pointermove", move, true);
  view.addEventListener("pointerup", end, true);
  view.addEventListener("pointercancel", end, true);
}

/** Pop out / Dock back, for a panel that has a menu of its own (the player's). */
export const panelWindowAction = (id: PanelId, detached: boolean) => ({
  label: detached ? "Dock back" : "Pop out",
  testId: detached ? "panel-dock" : "panel-pop-out",
  run: () => (detached ? dockPanel(id) : popOutPanel(id)),
});
