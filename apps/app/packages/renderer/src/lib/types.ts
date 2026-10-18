import {
  PacketStats,
  InputVideoTrack,
  InputAudioTrack,
  MetadataTags,
  InputFormat,
  Input,
} from "mediabunny";

export type ClipType =
  | "video"
  | "image"
  | "audio"
  | "text"
  | "shape"
  | "draw"
  | "filter"
  | "group";
export type TimelineType =
  | "media"
  | "audio"
  | "text"
  | "shape"
  | "draw"
  | "filter";
export type ViewTool = "pointer" | "hand" | "mask" | "draw" | "shape" | "text";
export type ShapeTool = "rectangle" | "ellipse" | "polygon" | "line" | "star";

/**
 * The app's first Adjust sliders, on its own scales (−100…100; blur, sharpness, noise and
 * vignette 0…100), drawn as its old WebGL filters drew them (the engine's `v1:` effects).
 * Legacy: kept so older projects look the same; new edits go in `color` (ClipColor) on
 * CapCut's scale. lib/color.ts converts them (`migrateLegacyAdjustments`).
 */
export interface MediaAdjustments {
  // Color Correction
  brightness?: number; // isFilter
  contrast?: number; // isFilter
  exposure?: number;
  hue?: number; // isFilter
  saturation?: number; // isFilter
  // Effects
  sharpness?: number;
  noise?: number; // isFilter
  blur?: number; // isFilter
  vignette?: number;
}

