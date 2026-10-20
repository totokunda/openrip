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
  | "sticker"
  | "draw"
  | "filter"
  | "group";
export type TimelineType =
  | "media"
  | "audio"
  | "text"
  | "shape"
  | "sticker"
  | "draw"
  | "filter";
export type ViewTool = "pointer" | "hand" | "mask" | "draw" | "shape" | "text";
/**
 * A shape clip's kind. CapCut's Stickers ▸ Shapes: rectangle, ellipse (its circle), triangle,
 * parallelogram, trapezoid, line, arrow and the pen's `path`. `polygon` (a regular polygon)
 * and `star` are the app's first shapes, kept for projects that have them.
 */
export type ShapeTool =
  | "rectangle"
  | "ellipse"
  | "triangle"
  | "parallelogram"
  | "trapezoid"
  | "line"
  | "arrow"
  | "path"
  | "polygon"
  | "star";

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
  /** The part of the picture shown (lib/crop.ts); `rotation` turns the picture inside it, degrees clockwise. */
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation?: number;
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
 *   "shadowColor", "shadowOpacity", "shadowBlur", "backgroundColor", "backgroundOpacity",
 *   "glowColor" (#rrggbb), "glowIntensity", "glowRange" (0–100, as CapCut keyframes its glow;
 *   it doesn't keyframe spacing);
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
  | "glowColor"
  | "glowIntensity"
  | "glowRange"
  | `draft:${string}`
  | `adjust:${AdjustSlider}`
  | `hsl:${HslRange}:${HslPart}`
  | "wheels:intensity"
  | "lut:intensity"
  | `chroma:${ChromaSlider}`
  /** OpenRip's own video effects (lib/effects): an effect bar's parameter, or one on a clip (`fx:<id>:<param>`), 0–100. */
  | `fx:${string}`;

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
  // For a text template's container (its parts are hidden under it)
  groupId?: string;
  /** Group (⌘G): clips with the same id are stuck together (lib/bundle.ts). */
  bundleId?: string;
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
  /**
   * CapCut's Deactivate clip: the clip stays on the timeline, greyed and hatched, but isn't
   * drawn, heard or exported (the engine leaves it out). Toggles back.
   */
  deactivated?: boolean;
  /** The Tracking tab's settings (lib/tracking.ts); the keys a track wrote are in `keyframes`. */
  tracking?: TrackingSettings;
}

/** Which way motion tracking goes from the frame its region was drawn on. */
export type TrackDirection = "both" | "forward" | "backward";

