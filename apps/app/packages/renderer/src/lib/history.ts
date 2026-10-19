// Undo and redo for the open project. The history keeps states of the project's document (its
// clips, tracks, markers, assets, canvas and main track magnet), not commands: every edit in
// the app goes through the stores, so recording what they hold covers every panel, tool and
// shortcut without each one knowing about undo. The stores replace what they change and keep the rest, so states share
// everything an edit didn't touch and a step costs about what the edit changed. Putting a
// state back goes through the stores too, so the autosave writes it and the engine syncs it.
// See docs/plan/app-engine-integration.md.
import { create } from "zustand";
import { onMenuEdit } from "@app/preload";
import { inputDocument } from "./window-group";
import _ from "lodash";
import { useClipStore, pruneAssetsForClips } from "./clip";
import { useControlsStore } from "./control";
import { useViewportStore } from "./viewport";
import type { AnyClipProps, Asset, Guide, Marker, TimelineProps } from "./types";
import type { CompoundFrame } from "./compound";

/** The part of the stores an undo puts back. Playhead, selection, zoom and views aren't in it. */
type Doc = {
  clips: AnyClipProps[];
  timelines: TimelineProps[];
  assets: Record<string, Asset>;
  clipDuration: number;
  aspectRatio: { width: number; height: number; id: string };
  /** Project settings' Custom resolution, or null (Adapted). */
  canvasSize: { width: number; height: number } | null;
  /** The frame rate: a change rescales the clips, which are in the document too. */
  fps: number;
  markers: Marker[];
  magnet: boolean;
  guides: Guide[];
  /** The timelines left to open the compound clip being edited (`clips` and `timelines` are its content's); empty on the main timeline. */
  stack: CompoundFrame[];
};

/**
 * A step that changes something outside the document (Link to media points the library's
 * links at other files): undoing or redoing it runs these, and the document stays as it is.
 */
export type Effect = { undo: () => void | Promise<void>; redo: () => void | Promise<void> };

/** A state in the history and the clips that were selected while it was the current one. */
type Entry = { doc: Doc; selection: string[]; effect?: Effect };

/** How many steps can be undone. */
const LIMIT = 100;

let past: Entry[] = [];
let future: Entry[] = [];
/** The stores' state as last seen; null while a project loads (nothing is recorded). */
let present: Doc | null = null;
/** While a state is being put back: its own changes aren't edits. */
let restoring = false;
/** Whether a state is being put back (an undo or redo): what the stores do then isn't an edit to follow. */
export const isRestoring = () => restoring;
/** Inside withoutHistory. */
let folding = 0;

/** Whether there's something to undo or redo, for buttons. */
export const useHistoryStore = create<{ canUndo: boolean; canRedo: boolean }>(() => ({
  canUndo: false,
  canRedo: false,
}));

const publish = () => {
  const next = { canUndo: present != null && past.length > 0, canRedo: present != null && future.length > 0 };
  const now = useHistoryStore.getState();
  if (now.canUndo !== next.canUndo || now.canRedo !== next.canRedo) useHistoryStore.setState(next);
};

/** Make a step of something done outside the document, which undo and redo run again. */
export function recordEffect(effect: Effect) {
  if (present == null) return;
  past.push({ doc: present, selection: useControlsStore.getState().selectedClipIds, effect });
  if (past.length > LIMIT) past.shift();
  future = [];
  // What the app does in answer (assets read again) isn't another step.
  stepAction = action;
  publish();
}

const readDoc = (): Doc => {
  const c = useClipStore.getState();
  return {
    clips: c.clips,
    timelines: c.timelines,
    assets: c.assets,
    clipDuration: c.clipDuration,
    aspectRatio: useViewportStore.getState().aspectRatio,
    canvasSize: useViewportStore.getState().canvasSize,
    fps: useControlsStore.getState().fps,
    markers: c.markers,
    magnet: c.magnet,
    guides: c.guides,
    stack: c.compoundStack,
  };
};

/**
 * Whether two states show the same project. Assets aren't compared: they follow the clips
 * (the store keeps those the clips use), and a change to one is new media info, not an edit.
 * Cheap on states that share most of their objects: equal references aren't looked into.
 */
const sameDoc = (a: Doc, b: Doc) =>
  _.isEqual(a.clips, b.clips) &&
  _.isEqual(a.timelines, b.timelines) &&
  _.isEqual(a.aspectRatio, b.aspectRatio) &&
  _.isEqual(a.canvasSize, b.canvasSize) &&
  a.fps === b.fps &&
  (a.stack === b.stack || _.isEqual(a.stack, b.stack)) &&
  _.isEqual(a.markers, b.markers) &&
  _.isEqual(a.guides, b.guides) &&
  a.magnet === b.magnet;

const shallowEqual = (a: object, b: object) => {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && (a as any)[k] === (b as any)[k]);
};

