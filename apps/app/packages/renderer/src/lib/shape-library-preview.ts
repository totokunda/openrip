import { create } from "zustand";
import type { LibraryShape } from "./shape-presets";

/**
 * The Shapes tile being previewed in the player (components/preview/ShapeLibraryPreview.tsx):
 * a click on a tile shows the shape over the canvas, as CapCut's library does, without
 * adding anything. Cleared by adding a shape, by leaving the tab and by a click elsewhere.
 */
type State = { shape: LibraryShape | null; set: (shape: LibraryShape | null) => void };
export const useShapePreviewStore = create<State>((set) => ({ shape: null, set: (shape) => set({ shape }) }));