/** A rotated rectangle on the canvas, in world units (y down), its turn in degrees clockwise. */
export interface WorldRegion {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

/** A clip's Tracking tab, as it saves it (`tracking` on the clip). */
export interface TrackingSettings {
  /** The tab's checkbox. */
  enabled: boolean;
  /** CapCut's tiles: None or Motion tracking. */
  mode: "none" | "motion";
  direction: TrackDirection;
  /** Follow the tracked object's scale, its distance (the clip's offset from it scaling with
   * it) and, beyond CapCut's options, its turn. */
  scale: boolean;
  distance: boolean;
  rotation: boolean;
  /** The region tracked, where it was drawn, at `frame` (a timeline frame). */
  region?: WorldRegion;
  frame?: number;
  /** The video clip tracked, once the clip's keys come from it. */
  video?: string;
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
  /** A captions track: made by Add captions or Auto captions (a text track the Captions inspector knows). */
  captions?: boolean;
  /** CapCut's Track height (the track's "…" menu); missing is Default. */
  size?: "short" | "tall";
  /** CapCut's Audio waveform size, % (the track's "…" menu); missing is 30. */
  waveform?: 30 | 60 | 100;
}

/** A timeline marker: a point in time on the ruler, with a colour and a note. */
export type Marker = {
  id: string;
  frame: number;
  color: string;
  note: string;
};

/**
 * A guide on the player's canvas (lib/guides.ts): a horizontal one (`axis` "y") at a height,
 * or a vertical one ("x") at a width, as a fraction of the canvas from its top or left edge
 * (0.5 is the middle; it may lie off the canvas). Part of the project.
 */
export type Guide = {
  id: string;
  axis: "x" | "y";
  at: number;
};

/** Visual media clips (video or image) that can carry masks. */
export type MediaClipProps = VideoClipProps | ImageClipProps;

/**
 * Where an openly licensed asset came from, kept with it (lib/credits.ts lists them for the
 * project): the Media tab's stock Library and the Audio tab's Music and Sound effects. `kind` is
 * what it is; `attributionRequired` is true for CC BY, which asks for credit.
 */
export type AssetCredit = {
  /** The library's id for the item, when it has one (music and sound tracks). */
  id?: string;
  kind: "video" | "photo" | "music" | "sound";
  title: string;
  author?: string;
  authorUrl?: string;
  /** "CC0", "Public domain", "CC BY 4.0". */
  license: string;
  licenseUrl?: string;
  /** "Wikimedia Commons", "Openverse", "Freesound". */
  sourceName: string;
  sourceUrl?: string;
  attributionRequired: boolean;
};

/** One recognized word: its text and where it is in the media, seconds. */
export type TranscriptWord = { t: string; s: number; e: number };

/**
 * What a local speech model heard in a media file (lib/transcript.ts): the words with their
 * times in the media, and which stretches of the media (`covered`, seconds, sorted and apart)
 * were listened to. A clip's trims and speed map the words onto the timeline.
 */
export type Transcript = { language: string; model: string; words: TranscriptWord[]; covered: [number, number][] };

export type Asset = {
  id: string;
  type: 'video' | 'image' | 'audio';
  path: string;
  width?: number;
  height?: number;
  duration: number;
  thumbnail?: string;
  /** The words the media says, once Transcript (or Auto captions) has listened. */
  transcript?: Transcript;
  /** Set for stock-library (and other openly licensed) assets. */
  credit?: AssetCredit;
}

/** The way a slide, push or wipe goes. */
export type AnimationDirection = "left" | "right" | "up" | "down";

/**
 * A built-in's parameters (lib/animations.ts lists which take what): the direction of a
 * slide, push or wipe (left when left out).
 */
export type AnimationParams = { direction?: AnimationDirection };

/** A shader transition's parameter values by name (lib/glTransitions.ts): a number, a flag, `[x, y]` or a colour as "#rrggbb". */
export type TransitionParamValue = number | boolean | string | [number, number];
export type TransitionParams = AnimationParams & { [key: string]: TransitionParamValue | undefined };

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
export type ClipTransition = { type: string; duration: number; name?: string; resource?: string | null; params?: TransitionParams };

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
  /**
   * CapCut's Change audio pitch: the sound's pitch follows the speed (resampled) instead of
   * staying as it was. A curve's sound always follows it.
   */
  changePitch?: boolean;
  /**
   * Speed › Smooth slow-mo (CapCut's `complement_frame_config`): while the clip plays slower
   * than its source, frames between its own are made from them, by optical flow or blended.
   */
  smoothSlowMo?: { mode: "optical_flow" | "frame_blending" } | null;
  /**
   * Video › Basic › Optical flow (CapCut's `smart_complement_frame`): the clip's frames made
   * up to `fps` by motion interpolation whatever its speed.
   */
  opticalFlow?: { fps: number } | null;
  /**
   * Video › Basic's Stabilize, Reduce image noise and Remove flickers, and Enhance motion ›
   * Motion blur: classic clean-up the engine draws (lib/enhance.ts). Null (or absent) is all off.
   */
  enhance?: EnhanceSettings | null;
};

/** How far Stabilize smooths the camera's path; the further, the more it crops. */
export type StabilizeLevel = "minimal_cut" | "recommended" | "most_stable";

/** A video clip's clean-up; strength and amount 0–100. */
export type EnhanceSettings = {
  stabilize?: { level: StabilizeLevel } | null;
  denoise?: { strength: number } | null;
  deflicker?: boolean;
  motionBlur?: { amount: number } | null;
};

/**
 * CapCut's Adjust › Basic sliders (the engine draws all of them): on CapCut's scale, −50…50,
 * except sharpen, clarity, particles, vignette and fade, 0…100 (a vignette below 0 lightens the
 * edges; particles is film grain).
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
  | "particles"
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
 *   (100 when missing); `mode` "log" draws the Log wheels instead (`log`: lift is Shadow, gamma
 *   Middle tone, gain Highlight, and Offset), each mode keeping its own values;
 * - `lut`: a LUT, drawn first;
 * - `auto`: Auto adjust's record of the slider values it put into `adjust` (lib/color-tools.ts);
 * - `match`: Color match, a table the engine makes from both clips' statistics, drawn before
 *   the LUT.
 * The engine draws them in CapCut's order: Color match, LUT, HSL, curves, wheels, sliders. On
 * a clip converted from a CapCut draft they go on top of the draft's own
 * (`draftAdjustments`): a slider or HSL range set in both draws this one.
 */
