// Text added from the left panel's Text tab: a text clip at the playhead, three seconds long,
// in the middle of the canvas on a new track at the top (where the canvas's Text tool puts
// its texts), in one of a few styles made from the text panel's own settings.
import { v4 as uuidv4 } from "uuid";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { useViewportStore } from "./viewport";
import { useInspectorStore } from "./inspector";
import { BASE_LONG_SIDE } from "./settings";
import type { TextClipProps } from "./types";

export interface TextPreset {
  id: string;
  name: string;
  props: Partial<TextClipProps>;
}

/** The text the canvas's Text tool starts with; the presets change some of it. */
const BASE: Partial<TextClipProps> = {
  text: "Default Text",
  fontSize: 32,
  fontWeight: 400,
  fontStyle: "normal",
  fontFamily: "Arial",
  color: "#ffffff",
  colorOpacity: 100,
  textAlign: "center",
  verticalAlign: "middle",
  textTransform: "none",
  textDecoration: "none",
  strokeEnabled: false,
  stroke: "#000000",
  strokeWidth: 2,
  strokeOpacity: 100,
  shadowEnabled: false,
  shadowColor: "#000000",
  shadowOpacity: 75,
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  shadowOffsetLocked: true,
};

export const TEXT_PRESETS: TextPreset[] = [
  { id: "plain", name: "Plain", props: {} },
  { id: "title", name: "Title", props: { text: "Title", fontSize: 56, fontWeight: 700, fontFamily: "Helvetica" } },
  { id: "outline", name: "Outline", props: { text: "Outline", fontSize: 44, fontWeight: 700, strokeEnabled: true, strokeWidth: 4 } },
  { id: "shadow", name: "Shadow", props: { text: "Shadow", fontSize: 40, fontWeight: 700, shadowEnabled: true, shadowBlur: 8, shadowOffsetX: 3, shadowOffsetY: 3 } },
  {
    id: "label",
    name: "Label",
    props: { text: "Label", fontSize: 30, fontWeight: 700, color: "#111111", backgroundEnabled: true, backgroundColor: "#ffffff", backgroundOpacity: 100, backgroundCornerRadius: 8 },
  },
  { id: "serif", name: "Serif", props: { text: "Serif", fontSize: 44, fontStyle: "italic", fontFamily: "Georgia" } },
  { id: "caps", name: "Caps", props: { text: "Caps", fontSize: 40, fontWeight: 700, textTransform: "uppercase", fontFamily: "Impact" } },
  { id: "yellow", name: "Yellow", props: { text: "Yellow", fontSize: 44, fontWeight: 700, color: "#ffd84d", strokeEnabled: true, stroke: "#000000", strokeWidth: 3 } },
];

/** Add a text in `preset`'s style at the playhead, select it and show its Text tab. */
export const addPresetText = (preset: TextPreset) => {
  const { addTimeline, addClip } = useClipStore.getState();
  const controls = useControlsStore.getState();
  const { aspectRatio } = useViewportStore.getState();
  // The canvas in world units, as the preview lays it out (BASE_LONG_SIDE tall).
  const ratio = aspectRatio.width / aspectRatio.height;
  const canvas = { width: BASE_LONG_SIDE * (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9), height: BASE_LONG_SIDE };
  const props = { ...BASE, ...preset.props };
  const fontSize = props.fontSize ?? 32;
  const width = Math.min(canvas.width * 0.8, Math.max(160, fontSize * 7));
  const height = fontSize * 1.6;

  const timelineId = uuidv4();
  addTimeline({ timelineId, type: "text", timelineY: 0, timelineHeight: 40, timelineWidth: 0, muted: false, hidden: false }, -1);
  const start = controls.focusFrame;
  const clip: TextClipProps = {
    ...(props as TextClipProps),
    clipId: uuidv4(),
    type: "text",
    timelineId,
    startFrame: start,
    endFrame: Math.min(start + 3 * (controls.fps || 24), controls.totalTimelineFrames - 1),
    trimEnd: -Infinity,
    trimStart: Infinity,
    transform: {
      x: (canvas.width - width) / 2,
      y: (canvas.height - height) / 2,
      width,
      height,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      cornerRadius: 0,
      opacity: 100,
    },
  };
  addClip(clip);
  controls.setSelectedClipIds([clip.clipId]);
  useInspectorStore.getState().setTab("text", "basic");
};
