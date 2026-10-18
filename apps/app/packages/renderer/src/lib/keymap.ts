// The keyboard shortcuts: every action the Shortcuts window lists (CapCut's, in its order, in
// its four tabs, and OpenRip's own after them), the keys each has, and which action a key
// press is. The handlers ask here: lib/timeline-shortcuts.ts (the timeline and the player) and
// components/controls/Controls.tsx (editing: undo, copy, delete, …), so a key the user moves
// in the Shortcuts window moves what it does.
//
// A key is a chord written "Mod+Shift+B": modifiers in that order (Mod is ⌘ on macOS and Ctrl
// elsewhere; Ctrl is the Mac's ⌃), then the key by its place on the keyboard (`KeyboardEvent.code`
// shortened: letters and digits bare, others by name, "Equal", "BracketLeft", "ArrowLeft",
// "Space"…), so ⌥ changing the letter doesn't matter. An action may have several keys; the
// window shows the first, and a new one replaces them all.
//
// The bindings live in the preferences (lib/preferences.ts): five presets, CapCut's
// "Shortcut 1–5", each keeping only what differs from the defaults.
import { create } from "zustand";
import { setMenuState } from "@app/preload";
import { preferences, usePreferencesStore, type Preferences } from "./preferences";
import type { I18nKey } from "./i18n";

export type ShortcutCategory = "timeline" | "player" | "basic" | "other";

export type ShortcutAction = {
  id: string;
  category: ShortcutCategory;
  label: I18nKey;
  /** The default keys (chords). */
  keys: string[];
  /** OpenRip can't do this yet: listed, dimmed, no key. */
  missing?: boolean;
  /**
   * Shown but not changed here: a mouse gesture, a key the system or the canvas tools own.
   * `keys` (when any) still count for conflicts; `show` is what the row shows.
   */
  fixed?: boolean;
  show?: string[];
};

const a = (id: string, category: ShortcutCategory, keys: string[], more: Partial<ShortcutAction> = {}): ShortcutAction => ({
  id,
  category,
  label: `action.${id}` as I18nKey,
  keys,
  ...more,
});
const missing = { missing: true };

/** Every action, by tab, in CapCut's order (OpenRip's own last). */
export const ACTIONS: ShortcutAction[] = [
  // Timeline
  a("split", "timeline", ["Mod+B"]),
  a("splitAll", "timeline", ["Mod+Shift+B"]),
  a("selectMode", "timeline", [], missing),
  a("splitMode", "timeline", [], missing),
  a("selectLeft", "timeline", ["BracketLeft"]),
  a("selectRight", "timeline", ["BracketRight"]),
  a("magnet", "timeline", ["P"]),
  a("snapping", "timeline", ["N"]),
  a("linkage", "timeline", ["Backquote"]),
  a("previewAxis", "timeline", [], missing),
  a("zoomIn", "timeline", ["Mod+Equal", "Mod+Shift+Equal", "Mod+NumpadAdd"]),
  a("zoomOut", "timeline", ["Mod+Minus", "Mod+NumpadSubtract"]),
  a("zoomScroll", "timeline", [], missing),
  a("scrollUpDown", "timeline", [], { fixed: true, show: ["Scroll"] }),
  a("scrollLeftRight", "timeline", [], { fixed: true, show: ["Shift", "Scroll"] }),
  a("activateClip", "timeline", [], missing),
  a("extractAudio", "timeline", ["Ctrl+Shift+S", "Mod+Shift+S"]),
  a("addMarker", "timeline", ["M"]),
  a("addMarkerColor", "timeline", [], missing),
  a("nextMarker", "timeline", ["Shift+M", "Alt+ArrowRight"]),
  a("prevMarker", "timeline", ["Alt+Shift+M", "Alt+ArrowLeft"]),
  a("prevFrame", "timeline", ["ArrowLeft"]),
  a("nextFrame", "timeline", ["ArrowRight"]),
  a("firstFrame", "timeline", ["Home"]),
  a("lastFrame", "timeline", ["End"]),
  a("shuttleLeft", "timeline", [], missing),
  a("shuttleStop", "timeline", [], missing),
  a("shuttleRight", "timeline", [], missing),
  a("deleteLeft", "timeline", ["Q"]),
  a("deleteRight", "timeline", ["W"]),
  a("keyframePanel", "timeline", ["Alt+K"]),
  a("addKeyframeOnPanel", "timeline", [], missing),
  a("addKeyframe", "timeline", [], missing),
  a("easeIn", "timeline", [], missing),
  a("easeOut", "timeline", [], missing),
  a("easing", "timeline", [], missing),
  a("linear", "timeline", [], missing),
  a("adjustProperties", "timeline", [], missing),
  a("stepForwardMany", "timeline", ["Shift+ArrowRight"]),
  a("stepBackMany", "timeline", ["Shift+ArrowLeft"]),
  a("zoomToFit", "timeline", ["Shift+Z"]),
  a("freeze", "timeline", []),
  a("reverse", "timeline", []),
  a("mirror", "timeline", []),
  a("rotate", "timeline", []),
  a("crop", "timeline", [], missing),
  a("trimClip", "timeline", [], missing),
  a("prevEdit", "timeline", ["ArrowUp"]),
  a("nextEdit", "timeline", ["ArrowDown"]),
  // Player
  a("playPause", "player", ["Space"]),
  a("fullScreenPreview", "player", ["Mod+Shift+F"]),
  a("cancelAlignment", "player", [], missing),
  a("zoomInPlayer", "player", ["Alt+Shift+Equal"]),
  a("zoomOutPlayer", "player", ["Alt+Shift+Minus"]),
  a("zoomFitPlayer", "player", ["Alt+Shift+Z", "Mod+0"]),
  a("showRulers", "player", ["Mod+Alt+R"]),
  a("showGuides", "player", ["Mod+Semicolon"]),
  a("zoom50Player", "player", ["Mod+5"]),
  a("zoom100Player", "player", ["Mod+1"]),
  a("zoom200Player", "player", ["Mod+2"]),
  // Basic
  a("copy", "basic", ["Mod+C"]),
  a("cut", "basic", ["Mod+X"]),
  a("paste", "basic", ["Mod+V"]),
  a("copyAttributes", "basic", [], missing),
  a("pasteAttributes", "basic", [], missing),
  a("delete", "basic", ["Backspace", "Delete"]),
  a("undo", "basic", ["Mod+Z"]),
  a("redo", "basic", ["Mod+Shift+Z", "Mod+Y"]),
  a("importMedia", "basic", ["Mod+I"]),
  a("exportStill", "basic", [], missing),
  a("export", "basic", ["Mod+E"]),
  a("newProject", "basic", ["Mod+N"]),
  a("switchPanel", "basic", [], missing),
  a("backToEdit", "basic", [], missing),
  a("quit", "basic", ["Mod+Q"], { fixed: true }),
  a("fullScreen", "basic", ["Mod+Ctrl+F"], { fixed: true }),
  a("exitFullScreen", "basic", ["Escape"], { fixed: true }),
  a("selectAll", "basic", ["Mod+A"]),
  a("group", "basic", ["Mod+G"]),
  a("ungroup", "basic", ["Mod+Shift+G"]),
  // Other: the preview's tools keep their letters (Controls.tsx handles them). There is no
  // draw tool: CapCut draws no freehand lines (its drawing is Stickers ▸ Shapes and the Pen).
  a("resizeTextCenter", "other", [], missing),
  a("pointerTool", "other", ["V"], { fixed: true }),
  a("handTool", "other", ["H"], { fixed: true }),
  a("textTool", "other", ["T"], { fixed: true }),
  a("shapeTool", "other", ["S"], { fixed: true }),
];