/**
 * `doc` for keeping, sharing clips with `next` (the state beside it in the history). Most
 * edits copy every clip on their way through the store (to sort them), though only one or
 * two changed: a copy that equals its neighbour's clip field for field is kept as that one,
 * so a step holds only the clips the edit changed.
 */
const share = (doc: Doc, next: Doc | undefined): Doc => {
  if (!next || doc.clips === next.clips) return doc;
  const byId = new Map(next.clips.map((c) => [c.clipId, c] as const));
  const clips = doc.clips.map((c) => {
    const other = byId.get(c.clipId);
    return other && other !== c && shallowEqual(c, other) ? other : c;
  });
  return { ...doc, clips };
};

// Which user action a change belongs to. Each press of a mouse button or a key (held keys
// repeat without counting) starts a new action, and every change until the next press belongs
// to it: a drag of a slider, a clip or a handle is one step however many changes it makes,
// and so are the changes the app makes by itself after an edit (a track left empty being
// removed, a new clip's box being fitted). Typing in a field is one action while the keys
// come less than a second apart.
let action = 0;
/** The action the current state was made by: its changes go into it rather than a new step. */
let stepAction = -1;
let pointerDown = false;
let typingIn: EventTarget | null = null;
let typedAt = 0;

const editable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

// The selection before the current task. Edits that select what they make (a split, a
// group, a paste) select it in the same task as the edit, before the clip store announces
// the edit; the step keeps the selection from before, which an undo brings back.
let selectionBefore: string[] = [];
let selectionQueued = false;

const onChange = () => {
  if (present == null || restoring) return;
  const next = readDoc();
  // The assets and the duration follow the clips: a change to them alone (media info coming
  // in for a new import) is folded in, as is one that leaves the project as it was.
  const followsOnly =
    next.clips === present.clips &&
    next.timelines === present.timelines &&
    next.aspectRatio === present.aspectRatio &&
    next.canvasSize === present.canvasSize &&
    next.fps === present.fps &&
    next.stack === present.stack &&
    next.markers === present.markers &&
    next.guides === present.guides &&
    next.magnet === present.magnet;
  if (folding > 0 || followsOnly || action === stepAction || sameDoc(present, next)) {
    present = next;
    return;
  }
  past.push({ doc: share(present, past[past.length - 1]?.doc), selection: selectionBefore });
  if (past.length > LIMIT) past.shift();
  future = [];
  stepAction = action;
  present = next;
  publish();
};

let subscribed = false;
const subscribe = () => {
  if (subscribed) return;
  subscribed = true;
  useClipStore.subscribe((s, p) => {
    if (
      s.clips !== p.clips ||
      s.timelines !== p.timelines ||
      s.assets !== p.assets ||
      s.clipDuration !== p.clipDuration ||
      s.markers !== p.markers ||
      s.guides !== p.guides ||
      s.magnet !== p.magnet ||
      s.compoundStack !== p.compoundStack
    ) {
      onChange();
    }
  });
  useViewportStore.subscribe((s, p) => {
    if (s.aspectRatio !== p.aspectRatio || s.canvasSize !== p.canvasSize) onChange();
  });
  useControlsStore.subscribe((s, p) => {
    if (s.fps !== p.fps) onChange();
    if (s.selectedClipIds === p.selectedClipIds || selectionQueued) return;
    selectionQueued = true;
    queueMicrotask(() => {
      selectionQueued = false;
      selectionBefore = useControlsStore.getState().selectedClipIds;
    });
  });
};

/** The canvas an undo or redo put back last. */
let restoredAspect: Doc["aspectRatio"] | null = null;

/**
 * Whether this canvas came back with an undo or redo. The preview moves every clip to the
 * middle when the canvas changes size, as part of that edit; a state put back has its clips
 * where they were, so the preview leaves them.
 */
export const isRestoredAspect = (aspectRatio: unknown) => aspectRatio != null && aspectRatio === restoredAspect;

