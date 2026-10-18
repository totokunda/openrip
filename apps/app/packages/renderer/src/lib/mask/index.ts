import { create } from "zustand";

export type MaskTool = "lasso" | "shape" | "draw" | "pen";
export type MaskShapeTool = "rectangle" | "ellipse" | "polygon" | "star";

interface MaskState {
  tool: MaskTool;
  shape: MaskShapeTool;
  brushSize: number;
  // The mask brush erases (the Mask tab's Eraser; ⌥ while drawing does too)
  erase: boolean;
  featherAmount: number;
  activeMaskId: string | null;
  isMaskDragging: boolean;
  isOverMask: boolean;
  setTool: (tool: MaskTool) => void;
  setShape: (shape: MaskShapeTool) => void;
  setBrushSize: (size: number) => void;
  setErase: (erase: boolean) => void;
  setFeatherAmount: (amount: number) => void;
  setActiveMaskId: (id: string | null) => void;
  setIsMaskDragging: (isDragging: boolean) => void;
  setIsOverMask: (isOverMask: boolean) => void;
}

export const useMaskStore = create<MaskState>((set) => ({
  tool: "lasso",
  shape: "rectangle",
  brushSize: 10,
  erase: false,
  // CapCut's Feather, 0–100: new masks start hard-edged.
  featherAmount: 0,
  activeMaskId: null,
  isMaskDragging: false,
  isOverMask: false,
  setTool: (tool) => set({ tool }),
  setShape: (shape) => set({ shape }),
  setBrushSize: (brushSize) => set({ brushSize }),
  setErase: (erase) => set({ erase }),
  setFeatherAmount: (featherAmount) => set({ featherAmount }),
  setActiveMaskId: (activeMaskId) => set({ activeMaskId }),
  setIsMaskDragging: (isMaskDragging) => set({ isMaskDragging }),
  setIsOverMask: (isOverMask) => set({ isOverMask }),
}));
