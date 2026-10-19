// OpenRip's own canvas patterns (the video's Canvas ▸ Style). The engine tiles them over the
// canvas (engine/crates/playback/src/pattern.rs); this is the same table and the same shapes,
// so a swatch here is what the canvas gets. `tests/compositing.test.ts` keeps the two lists
// of ids together.

export type CanvasPattern = { id: string; name: string; back: string; shape: string };

/** The patterns, in the order the panel lists them (the engine's `PATTERNS`). */
export const CANVAS_PATTERNS: CanvasPattern[] = [
  { id: "dots", name: "Dots", back: "#1f2a44", shape: "#f5c542" },
  { id: "stripes", name: "Stripes", back: "#f4e9d8", shape: "#e05a47" },
  { id: "diagonal", name: "Diagonal", back: "#126e82", shape: "#f2f2f2" },
  { id: "checks", name: "Checks", back: "#2b2b2b", shape: "#d9d9d9" },
  { id: "grid", name: "Grid", back: "#143d59", shape: "#5fb0e0" },
  { id: "plus", name: "Plus", back: "#f7d4e0", shape: "#9b3d68" },
  { id: "diamonds", name: "Diamonds", back: "#2e1a47", shape: "#ae81ce" },
  { id: "waves", name: "Waves", back: "#0c4a6e", shape: "#7fd1d8" },
  { id: "zigzag", name: "Zigzag", back: "#fff1a8", shape: "#f76b15" },
  { id: "triangles", name: "Triangles", back: "#1b4d3e", shape: "#a8e08a" },
  { id: "bricks", name: "Bricks", back: "#c46a4e", shape: "#f1e4d3" },
  { id: "rings", name: "Rings", back: "#3a3a4a", shape: "#e88fb3" },
];

const fract = (x: number) => x - Math.floor(x);

/** Whether the point (u, v) of a tile (0…1 across and down) is on the shape, not the background. */
export const onShape = (id: string, u: number, v: number): boolean => {
  const tri = (x: number) => 1 - Math.abs(2 * x - 1);
  switch (id) {
    case "dots":
      return Math.hypot(u - 0.5, v - 0.5) < 0.26;
    case "stripes":
      return u < 0.5;
    case "diagonal":
      return fract(u + v) < 0.5;
    case "checks":
      return u < 0.5 !== v < 0.5;
    case "grid":
      return u < 0.08 || v < 0.08;
    case "plus":
      return (Math.abs(u - 0.5) < 0.09 && Math.abs(v - 0.5) < 0.3) || (Math.abs(v - 0.5) < 0.09 && Math.abs(u - 0.5) < 0.3);
    case "diamonds":
      return Math.abs(u - 0.5) + Math.abs(v - 0.5) < 0.36;
    case "waves":
      return Math.abs(v - 0.5 - 0.22 * Math.sin(2 * Math.PI * u)) < 0.11;
    case "zigzag":
      return Math.abs(v - 0.2 - 0.6 * tri(u)) < 0.1;
    case "triangles":
      return v > 1 - tri(u) * 0.9 - 0.05 && v < 0.95;
    case "bricks": {
      const row = Math.floor(v * 2);
      return fract(v * 2) < 0.12 || fract(u + 0.5 * (row % 2)) < 0.06;
    }
    case "rings": {
      const r = Math.hypot(u - 0.5, v - 0.5);
      return r > 0.2 && r < 0.34;
    }
    default:
      return false;
  }
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Paint a pattern's tiles (`across` of them) onto a canvas, edges smoothed 4×4 as the engine does. */
export const drawPattern = (canvas: HTMLCanvasElement, p: CanvasPattern, across = 3) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const period = Math.max(2, Math.round(Math.min(width, height) / across));
  const [back, shape] = [rgb(p.back), rgb(p.shape)];
  const image = ctx.createImageData(width, height);
  const tile = new Float32Array(period * period);
  for (let y = 0; y < period; y++) {
    for (let x = 0; x < period; x++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) hit += onShape(p.id, (x + (sx + 0.5) / 4) / period, (y + (sy + 0.5) / 4) / period) ? 1 : 0;
      tile[y * period + x] = hit / 16;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = tile[(y % period) * period + (x % period)];
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(back[c] + (shape[c] - back[c]) * k);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
};