export interface ClipTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  cornerRadius: number;
  opacity: number;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * A clip property keyframes can drive (lib/keyframes.ts; docs/plan/app-engine-integration.md,
 * "Keyframes"). Values are in the clip field's own units:
 * - "position": [x, y], the centre of the clip's box in world units (y down);
 * - "scale": [scaleX, scaleY], as the transform's;
 * - "rotation": degrees clockwise, about the box's centre;
 * - "opacity": 0–100; "volume": dB (travelling as gain does, as CapCut's volume keys do);
 * - the Adjust sliders ("brightness", …, on their scale); "intensity", a filter bar's
 *   strength or a sticker bar's opacity (0–100);
 * - a text's "color" (#rrggbb), "fontSize", "stroke", "strokeWidth", "strokeOpacity",
 *   "shadowColor", "shadowOpacity", "shadowBlur", "backgroundColor", "backgroundOpacity";
 * - "draft:<id>": one of a converted clip's own adjustments (`draftAdjustments`) on CapCut's
 *   scale, or "draft:<id>:hue" (":saturation", ":lightness") for an HSL range;
 * - the colour tools (`color`): "adjust:<slider>" on CapCut's scale, "hsl:<range>:hue"
 *   (":saturation", ":lightness", −100…100), "wheels:intensity" and "lut:intensity" (0–100);
 * - the chroma key's "chroma:intensity", "chroma:shadow", "chroma:edgeSmooth" and
 *   "chroma:spill" (0–100), as CapCut keyframes them.
 */
export type KeyframeProperty =
  | "position"
  | "scale"
  | "rotation"
  | "opacity"
  | "volume"
  | "brightness"
  | "contrast"
  | "hue"
  | "saturation"
  | "sharpness"
  | "noise"
  | "blur"
  | "vignette"
  | "intensity"
  | "color"
  | "fontSize"
  | "stroke"
  | "strokeWidth"
  | "strokeOpacity"
  | "shadowColor"
  | "shadowOpacity"
  | "shadowBlur"
  | "backgroundColor"
  | "backgroundOpacity"
  | `draft:${string}`
  | `adjust:${AdjustSlider}`
  | `hsl:${HslRange}:${HslPart}`
  | "wheels:intensity"
  | "lut:intensity"
  | `chroma:${ChromaSlider}`;

/** A keyframe's value: a number, one per component (position, scale), or a colour. */
export type KeyframeValue = number | number[] | string;

/**
 * CapCut's keyframe graph presets: straight, held until the next key, or CapCut's curve with
 * its default handles (0.4 of the span, flat) leaving this key ("easeIn", slow to start),
 * arriving at the next ("easeOut", slow to end) or both ("easeInOut").
 */
export type KeyframePreset = "linear" | "hold" | "easeIn" | "easeOut" | "easeInOut";

/**
 * A curve handle as an offset from its key: in frames (positive leaving a key, negative
 * arriving at the next) and in the property's units (0–1 channels for a colour), one number
 * for every component or one per component.
 */
export interface KeyframeHandle {
  frames: number | number[];
  value: number | number[];
}

/**
 * CapCut's curve with explicit handles (the keyframe graph's custom curve): `out` leaves this
 * key, `in` arrives at the next. Components marked in `straight` go in a straight line.
 */
export interface KeyframeCurve {
  out: KeyframeHandle;
  in: KeyframeHandle;
  straight?: boolean[];
}

/** How a key's value travels to the next key's (linear without one). */
export type KeyframeEase = KeyframePreset | KeyframeCurve;

/**
 * A key at a clip-local frame (0 is where the clip starts on the timeline; fractional frames
 * keep a CapCut key's exact time), at the project's frame rate.
 */
export interface Keyframe {
  frame: number;
  value: KeyframeValue;
  ease?: KeyframeEase;
}

/** A clip's keyframes by property, each list sorted by frame. */
export type ClipKeyframes = Partial<Record<KeyframeProperty, Keyframe[]>>;

export interface ClipProps {
  // For grouping
  groupId?: string;
  hidden?: boolean;
  //
  timelineId?: string;
  startFrame: number;
  endFrame: number;
  trimEnd?: number;
  trimStart?: number;
  clipPadding?: number;
  clipId: string;
  // Persisted transform for preview canvas (position/size/scale/rotation)
  transform?: ClipTransform;
  originalTransform?: ClipTransform;
  type: ClipType;
  /**
   * Keyframed properties (lib/keyframes.ts). While a property has keys they decide its value
   * and the field's own value is ignored; editing it at the playhead sets a key there.
   */
  keyframes?: ClipKeyframes;
  /**
   * Clips that share it are linked, as CapCut links a video and its extracted audio: they
   * move, trim, split and delete together until unlinked.
   */
  linkId?: string;
}

export interface TimelineProps {
  type: TimelineType;
  timelineId: string;
  timelineWidth: number;
  timelineY: number;
  timelineHeight: number;
  timelinePadding: number;
  muted: boolean;
  hidden: boolean;
  /** Its clips can't be selected or edited (CapCut's "Lock track"). */
  locked?: boolean;
}

/** A timeline marker: a point in time on the ruler, with a colour and a note. */
export type Marker = {
  id: string;
  frame: number;
  color: string;
  note: string;
};

/** Visual media clips (video or image) that can carry masks. */
export type MediaClipProps = VideoClipProps | ImageClipProps;

export type Asset = {
  id: string;
  type: 'video' | 'image' | 'audio';
  path: string;
  width?: number;
  height?: number;
  duration: number;
  thumbnail?: string;
}

/** The way a slide, push or wipe goes. */
export type AnimationDirection = "left" | "right" | "up" | "down";

/**
 * A built-in's parameters (lib/animations.ts lists which take what): the direction of a
 * slide, push or wipe (left when left out).
 */
export type AnimationParams = { direction?: AnimationDirection };

/**
 * A clip's In, Out, Combo or Loop animation as the engine draws it: `type` is a built-in's
 * id from lib/animations.ts ("fade_in", "slide", "type_2", …), or "" for one from a CapCut
 * draft the engine doesn't draw (kept as CapCut had it, `name` its CapCut name). `duration`
 * in seconds: an In runs from the clip's start, an Out up to its end (after the In; the
 * engine shortens it so they don't overlap), a Combo over the whole clip whatever its
 * duration, a Loop repeats once per its duration. All end by the clip's end.
 */
export type ClipAnimation = { type: string; duration: number; name?: string; params?: AnimationParams };

/** A text's In animation (the typing ones and the clip moves alike). */
export type ClipAnimationIn = ClipAnimation;

/**
 * The transition from a video or photo into the next clip on its track (a built-in's id
 * from lib/animations.ts: "mix", "slide", "white_flash", …), or "" for a CapCut one the
 * engine doesn't draw. It runs across the cut, half its duration on each side, at most the
 * clip's length. Blink draws the image sequence CapCut downloaded with it (`resource`).
 */
export type ClipTransition = { type: string; duration: number; name?: string; resource?: string | null; params?: AnimationParams };

/**
 * One of a CapCut draft's own adjustments on a video or photo, by its material id: an Adjust
 * slider ("brightness", "highlights", …, `value` on CapCut's scale between `min` and `max`),
 * the colour wheels ("color_wheels", `value` their strength in percent), or HSL, curves, log
 * wheels, a filter or an effect on the clip. The ones the engine draws (`drawn`) can be
 * changed; taking one off the list takes it off the clip.
 */
export type DraftAdjustment = {
  id: string;
  kind: string;
  name: string;
  value?: number;
  min?: number;
  max?: number;
  /** Several sliders in one adjustment (an HSL range's hue, saturation and lightness). */
  values?: { key: string; name: string; value: number; min: number; max: number }[];
  drawn: boolean;
};

/** A point of a speed curve: `x` the progress through the clip's media (0 at its in-point, 1 at
 * its out-point, in the order it plays), `y` the speed there (0.1–10). CapCut's speed points. */
export type SpeedPoint = { x: number; y: number };

/**
 * A clip's speed curve (CapCut's Speed ▸ Curve): its points, and the preset they came from
 * ("Montage", "Hero", …; see lib/speed.ts), if any. The clip's `speed` is then the curve's
 * mean speed (its media length over its length on the timeline).
 */
export type SpeedCurve = { preset?: string; points: SpeedPoint[] };

/**
 * A freeze frame (CapCut's Freeze): the clip holds one frame of its asset, `at` seconds into
 * it, for its whole length, without sound.
 */
export type FreezeFrame = { at: number };

/**
 * The speed tools' fields on a video or audio clip (lib/speed.ts). A reversed clip plays its
 * media backward; its `trimStart` and `trimEnd` count in the order it plays, `trimStart` from
 * the media's end.
 */
export type SpeedProps = {
  speed?: number;
  reverse?: boolean;
  speedCurve?: SpeedCurve | null;
};

/**
 * CapCut's Adjust › Basic sliders (the engine draws all of them): on CapCut's scale, −50…50,
 * except sharpen, clarity, vignette and fade, 0…100 (a vignette below 0 lightens the edges).
 * 0 is off.
 */
export type AdjustSlider =
  | "exposure"
  | "brightness"
  | "contrast"
  | "saturation"
  | "temperature"
  | "tint"
  | "highlights"
  | "shadows"
  | "whites"
  | "blacks"
  | "sharpen"
  | "clarity"
  | "vignette"
  | "fade";

/** CapCut's named HSL ranges, in its order. */
export type HslRange = "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "magenta";
export type HslPart = "hue" | "saturation" | "lightness";
/** One range's shifts, −100…100 each. */
export type HslShift = Partial<Record<HslPart, number>>;

export type CurveChannel = "luma" | "red" | "green" | "blue";
/** A curve point: input and output level, 0–1. */
export type CurvePointXY = [number, number];

/** One colour wheel, CapCut's values (−1…1): per channel, luma and saturation. */
export type ColorWheel = { red?: number; green?: number; blue?: number; luma?: number; saturation?: number };

/** A LUT on the clip: a `.cube` file or a Hald CLUT image, its strength 0–100. */
export type ClipLut = { path: string; name?: string; intensity?: number };

/**
 * A video or photo's colour tools, as CapCut's Adjust tab (docs/plan/app-engine-integration.md,
 * "Colour and compositing"). Each part is optional and neutral when missing:
 * - `adjust`: the Basic sliders (AdjustSlider);
 * - `hsl`: the eight ranges' hue, saturation and lightness;
 * - `curves`: points per channel, sorted or not, the ends included (a curve needs two); the
 *   engine draws the smooth curve CapCut draws through them;
 * - `wheels`: the primary wheels (lift, gamma, gain, offset) and their strength, 0–100
 *   (100 when missing);
 * - `lut`: a LUT, drawn first.
 * The engine draws them in CapCut's order: LUT, HSL, curves, wheels, sliders. On a clip
 * converted from a CapCut draft they go on top of the draft's own (`draftAdjustments`): a
 * slider or HSL range set in both draws this one.
 */
export type ClipColor = {
  adjust?: Partial<Record<AdjustSlider, number>>;
  hsl?: Partial<Record<HslRange, HslShift>>;
  curves?: Partial<Record<CurveChannel, CurvePointXY[]>>;
  wheels?: { lift?: ColorWheel; gamma?: ColorWheel; gain?: ColorWheel; offset?: ColorWheel; intensity?: number };
  lut?: ClipLut | null;
};

/**
 * How a clip is put over the layers below it (CapCut's Blend › Mode; lib/compositing.ts
 * lists them with CapCut's names): "normal" is CapCut's Default.
 */
export type BlendModeId =
  | "normal"
  | "darken"
  | "screen"
  | "overlay"
  | "multiply"
  | "lighten"
  | "color_burn"
  | "color_dodge"
  | "linear_burn"
  | "soft_light"
  | "hard_light";

export type ChromaSlider = "intensity" | "shadow" | "edgeSmooth" | "spill";

/**
 * CapCut's chroma key (Remove BG › Chroma key): the picked colour (#rrggbb) and its sliders,
 * 0–100. Intensity 0 keys nothing; shadow keeps the colour's darker shades; edgeSmooth
 * softens the edge; spill takes the colour's cast off what's left.
 */
export type ClipChromaKey = { color: string } & Record<ChromaSlider, number>;

/**
 * What fills the canvas around a clip on the main track (CapCut's Canvas): a colour
 * (#rrggbb), the clip itself blurred (`blur`, CapCut's levels 0.0625, 0.375, 0.75, 1), or an
 * image (`image`, a path or file URL) covering the canvas. Ignored on other tracks, as in
 * CapCut.
 */
export type ClipCanvas = { type: "color" | "blur" | "image"; color?: string; blur?: number; image?: string };

/** Mirrored on screen, about the clip's middle (CapCut's Mirror). */
export type ClipFlip = { horizontal?: boolean; vertical?: boolean };

/** A video or photo's colour and compositing fields (all optional; missing is neutral). */
export type ClipLook = {
  color?: ClipColor | null;
  blendMode?: BlendModeId;
  chroma?: ClipChromaKey | null;
  canvas?: ClipCanvas | null;
  flip?: ClipFlip;
};

export type VideoClipProps = ClipProps &
  MediaAdjustments &
  SpeedProps &
  ClipLook & {

    assetId: string;
    assetIdHistory: string[];
    type: "video";
    // Intrinsic media dimensions for consistent aspect ratio
    mediaWidth?: number;
    mediaHeight?: number;
    mediaAspectRatio?: number; // width / height
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
    masks: MaskClipProps[];
    transitionOut?: ClipTransition | null;
    animationIn?: ClipAnimation | null;
    animationOut?: ClipAnimation | null;
    animationCombo?: ClipAnimation | null;
    draftAdjustments?: DraftAdjustment[];
    /** Set on a freeze-frame clip (`freezeFrame` in lib/speed.ts). */
    freeze?: FreezeFrame | null;
  };

export type ImageClipProps = ClipProps &
  MediaAdjustments &
  ClipLook & {
    assetId: string;
    assetIdHistory: string[];
    type: "image";
    // Intrinsic media dimensions for consistent aspect ratio
    mediaWidth?: number;
    mediaHeight?: number;
    mediaAspectRatio?: number; // width / height
    masks: MaskClipProps[];
    transitionOut?: ClipTransition | null;
    animationIn?: ClipAnimation | null;
    animationOut?: ClipAnimation | null;
    animationCombo?: ClipAnimation | null;
    draftAdjustments?: DraftAdjustment[];
  };

export type AudioClipProps = ClipProps &
  SpeedProps & {
    assetId: string;
    type: "audio";
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
  };

export type ShapeClipProps = ClipProps & {
  type: "shape";
  shapeType?: ShapeTool;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
};

export type PolygonClipProps = ShapeClipProps & {
  shapeType: "polygon";
  sides?: number;
};

export type StarClipProps = ShapeClipProps & {
  shapeType: "star";
  points?: number;
};

export type TextClipProps = ClipProps & {
  type: "text";
  /** How the text is put over what's under it (CapCut's Blend › Mode). */
  blendMode?: BlendModeId;
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  fontFamily?: string;
  color?: string;
  colorOpacity?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textDecoration?: "none" | "underline" | "overline" | "line-through";
  // Stroke properties
  strokeEnabled?: boolean;
  stroke?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  // Shadow properties
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowOpacity?: number;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOffsetLocked?: boolean;
  // Background properties
  backgroundEnabled?: boolean;
  backgroundColor?: string;
  backgroundOpacity?: number;
  backgroundCornerRadius?: number;
  // Animation
  animationIn?: ClipAnimationIn | null;
  animationOut?: ClipAnimation | null;
  animationLoop?: ClipAnimation | null;
  /** How a caption that follows the speech pages its words ("none" shows it whole). */
  captionStyle?: string;
  /** Whether the text has spoken-word timing (CapCut's auto captions). */
  spokenWords?: boolean;
  /**
   * How far into its speech (s) such a caption starts: what a split or a trim cut off its
   * start, so the words stay with the speech.
   */
  spokenFrom?: number;
};

export type FilterClipProps = ClipProps & {
  name?: string;
  type: "filter";
  smallPath?: string;
  fullPath?: string;
  category?: string;
  examplePath?: string;
  exampleAssetUrl?: string;
  intensity?: number;
  /**
   * A CapCut draft's bar ("filter", "effect", "sticker" or "adjustment"), and whether the
   * engine draws it (its filters so far, at `intensity`).
   */
  draftKind?: string;
  drawn?: boolean;
};

export interface DrawingLineTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

export interface DrawingLine {
  lineId: string;
  tool: "brush" | "highlighter" | "eraser";
  points: number[]; // [x1, y1, x2, y2, ...]
  stroke: string;
  strokeWidth: number;
  opacity: number;
  smoothing: number; // 0-1 tension value
  transform: DrawingLineTransform;
}

export type DrawingClipProps = ClipProps & {
  type: "draw";
  lines: DrawingLine[];
};

export type MaskTransform = ClipTransform;

export type MaskTool = "lasso" | "shape" | "draw";
export type MaskShapeTool = "rectangle" | "ellipse" | "polygon" | "star";

export interface MaskData {
  // For lasso tool - closed path points
  lassoPoints?: number[]; // [x1, y1, x2, y2, ...]
  /**
   * Optional path to an external Float32Array binary file containing the
   * lasso points for this mask data. When present, the main process will
   * have serialized the lassoPoints array into this .bin file to keep the
   * JSON snapshot compact.
   */
  lassoPointsBinPath?: string;
  // For shape tool
  shapeBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
    shapeType?: MaskShapeTool;
    scaleX?: number;
    scaleY?: number;
    renderOnce?: boolean;
  };
  // For the brush tool: strokes in world units at the mask's transform, as the lasso's points
  brushStrokes?: MaskBrushStroke[];
  // How this pose travels to the next keyframe's (linear without one; poses of different
  // shapes hold)
  ease?: KeyframeEase;
}