export const ACTION_BY_ID = new Map(ACTIONS.map((x) => [x.id, x]));
export const PRESETS = [1, 2, 3, 4, 5];

export const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");

const MOD_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];

/** A chord with its modifiers in order (and the Mac's Ctrl as Mod elsewhere). */
export const normalizeChord = (chord: string): string => {
  const parts = chord.split("+").filter(Boolean);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((m) => (!isMac && m === "Ctrl" ? "Mod" : m)));
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join("+");
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "OS", "Hyper", "Super"]);

/** The key of a press as a chord's last part, or null for a modifier alone. */
export const keyOf = (e: KeyboardEvent): string | null => {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const code = e.code || "";
  if (/^(Shift|Control|Alt|Meta|OS)(Left|Right)$/.test(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code) return code;
  // No code (synthetic events): the key itself.
  if (e.key.length === 1) return /[a-z]/i.test(e.key) ? e.key.toUpperCase() : e.key === " " ? "Space" : e.key;
  return e.key || null;
};

/** A key press as a chord ("Mod+Shift+B"), or null for a modifier alone. */
export const chordOf = (e: KeyboardEvent): string | null => {
  const key = keyOf(e);
  if (!key) return null;
  const mods: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push("Mod");
  if (isMac && e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return [...mods, key].join("+");
};

/** Each action's keys in a preset: the defaults, with what the preset changed. */
export const bindingsFor = (prefs: Preferences, preset: number = prefs.shortcutPreset): Record<string, string[]> => {
  const changed = prefs.shortcutPresets?.[String(preset)] ?? {};
  const out: Record<string, string[]> = {};
  for (const x of ACTIONS) {
    if (x.missing) out[x.id] = [];
    else if (!x.fixed && Array.isArray(changed[x.id])) out[x.id] = changed[x.id].map(normalizeChord);
    else out[x.id] = x.keys.map(normalizeChord);
  }
  return out;
};

/** What a preset keeps: only the actions whose keys differ from the defaults. */
export const presetChanges = (bindings: Record<string, string[]>): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const x of ACTIONS) {
    if (x.missing || x.fixed) continue;
    const now = bindings[x.id] ?? [];
    const def = x.keys.map(normalizeChord);
    if (JSON.stringify(now) !== JSON.stringify(def)) out[x.id] = now;
  }
  return out;
};

