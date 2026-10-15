import { create } from "zustand";

export type MaskTool = "lasso" | "shape" | "draw";
export type MaskShapeTool = "rectangle" | "ellipse" | "polygon" | "star";

interface MaskState {
  tool: MaskTool;
  shape: MaskShapeTool;
  brushSize: number;
  featherAmount: number;
  activeMaskId: string | null;
  isMaskDragging: boolean;
  isOverMask: boolean;
  setTool: (tool: MaskTool) => void;
  setShape: (shape: MaskShapeTool) => void;
  setBrushSize: (size: number) => void;
  setFeatherAmount: (amount: number) => void;
  setActiveMaskId: (id: string | null) => void;
  setIsMaskDragging: (isDragging: boolean) => void;
  setIsOverMask: (isOverMask: boolean) => void;
}

export const useMaskStore = create<MaskState>((set) => ({
  tool: "lasso",
  shape: "rectangle",
  brushSize: 10,
  featherAmount: 2,
  activeMaskId: null,
  isMaskDragging: false,
  isOverMask: false,
  setTool: (tool) => set({ tool }),
  setShape: (shape) => set({ shape }),
  setBrushSize: (brushSize) => set({ brushSize }),
  setFeatherAmount: (featherAmount) => set({ featherAmount }),
  setActiveMaskId: (activeMaskId) => set({ activeMaskId }),
  setIsMaskDragging: (isMaskDragging) => set({ isMaskDragging }),
  setIsOverMask: (isOverMask) => set({ isOverMask }),
}));