/** One stroke of a brush mask: its points, its width (`size`) and whether it erases. */
export interface MaskBrushStroke {
  points: number[]; // [x1, y1, x2, y2, ...]
  size: number;
  erase?: boolean;
}

export type MaskClipProps = {
  id: string;
  clipId?: string;
  tool: MaskTool;
  // The edge's softness, 0–100 as CapCut's Feather (the engine softens it as CapCut does)
  featherAmount: number;
  brushSize?: number;
  // Mask data for the initial frame/keyframes
  keyframes: Map<number, MaskData> | Record<number, MaskData>;
  // Transform applied to mask
  transform?: MaskTransform;
  // Metadata
  createdAt: number;
  lastModified: number;
  // Operation settings
  inverted?: boolean; // Invert the mask
  backgroundColor?: string;
  backgroundOpacity?: number;
  backgroundColorEnabled?: boolean;
  maskColor?: string;
  maskOpacity?: number;
  maskColorEnabled?: boolean;
};

export type GroupClipProps = ClipProps & {
  type: "group";
  children: string[][]; // clipIds for the children of the group
};

export type AnyClipProps =
  | VideoClipProps
  | ImageClipProps
  | AudioClipProps
  | ShapeClipProps
  | PolygonClipProps
  | TextClipProps
  | FilterClipProps
  | DrawingClipProps
  | GroupClipProps;