export type ClipColor = {
  adjust?: Partial<Record<AdjustSlider, number>>;
  hsl?: Partial<Record<HslRange, HslShift>>;
  curves?: Partial<Record<CurveChannel, CurvePointXY[]>>;
  wheels?: {
    lift?: ColorWheel;
    gamma?: ColorWheel;
    gain?: ColorWheel;
    offset?: ColorWheel;
    intensity?: number;
    mode?: "primary" | "log";
    log?: { lift?: ColorWheel; gamma?: ColorWheel; gain?: ColorWheel; offset?: ColorWheel };
  };
  lut?: ClipLut | null;
  auto?: ClipAutoAdjust | null;
  match?: ClipColorMatch | null;
};

/** A clip's colour statistics in Oklab (L, a, b): each channel's mean and standard deviation. */
export type ColorMoments = { mean: [number, number, number]; std: [number, number, number] };

/**
 * Adjust ▸ Auto adjust: the slider values the engine found from the clip's own statistics (the
 * panel's scale, at full intensity), the intensity (0–100), and what it added to `adjust` (so
 * it can be taken off again and the user's own changes stay); `range` the media seconds it read.
 */
export type ClipAutoAdjust = {
  intensity: number;
  values: Partial<Record<AdjustSlider, number>>;
  applied: Partial<Record<AdjustSlider, number>>;
  range?: [number, number];
};

/**
 * Adjust ▸ Color match: the clip's and the reference's colour statistics, the intensity
 * (0–100) and the reference clip; `consistent` when Smart suggestions ▸ Make colors consistent
 * set it.
 */
