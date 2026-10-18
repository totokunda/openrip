import { create } from "zustand";

/**
 * The player's eyedropper (the chroma key's colour picker, as CapCut's): while a panel waits
 * for a colour, a click on the picture hands it the colour there, read from the engine's frame
 * (components/preview/Eyedropper.tsx). Escape or a second press of the button stops it.
 */
interface EyedropperState {
  /** What gets the picked colour (#rrggbb) while picking; null otherwise. */
  onPick: ((hex: string) => void) | null;
  /** Who's picking (a panel's name), so its button shows it's on. */
  owner: string | null;
  start: (owner: string, onPick: (hex: string) => void) => void;
  stop: () => void;
}

export const useEyedropperStore = create<EyedropperState>((set) => ({
  onPick: null,
  owner: null,
  start: (owner, onPick) => set({ owner, onPick }),
  stop: () => set({ owner: null, onPick: null }),
}));

/**
 * The colour of the engine's frame (the canvas it draws into, `canvas`) at a point given as
 * fractions of the picture, averaged over 3×3 pixels; null when there's no frame.
 */
export const sampleFrame = (canvas: HTMLCanvasElement | null, fx: number, fy: number): string | null => {
  if (!canvas || canvas.width < 2 || fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
  const t = document.createElement("canvas");
  t.width = canvas.width;
  t.height = canvas.height;
  const g = t.getContext("2d");
  if (!g) return null;
  g.drawImage(canvas, 0, 0);
  const x = Math.min(canvas.width - 2, Math.max(1, Math.round(fx * canvas.width)));
  const y = Math.min(canvas.height - 2, Math.max(1, Math.round(fy * canvas.height)));
  const d = g.getImageData(x - 1, y - 1, 3, 3).data;
  const mean = [0, 1, 2].map((k) => {
    let s = 0;
    for (let i = 0; i < 9; i++) s += d[i * 4 + k];
    return Math.round(s / 9);
  });
  return "#" + mean.map((v) => v.toString(16).padStart(2, "0")).join("");
};