// Persisted, type-specific properties for a clip, excluding the shared base ClipProps
export type ClipSpecificProps = Omit<AnyClipProps, keyof ClipProps>;

export type ZoomLevel = number;

export type InputImageTrack = {
  width: number;
  height: number;
  mime?: string;
  size?: number; // bytes (if Blob/File provided or fetched)
  animated?: boolean; // GIF/WebP/AVIF (if ImageDecoder path)
  orientation?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; // EXIF tag 0x0112 (JPEG only here)
  input?: Blob | File | ArrayBuffer | Uint8Array | string,
};

export type MediaInfo = {
  path: string;
  video: InputVideoTrack | null;
  audio: (InputAudioTrack & { sampleSize?: number }) | null;
  image: InputImageTrack | null;
  stats: {
    video: PacketStats | undefined;
    audio: PacketStats | undefined;
  };
  duration: number | undefined;
  metadata: MetadataTags | undefined;
  mimeType: string | undefined;
  format: InputFormat | undefined;
  startFrame?: number;
  endFrame?: number;
  originalInput?: Input; // Only used for converting media to 24 fps
  videoDecoderConfig?: VideoDecoderConfig;
  /**
   * False when this app's own decoder can't read the picture (ProRes, for one): `video`
   * is kept for its size and rate, and frames come from the Rust engine instead.
   */
  videoDecodable?: boolean;
};

