// The editor's panels in windows of their own: the player, the left panel (Media), the
// inspector and the timeline can each be pulled out of the editor (its header dragged out of
// the window, or "Pop out") and put back ("Dock back", closing its window, or Layout ▸ Reset
// current layout). The editor's layout closes up the space a panel leaves.
//
// A panel window is opened here with `window.open` and stays part of this window's page: the
// panel is rendered into it through a React portal (components/panels/PanelWindows.tsx), so
// every store, the engine's frames and the undo history stay single. Its stylesheets are
// copied over and lib/window-group.ts brings it this window's listeners (keys, drags).
// Main (modules/PanelWindows.ts) places each window and remembers where it was, per panel.
//
// Which panels are out is kept between sessions. The windows exist only while a project is
// open: going Home closes them, and they come back where they were with the next project.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { movePanelWindow as movePanelWindowIpc, onPanelWindowClosed } from "@app/preload";
import { joinWindow, leaveWindow } from "./window-group";

export type PanelId = "assets" | "player" | "inspector" | "timeline";
export const PANEL_IDS: PanelId[] = ["assets", "player", "inspector", "timeline"];

/** The panels' names, as CapCut's layouts call them (its "Media" layout is the left panel's). */
export const PANEL_TITLES: Record<PanelId, string> = {
  assets: "Media",
  player: "Player",
  inspector: "Inspector",
  timeline: "Timeline",
};

/** A panel's open window and the element its panel is rendered into. */
export type PanelWindow = { name: string; window: Window; root: HTMLElement };

interface PanelWindowsState {
  /** The panels that are out of the editor (kept between sessions). */
  detached: PanelId[];
  /** Their windows, while a project is open. */
  open: Partial<Record<PanelId, PanelWindow>>;
  /** Pull a panel out into its own window, its top-left at `at` (screen px) if given. */
  popOut: (id: PanelId, at?: { x: number; y: number }) => void;
  /** Put a panel back in the editor. */
  dock: (id: PanelId) => void;
  /** Put every panel back. */
  dockAll: () => void;
}

/** Whether the editor is showing (a project is open): panel windows exist only then. */
let active = false;
let deactivating: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
/** Windows this page closed itself (docked, or going Home): their closing isn't a dock. */
const closingByPage = new Set<string>();
/** True once this window is unloading: windows closing then stay out for next time. */
let unloading = false;

export const usePanelWindowsStore = create<PanelWindowsState>()(
  persist(
    (set, get) => ({
      detached: [],
      open: {},
      popOut: (id, at) => {
        if (!get().detached.includes(id)) set((s) => ({ detached: [...s.detached, id] }));
        if (active) openWindow(id, at);
      },
      dock: (id) => {
        if (get().detached.includes(id)) set((s) => ({ detached: s.detached.filter((p) => p !== id) }));
        closeWindow(id);
      },
      dockAll: () => {
        if (get().detached.length) set({ detached: [] });
        for (const id of PANEL_IDS) closeWindow(id);
      },
    }),
    { name: "openrip:panel-windows", partialize: (s) => ({ detached: s.detached }) },
  ),
);

const store = () => usePanelWindowsStore.getState();

export const popOutPanel = (id: PanelId, at?: { x: number; y: number }) => store().popOut(id, at);
export const dockPanel = (id: PanelId) => store().dock(id);
export const dockAllPanels = () => store().dockAll();

/** Whether a panel is out of the editor in a window of its own right now. */
export const usePanelDetached = (id: PanelId) => usePanelWindowsStore((s) => s.detached.includes(id) && !!s.open[id]);

/**
 * The editor showing (true) or not (going Home, or a project loading): the panels that are out
 * get their windows back, or lose them (they stay out, for the next project). A quick
 * off-then-on (React's strict mode remounting) keeps the windows.
 */
export function setPanelWindowsActive(on: boolean) {
  if (deactivating) clearTimeout(deactivating);
  deactivating = null;
  if (on) {
    active = true;
    for (const id of store().detached) openWindow(id);
    return;
  }
  deactivating = setTimeout(() => {
    deactivating = null;
    active = false;
    for (const id of PANEL_IDS) closeWindow(id);
  }, 0);
}

