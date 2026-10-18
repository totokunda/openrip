// The editor's panels can be pulled out into windows of their own (lib/panel-windows.ts).
// They stay part of this window's React tree, rendered into the other window's document
// through a portal, so every store keeps a single copy. Their code listens on `window` and
// `document` (drags, keys, clicks outside, Konva's own drags) as it always has, and a
// ResizeObserver only sees its own window's layout. This module makes both reach the other
// windows:
//
// - a listener added to this window or document for an input event is added to every panel
//   window (or its document) too, now and when one opens later, so an event there reaches the
//   same handler with its own target and coordinates (Space plays, ⌘Z undoes, a drag that
//   started in a panel window follows the pointer there);
// - `ResizeObserver` observes each element through its own window's observer.
//
// It must run before anything adds listeners (Konva adds its drag listeners when it loads):
// main.tsx imports it first.

/** The events whose listeners follow the user's input into panel windows. */
const MIRRORED = new Set([
  "keydown",
  "keyup",
  "keypress",
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "mousedown",
  "mousemove",
  "mouseup",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
  "touchcancel",
  "dragover",
  "drop",
  "copy",
  "cut",
  "paste",
  "resize",
]);

type Kind = "window" | "document";
type Listener = EventListenerOrEventListenerObject;
type Options = boolean | AddEventListenerOptions | undefined;
/**
 * A mirrored listener: what was added, and what is actually registered in every window (the
 * same, or for a `once` listener a wrapper that takes it out of all of them when it fires in
 * one).
 */
type Rec = { type: string; listener: Listener; actual: Listener; options: Options; capture: boolean };

const records: Record<Kind, Rec[]> = { window: [], document: [] };
const others = new Set<Window>();
const nativeAdd = EventTarget.prototype.addEventListener;
const nativeRemove = EventTarget.prototype.removeEventListener;

const captureOf = (o: Options | EventListenerOptions) => (typeof o === "boolean" ? o : !!o?.capture);
const own = (kind: Kind): EventTarget => (kind === "window" ? window : document);
const targetIn = (w: Window, kind: Kind): EventTarget => (kind === "window" ? w : w.document);
const quietly = (f: () => void) => {
  try {
    f();
  } catch {
    // A window that's closing.
  }
};

function mirror(kind: Kind) {
  const target = own(kind);
  const add = function (type: string, listener: Listener | null, options?: Options) {
    if (!listener || !MIRRORED.has(type)) return nativeAdd.call(target, type, listener, options);
    const capture = captureOf(options);
    const list = records[kind];
    // Already there: as the browser does, nothing.
    if (list.some((r) => r.type === type && r.listener === listener && r.capture === capture)) return;
    const rec: Rec = { type, listener, actual: listener, options, capture };
    if (typeof options === "object" && options.once) {
      rec.actual = function (this: unknown, e: Event) {
        forget(kind, rec);
        return typeof listener === "function" ? listener.call(this, e) : listener.handleEvent(e);
      };
    }
    list.push(rec);
    nativeAdd.call(target, type, rec.actual, options);
    for (const w of others) quietly(() => targetIn(w, kind).addEventListener(type, rec.actual, options));
    const signal = typeof options === "object" ? options.signal : undefined;
    signal?.addEventListener("abort", () => forget(kind, rec), { once: true });
  };
  const remove = function (type: string, listener: Listener | null, options?: boolean | EventListenerOptions) {
    const capture = captureOf(options);
    const rec = listener && MIRRORED.has(type) ? records[kind].find((r) => r.type === type && r.listener === listener && r.capture === capture) : undefined;
    if (rec) forget(kind, rec);
    else nativeRemove.call(target, type, listener, options);
  };
  Object.defineProperty(target, "addEventListener", { value: add, configurable: true, writable: true });
  Object.defineProperty(target, "removeEventListener", { value: remove, configurable: true, writable: true });
}

function forget(kind: Kind, rec: Rec) {
  const list = records[kind];
  const i = list.indexOf(rec);
  if (i < 0) return;
  list.splice(i, 1);
  nativeRemove.call(own(kind), rec.type, rec.actual, rec.capture);
  for (const w of others) quietly(() => targetIn(w, kind).removeEventListener(rec.type, rec.actual, rec.capture));
}

/** The document the user last pressed, right-clicked or typed in: where a menu opens. */
let inputDoc: Document = document;
const noteInput = (e: Event) => {
  const node = e.target as Node | null;
  const doc = node && (node.nodeType === 9 ? (node as Document) : node.ownerDocument);
  if (doc) inputDoc = doc;
};
const INPUT_EVENTS = ["pointerdown", "contextmenu", "keydown"] as const;

/** The document of the window the user last pressed or typed in (this one, or a panel window). */
export function inputDocument(): Document {
  return inputDoc.defaultView && !inputDoc.defaultView.closed ? inputDoc : document;
}

/** The windows that make up the editor besides this one. */
export function panelWindows(): Window[] {
  return [...others];
}

/** A panel window joins: the listeners on this window and document reach it from now on. */
export function joinWindow(w: Window) {
  if (others.has(w)) return;
  others.add(w);
  for (const kind of ["window", "document"] as Kind[]) {
    for (const r of records[kind]) quietly(() => targetIn(w, kind).addEventListener(r.type, r.actual, r.options));
  }
  for (const type of INPUT_EVENTS) w.addEventListener(type, noteInput, true);
}

/** A panel window leaves (it's closing): its copies of the listeners go. */
export function leaveWindow(w: Window) {
  if (!others.delete(w)) return;
  for (const kind of ["window", "document"] as Kind[]) {
    for (const r of records[kind]) quietly(() => targetIn(w, kind).removeEventListener(r.type, r.actual, r.capture));
  }
  for (const type of INPUT_EVENTS) quietly(() => w.removeEventListener(type, noteInput, true));
  if (inputDoc.defaultView === w) inputDoc = document;
}

/**
 * A ResizeObserver that watches each element with its own window's observer: an observer only
 * sees the layout of the window it was made in, and panels can be in another one.
 */
const NativeResizeObserver = window.ResizeObserver;
class GroupResizeObserver implements ResizeObserver {
  #callback: ResizeObserverCallback;
  #byWindow = new Map<Window, ResizeObserver>();
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  #observerFor(el: Element): ResizeObserver {
    const w = (el.ownerDocument?.defaultView ?? window) as Window & { ResizeObserver: typeof ResizeObserver };
    let o = this.#byWindow.get(w);
    if (!o) {
      const Ctor = w === window ? NativeResizeObserver : w.ResizeObserver;
      o = new Ctor((entries) => this.#callback(entries, this));
      this.#byWindow.set(w, o);
    }
    return o;
  }
  observe(el: Element, options?: ResizeObserverOptions) {
    this.#observerFor(el).observe(el, options);
  }
  unobserve(el: Element) {
    quietly(() => this.#observerFor(el).unobserve(el));
  }
  disconnect() {
    for (const o of this.#byWindow.values()) quietly(() => o.disconnect());
    this.#byWindow.clear();
  }
}

if (typeof window !== "undefined" && !(window as any).__openripWindowGroup) {
  (window as any).__openripWindowGroup = true;
  mirror("window");
  mirror("document");
  for (const type of INPUT_EVENTS) nativeAdd.call(window, type, noteInput, true);
  if (NativeResizeObserver) (window as any).ResizeObserver = GroupResizeObserver;
}