export type ClipColorMatch = {
  intensity: number;
  source: ColorMoments;
  reference: ColorMoments;
  ref: { clipId: string; name?: string };
  consistent?: boolean;
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
 * image (`image`, a path or file URL) covering the canvas, or one of OpenRip's own tiled
 * patterns (`pattern`, an id in lib/canvas-patterns.ts). Ignored on other tracks, as in
 * CapCut.
 */
export type ClipCanvas = { type: "color" | "blur" | "image" | "pattern"; color?: string; blur?: number; image?: string; pattern?: string };

/** Mirrored on screen, about the clip's middle (CapCut's Mirror). */
export type ClipFlip = { horizontal?: boolean; vertical?: boolean };

/**
 * One of OpenRip's own video effects on a video or photo (lib/effects, drawn by the engine):
 * the catalog's `effectId`, its strength and its own parameters, all 0–100. `id` names this
 * one on the clip (its keyframes are `fx:<id>:intensity` and `fx:<id>:<param>`).
 */
export type ClipEffect = { id: string; effectId: string; name: string; intensity: number; params: Record<string, number> };

/** A video or photo's colour and compositing fields (all optional; missing is neutral). */
export type ClipLook = {
  /** OpenRip's own video effects on the clip, in order. */
  effects?: ClipEffect[];
  color?: ClipColor | null;
  blendMode?: BlendModeId;
  chroma?: ClipChromaKey | null;
  canvas?: ClipCanvas | null;
  flip?: ClipFlip;
};

/**
 * The engine's voice effect kinds (lib/audio-effects.ts lists their parameters and the presets
 * built on them; engine/crates/audio/src/voice.rs plays them).
 */
export type AudioEffectKind =
  | "pitch"
  | "robot"
  | "echo"
  | "reverb"
  | "chorus"
  | "tremolo"
  | "distortion"
  | "bitcrush"
  | "lowpass"
  | "highpass"
  | "eq"
  | "telephone"
  | "megaphone"
  | "gain";

/**
 * One voice effect on a clip: a kind with its parameters by name (missing ones take the kind's
 * defaults; every kind has `strength`, 0–100) and the preset's name it came from. A clip converted
 * from a CapCut draft lists its own voice filter as `{type: "draft", id, name}`: CapCut's bundle,
 * kept as it is (take the entry out to remove it).
 */
export type AudioEffect = { type: AudioEffectKind | "draft"; params?: Record<string, number>; name?: string; id?: string };

/**
 * CapCut's "Normalize loudness": the clip turned to `target` LUFS (CapCut's −23) from the
 * loudness `measured` over its range (LUFS) and its peak (dBFS), which lib/audio.ts measures
 * with the engine; without a measurement nothing changes. `range` is the media range measured
 * ([start, duration] s), so a trim can tell the measurement is stale.
 */
export type ClipLoudness = {
  enabled: boolean;
  target: number;
  measured?: number | null;
  peak?: number | null;
  range?: [number, number];
  /** Set by Make volume consistent (lib/audio.ts): what the clip's loudness was before it, to give back when it's turned off. */
  consistent?: { was: ClipLoudness | null };
};

/**
 * Reduce noise (OpenRip's classic spectral-gating denoiser, engine/crates/audio/src/denoise.rs):
 * the clip's own noise, read from its quietest moments, taken out. `strength` is 0–100 (the
 * engine's default, 70, without it).
 */
export type ClipDenoise = { enabled: boolean; strength?: number };

/**
 * CapCut's "Fill channel": "left" plays the left channel on both sides ("Fill right with left"),
 * "right" the right one; "mono" (OpenRip's own) both mixed.
 */
export type ChannelFill = "none" | "left" | "right" | "mono";

/** A beat a source app found (a CapCut draft's), in seconds of the clip's media. */
export type DetectedBeat = { time: number; downbeat: boolean };

/**
 * A clip's beat markers (lib/beats.ts), in seconds of its media so they stay on the music
 * through a trim or a move: those marked by hand, and whether the automatic ones show (every
 * beat, or only bar starts, CapCut's Beat 2 and Beat 1). `detected` holds a CapCut draft's own
 * automatic beats; without them the engine's are shown.
 */
export type ClipBeats = { manual?: number[]; auto?: boolean; everyBeat?: boolean; detected?: DetectedBeat[] };

/** The Audio tab's fields on a video or audio clip (all optional; missing is off). */
export type ClipAudio = {
  audioEffects?: AudioEffect[];
  loudness?: ClipLoudness | null;
  denoise?: ClipDenoise | null;
  channel?: ChannelFill;
  beats?: ClipBeats | null;
};

/**
 * What a compound clip plays (CapCut's subproject): a timeline of its own, with its own
 * tracks and clips, in frames from 0 at the compound's start (before its trims). The clips
 * can be any clip, including other compounds. See lib/compound.ts.
 */
export interface CompoundContent {
  clips: AnyClipProps[];
  timelines: TimelineProps[];
}

export type VideoClipProps = ClipProps &
  MediaAdjustments &
  SpeedProps &
  ClipLook &
  ClipAudio & {

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
    /** The Mask section's checkbox unticked: the masks stay, none is drawn. */
    masksOff?: boolean;
    transitionOut?: ClipTransition | null;
    animationIn?: ClipAnimation | null;
    animationOut?: ClipAnimation | null;
    animationCombo?: ClipAnimation | null;
    draftAdjustments?: DraftAdjustment[];
    /** Set on a freeze-frame clip (`freezeFrame` in lib/speed.ts). */
    freeze?: FreezeFrame | null;
    /**
     * Set on a compound clip (lib/compound.ts): a video clip whose picture and sound are this
     * timeline's, with no asset of its own (`assetId` is empty). Speed stays 1.
     */
    compound?: CompoundContent;
    /** A compound clip's name (CapCut's "Compound clip1"). */
    name?: string;
    /** A compound clip whose sound was taken out onto an audio clip (Extract audio): it plays none of its own. */
    audioSeparated?: boolean;
    /** A compound clip's mixed sound as an asset (lib/compound-actions.ts), which Transcript reads its words from. */
    mixAssetId?: string;
    /**
     * A compound clip rendered to a media file (lib/compound-render.ts), for the clean-up and
     * audio tools that read a file (Stabilize, Reduce image noise, Remove flickers, Motion blur,
     * Normalize loudness, Reduce noise, Auto adjust): the asset, and the key of the content it
     * was rendered from (the file is stale when the content has since changed).
     */
    renderedAssetId?: string;
    renderedKey?: string;
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
    /** The Mask section's checkbox unticked: the masks stay, none is drawn. */
    masksOff?: boolean;
    transitionOut?: ClipTransition | null;
    animationIn?: ClipAnimation | null;
    animationOut?: ClipAnimation | null;
    animationCombo?: ClipAnimation | null;
    draftAdjustments?: DraftAdjustment[];
  };

export type AudioClipProps = ClipProps &
  SpeedProps &
  ClipAudio & {
    assetId: string;
    type: "audio";
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
  };

/** A shape stroke's pattern (CapCut's stroke Style). */
export type StrokeStyle = "solid" | "dashed" | "dotted";
/** What an open outline carries at an end (CapCut's Cap: None, Arrow, Round). */
export type StrokeCap = "none" | "arrow" | "round";

/**
 * A point of a pen path (or of a line or an arrow): where it is in the shape's box, in
 * fractions of its width and height (0–1 from the top-left), and its Bézier handles as
 * offsets from it in the same units. A corner has no handles.
 */
export interface PathPoint {
  x: number;
  y: number;
  inX?: number;
  inY?: number;
  outX?: number;
  outY?: number;
}

export type ShapeClipProps = ClipProps & {
  type: "shape";
  shapeType?: ShapeTool;
  fill?: string;
  fillOpacity?: number;
  /** The Fill group's check (closed shapes are filled when it's unset). */
  fillEnabled?: boolean;
  stroke?: string;
  strokeOpacity?: number;
  /** World units. */
  strokeWidth?: number;
  /** The Stroke group's check (on when it's unset and the stroke has a width). */
  strokeEnabled?: boolean;
  strokeStyle?: StrokeStyle;
  /** An open outline's ends (a line, an arrow, an open pen path). An arrow's end is an arrow when unset. */
  capStart?: StrokeCap;
  capEnd?: StrokeCap;
  shadowEnabled?: boolean;
  shadowColor?: string;
  /** Percent. */
  shadowOpacity?: number;
  /** World units. */
  shadowDistance?: number;
  /** Degrees clockwise from the right, on screen. */
  shadowAngle?: number;
  /** A pen path's points (a line's and an arrow's two), in its box. */
  path?: PathPoint[];
  /** Whether the pen path closes back to its first point. */
  pathClosed?: boolean;
  /** A pen shape still being drawn (CapCut's "Shape to draw" on the timeline). */
  penDrawing?: boolean;
};

/**
 * A sticker from the Stickers library on the timeline (CapCut models its library stickers the
 * same way: a picture or an animation on a track of its own, with a transform, an Animation
 * tab and keyframes). The picture is the file the library cached (`stickerPath`, a PNG, an SVG
 * or an animated WebP) and `stickerWidth` × `stickerHeight` its size in pixels, which the
 * engine lays the clip's box out against (`transform` is the box in world units). The engine
 * tells a still from an animation by the file's content, and loops an animation by its own
 * frame times, from the clip's start.
 */
export type StickerClipProps = ClipProps & {
  type: "sticker";
  /** The library's id for it (lib/stickers/library.ts). */
  stickerId: string;
  name: string;
  category?: string;
  /** Where the file is on this machine (the engine reads it; the renderer loads it from there). */
  stickerPath: string;
  stickerWidth: number;
  stickerHeight: number;
  stickerAnimated?: boolean;
  /** The set it came from, for the credit it needs (CC BY asks for one). */
  stickerSet?: string;
  animationIn?: ClipAnimation | null;
  animationOut?: ClipAnimation | null;
  animationLoop?: ClipAnimation | null;
};

export type PolygonClipProps = ShapeClipProps & {
  shapeType: "polygon";
  sides?: number;
};

export type StarClipProps = ShapeClipProps & {
  shapeType: "star";
  points?: number;
};

/**
 * A gradient fill (CapCut's): colours ("#rrggbb" or "#rrggbbaa") at `stops` along a line
 * through the middle of each character, line or the whole text (`span`, "character" by
 * default), in the direction `angle` (degrees counter-clockwise from +x, +y up: 0 runs left to
 * right, 90 bottom to top). Stops are 0–1, ascending; without them the colours spread evenly.
 */
export type TextGradient = {
  colors: string[];
  stops?: number[];
  angle: number;
  span?: "character" | "line" | "text";
};

/** A further outline outside a text's stroke: its width in px (as `strokeWidth`), opacity 0–100. */
export type TextOutline = { color: string; width: number; opacity?: number };

/**
 * What a layer of a text style is painted with: a colour, a gradient, or the clip's own text
 * colour (`textColor`), at an opacity (0–100, 100 when left out).
 */
export type TextStylePaint =
  | { color: string; opacity?: number }
  | { gradient: TextGradient; opacity?: number }
  | { textColor: true; opacity?: number };

/**
 * The Effects tab's text style on a text clip (lib/text-styles.ts lists OpenRip's own): layers
 * drawn by the engine, shadows at the back, then the outlines (the first on top), then the
 * fill, in place of the clip's colour and stroke. Sizes are fractions of the font size: an
 * outline's `width` (how far it reaches outside the glyphs), a shadow's `distance` and `blur`
 * (`angle` in degrees counter-clockwise from +x, +y up). A glow under it all (`intensity` and
 * `range` 0–100; the clip's own glow wins). `id` is a built-in's, or "" for a CapCut library
 * style on a converted clip (drawn from CapCut's bundle, `name` its name; kept until replaced).
 */
export type TextEffectStyle = {
  id: string;
  name?: string;
  fill?: TextStylePaint;
  strokes?: { width: number; paint: TextStylePaint }[];
  shadows?: { paint: TextStylePaint; distance: number; angle: number; blur: number }[];
  glow?: { color?: string | null; intensity: number; range: number };
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
  /**
   * The Background section's geometry: Height and Width are the box's padding around the lines
   * in hundredths of an em (CapCut's 14 %), the offsets move it (0–100, 50 is centred, hundredths
   * of an em either way). Missing is no padding and centred.
   */
  backgroundHeight?: number;
  backgroundWidth?: number;
  backgroundOffsetX?: number;
  backgroundOffsetY?: number;
  /** Curved text (CapCut's Curve ▸ Strength): the degrees of arc each line is bent through, arching up when positive and sagging when negative; 0 or missing is straight. */
  textCurve?: number;
  /**
   * CapCut's Character and Line fields: steps of 1/20 of the font size between characters and
   * between lines (−10…100; 0 is CapCut's default). Not keyframeable (CapCut doesn't key them).
   */
  letterSpacing?: number;
  lineSpacing?: number;
  /** A gradient that paints the text in place of `color` (whose opacity still applies). */
  fillGradient?: TextGradient | null;
  /** More outlines outside the stroke, each drawn under the ones before it. */
  moreStrokes?: TextOutline[];
  /**
   * CapCut's Glow: its colour ("" or none for the text's own colours), Intensity and Range
   * (0–100; CapCut starts at 30 and 20) and offsets (−100…100, the light moved right and down;
   * 0 spreads it from the middle of the text).
   */
  glowEnabled?: boolean;
  glowColor?: string | null;
  glowIntensity?: number;
  glowRange?: number;
  glowOffsetX?: number;
  glowOffsetY?: number;
  /** The Effects tab's style (lib/text-styles.ts), or none. */
  textEffect?: TextEffectStyle | null;
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
  /**
   * The words of a caption made from speech (Auto captions) and when each is said: its
   * character range in `text` and clip-local seconds. The caption styles follow them
   * (engine/crates/playback/src/caption.rs); editing the text drops them.
   */
  captionWords?: { from: number; to: number; start: number; end: number; keyword?: boolean }[];
  /** The colour of an own caption style's highlight, fill or box, and of its keywords. */
  captionColor?: string;
  captionKeywordColor?: string;
  /** Made by Auto captions: Generate again replaces it. */
  autoCaption?: boolean;
  /** Its name in a text template's fields (the Text template tab of the group it came with). */
  templateField?: string;
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
   * One of OpenRip's own video effects (lib/effects): the bar draws it over everything under it
   * for its duration, with its parameters (0–100; keyframes `fx:<param>`). Then `intensity` is
   * the effect's strength.
   */
  effectId?: string;
  effectParams?: Record<string, number>;
  /**
   * A CapCut draft's bar ("filter", "effect", "sticker" or "adjustment"), and whether the
   * engine draws it (its filters so far, at `intensity`).
   */
  draftKind?: string;
  drawn?: boolean;
  /**
   * An adjustment layer (lib/adjustment.ts): the bar applies `color` (the Adjust tab's tools,
   * as a video's) to everything under it for its duration, inside its `masks`. `transform` is
   * the canvas's box, which the masks are placed in.
   */
  adjustment?: boolean;
  color?: ClipColor;
  masks?: MaskClipProps[];
  masksOff?: boolean;
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

export type MaskTool = "lasso" | "shape" | "draw" | "pen";
/**
 * A shape mask's shape: the app's rectangle, ellipse, triangle ("polygon") and star, and
 * CapCut's Split ("linear"), Filmstrip ("mirror") and heart from the inspector's Mask tab.
 */
export type MaskShapeTool = "rectangle" | "ellipse" | "circle" | "polygon" | "star" | "linear" | "mirror" | "heart" | "text";

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
    // A rectangle's round corners, 0–100 as CapCut's slider (of its shorter half-side)
    cornerRadius?: number;
    // A draft heart's or star's own picture (CapCut's bundle), drawn as CapCut draws it
    picture?: string;
  };
  // For the brush tool: strokes in world units at the mask's transform, as the lasso's points
  brushStrokes?: MaskBrushStroke[];
  // How this pose travels to the next keyframe's (linear without one; poses of different
  // shapes hold)
  ease?: KeyframeEase;
  // The feather at this pose (0–100) when the mask is keyed (lib/mask-shapes.ts); the
  // mask's own `featherAmount` otherwise
  featherAmount?: number;
  // Likewise the expansion (−100…100, CapCut's Expansion on a brush or pen mask)
  expansion?: number;
  // A pen mask's closed path (tool "pen"): anchors in world units at the mask's transform,
  // each with the handle it arrives by (ix, iy) and leaves by (ox, oy)
  penPath?: { points: MaskPenPoint[]; closed: boolean };
  // A text mask's words and style (shapeType "text"); its box is shapeBounds
  text?: MaskTextStyle;
}

