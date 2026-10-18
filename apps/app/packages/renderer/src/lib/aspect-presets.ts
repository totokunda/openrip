// The canvas sizes offered for a new project on the home screen and in the player's Ratio
// menu, named by what they're for.
export interface AspectPreset {
  id: string;
  name: string;
  width: number;
  height: number;
}

export const ASPECT_PRESETS: AspectPreset[] = [
  { id: "16:9", name: "Wide", width: 16, height: 9 },
  { id: "9:16", name: "Vertical", width: 9, height: 16 },
  { id: "1:1", name: "Square", width: 1, height: 1 },
  { id: "4:3", name: "Classic", width: 4, height: 3 },
  { id: "4:5", name: "Social", width: 4, height: 5 },
  { id: "21:9", name: "Cinema", width: 21, height: 9 },
  { id: "2:3", name: "Portrait", width: 2, height: 3 },
];

/** A box of the ratio's shape that fits in `size` × `size` (for drawing the ratio as a frame). */
export const ratioBox = (width: number, height: number, size: number) => {
  const r = width / height;
  if (!Number.isFinite(r) || r <= 0) return { width: size, height: size };
  return r >= 1 ? { width: size, height: size / r } : { width: size * r, height: size };
};
