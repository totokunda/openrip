// A Hald CLUT applied to a picture on the CPU: the same maths as the engine's filter
// (engine/crates/render, Lut3d::from_hald and filter.wgsl's fs_lut3d). The image is a square of
// side level³ holding level⁶ entries, entry r + n·g + n²·b (n = level²) at that index read row
// by row; a colour reads it at its corners (c × (n − 1)) with trilinear interpolation. The Filters
// tab renders its tiles with this, so a tile shows what the timeline will.

/** The Hald level of a square image of this side (the smallest l with l³ ≥ side), 2 to 16. */
export const haldLevel = (side: number): number => {
  for (let l = 2; l <= 16; l++) if (l * l * l >= side) return l;
  return 0;
};

/**
 * `src` (RGBA bytes) through the table `hald` (RGBA bytes, width × height), mixed in at
 * `strength` (0 to 1). Returns new RGBA bytes; alpha is kept.
 */
export function applyHald(src: Uint8ClampedArray, hald: Uint8ClampedArray, width: number, height: number, strength = 1): Uint8ClampedArray {
  const level = haldLevel(Math.min(width, height));
  const n = level * level;
  const out = new Uint8ClampedArray(src.length);
  if (!level || width * height < n * n * n) {
    out.set(src);
    return out;
  }
  const top = n - 1;
  const nn = n * n;
  for (let i = 0; i < src.length; i += 4) {
    const r = Math.min(top, (src[i] / 255) * top);
    const g = Math.min(top, (src[i + 1] / 255) * top);
    const b = Math.min(top, (src[i + 2] / 255) * top);
    const r0 = Math.floor(r), g0 = Math.floor(g), b0 = Math.floor(b);
    const r1 = Math.min(r0 + 1, top), g1 = Math.min(g0 + 1, top), b1 = Math.min(b0 + 1, top);
    const fr = r - r0, fg = g - g0, fb = b - b0;
    const o000 = (r0 + n * g0 + nn * b0) * 4, o100 = (r1 + n * g0 + nn * b0) * 4;
    const o010 = (r0 + n * g1 + nn * b0) * 4, o110 = (r1 + n * g1 + nn * b0) * 4;
    const o001 = (r0 + n * g0 + nn * b1) * 4, o101 = (r1 + n * g0 + nn * b1) * 4;
    const o011 = (r0 + n * g1 + nn * b1) * 4, o111 = (r1 + n * g1 + nn * b1) * 4;
    for (let ch = 0; ch < 3; ch++) {
      const c00 = hald[o000 + ch] + (hald[o100 + ch] - hald[o000 + ch]) * fr;
      const c10 = hald[o010 + ch] + (hald[o110 + ch] - hald[o010 + ch]) * fr;
      const c01 = hald[o001 + ch] + (hald[o101 + ch] - hald[o001 + ch]) * fr;
      const c11 = hald[o011 + ch] + (hald[o111 + ch] - hald[o011 + ch]) * fr;
      const c0 = c00 + (c10 - c00) * fg;
      const c1 = c01 + (c11 - c01) * fg;
      const looked = c0 + (c1 - c0) * fb;
      const orig = src[i + ch];
      out[i + ch] = orig + (looked - orig) * strength;
    }
    out[i + 3] = src[i + 3];
  }
  return out;
}