/** Move a panel's window (its top-left, screen px): it follows the pointer while dragged out. */
export function movePanelWindow(id: PanelId, x: number, y: number) {
  const pw = store().open[id];
  if (pw) movePanelWindowIpc(pw.name, x, y);
}

/** Where a window's page starts on the screen (its top-left, screen px). */
function pageOrigin(w: Window) {
  const side = Math.max(0, (w.outerWidth - w.innerWidth) / 2);
  return { x: w.screenX + side, y: w.screenY + Math.max(0, w.outerHeight - w.innerHeight - side) };
}

/** The window things dragged from the left panel are dropped in: the timeline's. */
export const dropWindow = (): Window => {
  const w = store().open.timeline?.window;
  return w && !w.closed ? w : window;
};

/**
 * A drag (dnd-kit) that starts in one window and is dropped in another: media dragged from the
 * left panel's own window onto the editor's timeline, or from the editor onto the timeline's
 * window. The pointer keeps reporting to the window the drag started in, in its page's
 * coordinates; this moves them into the timeline's window's, where the drop is worked out and
 * the dragged picture is drawn (App's DragOverlay).
 */
export function betweenWindows<T extends { x: number; y: number }>({ transform, activatorEvent }: { transform: T; activatorEvent: Event | null }): T {
  const from = (activatorEvent?.target as Node | null | undefined)?.ownerDocument?.defaultView;
  const to = dropWindow();
  if (!from || from === to) {
    dragOffset = { x: 0, y: 0 };
    return transform;
  }
  const [a, b] = [pageOrigin(from), pageOrigin(to)];
  dragOffset = { x: a.x - b.x, y: a.y - b.y };
  return { ...transform, x: transform.x + dragOffset.x, y: transform.y + dragOffset.y };
}

/** How far `betweenWindows` moves the drag now. */
let dragOffset = { x: 0, y: 0 };

type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };

/**
 * The dragged picture's rect as dnd-kit measures it (once, as it appears), less the move
 * between windows it's drawn with: dnd-kit adds the drag's move to it, which would count that
 * move twice. `measure` is dnd-kit's own (getClientRect).
 */
export const dragOverlayRect = (measure: (el: HTMLElement) => Rect) => (el: HTMLElement): Rect => {
  const r = measure(el);
  const { x, y } = dragOffset;
  return { ...r, top: r.top - y, bottom: r.bottom - y, left: r.left - x, right: r.right - x };
};

/** Bring a panel's window to the front. */
export function focusPanelWindow(id: PanelId) {
  store().open[id]?.window.focus();
}

function openWindow(id: PanelId, at?: { x: number; y: number }) {
  const existing = store().open[id];
  if (existing && !existing.window.closed) {
    existing.window.focus();
    return;
  }
  // Each window gets a new name: one closing under the old name isn't reused.
  const name = `openrip-panel:${id}:${++seq}`;
  const features = at ? `left=${Math.round(at.x)},top=${Math.round(at.y)}` : "";
  const w = window.open("", name, features);
  if (!w) {
    console.warn(`[panel-windows] couldn't open a window for the ${id}`);
    return;
  }
  const root = prepareDocument(w, id);
  joinWindow(w);
  w.addEventListener("pagehide", () => gone(id, name, w));
  usePanelWindowsStore.setState((s) => ({ open: { ...s.open, [id]: { name, window: w, root } } }));
}

function closeWindow(id: PanelId) {
  const pw = store().open[id];
  if (!pw) return;
  closingByPage.add(pw.name);
  // The panel leaves the window first (React unmounts it), then the window goes.
  usePanelWindowsStore.setState((s) => {
    const open = { ...s.open };
    delete open[id];
    return { open };
  });
  leaveWindow(pw.window);
  stopStyleSync(pw.window);
  setTimeout(() => {
    try {
      pw.window.close();
    } catch {
      // Already gone.
    }
  }, 0);
}

