import React, { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Toaster } from "@/components/ui/sonner";
import EditorLayout from "./panels/EditorLayout";
import PanelWindows from "./panels/PanelWindows";
import { useLayoutConfigStore } from "@/lib/layout-config";
import { betweenWindows, dragOverlayRect, usePanelWindowsStore } from "@/lib/panel-windows";
import Topbar from "./bars/Topbar";
import { DndContext, DragEndEvent, DragOverlay, getClientRect } from "@dnd-kit/core";
import { MediaItem, MediaThumb } from "@/components/media/Item";
import { TransitionDragTile } from "@/components/menus/TransitionMenu";
import { cn } from "@/lib/utils";
import { useClipStore } from "@/lib/clip";
import GlobalContextMenu from "@/components/GlobalContextMenu";
import { useMissingMediaWatcher } from "@/lib/media/missing";
import RecordPanel from "@/components/record/RecordPanel";

/** Keeps the missing-media state current while the editor is open (renders nothing). */
const MissingMediaWatcher: React.FC = () => {
  useMissingMediaWatcher();
  return null;
};
import AnalysisPill from "@/components/timeline/AnalysisPill";
import { useProjectsStore } from "@/lib/projects";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/react-query/queryClient";
import { useContextMenuStore } from "@/lib/context-menu";
import { useUpdateToasts } from "@/hooks/use-update-toasts";
import { initEnginePreview } from "@/lib/engine-preview";
import { initHistory } from "@/lib/history";
import { useShellStore } from "@/lib/shell";
import HomeScreen from "./home/HomeScreen";
import AppDialogs from "./dialogs/AppDialogs";
import { initPreferences } from "@/lib/preferences";
import { initKeymap } from "@/lib/keymap";

/** The window while the projects (first) or a project (later) are loading. */
const Loading: React.FC<{ title: string; note: string }> = ({ title, note }) => (
  <main className="w-full h-screen flex flex-col bg-brand-background-dark text-center font-poppins">
    <div className="relative flex-1 overflow-hidden">
      <div className="relative z-10 h-full w-full flex flex-col items-center justify-center gap-5">
        <div className="text-[12px] text-brand-light/50">{title}</div>
        <div className="text-2xl font-semibold tracking-tight text-brand-light">OpenRip</div>
        <div className="h-9 w-9 rounded-full border-2 border-brand-light/15 border-t-brand-accent-shade animate-spin" />
        <p className="max-w-sm text-[11px] text-brand-light/40 leading-relaxed">{note}</p>
      </div>
    </div>
    <Toaster />
  </main>
);

/** The dragged picture measured without the move between windows (lib/panel-windows.ts). */
const overlayMeasuring = { dragOverlay: { measure: dragOverlayRect(getClientRect) } };

/** `node` rendered into `container` (another window's body), or here without one. */
const portalInto = (container: HTMLElement | undefined, node: React.ReactNode) => (container ? createPortal(node, container) : node);