export type FrameBatch = {
  path: string;
  start_frame: number;
  end_frame: number;
  width: number;
  height: number;
  pixel_format: "rgba8";
  frames: number[][] | Uint8Array[];
};

export interface Point {
  x: number;
  y: number;
}

/** The left panel's tabs, in CapCut's order. */
export type SidebarSection =
  | "media"
  | "audio"
  | "text"
  | "stickers"
  | "effects"
  | "transitions"
  | "captions"
  | "filters"
  | "adjustment"
  | "templates";

export interface Filter {
  id: string;
  name: string;
  smallPath: string;
  fullPath: string;
  category: string;
  examplePath: string;
  exampleAssetUrl: string;
}

export type FilterWithType = Filter & {
  type: "filter";
};

// Fast, compact signature generator for AnyClipProps to use in React deps
// Focuses on stable, lightweight fields and summarizes large arrays
export function clipSignature(clip: AnyClipProps): string {
  try {
    const parts: string[] = [];

    // Common/base fields
    parts.push(
      clip.type,
      clip.clipId,
      clip.timelineId ?? "",
      n(clip.startFrame),
      n(clip.endFrame),
      n(clip.trimStart),
      n(clip.trimEnd),
      n(clip.clipPadding),
      clip.hidden ? "1" : "0",
      clip.groupId ?? "",
      encodeTransform(clip.transform),
      encodeTransform(clip.originalTransform),
      keyframesSignature(clip.keyframes),
    );

    // Per-type specific fields (keep minimal for speed)
    switch (clip.type) {
      case "video": {
        parts.push(
          (clip as any)?.assetId ?? "",
          n(clip.mediaWidth),
          n(clip.mediaHeight),
          n(clip.mediaAspectRatio),
          n(clip.volume),
          n(clip.fadeIn),
          n(clip.fadeOut),
          n(clip.speed),
          masksSignature((clip as any)?.masks),
        );
        break;
      }
      case "image": {
        parts.push(
          (clip as any)?.assetId ?? "",
          n(clip.mediaWidth),
          n(clip.mediaHeight),
          n(clip.mediaAspectRatio),
          masksSignature((clip as any)?.masks),
        );
        break;
      }
      case "audio": {
        const a = clip as any;
        parts.push(
          a?.assetId ?? "",
          n(a?.volume),
          n(a?.fadeIn),
          n(a?.fadeOut),
          n(a?.speed),
        );
        break;
      }
      case "shape": {
        const s = clip as any;
        parts.push(
          s.shapeType ?? "",
          s.fill ?? "",
          n(s.fillOpacity),
          s.stroke ?? "",
          n(s.strokeOpacity),
          n(s.strokeWidth),
        );
        break;
      }
      case "text": {
        const t = clip as any;
        const text = t.text ?? "";
        const textPrefix =
          text.length > 32 ? text.slice(0, 32) + "\u2026" : text;
        parts.push(
          String(text.length),
          textPrefix,
          n(t.fontSize),
          n(t.fontWeight),
          t.fontStyle ?? "",
          t.fontFamily ?? "",
          t.color ?? "",
          n(t.colorOpacity),
          t.textAlign ?? "",
          t.verticalAlign ?? "",
          t.textTransform ?? "",
          t.textDecoration ?? "",
          t.strokeEnabled ? "1" : "0",
          t.stroke ?? "",
          n(t.strokeWidth),
          n(t.strokeOpacity),
          t.shadowEnabled ? "1" : "0",
          t.shadowColor ?? "",
          n(t.shadowOpacity),
          n(t.shadowBlur),
          n(t.shadowOffsetX),
          n(t.shadowOffsetY),
          t.shadowOffsetLocked ? "1" : "0",
          t.backgroundEnabled ? "1" : "0",
          t.backgroundColor ?? "",
          n(t.backgroundOpacity),
          n(t.backgroundCornerRadius),
        );
        break;
      }
      case "filter": {
        const f = clip as any;
        parts.push(
          f.name ?? "",
          f.smallPath ?? "",
          f.fullPath ?? "",
          f.category ?? "",
          f.examplePath ?? "",
          f.exampleAssetUrl ?? "",
          n(f.intensity),
        );
        break;
      }
      case "draw": {
        parts.push(linesSignature((clip as any)?.lines));
        break;
      }
      case "group": {
        parts.push(groupChildrenSignature((clip as any)?.children));
        break;
      }
      default: {
        break;
      }
    }

    return parts.join("|");
  } catch (_err) {
    return fallbackSignature(clip);
  }
}