/**
 * A panel window's page went away. When this page closed it, nothing more; otherwise the user
 * closed it (main says so, `onPanelWindowClosed`), or the app is quitting, when it stays out
 * for next time. Without word from main, it's docked a little later unless this page is going too.
 */
function gone(id: PanelId, name: string, w: Window) {
  leaveWindow(w);
  stopStyleSync(w);
  if (closingByPage.delete(name)) return;
  if (store().open[id]?.name === name) {
    usePanelWindowsStore.setState((s) => {
      const open = { ...s.open };
      delete open[id];
      return { open };
    });
  }
  setTimeout(() => {
    if (!unloading && active && !store().open[id]) store().dock(id);
  }, 1500);
}

try {
  onPanelWindowClosed((name) => {
    if (closingByPage.has(name)) return;
    const id = name.split(":")[1] as PanelId;
    if (PANEL_IDS.includes(id)) store().dock(id);
  });
} catch {
  // No preload (tests of the page alone).
}
window.addEventListener("beforeunload", () => (unloading = true));
window.addEventListener("pagehide", () => (unloading = true));

// The window's document: this one's stylesheets (Tailwind, fonts, the theme), its classes, and
// a root for the panel.
function prepareDocument(w: Window, id: PanelId): HTMLElement {
  const doc = w.document;
  doc.title = `${PANEL_TITLES[id]} — OpenRip`;
  doc.documentElement.lang = document.documentElement.lang;
  doc.documentElement.className = document.documentElement.className;
  doc.body.className = document.body.className;
  doc.body.style.margin = "0";
  startStyleSync(w);
  // Files dropped where nothing takes them would replace the page.
  doc.addEventListener("dragover", (e) => e.preventDefault());
  doc.addEventListener("drop", (e) => e.preventDefault());
  const root = doc.createElement("div");
  root.id = "openrip-panel-root";
  root.className = "fixed inset-0 flex flex-col font-poppins text-center bg-brand-background-dark";
  doc.body.appendChild(root);
  return root;
}

const styleNodes = (doc: Document) => [...doc.head.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')];

function cloneStyle(node: HTMLElement, doc: Document): HTMLElement {
  if (node instanceof HTMLLinkElement) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = node.href; // absolute
    if (node.media) link.media = node.media;
    return link;
  }
  const style = doc.createElement("style");
  let text = node.textContent ?? "";
  // Rules added through the CSSOM aren't in the text.
  if (!text.trim()) {
    try {
      text = [...((node as HTMLStyleElement).sheet?.cssRules ?? [])].map((r) => r.cssText).join("\n");
    } catch {
      text = "";
    }
  }
  style.textContent = text;
  return style;
}

const styleSyncs = new Map<Window, { observer: MutationObserver; copies: HTMLElement[] }>();

/** Copy this document's stylesheets into `w`, and again whenever they change (dev reloads, lazy chunks). */
function startStyleSync(w: Window) {
  const copy = () => {
    const sync = styleSyncs.get(w);
    if (!sync || w.closed) return;
    for (const c of sync.copies) c.remove();
    sync.copies = styleNodes(document).map((n) => cloneStyle(n, w.document));
    for (const c of sync.copies) w.document.head.appendChild(c);
  };
  let pending = false;
  const isStyle = (n: Node | null) => !!n && (n.nodeName === "STYLE" || (n.nodeName === "LINK" && (n as HTMLLinkElement).rel === "stylesheet"));
  const observer = new MutationObserver((records) => {
    const touched = records.some((r) =>
      r.type === "characterData" ? isStyle(r.target.parentNode) : isStyle(r.target) || [...r.addedNodes, ...r.removedNodes].some(isStyle),
    );
    if (!touched || pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      copy();
    });
  });
  styleSyncs.set(w, { observer, copies: [] });
  copy();
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
}

function stopStyleSync(w: Window) {
  styleSyncs.get(w)?.observer.disconnect();
  styleSyncs.delete(w);
}
