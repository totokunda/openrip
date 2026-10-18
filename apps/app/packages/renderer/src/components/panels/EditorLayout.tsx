import React from "react";
import { LuSquareArrowDownLeft } from "react-icons/lu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { layoutStorageKey, type AppLayoutId } from "@/lib/layout-config";
import { dockAllPanels, PANEL_IDS, usePanelWindowsStore, type PanelId } from "@/lib/panel-windows";
import MediaModelPanel from "./MediaModelPanel";
import PreviewPanel from "./PreviewPanel";
import PropertiesPanel from "./PropertiesPanel";
import TimelinePanel from "./TimelinePanel";

/** A panel in a layout, with the sizes it's given there (shares of its group, %). */
type Leaf = { panel: PanelId; size: number; min?: number; max?: number };
/** Panels side by side or stacked; nested groups are panels of their parent. */
type Group = { group: string; direction: "horizontal" | "vertical"; size?: number; min?: number; max?: number; children: Node[] };
type Node = Leaf | Group;

/**
 * CapCut's Default, Media, Attributes and Vertical layouts, their sizes as shares of the window
 * (capcut-ui-spec.md §1).
 */
const LAYOUTS: Record<AppLayoutId, Group> = {
  default: {
    group: "root",
    direction: "vertical",
    children: [
      {
        group: "upper",
        direction: "horizontal",
        size: 55,
        min: 30,
        max: 75,
        children: [
          { panel: "assets", size: 34.6 },
          { panel: "player", size: 38.4 },
          { panel: "inspector", size: 27 },
        ],
      },
      { panel: "timeline", size: 45 },
    ],
  },
  media: {
    group: "root",
    direction: "horizontal",
    children: [
      { panel: "assets", size: 32.5, min: 20, max: 50 },
      {
        group: "rest",
        direction: "vertical",
        size: 67.5,
        min: 30,
        children: [
          {
            group: "upper",
            direction: "horizontal",
            size: 54,
            min: 30,
            children: [
              { panel: "player", size: 63, min: 30 },
              { panel: "inspector", size: 37, min: 25 },
            ],
          },
          { panel: "timeline", size: 46 },
        ],
      },
    ],
  },
  properties: {
    group: "root",
    direction: "horizontal",
    children: [
      {
        group: "rest",
        direction: "vertical",
        size: 75.4,
        min: 40,
        children: [
          {
            group: "upper",
            direction: "horizontal",
            size: 54,
            min: 30,
            children: [
              { panel: "assets", size: 40, min: 22 },
              { panel: "player", size: 60, min: 30 },
            ],
          },
          { panel: "timeline", size: 46 },
        ],
      },
      { panel: "inspector", size: 24.6, min: 18 },
    ],
  },
  vertical: {
    group: "root",
    direction: "horizontal",
    children: [
      {
        group: "rest",
        direction: "vertical",
        size: 73.4,
        min: 40,
        children: [
          {
            group: "upper",
            direction: "horizontal",
            size: 54,
            min: 30,
            children: [
              { panel: "assets", size: 66, min: 30 },
              { panel: "inspector", size: 34, min: 25 },
            ],
          },
          { panel: "timeline", size: 46 },
        ],
      },
      { panel: "player", size: 26.6, min: 18 },
    ],
  },
};

const PANELS: Record<PanelId, React.FC<{ order?: number; defaultSize?: number; minSize?: number; maxSize?: number }>> = {
  assets: MediaModelPanel,
  player: PreviewPanel,
  inspector: PropertiesPanel,
  timeline: TimelinePanel,
};

/**
 * The gaps between panels (7 px between columns, 6 px between rows, as CapCut's), which are
 * also the handles that resize them.
 */
const handle = "bg-transparent data-[panel-group-direction=horizontal]:w-[7px] data-[panel-group-direction=vertical]:h-[6px]";

const isLeaf = (n: Node): n is Leaf => "panel" in n;
const keyOf = (n: Node) => (isLeaf(n) ? n.panel : n.group);
const hasDocked = (n: Node, docked: Set<PanelId>): boolean => (isLeaf(n) ? docked.has(n.panel) : n.children.some((c) => hasDocked(c, docked)));

/**
 * A group with its docked panels: the ones out in windows of their own are left out and the
 * rest share the space (a group left empty goes too). Each set of panels keeps its own sizes
 * (the group's autoSaveId stores one layout per set).
 */
function renderGroup(g: Group, layout: AppLayoutId, docked: Set<PanelId>, root: boolean): React.ReactNode {
  const items: React.ReactNode[] = [];
  let prev: string | null = null;
  g.children.forEach((child, i) => {
    if (!hasDocked(child, docked)) return;
    const key = keyOf(child);
    if (prev) items.push(<ResizableHandle key={`handle-${prev}-${key}`} className={handle} />);
    prev = key;
    if (isLeaf(child)) {
      const Panel = PANELS[child.panel];
      items.push(<Panel key={key} order={i + 1} defaultSize={child.size} minSize={child.min} maxSize={child.max} />);
    } else {
      items.push(
        <ResizablePanel key={key} id={child.group} order={i + 1} defaultSize={child.size} minSize={child.min} maxSize={child.max}>
          {renderGroup(child, layout, docked, false)}
        </ResizablePanel>,
      );
    }
  });
  return (
    <ResizablePanelGroup
      direction={g.direction}
      autoSaveId={root ? layoutStorageKey(layout) : `${layoutStorageKey(layout)}:${g.group}`}
      className={root ? "flex-1 overflow-hidden" : "overflow-hidden"}
    >
      {items}
    </ResizablePanelGroup>
  );
}

/** The editor's panels in the chosen layout, less those pulled out into windows of their own. */
const EditorLayout: React.FC<{ layout: AppLayoutId }> = ({ layout }) => {
  const detached = usePanelWindowsStore((s) => s.detached);
  const open = usePanelWindowsStore((s) => s.open);
  // A panel is out only while its window is: until it opens (or if it can't) it stays here.
  const docked = new Set(PANEL_IDS.filter((id) => !(detached.includes(id) && open[id])));
  if (docked.size === 0) {
    return (
      <div data-testid="all-panels-out" className="flex-1 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-brand-divider text-[12px] text-brand-light/60">
        Every panel is in a window of its own.
        <button
          type="button"
          onClick={() => dockAllPanels()}
          className="h-7 px-3 flex items-center gap-1.5 rounded-[4px] bg-brand-background-light hover:bg-brand-button text-brand-light"
        >
          <LuSquareArrowDownLeft className="w-3.5 h-3.5" />
          Dock all
        </button>
      </div>
    );
  }
  return <>{renderGroup(LAYOUTS[layout], layout, docked, true)}</>;
};

export default EditorLayout;