function fallbackSignature(clip: AnyClipProps): string {
  try {
    const t = (clip as any)?.type ?? "";
    const id = (clip as any)?.clipId ?? "";
    const tl = (clip as any)?.timelineId ?? "";
    const src = typeof (clip as any)?.assetId === "string" ? (clip as any).assetId : "";
    return [t, id, tl, src, "ERR"].join("|");
  } catch {
    return "CLIP|ERR";
  }
}

function n(value: number | undefined | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "number") return "";
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function encodeTransform(t: ClipTransform | undefined): string {
  if (!t) return "";
  return [
    n(t.x),
    n(t.y),
    n(t.width),
    n(t.height),
    n(t.scaleX),
    n(t.scaleY),
    n(t.rotation),
    n(t.cornerRadius),
    n(t.opacity),
    encodeCrop(t.crop),
  ].join(",");
}

function encodeCrop(c: { x: number; y: number; width: number; height: number } | undefined): string {
  if (!c) return "";
  return [
    n(c.x),
    n(c.y),
    n(c.width),
    n(c.height),
  ].join(",");
}



function encodeLineTransform(t: DrawingLineTransform | undefined): string {
  if (!t) return "";
  return [
    n(t.x),
    n(t.y),
    n(t.scaleX),
    n(t.scaleY),
    n(t.rotation),
    n(t.opacity),
  ].join(",");
}

