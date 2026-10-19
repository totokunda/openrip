import React, { useEffect, useMemo, useState } from "react";
import {
  PiAlignBottom,
  PiAlignCenterHorizontal,
  PiAlignCenterVertical,
  PiAlignLeft,
  PiAlignRight,
  PiAlignTop,
} from "react-icons/pi";
import { LuFlipHorizontal2, LuFlipVertical2, LuRotateCw, LuPlus, LuImage } from "react-icons/lu";
import { TbArrowsMaximize, TbArrowsMinimize, TbArrowAutofitWidth } from "react-icons/tb";
import { ENGINE_FRAME_CANVAS_ID, pickMediaPaths } from "@app/preload";
import { useClipStore } from "@/lib/clip";
import { useViewportStore } from "@/lib/viewport";
import { useEnginePreviewStore } from "@/lib/engine-preview";
import { clearKeyframes, valueAt } from "@/lib/keyframes";
import { editProperties, transformAt, usePlayhead } from "@/lib/keyframe-ui";
import { centreOf, flipOf, rotate90, scalePreset, toggleFlip, worldOf, ScalePreset } from "@/lib/transform-presets";
import {
  BLEND_MODES,
  CANVAS_BLURS,
  applyCanvasToAll,
  canvasBlur,
  canvasColor,
  canvasImage,
  fillsCanvas,
  setBlendMode,
  setCanvas,
} from "@/lib/compositing";
import type { AnyClipProps, BlendModeId, ClipCanvas, ImageClipProps, KeyframeProperty, KeyframeValue, VideoClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import Section from "./Section";
import PropertyRow from "./PropertyRow";
import PropertiesSlider from "./PropertiesSlider";
import KeyframeButton from "./KeyframeButton";
import KeyframedSlider from "./KeyframedSlider";
import { ButtonGroup, Dial, GroupButton, GroupDivider, InspectorSelect, NumberField, Toggle } from "./controls";

/**
 * Video ▸ Basic (and a photo's), as CapCut lays it out (docs/plan/capcut-ui-spec.md §4.8,
 * §6.17): Transform (scale with the uniform switch, position, rotate, alignment, and the
 * app's fit / fill / stretch, quarter turn and mirrors), Blend (mode and opacity) and, for a
 * clip on the main track, Canvas (none, a colour, the clip blurred or an image, and Apply to
 * all). Position, scale, rotation and opacity are keyframeable: each row shows its value at
 * the playhead and keys it (lib/keyframe-ui.ts).
 */

type Media = VideoClipProps | ImageClipProps;

/** The canvas in world units, and the project's pixels per world unit (positions show in pixels). */
export const useWorld = () => {
  const aspect = useViewportStore((s) => s.aspectRatio);
  const world = useMemo(() => worldOf(aspect.width / aspect.height), [aspect.width, aspect.height]);
  // The engine knows the canvas in pixels; before it does, 1080 px across the short side.
  const px = useEnginePreviewStore((s) => (s.project ? s.project.height / world.height : 1080 / Math.min(world.width, world.height)));
  return { world, px };
};

const update = (clipId: string, patch: Partial<AnyClipProps>) => useClipStore.getState().updateClip(clipId, patch);
const current = (clipId: string) => useClipStore.getState().getClipById(clipId);

const TRANSFORM_KEYS: KeyframeProperty[] = ["scale", "position", "rotation"];

export const TransformSection: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as Media | undefined;
  const { frame, fps } = usePlayhead();
  const { world, px } = useWorld();
  const t = clip?.transform;
  // The box against the size it was fitted at: CapCut's 100 % is the fitted picture.
  const base = clip?.originalTransform ?? t;
  const kx = t && base?.width ? t.width / base.width : 1;
  const ky = t && base?.height ? t.height / base.height : 1;
  const scale = (clip ? valueAt(clip, "scale", frame, fps) : [1, 1]) as number[];
  const pct = [scale[0] * kx * 100, (scale[1] ?? scale[0]) * ky * 100];
  const [uniform, setUniform] = useState(true);
  useEffect(() => setUniform(Math.abs(pct[0] - pct[1]) < 0.5), [clipId]);
  if (!clip || !t) return null;
  const centre = valueAt(clip, "position", frame, fps) as number[];
  const rotation = Number(valueAt(clip, "rotation", frame, fps));
  // Edits at the playhead by CapCut's rule, on the clip as the store has it now.
  const edit = (edits: [KeyframeProperty, KeyframeValue][]) => {
    const now = current(clipId);
    if (now) update(clipId, editProperties(now, frame, edits));
  };
  const setScale = (x: number, y: number) => edit([["scale", [Math.max(1, x) / 100 / kx, Math.max(1, y) / 100 / ky]]]);
  // Position as CapCut shows it: pixels from the canvas's middle, y up.
  const shownX = (centre[0] - world.width / 2) * px;
  const shownY = (world.height / 2 - centre[1]) * px;
  const setPosition = (x: number, y: number) => edit([["position", [world.width / 2 + x / px, world.height / 2 - y / px]]]);

  // Alignment on the canvas, by the turned picture's bounds.
  const align = (to: "left" | "center-h" | "right" | "top" | "center-v" | "bottom") => {
    const shown = transformAt(clip, frame, fps)!;
    const [w, h] = [shown.width * shown.scaleX, shown.height * shown.scaleY];
    const r = (shown.rotation * Math.PI) / 180;
    const hw = (Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h) / 2;
    const hh = (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h) / 2;
    let [x, y] = centre;
    if (to === "left") x = hw;
    if (to === "center-h") x = world.width / 2;
    if (to === "right") x = world.width - hw;
    if (to === "top") y = hh;
    if (to === "center-v") y = world.height / 2;
    if (to === "bottom") y = world.height - hh;
    edit([["position", [x, y]]]);
  };
  // Fit, fill and stretch over the canvas, centred (keys set at the playhead when keyed).
  const preset = (p: ScalePreset) => {
    const now = current(clipId);
    if (!now) return;
    const to = scalePreset(transformAt(now, frame, fps)!, world, p);
    edit([
      ["scale", [to.scaleX, to.scaleY]],
      ["position", centreOf(to)],
    ]);
  };
  const quarter = () => {
    const now = current(clipId);
    if (!now) return;
    const turned = rotate90({ ...now, transform: transformAt(now, frame, fps) } as AnyClipProps).transform!;
    edit([["rotation", turned.rotation]]);
  };
  const flips = flipOf(clip);
  // Back to CapCut's defaults: 100 %, centred, upright, none of them keyed.
  const reset = () => {
    const now = current(clipId);
    if (!now?.transform) return;
    let keyframes = now.keyframes;
    for (const p of TRANSFORM_KEYS) keyframes = clearKeyframes(keyframes, p);
    const plain = { ...now, keyframes } as AnyClipProps;
    update(clipId, {
      keyframes,
      ...editProperties(plain, frame, [
        ["rotation", 0],
        ["scale", [1 / kx, 1 / ky]],
        ["position", [world.width / 2, world.height / 2]],
      ]),
    });
  };
  const scaleNav = <KeyframeButton clipId={clipId} properties={["scale"]} />;
  const scaleRow = (label: string, value: number, set: (v: number) => void) => (
    <div className="pb-[5px]" data-property="scale">
      <PropertiesSlider label={label} value={value} onChange={set} min={1} max={500} step={1} toFixed={0} suffix="%" end={scaleNav} />
    </div>
  );

  return (
    <Section title="Transform" onReset={reset} keyframes={{ clipId, properties: TRANSFORM_KEYS }} testId="section-transform">
      {uniform ? (
        scaleRow("Scale", pct[0], (v) => setScale(v, v))
      ) : (
        <>
          {scaleRow("Scale width", pct[0], (v) => setScale(v, pct[1]))}
          {scaleRow("Scale height", pct[1], (v) => setScale(pct[0], v))}
        </>
      )}
      <PropertyRow label="Uniform scale">
        <div className="flex-1" />
        <Toggle
          on={uniform}
          label="Uniform scale"
          onChange={(on) => {
            setUniform(on);
            if (on && Math.abs(pct[0] - pct[1]) >= 0.5) setScale(pct[0], pct[0]);
          }}
        />
      </PropertyRow>
      <PropertyRow label="Position" clipId={clipId} keyframes="position">
        <NumberField label="Position X" prefix="X" value={shownX} onChange={(x) => setPosition(x, shownY)} />
        <NumberField label="Position Y" prefix="Y" value={shownY} onChange={(y) => setPosition(shownX, y)} className="ml-1.5" />
      </PropertyRow>
      <PropertyRow label="Rotate" clipId={clipId} keyframes="rotation">
        <NumberField label="Rotate" value={rotation} unit="°" digits={2} onChange={(r) => edit([["rotation", r]])} />
        <div className="ml-[52px]">
          <Dial value={rotation} label="Rotate dial" onChange={(r) => edit([["rotation", r]])} />
        </div>
      </PropertyRow>
      <div className="mt-1.5 flex flex-row flex-wrap items-center gap-2">
        {/* CapCut's alignment group. */}
        <ButtonGroup>
          <GroupButton title="Align left" onClick={() => align("left")}>
            <PiAlignLeft className="h-4 w-4" />
          </GroupButton>
          <GroupButton title="Centre horizontally" onClick={() => align("center-h")}>
            <PiAlignCenterHorizontal className="h-4 w-4" />
          </GroupButton>
          <GroupButton title="Align right" onClick={() => align("right")}>
            <PiAlignRight className="h-4 w-4" />
          </GroupButton>
          <GroupDivider />
          <GroupButton title="Align top" onClick={() => align("top")}>
            <PiAlignTop className="h-4 w-4" />
          </GroupButton>
          <GroupButton title="Centre vertically" onClick={() => align("center-v")}>
            <PiAlignCenterVertical className="h-4 w-4" />
          </GroupButton>
          <GroupButton title="Align bottom" onClick={() => align("bottom")}>
            <PiAlignBottom className="h-4 w-4" />
          </GroupButton>
        </ButtonGroup>
        {/* The transform tools CapCut keeps in its timeline menu: fit, fill, stretch, a quarter
            turn and the mirrors. */}
        <ButtonGroup>
          <GroupButton title="Fit to the canvas" testId="transform-fit" onClick={() => preset("fit")}>
            <TbArrowsMinimize className="h-3.5 w-3.5" />
          </GroupButton>
          <GroupButton title="Fill the canvas" testId="transform-fill" onClick={() => preset("fill")}>
            <TbArrowsMaximize className="h-3.5 w-3.5" />
          </GroupButton>
          <GroupButton title="Stretch to the canvas" testId="transform-stretch" onClick={() => preset("stretch")}>
            <TbArrowAutofitWidth className="h-4 w-4" />
          </GroupButton>
          <GroupDivider />
          <GroupButton title="Rotate 90°" testId="transform-rotate90" onClick={quarter}>
            <LuRotateCw className="h-3.5 w-3.5" />
          </GroupButton>
          <GroupButton title="Mirror" testId="transform-flip-h" active={flips.horizontal} onClick={() => update(clipId, toggleFlip(current(clipId)!, "horizontal"))}>
            <LuFlipHorizontal2 className="h-3.5 w-3.5" />
          </GroupButton>
          <GroupButton title="Flip upside down" testId="transform-flip-v" active={flips.vertical} onClick={() => update(clipId, toggleFlip(current(clipId)!, "vertical"))}>
            <LuFlipVertical2 className="h-3.5 w-3.5" />
          </GroupButton>
        </ButtonGroup>
      </div>
    </Section>
  );
};