const App: React.FC = () => {
  useUpdateToasts();
  // The Rust engine preview setting, and keeping the engine's copy of the project current.
  useEffect(() => {
    initEnginePreview();
  }, []);
  // Undo and redo: telling one edit from the next by the user's presses.
  useEffect(() => {
    initHistory();
  }, []);
  // The Settings window's preferences, and the keys they bind (lib/keymap.ts).
  useEffect(() => {
    void initPreferences().then(() => initKeymap());
  }, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layout = useLayoutConfigStore((s) => s.layout);
  const resetCount = useLayoutConfigStore((s) => s.resetCount);
  // The timeline's own window, when it's out of the editor (drops land there).
  const timelineWindow = usePanelWindowsStore((s) => s.open.timeline?.window);
  const view = useShellStore((s) => s.view);
  const { ghostInStage, clips} = useClipStore();
  const projectsLoaded = useProjectsStore((s) => s.projectsLoaded);
  // The home screen waits for the first load only: it lists the projects from then on.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (projectsLoaded) setReady(true);
  }, [projectsLoaded]);
  const activeProject = useProjectsStore((s) => s.getActiveProject());
  const [activeDragItem, setActiveDragItem] = useState<MediaItem | null>(
    null,
  );
  // The transition card being dragged onto a cut, by its type.
  const [dragTransition, setDragTransition] = useState<string | null>(null);

  // Disable scrolling while dragging
  useEffect(() => {
    if (!activeDragItem) return;
    const preventDefault = (e: Event) => {
      e.preventDefault();
    };
    const preventKeyScroll = (e: KeyboardEvent) => {
      const blockedKeys = [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        " ",
        "Spacebar",
      ];
      if (blockedKeys.includes(e.key) || e.code === "Space") {
        e.preventDefault();
      }
    };
    // Best-effort: also hide body scrollbars and disable touch panning/overscroll
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = (document.body.style as any).touchAction;
    const prevOverscroll = (document.body.style as any).overscrollBehavior;
    document.body.style.overflow = "hidden";
    (document.body.style as any).touchAction = "none";
    (document.body.style as any).overscrollBehavior = "none";
    document.addEventListener("wheel", preventDefault, {
      passive: false,
      capture: true,
    });
    document.addEventListener("touchmove", preventDefault, {
      passive: false,
      capture: true,
    });
    window.addEventListener("keydown", preventKeyScroll, { capture: true });
    return () => {
      document.body.style.overflow = prevOverflow;
      (document.body.style as any).touchAction = prevTouchAction;
      (document.body.style as any).overscrollBehavior = prevOverscroll;
      document.removeEventListener(
        "wheel",
        preventDefault as EventListener,
        true,
      );
      document.removeEventListener(
        "touchmove",
        preventDefault as EventListener,
        true,
      );
      window.removeEventListener(
        "keydown",
        preventKeyScroll as EventListener,
        true,
      );
    };
  }, [activeDragItem]);

  // Enable copy for non-editable selected text via a minimal context menu.
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const sel = window.getSelection?.();
      if (!sel || sel.isCollapsed) return;
      const selectedText = sel.toString?.() ?? "";
      if (!selectedText.trim()) return;

      const node = e.target as Node | null;
      if (!node) return;

      // Only show this menu when right-click happens *on the selected text*.
      try {
        const containsNode =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          typeof (sel as any).containsNode === "function"
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (sel as any).containsNode(node, true)
            : true;
        if (!containsNode) return;
      } catch {
        // If containsNode fails, don't hijack the context menu.
        return;
      }

      // Don't override when something else already handled it.
      if (e.defaultPrevented) return;

      e.preventDefault();
      const shortcut =
        typeof navigator !== "undefined" &&
        typeof navigator.platform === "string" &&
        navigator.platform.toLowerCase().includes("mac")
          ? "⌘C"
          : "Ctrl+C";
      useContextMenuStore.getState().openMenu({
        position: { x: e.clientX, y: e.clientY },
        target: { type: "textSelection" },
        groups: [
          {
            id: "edit",
            items: [{ id: "copy", label: "Copy", action: "copy", shortcut }],
          },
        ],
      });
    };

    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

  const handleDragEnd = (_e: DragEndEvent) => {
    setActiveDragItem(null);
    setDragTransition(null);
  };

  if (!ready) {
    return <Loading title="Preparing workspace" note="Loading projects and initializing timeline..." />;
  }
  if (view === "home") {
    return (
      <>
        <HomeScreen />
        <AppDialogs />
        <Toaster />
      </>
    );
  }
  if (!projectsLoaded || !activeProject) {
    return <Loading title="Opening project" note={activeProject?.name ?? ""} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
    <DndContext
      autoScroll={false}
      // Media dragged from a panel in one window onto the timeline in another.
      modifiers={[betweenWindows]}
      measuring={overlayMeasuring}
      onDragStart={(event) => {
        const data = event?.active?.data?.current as unknown as
          | MediaItem
          | undefined;
        if (!data) return;
        // A transition card shows its own picture while it's dragged.
        if ((data as any).type === "transition") {
          setDragTransition((data as any).transition);
          return;
        }
        // Accept media items (MediaItem has ClipType in data.type)
        if ((data as any).name) {
          setActiveDragItem(data as any);
        }
      }}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveDragItem(null);
        setDragTransition(null);
      }}
    >
      <main
        ref={containerRef}
        data-testid="editor"
        className="w-full text-center font-poppins bg-brand-background-dark h-screen flex flex-col"
      >
        <Topbar />
        <Toaster />
        {/* The panels, 8 px from the window's edges, in CapCut's Default, Media, Attributes or
            Vertical layout; each layout keeps its sizes (localStorage), which "Reset current
            layout" clears. Panels pulled out into windows of their own leave the layout and
            are rendered into their windows (PanelWindows). */}
        <div key={`${layout}-${resetCount}`} className="flex flex-1 min-h-0 w-full px-2 pb-2">
          <EditorLayout layout={layout} />
        </div>
      </main>
      <PanelWindows />
      <GlobalContextMenu />
      <AppDialogs />
      <AnalysisPill />
      <MissingMediaWatcher />
      <RecordPanel />
      {/* The dragged picture, in the timeline's window (it can have one of its own). */}
      {portalInto(
        timelineWindow?.document.body,
        <DragOverlay dropAnimation={null}>
          {activeDragItem ? (
            <div
              className={cn(
                "w-44 aspect-video rounded-md overflow-hidden bg-brand opacity-100",
                {
                  "opacity-0": ghostInStage && clips.length > 0,
                },
              )}
            >
              <MediaThumb item={activeDragItem} isDragging={true} />
            </div>
          ) : dragTransition ? (
            <TransitionDragTile type={dragTransition} />
          ) : null}
        </DragOverlay>,
      )}
    </DndContext>
    </QueryClientProvider>
  );
};

export default App;