/** The action using `chord` in `bindings`, other than `except`. */
export const actionUsing = (bindings: Record<string, string[]>, chord: string, except?: string): ShortcutAction | undefined => {
  const c = normalizeChord(chord);
  return ACTIONS.find((x) => x.id !== except && !x.missing && (bindings[x.id] ?? []).includes(c));
};

interface KeymapState {
  bindings: Record<string, string[]>;
  /** chord → action id, for the actions the handlers run. */
  lookup: Map<string, string>;
}

const build = (prefs: Preferences): KeymapState => {
  const bindings = bindingsFor(prefs);
  const lookup = new Map<string, string>();
  for (const x of ACTIONS) {
    if (x.missing || x.fixed) continue;
    for (const c of bindings[x.id] ?? []) if (!lookup.has(c)) lookup.set(c, x.id);
  }
  return { bindings, lookup };
};

export const useKeymapStore = create<KeymapState>(() => build(preferences()));

/** The Electron accelerator for a chord (the menu bar's Undo and Redo follow the bindings). */
export const acceleratorOf = (chord: string | undefined): string => {
  if (!chord) return "";
  const parts = chord.split("+");
  const key = parts.pop() ?? "";
  const names: Record<string, string> = {
    Equal: "=", Minus: "-", BracketLeft: "[", BracketRight: "]", Backquote: "`", Semicolon: ";", Quote: "'",
    Comma: ",", Period: ".", Slash: "/", Backslash: "\\", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up",
    ArrowDown: "Down", Escape: "Esc", NumpadAdd: "numadd", NumpadSubtract: "numsub",
  };
  const mods = parts.map((m) => (m === "Mod" ? "CmdOrCtrl" : m === "Ctrl" ? "Control" : m));
  return [...mods, names[key] ?? key].join("+");
};

let started = false;

/** Follow the preferences: rebuild the lookup and tell the menu bar Undo's and Redo's keys. */
export function initKeymap() {
  if (started) return;
  started = true;
  const apply = (prefs: Preferences) => {
    const next = build(prefs);
    useKeymapStore.setState(next);
    try {
      setMenuState({ undo: acceleratorOf(next.bindings.undo?.[0]), redo: acceleratorOf(next.bindings.redo?.[0]) });
    } catch {
      // no menu bar (tests)
    }
  };
  apply(preferences());
  usePreferencesStore.subscribe((s, prev) => {
    if (s.prefs.shortcutPreset !== prev.prefs.shortcutPreset || s.prefs.shortcutPresets !== prev.prefs.shortcutPresets) apply(s.prefs);
  });
}

/** The action a key press is, or null. */
export const actionFor = (e: KeyboardEvent): string | null => {
  const chord = chordOf(e);
  return chord ? (useKeymapStore.getState().lookup.get(chord) ?? null) : null;
};

/** The first key of an action, for a tooltip ("Split (⌘B)"). */
export const shortcutHint = (id: string): string => {
  const c = useKeymapStore.getState().bindings[id]?.[0];
  return c ? keyLabels(c).join("") : "";
};

/** A tooltip naming an action's key as it is now: "Delete left (Q)", or the name alone. */
export const useShortcutTitle = (name: string, id: string): string => {
  const c = useKeymapStore((s) => s.bindings[id]?.[0]);
  return c ? `${name} (${keyLabels(c).join("")})` : name;
};

// ---- Showing keys ----

const MAC_MODS: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const PC_MODS: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
const KEY_GLYPHS: Record<string, string> = {
  Equal: "+", Minus: "−", BracketLeft: "[", BracketRight: "]", Backquote: "~", Semicolon: ";", Quote: "'",
  Comma: ",", Period: ".", Slash: "/", Backslash: "\\", ArrowLeft: "◀", ArrowRight: "▶", ArrowUp: "▲", ArrowDown: "▼",
  Backspace: "⌫", Delete: "⌦", Tab: "⇥", Enter: "↩", NumpadAdd: "+", NumpadSubtract: "−", Escape: "esc",
};
/** Keys drawn as a word on a light badge, as CapCut draws Space, Home and esc. */
export const NAMED_KEYS = new Set(["Space", "Home", "End", "esc", "PageUp", "PageDown", "Scroll", "Click"]);

/** A chord's badges, in order: "Mod+Shift+B" → ["⌘", "⇧", "B"]. */
export const keyLabels = (chord: string): string[] => {
  const parts = chord.split("+");
  const key = parts.pop() ?? "";
  const mods = parts.map((m) => (isMac ? MAC_MODS : PC_MODS)[m] ?? m);
  const shown = KEY_GLYPHS[key] ?? (key.startsWith("Numpad") ? key.slice(6) : key);
  return [...mods, shown];
};

/** What an action's row shows: its first key's badges, or its gesture. */
export const actionLabels = (x: ShortcutAction, bindings: Record<string, string[]>): string[] => {
  if (x.show) return x.show.map((s) => (s === "Shift" || s === "Mod" || s === "Alt" || s === "Ctrl" ? (isMac ? MAC_MODS : PC_MODS)[s] : s));
  const c = bindings[x.id]?.[0];
  return c ? keyLabels(c) : [];
};