/** Blend: CapCut's eleven modes and the opacity (keyframeable). */
export const BlendSection: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as Media | undefined;
  if (!clip) return null;
  const reset = () => {
    const now = current(clipId);
    if (!now?.transform) return;
    update(clipId, { blendMode: "normal", keyframes: clearKeyframes(now.keyframes, "opacity"), transform: { ...now.transform, opacity: 100 } } as Partial<AnyClipProps>);
  };
  return (
    <Section title="Blend" onReset={reset} keyframes={{ clipId, properties: ["opacity"] }} testId="section-blend">
      <PropertyRow label="Mode">
        <InspectorSelect
          label="Blend mode"
          value={clip.blendMode ?? "normal"}
          onChange={(v) => update(clipId, setBlendMode(current(clipId)!, v as BlendModeId))}
          options={BLEND_MODES.map((m) => ({ value: m.id, label: m.name }))}
        />
      </PropertyRow>
      <KeyframedSlider clipId={clipId} property="opacity" label="Opacity" min={0} max={100} suffix="%" />
    </Section>
  );
};

/** A small copy of the engine's current picture, for the blur tiles. */
const useFrameThumb = (on: boolean) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    const c = document.getElementById(ENGINE_FRAME_CANVAS_ID) as HTMLCanvasElement | null;
    if (!c || c.width < 4) return;
    const t = document.createElement("canvas");
    const k = 120 / Math.max(c.width, c.height);
    t.width = Math.max(1, Math.round(c.width * k));
    t.height = Math.max(1, Math.round(c.height * k));
    t.getContext("2d")?.drawImage(c, 0, 0, t.width, t.height);
    setUrl(t.toDataURL());
  }, [on]);
  return url;
};

