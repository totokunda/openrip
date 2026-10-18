// The fonts a text can be set in, for the Text tab's font menu: the app's bundled web fonts
// (the @fontsource packages main.tsx imports, openly licensed) and the fonts installed on the
// system. The bundled ones are also handed to the engine, which draws them from the same
// files (WOFF2, one per script), so its text matches what the menu shows. See
// docs/plan/app-engine-integration.md ("Text styles and captions").
import { create } from "zustand";
import { engineFontFamilies, engineRegisterFonts, type EngineFontFace } from "@app/preload";

/** A family in the font menu. */
export type FontOption = { family: string; kind: "bundled" | "system" };

/**
 * Installed fonts offered without the engine (which lists what's really installed): the ones
 * every Mac and Windows machine has.
 */
const COMMON_SYSTEM_FONTS = ["Arial", "Helvetica", "Times New Roman", "Georgia", "Verdana", "Courier New", "Comic Sans MS", "Impact", "Trebuchet MS"];

const RECENT_KEY = "openrip:recent-fonts";
const RECENT_MAX = 5;

/** The first file URL in an `@font-face` `src` (a WOFF2 one if there is one). */
const srcUrl = (src: string): string | null => {
  const urls = [...src.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)\s*(?:format\(\s*["']?([\w-]+)["']?\s*\))?/g)];
  const pick = urls.find((m) => m[3] === "woff2") ?? urls[0];
  return pick ? pick[2] : null;
};

/**
 * The page's `@font-face` rules: each face's family, weight, slant, `unicode-range` and file
 * URL (absolute). The bundled fonts, as the page loads them.
 */
export function pageFontFaces(): EngineFontFace[] {
  const faces: EngineFontFace[] = [];
  const seen = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin's sheet
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const s = rule.style;
      const raw = srcUrl(s.getPropertyValue("src"));
      if (!raw) continue;
      let url: string;
      try {
        url = new URL(raw, sheet.href ?? document.baseURI).href;
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      const family = s.getPropertyValue("font-family").replace(/["']/g, "").trim();
      const weight = parseInt(s.getPropertyValue("font-weight"), 10);
      faces.push({
        family,
        weight: Number.isFinite(weight) ? weight : 400,
        italic: /italic|oblique/.test(s.getPropertyValue("font-style")),
        url,
        unicodeRange: s.getPropertyValue("unicode-range") || undefined,
      });
    }
  }
  return faces;
}

/** The bundled families, by name. */
const bundledFamilies = (faces: EngineFontFace[]) => [...new Set(faces.map((f) => f.family).filter(Boolean))].sort((a, b) => a.localeCompare(b));

const readRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
};

interface FontsState {
  bundled: string[];
  system: string[];
  /** Families picked lately, newest first (kept between sessions). */
  recent: string[];
  /** Whether the system's list came from the engine. */
  loaded: boolean;
  /** Read the bundled fonts from the page and the installed ones from the engine. */
  load: () => Promise<void>;
  /** Note a family as just picked. */
  use: (family: string) => void;
}

export const useFontsStore = create<FontsState>((set, get) => ({
  bundled: [],
  system: COMMON_SYSTEM_FONTS,
  recent: readRecent(),
  loaded: false,
  load: async () => {
    const bundled = bundledFamilies(pageFontFaces());
    set({ bundled });
    const families = await engineFontFamilies().catch(() => []);
    const installed = families.filter((f) => !f.bundled && !bundled.includes(f.name)).map((f) => f.name);
    if (installed.length) set({ system: installed, loaded: true });
  },
  use: (family) => {
    const recent = [family, ...get().recent.filter((f) => f !== family)].slice(0, RECENT_MAX);
    set({ recent });
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {}
  },
}));

/** Every family in the menu's order (bundled, then installed), each once. */
export const allFonts = (s: Pick<FontsState, "bundled" | "system">): FontOption[] => [
  ...s.bundled.map((family) => ({ family, kind: "bundled" as const })),
  ...s.system.filter((f) => !s.bundled.includes(f)).map((family) => ({ family, kind: "system" as const })),
];

let registered: Promise<number> | null = null;

/**
 * Hand the page's bundled fonts to the engine, once per page (before it first draws the
 * project), and fill the font menu's lists.
 */
export function registerBundledFonts(): Promise<number> {
  if (!registered) {
    registered = engineRegisterFonts(pageFontFaces()).catch(() => 0);
    void registered.then(() => useFontsStore.getState().load());
  }
  return registered;
}
