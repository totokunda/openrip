// The Captions tab's actions: a subtitle file (.srt or .vtt) read onto a captions track in a
// chosen style, and the timeline's texts written out as an .srt. The parsing and the clips are
// lib/captions.ts's (pure); this file reads and writes the files through the preload and adds
// the clips through the clip store, one undo step per import. See
// docs/plan/app-engine-integration.md ("Text styles and captions").
import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { pickMediaPaths, pickSavePath, readFileBuffer, writeFileBuffer } from "@app/preload";
import { CAPTION_STYLE, captionClips, clipsToCues, parseCaptions, writeSrt } from "./captions";
import { TEXT_PRESETS } from "./text-presets";
import { CAPTION_PRESETS, type CaptionKind } from "./caption-presets";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { useViewportStore } from "./viewport";
import { BASE_LONG_SIDE } from "./settings";
import type { TextClipProps } from "./types";

/** A look for captions: the default, or one of the text presets made for captions. */
export type CaptionStyle = { id: string; name: string; props: Partial<TextClipProps>; /** For OpenRip's word-by-word styles: how they treat the word being said. */ kind?: CaptionKind };

/** The text presets' look without their sample words. */
const look = (props: Partial<TextClipProps>): Partial<TextClipProps> => {
  const { text: _text, ...rest } = props;
  return rest;
};

/**
 * The caption styles offered (CapCut's caption templates, OpenRip's own looks): the default,
 * then presets' looks on the caption's size and placement (each without the default's outline
 * unless it has its own).
 */
export const CAPTION_STYLES: CaptionStyle[] = [
  { id: "default", name: "Default", props: CAPTION_STYLE },
  ...["caption", "caption_box", "yellow", "plain", "shadow", "label", "neon"].flatMap((id) => {
    const p = TEXT_PRESETS.find((t) => t.id === id);
    return p ? [{ id: p.id, name: p.name, props: { ...CAPTION_STYLE, strokeEnabled: false, ...look(p.props), fontSize: Math.min(p.props.fontSize ?? 30, 40) } }] : [];
  }),
];

// OpenRip's forty word-by-word styles (lib/caption-presets.ts), after the first eight.
CAPTION_STYLES.push(...CAPTION_PRESETS.map((p): CaptionStyle => ({ id: p.id, name: p.name, kind: p.kind, props: { ...CAPTION_STYLE, strokeEnabled: false, ...p.props } })));

export const captionStyle = (id: string): CaptionStyle => CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0];

const STYLE_KEY = "openrip:caption-style";

/** A subtitle file brought in this session, for its card. */
export type ImportedCaptions = { path: string; name: string; cues: number };

interface CaptionsState {
  /** The style new captions get. */
  styleId: string;
  setStyle: (id: string) => void;
  /** Files imported this session, newest first. */
  files: ImportedCaptions[];
  /** What the last import or export did, for the panel to say. */
  message: string | null;
  setMessage: (m: string | null) => void;
}

export const useCaptionsStore = create<CaptionsState>((set) => ({
  styleId: (() => {
    try {
      return localStorage.getItem(STYLE_KEY) ?? "default";
    } catch {
      return "default";
    }
  })(),
  setStyle: (styleId) => {
    set({ styleId });
    try {
      localStorage.setItem(STYLE_KEY, styleId);
    } catch {}
  },
  files: [],
  message: null,
  setMessage: (message) => set({ message }),
}));

const SUBTITLES = [{ name: "Subtitles", extensions: ["srt", "vtt"] }];

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** The canvas in world units, as the preview lays it out (BASE_LONG_SIDE tall). */
const worldCanvas = () => {
  const { aspectRatio } = useViewportStore.getState();
  const ratio = aspectRatio.width / aspectRatio.height;
  return { width: BASE_LONG_SIDE * (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9), height: BASE_LONG_SIDE };
};

/**
 * Read a subtitle file onto a new captions track at the top, in the chosen style, its cues at
 * their own times from the timeline's start. Returns how many captions it added (0 if the file
 * had none it could read).
 */
export async function importCaptionFile(path: string, styleId = useCaptionsStore.getState().styleId): Promise<number> {
  const bytes = await readFileBuffer(path);
  const { cues, skipped } = parseCaptions(new TextDecoder("utf-8").decode(bytes));
  const name = baseName(path);
  if (!cues.length) {
    useCaptionsStore.getState().setMessage(`No captions found in ${name}.`);
    return 0;
  }
  const fps = useControlsStore.getState().fps || 24;
  const { timeline, clips } = captionClips(cues, { fps, canvas: worldCanvas(), style: captionStyle(styleId).props, makeId: uuidv4 });
  const { addTimeline, addClip } = useClipStore.getState();
  addTimeline(timeline, -1);
  for (const clip of clips) addClip(clip);
  useCaptionsStore.setState((s) => ({
    files: [{ path, name, cues: clips.length }, ...s.files.filter((f) => f.path !== path)],
    message: `Added ${clips.length} caption${clips.length === 1 ? "" : "s"} from ${name}${skipped ? ` (${skipped} unreadable cue${skipped === 1 ? "" : "s"} left out)` : ""}.`,
  }));
  return clips.length;
}

/** Pick subtitle files and import each. */
export async function pickAndImportCaptions(): Promise<number> {
  const paths = await pickMediaPaths({ title: "Import captions", filters: SUBTITLES });
  let added = 0;
  for (const path of paths) {
    try {
      added += await importCaptionFile(path);
    } catch (e) {
      useCaptionsStore.getState().setMessage(`Couldn't read ${baseName(path)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return added;
}

/** A caption style on every text of a track (CapCut's templates go on the whole caption track). */
export function applyCaptionStyle(timelineId: string, styleId: string) {
  const props = captionStyle(styleId).props;
  const { clips, updateClip } = useClipStore.getState();
  for (const c of clips) {
    if (c.type === "text" && c.timelineId === timelineId) {
      // A caption made from speech takes a plain style's "whole text" in place of the last word-by-word one.
      const words = (c as TextClipProps).captionWords ? { captionStyle: "none" } : {};
      updateClip(c.clipId, { ...words, ...props });
    }
  }
}

/** The timeline's texts as SRT cues: every visible text on a visible track. */
export function timelineCues() {
  const { clips, timelines } = useClipStore.getState();
  const hiddenTimelines = timelines.filter((t) => t.hidden).map((t) => t.timelineId);
  return clipsToCues(clips, useControlsStore.getState().fps || 24, { hiddenTimelines });
}

/** Write the timeline's texts as an .srt where the user picks. Returns the path, or null. */
export async function exportCaptions(defaultName = "captions.srt"): Promise<string | null> {
  const cues = timelineCues();
  if (!cues.length) {
    useCaptionsStore.getState().setMessage("There are no texts on the timeline to export.");
    return null;
  }
  const path = await pickSavePath({ title: "Export captions", defaultPath: defaultName, filters: [{ name: "SubRip", extensions: ["srt"] }] });
  if (!path) return null;
  await writeFileBuffer(path, new TextEncoder().encode(writeSrt(cues)));
  useCaptionsStore.getState().setMessage(`Exported ${cues.length} caption${cues.length === 1 ? "" : "s"} to ${baseName(path)}.`);
  return path;
}
