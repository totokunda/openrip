// The cover choice in the project and whether the cover editor is open: kept apart from
// lib/cover.ts (which reads the project stores) so the project's persistence can use it
// without a loop between the modules.
import { create } from "zustand";

/** A line of text on the cover: its centre and size as fractions of the cover, so it scales with it. */
export interface CoverText {
  id: string;
  text: string;
  /** Centre, 0..1 across and down the cover. */
  x: number;
  y: number;
  /** Font size as a fraction of the cover's height. */
  size: number;
  color: string;
  bold: boolean;
}

export type CoverSource = { kind: "frame"; timeUs: number } | { kind: "image"; path: string };

/** What the cover editor saved, enough to open it again. */
export interface CoverSpec {
  source: CoverSource;
  texts: CoverText[];
}

interface CoverState {
  /** The open project's chosen cover; null while it follows the first frame by itself. */
  cover: CoverSpec | null;
  setCover: (cover: CoverSpec | null) => void;
  /** The cover editor is open. */
  open: boolean;
  openEditor: () => void;
  closeEditor: () => void;
}

export const useCoverStore = create<CoverState>((set) => ({
  cover: null,
  setCover: (cover) => set({ cover }),
  open: false,
  openEditor: () => set({ open: true }),
  closeEditor: () => set({ open: false }),
}));