function masksSignature(arr: MaskClipProps[] | undefined): string {
  if (!arr || arr.length === 0) return "";
  const parts: string[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    const kf: any = m.keyframes as any;
    let kfCount = 0;
    if (kf) {
      if (typeof Map !== "undefined" && kf instanceof Map)
        kfCount = (kf as Map<any, any>).size;
      else if (typeof kf === "object") kfCount = Object.keys(kf).length;
    }
    parts[i] = [
      m.id,
      m.tool,
      n(m.featherAmount),
      n(m.brushSize),
      encodeTransform(m.transform),
      m.backgroundColor ?? "",
      n(m.backgroundOpacity),
      m.backgroundColorEnabled ? "1" : "0",
      m.maskColor ?? "",
      n(m.maskOpacity),
      m.maskColorEnabled ? "1" : "0",
      m.inverted ? "1" : "0",
      kfCount.toString(),
    ].join(",");
  }
  return parts.join("|");
}

function keyframesSignature(keyframes: ClipKeyframes | undefined): string {
  if (!keyframes) return "";
  return Object.entries(keyframes)
    .map(([p, keys]) => `${p}:${(keys ?? []).map((k) => `${n(k.frame)}=${JSON.stringify(k.value)}${k.ease ? JSON.stringify(k.ease) : ""}`).join(";")}`)
    .join("|");
}

