// The pictures on the Transitions and Effects tabs' tiles: real footage (a few small clips bundled
// in resources/preview-footage, see its CREDITS.txt) with the transition or effect drawn on it by
// the engine's own renderer, as the timeline would draw it. Each tile's pictures are one JPEG
// sheet of frames (the one the tile rests on, and the loop that plays when it's hovered), made
// the first time the tile is seen and kept in the rendering cache (Settings counts and clears it
// with the rest), named by a code of the engine's drawing of that transition or effect so it's
// made again when the engine changes it.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain, nativeImage } from "electron";
import { getSettingsModule } from "./SettingsModule.js";

type Frames = { width: number; height: number; data: Buffer }[];

/** The part of the engine's addon the previews use. */
export type TilePreviewEngine = {
  projectPreviews?(json: string, times: number[], width: number, height: number, crop: number[] | null): Promise<Frames>;
  previewRevision?(id: string, effect: boolean): string;
};

export type TilePreviewSpec =
  | { kind: "transition"; id: string; name: string; params?: Record<string, unknown> }
  | { kind: "effect"; id: string; name: string; intensity: number; params: Record<string, number> };

/** What a tile gets: the sheet's JPEG (`cols` frames across), the frame it rests on, and the loop's speed. */
export type TilePreview = { jpeg: Uint8Array; size: number; cols: number; frames: number; still: number; fps: number };

/** Bump when the clips, the framing or the sheet's layout change: every tile is then drawn again. */
const STYLE = "1";
/** A tile's frames (square, so a tile at 86 px is sharp at 2x). */
const SIZE = 172;
const FRAMES = 24;
const COLS = 6;
const FPS_PROJECT = 24;
/** Footage is 16:9; the tile shows its middle square. */
const CROP = [0.21875, 0, 0.5625, 1];
const CLIPS = ["street", "forest", "beach"];
/** A transition's moment: the cut at 3 s of a 1 s transition, the loop running a little either side of it. */
const CUT = 3;
const TRANSITION_SECONDS = 1;
const TRANSITION_LOOP: [number, number] = [2.2, 3.8];
/** The moment a transition's tile rests on (a third of the way in, where it reads even for the fades). */
const TRANSITION_STILL = 2.85;
/** An effect's run, and the moment its tile rests on. */
const EFFECT_SECONDS = 2;
const EFFECT_STILL = 0.7;

/** The folder of the clips: beside the app's resources when packaged, in apps/app/resources in development. */
function footageDir(): string | null {
  if (app.isPackaged) return join(process.resourcesPath, "preview-footage");
  let dir = app.getAppPath();
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, "resources", "preview-footage");
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

const box = { x: 0, y: 0, width: 1066.667, height: 600, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 };
const tick = (seconds: number) => String(Math.round(seconds * 1e6));
const clip = (id: string, asset: string, start: number, end: number, extra: Record<string, unknown> = {}) => ({
  type: "video",
  clipId: id,
  timelineId: "t1",
  clipPadding: 24,
  assetId: asset,
  startTick: tick(start),
  endTick: tick(end),
  trimStartTick: "0",
  trimEndTick: "0",
  speed: 1,
  reverse: false,
  volume: 0,
  mediaWidth: 360,
  mediaHeight: 202,
  mediaAspectRatio: 360 / 202,
  transform: box,
  ...extra,
});

/** The small project a tile is drawn from: two clips meeting at the transition, or one with the effect. */
function project(dir: string, spec: TilePreviewSpec): string {
  const pick = parseInt(hash(spec.id).slice(0, 6), 16);
  const [a, b] = [CLIPS[pick % CLIPS.length], CLIPS[(pick + 1) % CLIPS.length]];
  const asset = (name: string) => ({ id: name, path: `file://${join(dir, `${name}.mp4`).split("/").map(encodeURIComponent).join("/")}`, type: "video", duration: 3, width: 360, height: 202 });
  let clips: unknown[];
  let assets: Record<string, unknown>;
  if (spec.kind === "transition") {
    assets = { [a]: asset(a), [b]: asset(b) };
    clips = [
      clip("a", a, 0, CUT, { transitionOut: { type: spec.id, name: spec.name, duration: TRANSITION_SECONDS, ...(spec.params ? { params: spec.params } : {}) } }),
      clip("b", b, CUT, CUT + 3),
    ];
  } else {
    assets = { street: asset("street") };
    clips = [clip("a", "street", 0, EFFECT_SECONDS, { effects: [{ id: "e1", effectId: spec.id, name: spec.name, intensity: spec.intensity, params: spec.params }] })];
  }
  return JSON.stringify({
    version: "1.0.0",
    meta: { id: `tile-${spec.id}`, name: spec.name, projectId: 0 },
    settings: { fps: FPS_PROJECT, aspectRatio: { width: 1920, height: 1080, id: "16:9" } },
    assets,
    timeline: { tracks: [{ type: "media", timelineId: "t1", muted: false, hidden: false }], clips },
  });
}

