#!/usr/bin/env node
// Brings the gl-transitions collection (https://github.com/gl-transitions/gl-transitions, MIT
// and BSD, each transition keeps its author's licence) into the engine and the app:
//
//   node engine/scripts/gen-gl-transitions.mjs <dir of the npm package "gl-transitions">
//
// - copies each chosen transition's WGSL (the collection's own translation of the GLSL, header
//   with author and licence kept) to engine/crates/render/src/glt/<name>.wgsl;
// - writes engine/crates/render/src/glt/table.rs: the shaders with their uniform layouts and
//   default parameters;
// - writes apps/app/packages/renderer/src/lib/glTransitions.ts: the panel's entries (OpenRip's
//   own names and categories, parameter controls).
//
// Fetch the package with `npm pack gl-transitions@1` into an empty folder and unpack it there.
// Not run in the build: the outputs are committed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkg = process.argv[2];
if (!pkg) throw new Error("usage: gen-gl-transitions.mjs <gl-transitions package dir>");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const shaderDir = path.join(root, "engine/crates/render/src/glt");
const tsOut = path.join(root, "apps/app/packages/renderer/src/lib/glTransitions.ts");

// name in the collection: [OpenRip's name, category, per-parameter overrides {label?, min?, max?, step?}]
const CHOSEN = {
  // Basic
  fadecolor: ["Fade through color", "Basic", { colorPhase: { label: "Color hold" } }],
  fadegrayscale: ["Fade through gray", "Basic"],
  colorphase: ["Staggered channels", "Basic"],
  HSVfade: ["Hue cycle fade", "Basic"],
  // Slide
  Directional: ["Drift push", "Slide"],
  "directional-easing": ["Eased drift push", "Slide"],
  DirectionalScaled: ["Shrinking push", "Slide", { scale: { min: 0.2, max: 1, step: 0.05 } }],
  LeftRight: ["Shrink left, slide in", "Slide"],
  TopBottom: ["Shrink up, slide in", "Slide"],
  x_axis_translation: ["Slide away, then fade", "Slide"],
  splitSlideInHorizontal: ["Split in, sideways", "Slide"],
  splitSlideInVertical: ["Split in, vertical", "Slide"],
  // Wipe
  directionalwipe: ["Soft diagonal wipe", "Wipe"],
  directionalwarp: ["Warped diagonal wipe", "Wipe"],
  angular: ["Clock wipe", "Wipe"],
  Radial: ["Radial sweep", "Wipe", { smoothness: { min: 0, max: 1.5, step: 0.05 } }],
  windowslice: ["Vertical slices", "Wipe"],
  windowblinds: ["Blinds", "Wipe"],
  wind: ["Ragged wipe", "Wipe"],
  static_wipe: ["Static edge wipe", "Wipe"],
  BowTieWithParameter: ["Bow tie, adjustable", "Wipe", { adjust: { min: 0, max: 1, step: 0.05 } }],
  HorizontalOpen: ["Open up and down", "Wipe"],
  VerticalOpen: ["Open left and right", "Wipe"],
  // Mask
  circleopen: ["Soft circle", "Mask"],
  circle: ["Circle closes", "Mask"],
  CircleCrop: ["Circle crop", "Mask"],
  Rectangle: ["Rectangle grows", "Mask"],
  RectangleCrop: ["Rectangle crop", "Mask"],
  Box: ["Shrink into box", "Mask"],
  heart: ["Heart reveal", "Mask"],
  StarWipe: ["Star reveal", "Mask"],
  polar_function: ["Flower reveal", "Mask", { segments: { min: 2, max: 12, step: 1 } }],
  pinwheel: ["Pinwheel reveal", "Mask"],
  perlin: ["Noise blobs", "Mask"],
  // Pattern
  PolkaDotsCurtain: ["Polka dots", "Pattern"],
  chessboard: ["Chessboard", "Pattern"],
  randomsquares: ["Random squares", "Pattern"],
  BlockDissolve: ["Block dissolve", "Pattern", { blocksize: { min: 0.005, max: 0.2, step: 0.005 } }],
  squareswire: ["Diagonal squares", "Pattern"],
  TilesWave: ["Tile wave", "Pattern"],
  hexagonalize: ["Hexagons", "Pattern"],
  pixelize: ["Pixelate", "Pattern"],
  mosaic_transition: ["Mosaic blocks", "Pattern"],
  // Camera
  CrossZoom: ["Zoom blur fade", "Camera"],
  SimpleZoom: ["Zoom in, then fade", "Camera"],
  SimpleZoomOut: ["Zoom out into place", "Camera"],
  ZoomLeftWipe: ["Zoom, wipe from right", "Camera"],
  zoomInOut: ["Zoom to a flat color", "Camera"],
  crosswarp: ["Zoom cross warp", "Camera"],
  "scale-in": ["Scale in", "Camera"],
  DreamyZoom: ["Dreamy zoom", "Camera"],
  Revolve_Left: ["Revolving swirl", "Camera"],
  tangentMotionBlur: ["Flung motion blur", "Camera"],
  rotateTransition: ["Rotate cross fade", "Camera"],
  rotate_scale_fade: ["Spin and zoom away", "Camera"],
  RotateScaleVanish: ["Spin and vanish", "Camera"],
  // Blur
  LinearBlur: ["Blur fade", "Blur"],
  DefocusBlur: ["Defocus fade", "Blur"],
  // Light
  burn: ["Glow toward a color", "Light"],
  burn0: ["Burning edges", "Light"],
  FilmBurn: ["Film light leak", "Light"],
  Overexposure: ["Overexposure", "Light"],
  EdgeTransition: ["Glowing edges", "Light"],
  dissolve: ["Hot dissolve", "Light"],
  undulatingBurnOut: ["Wavy burn out", "Light"],
  // Glitch
  GlitchDisplace: ["Block displace", "Glitch"],
  GlitchMemories: ["Color shift blocks", "Glitch"],
  Drop_Zone_Flicker: ["Flicker glitch", "Glitch"],
  StripDatamoshGlitch: ["Datamosh strips", "Glitch"],
  parametric_glitch: ["Band glitch", "Glitch"],
  old_tv_lost_signal: ["Lost signal", "Glitch"],
  // Distortion
  Dreamy: ["Dreamy waves", "Distortion"],
  WaterDrop: ["Water drop", "Distortion"],
  ripple: ["Ripples", "Distortion"],
  ButterflyWaveScrawler: ["Wave scribble", "Distortion"],
  CrazyParametricFun: ["Curve warp", "Distortion"],
  Swirl: ["Swirl", "Distortion"],
  kaleidoscope: ["Kaleidoscope", "Distortion"],
  powerKaleido: ["Folding kaleidoscope", "Distortion"],
  flyeye: ["Fly eye", "Distortion"],
  morph: ["Color morph", "Distortion"],
  "coord-from-in": ["Color displace", "Distortion"],
  DoomScreenTransition: ["Melt down", "Distortion"],
  luminance_melt: ["Luminance melt", "Distortion"],
  ColourDistance: ["Color distance", "Distortion"],
  ZoomInCircles: ["Zoom rings", "Distortion"],
  squeeze: ["Squeeze to a line", "Distortion"],
  fragment: ["Shatter", "Distortion"],
  // 3D
  cube: ["Cube turn", "3D"],
  doorway: ["Double doors", "3D"],
  swap: ["Swap places", "3D"],
  BookFlip: ["Book page", "3D"],
  InvertedPageCurl: ["Page curl", "3D"],
  SimpleFlip: ["Flip", "3D"],
  GridFlip: ["Grid flip", "3D"],
  Fold: ["Fold open", "3D"],
  Rolls: ["Roll away", "3D"],
  StereoViewer: ["Stereo cards", "3D"],
  Bounce: ["Drop and bounce", "3D"],
  // Overlay
  multiply_blend: ["Multiply blend", "Overlay"],
};