function linesSignature(lines: DrawingLine[] | undefined): string {
  if (!lines || lines.length === 0) return "";
  const count = lines.length;
  let totalPoints = 0;
  let rolling = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const len = ln.points ? ln.points.length : 0;
    totalPoints += len;
    // fast rolling hash from lengths and widths
    rolling =
      ((rolling << 5) - rolling) ^
      (len & 0xffff) ^
      ((ln.strokeWidth | 0) & 0xffff);
  }
  const first = lines[0];
  const last = lines[count - 1];
  return [
    count.toString(),
    totalPoints.toString(),
    (rolling >>> 0).toString(36), // compact
    lineKey(first),
    lineKey(last),
  ].join("|");
}

function lineKey(l: DrawingLine | undefined): string {
  if (!l) return "";
  return [
    l.lineId,
    l.tool,
    (l.points ? l.points.length : 0).toString(),
    l.stroke,
    n(l.strokeWidth),
    n(l.opacity),
    n(l.smoothing),
    encodeLineTransform(l.transform),
  ].join(",");
}

function groupChildrenSignature(children: string[][]): string {
  if (!children || children.length === 0) return "";
  const groups = children.length;
  let total = 0;
  for (let i = 0; i < children.length; i++) total += children[i]?.length ?? 0;
  const first = children[0]?.[0] ?? "";
  const lastGroup = children[children.length - 1];
  const last =
    lastGroup && lastGroup.length > 0 ? lastGroup[lastGroup.length - 1] : "";
  return [groups.toString(), total.toString(), first, last].join(",");
}
