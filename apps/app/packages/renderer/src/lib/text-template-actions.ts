// What the Text tab's templates do in the app (lib/text-templates.ts holds the templates and lays
// them out, purely): add one at the playhead as a group on new tracks, in one undo step; draw its
// previews with the engine (so a tile and the player show what an export draws); and keep the
// favourites. The stores are loaded when a function needs them, so the pure files stay testable.
import { create } from "zustand";
import { engineProjectPreviews } from "@app/preload";
import { DESIGN_CANVAS, templateLayout, templatePlacement, type TextTemplate } from "./text-templates.ts";
import type { AnyClipProps } from "./types";

// ---- adding -----------------------------------------------------------------------------------

/**
 * Add `template` at the playhead (or `startFrame`): a track for each layer, the layers' clips on
 * them (the first at the back), and a group of them all (CapCut's compound clip), selected on
 * its Text template tab, where the words are edited. All of it is one undo step. Returns the
 * group's id.
 */
export const addTemplate = async (template: TextTemplate, opts: { startFrame?: number } = {}): Promise<string | null> => {
  const [{ v4: uuidv4 }, { useClipStore, getTimelineHeightForClip }, { useControlsStore }, { useViewportStore }, { useInspectorStore }, { BASE_LONG_SIDE, DEFAULT_FPS }] = await Promise.all([
    import("uuid"),
    import("./clip"),
    import("./control"),
    import("./viewport"),
    import("./inspector"),
    import("./settings"),
  ]);
  const clips = useClipStore.getState();
  const controls = useControlsStore.getState();
  const { aspectRatio } = useViewportStore.getState();
  const ratio = aspectRatio.width / aspectRatio.height;
  const canvas = { width: BASE_LONG_SIDE * (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9), height: BASE_LONG_SIDE };
  const layout = templateLayout(template, {
    fps: controls.fps || DEFAULT_FPS,
    canvas,
    startFrame: Math.max(0, Math.round(opts.startFrame ?? controls.focusFrame)),
    ids: () => ({ clipId: uuidv4(), timelineId: uuidv4() }),
  });
  // A track on top for each layer, the group's above them all.
  for (const { clip, layer } of layout) {
    clips.addTimeline({ timelineId: clip.timelineId, type: layer.kind === "text" ? "text" : "shape", timelineY: 0, timelineHeight: getTimelineHeightForClip(clip.type as any), timelineWidth: 0, muted: false, hidden: false }, -1);
    clips.addClip(clip as AnyClipProps);
  }
  clips.addTimeline({ type: "media", timelineY: 0, timelineHeight: getTimelineHeightForClip("group"), timelineWidth: 0, muted: false, hidden: false }, -1);
  const ids = layout.map((l) => l.clip.clipId);
  clips.groupClips(ids);
  const group = useClipStore.getState().clips.find((c) => c.type === "group" && (c as any).children?.flat().includes(ids[0]));
  if (!group) return null;
  clips.updateClip(group.clipId, { template: { id: template.id, name: template.name } } as Partial<AnyClipProps>);
  controls.setSelectedClipIds([group.clipId]);
  useInspectorStore.getState().setTab("template");
  return group.clipId;
};

// ---- favourites -------------------------------------------------------------------------------

const FAVOURITES_KEY = "openrip:text-template-favourites";

const readFavourites = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** The templates starred in the library, and the one clicked to preview in the player. */
export const useTemplateLibrary = create<{
  favourites: string[];
  toggleFavourite: (id: string) => void;
  preview: TextTemplate | null;
  setPreview: (t: TextTemplate | null) => void;
}>((set, get) => ({
  favourites: readFavourites(),
  toggleFavourite: (id) => {
    const now = get().favourites;
    const next = now.includes(id) ? now.filter((f) => f !== id) : [...now, id];
    try {
      localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
    } catch {
      // storage can be blocked; the favourites last the session
    }
    set({ favourites: next });
  },
  preview: null,
  setPreview: (preview) => set({ preview }),
}));

// ---- previews ---------------------------------------------------------------------------------

export type PreviewFrame = { width: number; height: number; rgba: Uint8Array };

const FPS = 24;
const BACKDROP = "#1d1b22";
const tick = (frame: number) => String(Math.round((frame / FPS) * 1e6));
/** The sentinels a clip's open-ended trims are saved as. */
const TRIM_START = "1";
const TRIM_END = "2";

/**
 * A project of just the template over its backdrop, in the app's own format (as autosave writes
 * it), for the engine to draw. `placed` keeps the template where it sits on a 16:9 canvas;
 * otherwise it's in the middle of it.
 */
