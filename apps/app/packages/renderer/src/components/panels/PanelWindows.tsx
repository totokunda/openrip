import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { LuSquareArrowDownLeft } from "react-icons/lu";
import { PortalContainerContext } from "@/components/ui/portal-container";
import { dockPanel, PANEL_TITLES, setPanelWindowsActive, usePanelWindowsStore, type PanelId, type PanelWindow } from "@/lib/panel-windows";
import { useProjectsStore } from "@/lib/projects";
import MediaModelPanel from "./MediaModelPanel";
import PreviewPanel from "./PreviewPanel";
import PropertiesPanel from "./PropertiesPanel";
import TimelinePanel from "./TimelinePanel";
import { WINDOW_GUTTER, WINDOW_STRIP } from "./PanelShell";

const PANELS: Record<PanelId, React.FC<{ detached?: boolean }>> = {
  assets: MediaModelPanel,
  player: PreviewPanel,
  inspector: PropertiesPanel,
  timeline: TimelinePanel,
};

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/**
 * A panel in its own window: CapCut's dark window chrome (a 34 px strip on the window's
 * background with the window's buttons, its name in the middle and Dock back at the right),
 * the panel under it with the editor's 8 px gutter. Menus and popovers open in this window.
 */
const DetachedPanel: React.FC<{ id: PanelId; pw: PanelWindow }> = ({ id, pw }) => {
  const Panel = PANELS[id];
  const project = useProjectsStore((s) => s.getActiveProject()?.name ?? "");
  useEffect(() => {
    pw.window.document.title = `${PANEL_TITLES[id]}${project ? ` — ${project}` : ""}`;
  }, [pw, id, project]);
  // (The player's frame fits its new window by itself: lib/player-zoom.ts keeps it fitted.)
  return createPortal(
    <PortalContainerContext.Provider value={pw.window.document.body}>
      <div data-testid={`panel-window-${id}`} className="flex flex-col w-full h-full bg-brand-background-dark">
        <div
          className="relative shrink-0 flex items-center select-none"
          style={{ height: WINDOW_STRIP, WebkitAppRegion: "drag", paddingLeft: isMac ? 78 : 12, paddingRight: isMac ? 11 : 150 } as React.CSSProperties}
        >
          <span className="absolute inset-x-0 text-center text-[12px] font-semibold text-brand-lighter pointer-events-none">{PANEL_TITLES[id]}</span>
          <button
            type="button"
            data-testid="dock-back"
            title="Put it back in the editor"
            onClick={() => dockPanel(id)}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="relative ml-auto h-[22px] px-2 flex items-center gap-1.5 rounded-[4px] bg-brand-background-light hover:bg-brand-button text-[12px] text-brand-light transition-colors"
          >
            <LuSquareArrowDownLeft className="w-3.5 h-3.5" />
            Dock back
          </button>
        </div>
        <div className="flex-1 min-h-0 flex" style={{ padding: `0 ${WINDOW_GUTTER}px ${WINDOW_GUTTER}px` }}>
          <Panel detached />
        </div>
      </div>
    </PortalContainerContext.Provider>,
    pw.root,
  );
};

/**
 * The panels pulled out of the editor, each in its window. Mounted with the editor: the
 * windows open with it and close when it goes (Home), their panels staying out for the next
 * project.
 */
const PanelWindows: React.FC = () => {
  const open = usePanelWindowsStore((s) => s.open);
  useEffect(() => {
    setPanelWindowsActive(true);
    return () => setPanelWindowsActive(false);
  }, []);
  return (
    <>
      {(Object.entries(open) as [PanelId, PanelWindow][]).map(([id, pw]) => (
        <DetachedPanel key={pw.name} id={id} pw={pw} />
      ))}
    </>
  );
};

export default PanelWindows;