/** OpenRip's own swatches for the canvas colour (CapCut's palette isn't copied). */
const CANVAS_SWATCHES = ["#000000", "#ffffff", "#808080", "#3a3a3a", "#d6d6d6", "#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8e4f2f", "#fbd5e0", "#c2e5ff", "#c4e8d1", "#fff1a8"];

const CANVAS_TYPES = [
  { value: "none", label: "None" },
  { value: "color", label: "Color" },
  { value: "blur", label: "Blur" },
  { value: "image", label: "Image" },
];

/** A 60×60 tile on the raised grey (CapCut's tile grid); selected, an accent outline. */
const Tile: React.FC<{ selected?: boolean; onClick: () => void; title: string; children: React.ReactNode; testId?: string }> = ({ selected, onClick, title, children, testId }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={selected}
    data-testid={testId}
    onClick={onClick}
    className={cn(
      "relative w-[60px] h-[60px] rounded-[6px] overflow-hidden bg-brand-background-light flex items-center justify-center shrink-0",
      selected ? "outline outline-[1.5px] outline-brand-accent outline-offset-0" : "hover:bg-brand-button",
    )}
  >
    {children}
  </button>
);

/** Canvas: what fills the canvas around a clip on the main track. */
const CanvasSection: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as Media | undefined;
  const timelines = useClipStore((s) => s.timelines);
  const canvas = clip?.canvas ?? null;
  const thumb = useFrameThumb(canvas?.type === "blur");
  if (!clip || !fillsCanvas(clip, timelines)) return null;
  const set = (next: ClipCanvas | null) => update(clipId, setCanvas(current(clipId)!, next));
  const pickImage = async () => {
    const [path] = await pickMediaPaths({ title: "Choose an image for the canvas", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }] });
    if (path) set(canvasImage(path));
  };
  const applyAll = () => {
    const { clips, timelines: tracks, updateClip } = useClipStore.getState();
    // Every clip's canvas in one press: one undo step.
    for (const [id, patch] of applyCanvasToAll(clips, tracks, canvas)) updateClip(id, patch);
  };
  const type = canvas?.type ?? "none";
  return (
    <Section
      title="Canvas"
      checked={canvas != null}
      onCheckedChange={(on) => set(on ? canvasBlur() : null)}
      actions={
        <button
          type="button"
          onClick={applyAll}
          className="h-[22px] px-2.5 rounded-[4px] bg-brand-button hover:bg-brand-hover text-[12px] font-semibold text-brand-lighter"
        >
          Apply to all
        </button>
      }
      dimOff={false}
      testId="section-canvas"
    >
      <InspectorSelect
        label="Canvas fill"
        value={type}
        onChange={(v) => {
          if (v === "none") set(null);
          else if (v === "color") set(canvasColor(canvas?.color ?? "#000000"));
          else if (v === "blur") set(canvasBlur(canvas?.blur));
          // An image: the one it had, else one picked now.
          else if (canvas?.image) set(canvasImage(canvas.image));
          else void pickImage();
        }}
        options={CANVAS_TYPES}
      />
      {canvas?.type === "color" && (
        <div className="mt-3 grid grid-cols-9 gap-[6px]" data-testid="canvas-colors">
          {CANVAS_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={`Canvas ${c}`}
              onClick={() => set(canvasColor(c))}
              className={cn("h-[30px] rounded-[4px]", canvas.color?.toLowerCase() === c && "outline outline-[1.5px] outline-brand-accent outline-offset-1")}
              style={{ background: c }}
            />
          ))}
          <label title="Another colour" className="relative h-[30px] rounded-[4px] bg-brand-background-light hover:bg-brand-button flex items-center justify-center cursor-pointer">
            <LuPlus className="w-3.5 h-3.5 text-brand-light" />
            <input
              type="color"
              aria-label="Canvas colour"
              value={canvas.color ?? "#000000"}
              onChange={(e) => set(canvasColor(e.target.value))}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </div>
      )}
      {canvas?.type === "blur" && (
        <div className="mt-3 flex flex-row gap-[18px]" data-testid="canvas-blurs">
          {CANVAS_BLURS.map((b, i) => (
            <Tile key={b} title={`Blur ${i + 1}`} selected={Math.abs((canvas.blur ?? 0) - b) < 1e-6} onClick={() => set(canvasBlur(b))} testId={`canvas-blur-${i + 1}`}>
              {thumb ? (
                <img src={thumb} alt="" className="w-full h-full object-cover scale-110" style={{ filter: `blur(${[0.5, 2.5, 5, 7][i]}px)` }} />
              ) : (
                <span className="text-[11px] text-brand-light">{i + 1}</span>
              )}
            </Tile>
          ))}
        </div>
      )}
      {canvas?.type === "image" && (
        <div className="mt-3 flex flex-row items-center gap-3 min-w-0">
          <Tile title="Choose another image" onClick={pickImage} testId="canvas-image-pick">
            <LuImage className="w-4 h-4 text-brand-light" />
          </Tile>
          <span className="text-[12px] text-[#949494] truncate min-w-0" title={canvas.image}>
            {canvas.image?.split(/[\\/]/).pop()}
          </span>
        </div>
      )}
    </Section>
  );
};

const VideoBasicProperties: React.FC<{ clipId: string }> = ({ clipId }) => (
  <div className="min-w-0 divide-y divide-brand-divider">
    <TransformSection clipId={clipId} />
    <BlendSection clipId={clipId} />
    <CanvasSection clipId={clipId} />
  </div>
);

export default VideoBasicProperties;