/** One anchor of a pen mask's path, its handles absolute. */
export interface MaskPenPoint {
  x: number;
  y: number;
  ix: number;
  iy: number;
  ox: number;
  oy: number;
}

/** A text mask's words and style (CapCut's Text mask): `size` in world units at the mask's
 * transform, spacing in ems. */
export interface MaskTextStyle {
  content: string;
  font: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  letterSpacing?: number;
  lineSpacing?: number;
  align?: "left" | "center" | "right";
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
  // Its keyframe diamond was pressed: an edit sets a pose at the playhead even while it has
  // only one (lib/mask-shapes.ts)
  keyed?: boolean;
  // CapCut's Expansion (−100…100) on a brush or pen mask
  expansion?: number;
  // A converted CapCut clip's mask: the draft's material it shows (engine/crates/v1)
  draftMask?: string;
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
  /** The text template (lib/text-templates.ts) the group was made from: its Text template tab edits the words. */
  template?: { id: string; name: string };
};

export type AnyClipProps =
  | VideoClipProps
  | ImageClipProps
  | AudioClipProps
  | ShapeClipProps
  | StickerClipProps
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
  /** The look group the Filters tab lists it under (lib/filters/looks.ts), the example photo its tile is drawn on, and its place in Featured (-1: not in it). */
  group?: string;
  photo?: string;
  featured?: number;
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
          audioSignature(clip),
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
          audioSignature(a),
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
          JSON.stringify([s.fillEnabled, s.strokeEnabled, s.strokeStyle, s.capStart, s.capEnd, s.shadowEnabled, s.shadowColor, s.shadowOpacity, s.shadowDistance, s.shadowAngle, s.path, s.pathClosed]),
        );
        break;
      }
      case "sticker": {
        const k = clip as any;
        parts.push(k.stickerId ?? "", k.stickerPath ?? "", n(k.stickerWidth), n(k.stickerHeight));
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

function encodeCrop(c: { x: number; y: number; width: number; height: number; rotation?: number } | undefined): string {
  if (!c) return "";
  return [
    n(c.x),
    n(c.y),
    n(c.width),
    n(c.height),
    n(c.rotation),
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

/** The Audio tab's fields, compactly: effects and their parameters, loudness, channel, beats. */
function audioSignature(clip: ClipAudio | undefined): string {
  if (!clip) return "";
  const fx = (clip.audioEffects ?? []).map((e) => `${e.type}:${e.id ?? ""}:${Object.entries(e.params ?? {}).map(([k, v]) => `${k}=${v}`).join(",")}`).join(";");
  const l = clip.loudness;
  const b = clip.beats;
  const d = clip.denoise;
  return [fx, l ? `${l.enabled ? 1 : 0}/${l.target}/${l.measured ?? ""}` : "", d ? `${d.enabled ? 1 : 0}/${d.strength ?? ""}` : "", clip.channel ?? "", b ? `${(b.manual ?? []).join(",")}/${b.auto ? 1 : 0}/${b.everyBeat ? 1 : 0}/${b.detected?.length ?? 0}` : ""].join("|");
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