/** The moments the tile's frames are drawn at, and the one it rests on. */
function moments(kind: TilePreviewSpec["kind"]): { times: number[]; still: number; fps: number } {
  if (kind === "transition") {
    const [from, to] = TRANSITION_LOOP;
    const times = Array.from({ length: FRAMES }, (_, i) => from + (i / FRAMES) * (to - from));
    return { times, still: Math.round(((TRANSITION_STILL - from) / (to - from)) * FRAMES), fps: FRAMES / (to - from) };
  }
  const times = Array.from({ length: FRAMES }, (_, i) => (i / FRAMES) * EFFECT_SECONDS);
  return { times, still: Math.round((EFFECT_STILL / EFFECT_SECONDS) * FRAMES), fps: FRAMES / EFFECT_SECONDS };
}

export class TilePreviews {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly engine: () => TilePreviewEngine | null) {}

  /** `engine-thumbnails/tile-previews`, inside the rendering cache Settings counts and clears. */
  private dir(): string {
    return join(getSettingsModule().renderCacheDir(), "tile-previews");
  }

  /** The tile's pictures, from the cache or drawn now (one at a time); null without the engine or the clips. */
  preview(spec: TilePreviewSpec): Promise<TilePreview | null> {
    const next = this.queue.then(() => this.make(spec));
    this.queue = next.catch(() => undefined);
    return next.catch((e) => {
      console.warn(`[tiles] ${spec.kind} ${spec.id} failed:`, e instanceof Error ? e.message : e);
      return null;
    });
  }

  private async make(spec: TilePreviewSpec): Promise<TilePreview | null> {
    const engine = this.engine();
    const footage = footageDir();
    if (!engine?.projectPreviews || !footage) return null;
    const { times, still, fps } = moments(spec.kind);
    const revision = engine.previewRevision?.(spec.id, spec.kind === "effect") ?? "";
    const code = hash([STYLE, revision, JSON.stringify(spec)].join("|")).slice(0, 16);
    const stem = `${spec.kind}-${spec.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    const file = join(this.dir(), `${stem}-${code}.jpg`);
    const result = (jpeg: Uint8Array): TilePreview => ({ jpeg, size: SIZE, cols: COLS, frames: FRAMES, still, fps });
    try {
      return result(new Uint8Array(await readFile(file)));
    } catch {
      // Not drawn yet.
    }
    const frames = await engine.projectPreviews(project(footage, spec), times, Math.round((SIZE * 16) / 9), SIZE, CROP);
    if (frames.length !== FRAMES) return null;
    const rows = Math.ceil(FRAMES / COLS);
    const width = COLS * SIZE;
    // The frames on one sheet, as BGRA (what nativeImage takes).
    const bitmap = Buffer.alloc(width * rows * SIZE * 4);
    frames.forEach((f, i) => {
      const [x0, y0] = [(i % COLS) * SIZE, Math.floor(i / COLS) * SIZE];
      for (let y = 0; y < Math.min(f.height, SIZE); y++) {
        for (let x = 0; x < Math.min(f.width, SIZE); x++) {
          const s = (y * f.width + x) * 4;
          const d = ((y0 + y) * width + x0 + x) * 4;
          bitmap[d] = f.data[s + 2];
          bitmap[d + 1] = f.data[s + 1];
          bitmap[d + 2] = f.data[s];
          bitmap[d + 3] = 255;
        }
      }
    });
    const jpeg = nativeImage.createFromBitmap(bitmap, { width, height: rows * SIZE }).toJPEG(80);
    await mkdir(this.dir(), { recursive: true });
    // Older pictures of this tile (from before the engine changed it) go.
    for (const name of await readdir(this.dir()).catch(() => [] as string[])) {
      if (name.startsWith(`${stem}-`) && name !== `${stem}-${code}.jpg`) await rm(join(this.dir(), name), { force: true }).catch(() => {});
    }
    await writeFile(file, jpeg);
    return result(new Uint8Array(jpeg));
  }

  register(): void {
    try {
      ipcMain.removeHandler("engine:tile-preview");
    } catch {}
    ipcMain.handle("engine:tile-preview", (_event, spec: TilePreviewSpec) => this.preview(spec));
  }
}