/** Put a state back into the stores, with its selection where its clips are still there. */
const restore = (entry: Entry) => {
  const { clips, timelines, clipDuration, aspectRatio, canvasSize, fps, markers, magnet, guides, stack } = entry.doc;
  const clipStore = useClipStore.getState();
  // Assets are the media's metadata: the newest of each, for the clips that use them.
  const assets = pruneAssetsForClips({ ...entry.doc.assets, ...clipStore.assets }, clips);
  const ids = new Set(clips.map((c) => c.clipId));
  const selection = entry.selection.filter((id) => ids.has(id));
  const maskId = useControlsStore.getState().selectedMaskId;
  const maskKept = !!maskId && clips.some((c) => ((c as any).masks ?? []).some((m: any) => m?.id === maskId));
  restoring = true;
  try {
    // The frame rate goes back with its clips: the timeline's frame counts scale with it, as
    // when it was changed (setFpsWithRescale).
    const controls = useControlsStore.getState();
    if (fps !== controls.fps && fps > 0) {
      const k = fps / Math.max(1, controls.fps);
      const total = Math.max(0, Math.round(controls.totalTimelineFrames * k));
      useControlsStore.setState({
        fps,
        totalTimelineFrames: total,
        timelineDuration: [Math.round(controls.timelineDuration[0] * k), Math.round(controls.timelineDuration[1] * k)],
        focusFrame: Math.max(0, Math.min(Math.max(0, total - 1), Math.round(controls.focusFrame * k))),
      });
    }
    clipStore._updateZoomLevel(clips, clipDuration);
    useClipStore.setState({ clips, timelines, assets, clipDuration, markers, magnet, guides, compoundStack: stack, mainPreview: null });
    if (aspectRatio !== useViewportStore.getState().aspectRatio) {
      restoredAspect = aspectRatio;
      useViewportStore.setState({ aspectRatio, canvasSize, shouldUpdateViewport: true });
    } else if (canvasSize !== useViewportStore.getState().canvasSize) {
      useViewportStore.setState({ canvasSize });
    }
    useControlsStore.setState({ selectedClipIds: selection, ...(maskKept ? {} : { selectedMaskId: null }) });
  } finally {
    restoring = false;
  }
  present = readDoc();
  selectionBefore = selection;
  // What the app does in answer (clips mounting again, the engine laying out text) belongs to
  // this state, not to a new step.
  stepAction = action;
};

/** Undo the last step. Does nothing during a drag. */
export function undo() {
  if (present == null || pointerDown) return;
  // A step that came back to where it began (a drag returned to its start) changes nothing.
  let entry = past.pop();
  while (entry && !entry.effect && sameDoc(entry.doc, present)) entry = past.pop();
  if (entry?.effect) {
    future.unshift({ doc: present, selection: useControlsStore.getState().selectedClipIds, effect: entry.effect });
    void entry.effect.undo();
  } else if (entry) {
    future.unshift({ doc: share(present, entry.doc), selection: useControlsStore.getState().selectedClipIds });
    restore(entry);
  }
  publish();
}

/** Redo the last undone step. Does nothing during a drag. */
export function redo() {
  if (present == null || pointerDown) return;
  const entry = future.shift();
  if (entry?.effect) {
    past.push({ doc: present, selection: useControlsStore.getState().selectedClipIds, effect: entry.effect });
    void entry.effect.redo();
  } else if (entry) {
    past.push({ doc: share(present, entry.doc), selection: useControlsStore.getState().selectedClipIds });
    if (past.length > LIMIT) past.shift();
    restore(entry);
  }
  publish();
}

/**
 * Run `fn` and fold what it changes into the current state instead of making a step: for
 * changes the app makes by itself that undo shouldn't take back on their own (the engine's
 * new layout of a text after an edit; undone, the edit takes it with it).
 */
export function withoutHistory(fn: () => void) {
  folding++;
  try {
    fn();
  } finally {
    folding--;
  }
}

/**
 * Make the next change a step of its own, without a press: for an edit applied when work the
 * user started in the background finishes (Split scenes, Color match), whatever was pressed
 * meanwhile. Everything it changes in the same task belongs to that step.
 */
export function beginStep() {
  action++;
}

/** Stop recording while a project loads, and forget the last project's steps. */
export function pauseHistory() {
  present = null;
  past = [];
  future = [];
  publish();
}

/** Start an empty history from what the stores hold now: once a project has loaded. */
export function resetHistory() {
  subscribe();
  past = [];
  future = [];
  present = readDoc();
  selectionBefore = useControlsStore.getState().selectedClipIds;
  // Changes before the user's first action (clips fitting their boxes as they mount) are part
  // of the project as opened.
  stepAction = action;
  publish();
}

let initialized = false;

/** Follow the user's presses, which tell edits apart. Safe to call more than once. */
export function initHistory() {
  if (initialized) return;
  initialized = true;
  subscribe();
  const opts = { capture: true };
  window.addEventListener(
    "pointerdown",
    () => {
      action++;
      pointerDown = true;
      typingIn = null;
    },
    opts,
  );
  const release = () => {
    pointerDown = false;
  };
  window.addEventListener("pointerup", release, opts);
  window.addEventListener("pointercancel", release, opts);
  window.addEventListener("blur", release);
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat || ["Meta", "Control", "Shift", "Alt", "CapsLock"].includes(e.key)) return;
      if (editable(e.target)) {
        const sameField = e.target === typingIn && e.timeStamp - typedAt < 1000;
        typingIn = e.target;
        typedAt = e.timeStamp;
        if (sameField) return;
      } else {
        typingIn = null;
      }
      action++;
    },
    opts,
  );
  // Files dropped from the Finder come without a press in the window.
  window.addEventListener("drop", () => action++, opts);
  // Edit ▸ Undo and Redo in the menu bar: a focused field's typing, as the menu would undo
  // it, else the project. The field can be in a panel's own window (lib/panel-windows.ts).
  onMenuEdit((cmd) => {
    const doc = inputDocument();
    if (editable(doc.activeElement)) doc.execCommand(cmd);
    else if (cmd === "undo") undo();
    else redo();
  });
}
