import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The player's view settings, kept between sessions (CapCut keeps them too):
 *
 * - the preview's quality while playing, CapCut's Full / High / Medium / Low. Playback renders
 *   at this fraction of the canvas's size on screen; paused frames and exports always render
 *   in full;
 * - the colour oscilloscope (header menu ▸ Color oscilloscope) and which of its scopes show;
 * - the rulers (⌘⌥R) and whether the project's guides show (⌘;). The guides themselves belong
 *   to the project (lib/guides.ts);
 * - the safe-area overlay, the bottom bar's toggle where CapCut has its platform overlay.
 */
export type PreviewQuality = "full" | "high" | "medium" | "low";

/** The engine's render scale for each quality, as a fraction of the canvas's size on screen. */
export const QUALITY_SCALE: Record<PreviewQuality, number> = { full: 1, high: 0.75, medium: 0.5, low: 0.25 };

export type ScopeKind = "parade" | "waveform" | "vectorscope";
/** CapCut's order, left to right under the canvas. */
export const SCOPE_KINDS: ScopeKind[] = ["parade", "waveform", "vectorscope"];

interface PlayerState {
  quality: PreviewQuality;
  setQuality: (quality: PreviewQuality) => void;
  /** The colour oscilloscope under the canvas. */
  scopes: boolean;
  setScopes: (on: boolean) => void;
  /** Which scopes it shows (all three by default, as CapCut). */
  scopeKinds: ScopeKind[];
  toggleScopeKind: (kind: ScopeKind) => void;
  rulers: boolean;
  setRulers: (on: boolean) => void;
  /** Whether the project's guides are drawn (and snapped to). */
  showGuides: boolean;
  setShowGuides: (on: boolean) => void;
  safeAreas: boolean;
  setSafeAreas: (on: boolean) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      quality: "full",
      setQuality: (quality) => set({ quality }),
      scopes: false,
      setScopes: (scopes) => set({ scopes }),
      scopeKinds: [...SCOPE_KINDS],
      toggleScopeKind: (kind) =>
        set((s) => {
          const on = s.scopeKinds.includes(kind);
          // At least one scope stays: hiding them all is the Show item's job.
          if (on && s.scopeKinds.length === 1) return {};
          return { scopeKinds: SCOPE_KINDS.filter((k) => (k === kind ? !on : s.scopeKinds.includes(k))) };
        }),
      rulers: false,
      setRulers: (rulers) => set({ rulers }),
      showGuides: true,
      setShowGuides: (showGuides) => set({ showGuides }),
      safeAreas: false,
      setSafeAreas: (safeAreas) => set({ safeAreas }),
    }),
    {
      name: "openrip:player",
      version: 1,
      // Before: quality as the fraction itself (1, 0.5, 0.25) and `guides` for the safe areas.
      migrate: (old: any, version) => {
        if (version >= 1 || !old || typeof old !== "object") return old;
        const quality: PreviewQuality = old.quality === 0.5 ? "medium" : old.quality === 0.25 ? "low" : "full";
        const { guides, ...rest } = old;
        return { ...rest, quality, safeAreas: guides === true };
      },
    },
  ),
);