export const previewProject = (template: TextTemplate, placed: boolean, aspect = { width: 1920, height: 1080 }): string => {
  const ratio = aspect.width / aspect.height;
  const canvas = { width: DESIGN_CANVAS.height * ratio, height: DESIGN_CANVAS.height };
  const layout = templateLayout(placed ? template : { ...template, place: undefined }, { fps: FPS, canvas, startFrame: 0, ids: (() => { let n = 0; return () => ({ clipId: `c${n}`, timelineId: `t${n++}` }); })() });
  const back = { type: "shape", clipId: "backdrop", timelineId: "tb", shapeType: "rectangle", fill: template.backdrop ?? BACKDROP, fillOpacity: 100, fillEnabled: true, strokeEnabled: false, strokeWidth: 0, transform: { x: 0, y: 0, width: canvas.width, height: canvas.height, scaleX: 1, scaleY: 1, rotation: 0, cornerRadius: 0, opacity: 100 }, startFrame: 0, endFrame: Math.round(template.seconds * FPS) };
  const all = [back as any, ...layout.map((l) => l.clip as any)];
  const clips = all.map((c) => {
    const { startFrame, endFrame, trimStart, trimEnd, ...rest } = c;
    return { ...rest, startTick: tick(startFrame), endTick: tick(endFrame), trimStartTick: trimStart === Infinity ? TRIM_START : "0", trimEndTick: trimEnd === -Infinity ? TRIM_END : "0" };
  });
  const tracks = [...all].reverse().map((c) => ({ type: c.type === "text" ? "text" : "shape", timelineId: c.timelineId, muted: false, hidden: false }));
  return JSON.stringify({
    version: "1.0.0",
    meta: { id: `template-${template.id}`, name: template.name, projectId: 0 },
    settings: { fps: FPS, aspectRatio: { width: aspect.width, height: aspect.height, id: "preview" } },
    assets: {},
    timeline: { tracks, clips },
  });
};

/** Where a tile's picture is cut from the canvas, as fractions of it: the template's block with room around it. */
export const tileCrop = (template: TextTemplate): [number, number, number, number] => {
  const canvas = DESIGN_CANVAS;
  const { x, y, width, height } = templatePlacement({ ...template, place: undefined }, canvas);
  // Room around it, and no wider than 4.2:1 (a long strip shows its start).
  const pad = Math.max(width, height) * 0.06 + 6;
  const h = Math.min(canvas.height, height + pad * 2);
  const w = Math.min(canvas.width, Math.min(width + pad * 2, h * 4.2));
  const left = Math.min(Math.max(0, x - pad), canvas.width - w);
  const top = Math.min(Math.max(0, y + height / 2 - h / 2), canvas.height - h);
  return [left / canvas.width, top / canvas.height, w / canvas.width, h / canvas.height];
};

/** What the engine draws a tile at: about twice its size across. */
const renderSize = (crop: number[]) => {
  const width = Math.round(Math.min(1600, Math.max(560, 360 / crop[2])));
  return { width, height: Math.round((width * 9) / 16) };
};

// The engine draws one project at a time; the tiles ask in turn.
let queue: Promise<unknown> = Promise.resolve();
const turn = <T>(run: () => Promise<T>): Promise<T> => {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
};

const draw = async (template: TextTemplate, times: number[], placed: boolean, aspect?: { width: number; height: number }): Promise<PreviewFrame[]> => {
  const { registerBundledFonts } = await import("./fonts");
  await registerBundledFonts().catch(() => 0);
  const crop = placed ? null : tileCrop(template);
  const size = placed ? { width: 640, height: Math.round(640 / ((aspect?.width ?? 16) / (aspect?.height ?? 9))) } : renderSize(crop!);
  return engineProjectPreviews(previewProject(template, placed, aspect), times, size.width, size.height, crop);
};

const stills = new Map<string, Promise<PreviewFrame | null>>();
const loops = new Map<string, Promise<PreviewFrame[]>>();
/** Frames of a hovered tile's loop: the template's first seconds, 12 a second. */
export const LOOP_FPS = 12;
const loopTimes = (t: TextTemplate) => Array.from({ length: Math.max(2, Math.round(Math.min(t.seconds, 5) * LOOP_FPS)) }, (_, i) => i / LOOP_FPS);

/** The picture a tile shows: the template a little way in, drawn by the engine (cached). */
export const templateStill = (t: TextTemplate): Promise<PreviewFrame | null> => {
  let p = stills.get(t.id);
  if (!p) {
    p = turn(() => draw(t, [t.seconds * 0.6], false)).then((f) => f[0] ?? null).catch(() => null);
    stills.set(t.id, p);
  }
  return p;
};

/** The frames a hovered tile plays, from the start (cached). */
export const templateLoop = (t: TextTemplate): Promise<PreviewFrame[]> => {
  let p = loops.get(t.id);
  if (!p) {
    p = turn(() => draw(t, loopTimes(t), false)).catch(() => []);
    loops.set(t.id, p);
  }
  return p;
};

/** The frames the player shows for a clicked tile: the whole canvas, the template where it would be added. */
export const templatePlayerLoop = (t: TextTemplate, aspect: { width: number; height: number }): Promise<PreviewFrame[]> =>
  turn(() => draw(t, loopTimes(t), true, aspect)).catch(() => []);