const catalog = JSON.parse(fs.readFileSync(path.join(pkg, "gl-transitions.json"), "utf8"));
const layouts = JSON.parse(fs.readFileSync(path.join(pkg, "layouts.json"), "utf8"));
const byName = Object.fromEntries(catalog.map((t) => [t.name, t]));

const KIND = { float: "Float", int: "Int", bool: "Bool", vec2: "Vec2", vec3: "Vec3", vec4: "Vec4", ivec2: "IVec2" };
const label = (k) => {
  const s = k.replace(/^u_?/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};
const round = (x) => Math.round(x * 1000) / 1000;

fs.mkdirSync(shaderDir, { recursive: true });
for (const f of fs.readdirSync(shaderDir)) if (f.endsWith(".wgsl")) fs.unlinkSync(path.join(shaderDir, f));

const rust = [];
const ts = [];
const names = Object.keys(CHOSEN).sort((a, b) => a.localeCompare(b));
for (const name of names) {
  const t = byName[name];
  if (!t) throw new Error(`not in the collection: ${name}`);
  const layout = layouts[name];
  if (layout.textures.length) throw new Error(`${name} needs extra textures`);
  const [title, category, over = {}] = CHOSEN[name];
  fs.copyFileSync(path.join(pkg, "wgsl", `${name}.wgsl`), path.join(shaderDir, `${name}.wgsl`));
  const params = layout.uniforms.filter((u) => u.name !== "progress" && u.name !== "ratio");
  const rp = params.map((u) => {
    const d = t.params[u.name]?.default;
    const v = Array.isArray(d) ? d : [d === true ? 1 : d === false ? 0 : d];
    const four = [0, 1, 2, 3].map((i) => (v[i] !== undefined ? v[i] : i === 3 && u.type === "vec3" ? 1 : 0));
    return `GlParam { name: ${JSON.stringify(u.name)}, kind: Kind::${KIND[u.type]}, offset: ${u.offset}, default: [${four.map((x) => Number(x).toFixed(4)).join(", ")}] }`;
  });
  rust.push(
    `    GlTransition {\n        id: "gl_${name}",\n        author: ${JSON.stringify(t.author)},\n        license: ${JSON.stringify(t.license)},\n        size: ${layout.size},\n        wgsl: include_str!("${name}.wgsl"),\n        params: &[\n${rp.map((x) => `            ${x},`).join("\n")}\n        ],\n    },`,
  );
  const tp = params.map((u) => {
    const meta = t.params[u.name] ?? {};
    const o = over[u.name] ?? {};
    const d = meta.default;
    const base = { key: u.name, label: o.label ?? label(u.name) };
    if (u.type === "bool") return { ...base, kind: "bool", default: !!d };
    if (u.type === "vec3" || u.type === "vec4") {
      const c = d.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("");
      return meta.color ? { ...base, kind: "color", default: `#${c}`, ...(u.type === "vec4" ? { alpha: round(d[3]) } : {}) } : { ...base, kind: "color", default: `#${c}` };
    }
    if (u.type === "vec2") {
      if (/direction/i.test(u.name)) return { ...base, kind: "direction", default: d };
      return { ...base, kind: "point", default: d };
    }
    if (u.type === "ivec2") return { ...base, kind: "int2", default: d, min: 1, max: 40 };
    // float / int: a slider range around the default unless the collection says one.
    const integer = u.type === "int";
    let min = o.min ?? meta.min;
    let max = o.max ?? meta.max;
    if (min === undefined || max === undefined) {
      const a = Math.abs(d);
      if (d === 0) [min, max] = [0, 1];
      else if (d < 0) [min, max] = [d * 2.5, -d * 2.5];
      else [min, max] = [0, a <= 1 ? Math.max(1, round(a * 2.5)) : Math.ceil(a * 2.5)];
    }
    const step = o.step ?? meta.step ?? (integer ? 1 : max - min > 20 ? 1 : max - min > 2 ? 0.1 : 0.01);
    return { ...base, kind: integer ? "int" : "float", default: d, min, max, step };
  });
  ts.push({ type: `gl_${name}`, name: title, category, author: t.author, license: t.license, params: tp });
}

fs.writeFileSync(
  path.join(shaderDir, "table.rs"),
  `// Generated by engine/scripts/gen-gl-transitions.mjs from the gl-transitions collection
// (https://github.com/gl-transitions/gl-transitions, MIT unless a transition says otherwise;
// each .wgsl keeps its author and licence in its header). Don't edit by hand.

use super::{GlParam, GlTransition, Kind};

pub static TABLE: &[GlTransition] = &[
${rust.join("\n")}
];
`,
);

fs.writeFileSync(
  tsOut,
  `// Generated by engine/scripts/gen-gl-transitions.mjs: the gl-transitions collection
// (https://github.com/gl-transitions/gl-transitions; MIT, two BSD) as the panel lists it, with
// OpenRip's own names and categories. The engine draws them (engine/crates/render/src/glt).
// Don't edit by hand.

export type GlParamDef =
  | { key: string; label: string; kind: "float" | "int"; default: number; min: number; max: number; step: number }
  | { key: string; label: string; kind: "bool"; default: boolean }
  | { key: string; label: string; kind: "color"; default: string; alpha?: number }
  | { key: string; label: string; kind: "direction" | "point"; default: [number, number] }
  | { key: string; label: string; kind: "int2"; default: [number, number]; min: number; max: number };

export type GlTransitionDef = { type: string; name: string; category: string; author: string; license: string; params: GlParamDef[] };

export const GL_TRANSITIONS: GlTransitionDef[] = [
${ts.map((t) => "  " + JSON.stringify(t)).join(",\n")},
];
`,
);
console.log(`${names.length} transitions`);
