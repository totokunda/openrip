import React, { useEffect, useRef, useState } from "react";
import { LuBan, LuBrush, LuCircle, LuHeart, LuLink2, LuPenTool, LuPlus, LuStar, LuUnlink2, LuX } from "react-icons/lu";
import { TbSquareToggle } from "react-icons/tb";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { useMaskStore } from "@/lib/mask";
import { transformAt, usePlayhead } from "@/lib/keyframe-ui";
import {
  Bounds,
  MASK_SHAPES,
  MaskShape,
  boundsCentre,
  changeMaskShape,
  editMaskPose,
  maskFrame,
  maskNav,
  maskShapeName,
  newShapeMask,
  pictureBox,
  placeBounds,
  poseAt,
  toggleMaskPose,
} from "@/lib/mask-shapes";
import type { AnyClipProps, MaskClipProps, MaskData, MediaClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import Section from "../Section";
import PropertyRow from "../PropertyRow";
import PropertiesSlider from "../PropertiesSlider";
import { KeyframeNavigator } from "../KeyframeButton";
import { Dial, NumberField, Toggle } from "../controls";
import { useWorld } from "../VideoBasicProperties";
import MaskOperationsProperties from "./MaskOperationsProperties";
import TrackMaskSection from "./TrackMaskSection";

/**
 * Video ▸ Mask, as CapCut lays it out (docs/plan/capcut-ui-spec.md §4.8c, §6.17): the clip's
 * masks as chips with "+" to add one, the shapes as tiles (None, Split, Filmstrip, Circle,
 * Rectangle, Stars, Heart and the app's Pen, which draws a lasso on the picture), then Mask
 * settings: invert, Position, Rotation, Size (linked or not), Feather and, on a rectangle,
 * Round corners. Each row keys the mask's pose at the playhead (lib/mask-shapes.ts); the
 * engine draws the masks, with their outline and handles on the canvas while this tab is open.
 */

/** Small glyphs for Split and Filmstrip (OpenRip's own drawings). */
const SplitGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="3" width="20" height="20" rx="1" />
    <path d="M3 13 H23" />
  </svg>
);
const FilmstripGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="3" width="20" height="20" rx="1" />
    <path d="M3 9 H23 M3 17 H23" />
  </svg>
);
const RectGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="3" width="20" height="20" rx="1" />
    <rect x="8" y="9" width="10" height="8" />
  </svg>
);
const GLYPHS: Record<string, React.ReactNode> = {
  none: <LuBan className="w-6 h-6" />,
  linear: <SplitGlyph />,
  mirror: <FilmstripGlyph />,
  ellipse: <LuCircle className="w-6 h-6" />,
  rectangle: <RectGlyph />,
  star: <LuStar className="w-6 h-6" />,
  heart: <LuHeart className="w-6 h-6" />,
  brush: <LuBrush className="w-6 h-6" />,
  lasso: <LuPenTool className="w-6 h-6" />,
};

type Media = MediaClipProps;

const MaskPropertiesPanel: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as Media | undefined;
  const selectedMaskId = useControlsStore((s) => s.selectedMaskId);
  const setSelectedMaskId = useControlsStore((s) => s.setSelectedMaskId);
  // The canvas tool the Brush and Pen tiles bring out (the mask tool's brush or lasso).
  const maskToolOut = useViewportStore((s) => s.tool === "mask");
  const canvasTool = useMaskStore((s) => s.tool);
  const brushSize = useMaskStore((s) => s.brushSize);
  const erase = useMaskStore((s) => s.erase);
  const drawing = maskToolOut ? (canvasTool === "lasso" ? "lasso" : canvasTool === "draw" ? "brush" : null) : null;
  const { frame, fps } = usePlayhead();
  const { px } = useWorld();
  // "+" pressed: the next shape makes a new mask instead of changing the selected one.
  const [adding, setAdding] = useState(false);
  const [linked, setLinked] = useState(true);
  const masks: MaskClipProps[] = (clip as any)?.masks ?? [];
  const mask = masks.find((m) => m.id === selectedMaskId) ?? (adding || drawing ? undefined : masks[0]);
  // Select the first mask when none is (outside render: it updates another store).
  useEffect(() => {
    if (!adding && !drawing && masks.length && !masks.some((m) => m.id === selectedMaskId)) setSelectedMaskId(masks[0].id);
  }, [adding, drawing, masks.length, selectedMaskId]);
  // A lasso closed with Pen is a new mask: back to the pointer with it selected, as CapCut's
  // pen finishes.
  const count = useRef(masks.length);
  useEffect(() => {
    if (drawing === "lasso" && masks.length > count.current) {
      setSelectedMaskId(masks[masks.length - 1].id);
      useViewportStore.getState().setTool("pointer");
    }
    count.current = masks.length;
  }, [masks.length, drawing]);
  if (!clip?.transform) return null;
  const finishDrawing = () => useViewportStore.getState().setTool("pointer");

  const store = () => useClipStore.getState();
  const now = () => store().getClipById(clipId) as Media;
  const setMasks = (next: MaskClipProps[]) => store().updateClip(clipId, { masks: next } as Partial<AnyClipProps>);
  const replace = (m: MaskClipProps) => setMasks(((now() as any).masks ?? []).map((x: MaskClipProps) => (x.id === m.id ? m : x)));
  const current = () => ((now() as any).masks ?? []).find((m: MaskClipProps) => m.id === mask?.id) as MaskClipProps | undefined;

  const pick = (id: string) => {
    const c = now();
    if (id === "none") {
      if (!mask) return;
      setMasks(masks.filter((m) => m.id !== mask.id));
      setSelectedMaskId(null);
      return;
    }
    if (id === "lasso" || id === "brush") {
      // Pen draws an outline on the picture with the mask tool's lasso (a new mask when it
      // closes); Brush paints strokes onto the selected brush mask, or a new one.
      useMaskStore.getState().setTool(id === "lasso" ? "lasso" : "draw");
      useViewportStore.getState().setTool("mask");
      if (id === "lasso" || mask?.tool !== "draw") setSelectedMaskId(null);
      setAdding(false);
      return;
    }
    if (mask && !adding) {
      replace(changeMaskShape(mask, id as MaskShape, mask.transform ?? c.transform!));
      return;
    }
    const m = newShapeMask(c, id as MaskShape, maskFrame(c, useControlsStore.getState().focusFrame));
    setMasks([...((c as any).masks ?? []), m]);
    setSelectedMaskId(m.id);
    setAdding(false);
  };

  const f = maskFrame(clip, frame);
  const pose: MaskData | undefined = mask ? poseAt(mask, f, fps) : undefined;
  const b = pose?.shapeBounds as Bounds | undefined;
  const lasso = mask?.tool === "lasso" ? (pose?.lassoPoints ?? []) : null;
  const shapeType = (b?.shapeType ?? "rectangle") as MaskShape;
  // The mask's units against the canvas's pixels: the picture as drawn now over the scale the
  // mask was drawn at (the engine scales a mask with its clip).
  const mt = mask?.transform ?? clip.transform;
  const shown = transformAt(clip, frame, fps) ?? clip.transform;
  const kx = ((shown.scaleX || 1) / (mt.scaleX || 1)) * px;
  const ky = ((shown.scaleY || 1) / (mt.scaleY || 1)) * px;
  const { w: W, h: H } = pictureBox(mt);
  const box = lasso
    ? (() => {
        const xs = lasso.filter((_, i) => i % 2 === 0);
        const ys = lasso.filter((_, i) => i % 2 === 1);
        return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      })()
    : null;
  const centre: [number, number] = b ? boundsCentre(b) : box ? [box.x + box.w / 2, box.y + box.h / 2] : [W / 2, H / 2];
  const size: [number, number] = b ? [b.width * (b.scaleX ?? 1), b.height * (b.scaleY ?? 1)] : box ? [box.w, box.h] : [0, 0];

  // An edit of the pose at the playhead (CapCut's rule), from the mask as the store has it.
  const edit = (fn: (p: MaskData) => MaskData) => {
    const m = current();
    if (m) replace(editMaskPose(m, maskFrame(now(), useControlsStore.getState().focusFrame), fps, fn));
  };
  const moveTo = (c: [number, number]) =>
    edit((p) => {
      if (p.shapeBounds) return { ...p, shapeBounds: placeBounds(p.shapeBounds as Bounds, c) };
      if (!p.lassoPoints) return p;
      const [dx, dy] = [c[0] - centre[0], c[1] - centre[1]];
      return { ...p, lassoPoints: p.lassoPoints.map((v, i) => v + (i % 2 ? dy : dx)) };
    });
  const resize = (w: number, h: number) =>
    edit((p) => {
      if (p.shapeBounds) {
        const sb = p.shapeBounds as Bounds;
        return { ...p, shapeBounds: placeBounds({ ...sb, width: Math.max(1, w), height: Math.max(1, h), scaleX: 1, scaleY: 1 }, boundsCentre(sb)) };
      }
      if (!p.lassoPoints || !box) return p;
      const [sx, sy] = [w / Math.max(1e-6, box.w), h / Math.max(1e-6, box.h)];
      return { ...p, lassoPoints: p.lassoPoints.map((v, i) => (i % 2 ? centre[1] + (v - centre[1]) * sy : centre[0] + (v - centre[0]) * sx)) };
    });

  const nav = mask ? maskNav(mask, clip, frame) : { keyed: false, at: false };
  const navigator = mask ? <KeyframeNavigator nav={nav} name={`mask:${mask.id}`} onToggle={() => replace(toggleMaskPose(current()!, maskFrame(now(), useControlsStore.getState().focusFrame), fps))} /> : null;
  const reset = () => {
    const m = current();
    if (!m || m.tool !== "shape") return;
    const fresh = newShapeMask(now(), shapeType, maskFrame(now(), useControlsStore.getState().focusFrame));
    replace({ ...m, keyframes: fresh.keyframes, featherAmount: 0, inverted: false, keyed: false, transform: fresh.transform });
  };

  return (
    <div className="min-w-0 divide-y divide-brand-divider" data-testid="mask-panel">
      <Section title="Mask" testId="section-mask">
        {masks.length > 0 && (
          <div className="flex flex-row flex-wrap items-center gap-2 mb-3">
            {masks.map((m, i) => (
              <div key={m.id} className="group relative">
                <button
                  type="button"
                  data-testid={`mask-chip-${i}`}
                  onClick={() => {
                    setAdding(false);
                    setSelectedMaskId(m.id);
                  }}
                  className={cn(
                    "h-6 px-3 rounded-full text-[12px] whitespace-nowrap",
                    m.id === mask?.id ? "bg-brand-button text-brand-light" : "bg-brand-background-light text-[#949494] hover:text-brand-light",
                  )}
                >
                  Mask{i + 1} {maskShapeName(m)}
                </button>
                <button
                  type="button"
                  title="Delete mask"
                  aria-label={`Delete mask ${i + 1}`}
                  onClick={() => setMasks(masks.filter((x) => x.id !== m.id))}
                  className="absolute -right-1 -top-1 hidden group-hover:flex w-3.5 h-3.5 rounded-full bg-brand-header border border-brand-divider items-center justify-center text-brand-light"
                >
                  <LuX className="w-2 h-2" />
                </button>
              </div>
            ))}
            <button
              type="button"
              title="Add a mask"
              aria-label="Add a mask"
              aria-pressed={adding}
              data-testid="mask-add"
              onClick={() => setAdding(!adding)}
              className={cn("w-6 h-6 rounded-full flex items-center justify-center", adding ? "bg-brand-accent text-white" : "bg-brand-background-light text-brand-light hover:bg-brand-button")}
            >
              <LuPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex flex-row flex-wrap gap-x-[18px] gap-y-2">
          {MASK_SHAPES.map((s) => {
            const own = s.id === "lasso" ? "lasso" : s.id === "brush" ? "draw" : "shape";
            const selected = drawing ? s.id === drawing : !adding && (s.id === "none" ? !mask : mask ? mask.tool === own && (own !== "shape" || shapeType === s.id) : false);
            return (
              <button key={s.id} type="button" data-testid={`mask-shape-${s.id}`} onClick={() => pick(s.id)} className="flex flex-col items-center gap-1 w-[60px] group">
                <span
                  className={cn(
                    "w-[60px] h-[60px] rounded-[6px] bg-brand-background-light flex items-center justify-center text-brand-light group-hover:bg-brand-button",
                    selected && "outline outline-[1.5px] outline-brand-accent",
                  )}
                >
                  {GLYPHS[s.id]}
                </span>
                <span className="text-[12px] text-[#949494]">{s.name}</span>
              </button>
            );
          })}
        </div>
        {drawing && (
          <div className="mt-3 flex flex-row items-start gap-3" data-testid="mask-drawing">
            <p className="flex-1 text-[12px] text-[#949494] text-start">
              {drawing === "lasso" ? "Draw the outline on the picture; it closes when you let go." : "Paint on the picture; hold ⌥ (or turn on Eraser) to erase."}
            </p>
            <button
              type="button"
              data-testid="mask-drawing-done"
              onClick={finishDrawing}
              className="h-[22px] px-3 rounded-[4px] bg-brand-button hover:bg-brand-hover text-[12px] font-semibold text-brand-lighter shrink-0"
            >
              Done
            </button>
          </div>
        )}
      </Section>
      {(drawing === "brush" || mask?.tool === "draw") && (
        <Section title="Brush" testId="section-mask-brush">
          {/* The brush's size and eraser, for the strokes still to paint (OpenRip's brush). */}
          <div className="pb-[5px]">
            <PropertiesSlider label="Brush size" value={brushSize} onChange={(v) => useMaskStore.getState().setBrushSize(Math.max(1, Math.min(200, v)))} min={1} max={200} step={1} toFixed={0} />
          </div>
          <PropertyRow label="Eraser">
            <div className="flex-1" />
            <Toggle on={erase} label="Eraser" onChange={(on) => useMaskStore.getState().setErase(on)} />
          </PropertyRow>
        </Section>
      )}
      {mask && pose && (
        <Section
          title="Mask settings"
          onReset={mask.tool === "shape" ? reset : undefined}
          actions={
            <button
              type="button"
              title="Invert"
              aria-label="Invert the mask"
              aria-pressed={!!mask.inverted}
              data-testid="mask-invert"
              onClick={() => replace({ ...current()!, inverted: !mask.inverted })}
              className={cn("w-[18px] h-[18px] rounded-[3px] flex items-center justify-center", mask.inverted ? "bg-brand-accent text-white" : "text-brand-light hover:text-brand-lighter")}
            >
              <TbSquareToggle className="w-[15px] h-[15px]" />
            </button>
          }
          navigator={navigator}
          testId="section-mask-settings"
        >
          {/* A mask's poses key all its settings at once: every row's navigator is the pose's. A
              brush mask's strokes stay where they're painted: it has only the feather. */}
          {mask.tool !== "draw" && (
          <PropertyRow label="Position" navigator={navigator}>
            <NumberField label="Mask position X" prefix="X" value={(centre[0] - W / 2) * kx} onChange={(x) => moveTo([W / 2 + x / kx, centre[1]])} />
            <NumberField label="Mask position Y" prefix="Y" value={(H / 2 - centre[1]) * ky} onChange={(y) => moveTo([centre[0], H / 2 - y / ky])} className="ml-1.5" />
          </PropertyRow>
          )}
          {b && (
            <PropertyRow label="Rotation" navigator={navigator}>
              <NumberField label="Mask rotation" value={b.rotation ?? 0} unit="°" digits={1} onChange={(r) => edit((p) => ({ ...p, shapeBounds: placeBounds({ ...(p.shapeBounds as Bounds), rotation: r }, boundsCentre(p.shapeBounds as Bounds)) }))} />
              <div className="ml-[52px]">
                <Dial value={b.rotation ?? 0} label="Mask rotation dial" onChange={(r) => edit((p) => ({ ...p, shapeBounds: placeBounds({ ...(p.shapeBounds as Bounds), rotation: r }, boundsCentre(p.shapeBounds as Bounds)) }))} />
              </div>
            </PropertyRow>
          )}
          {shapeType !== "linear" && mask.tool !== "draw" && (
            <PropertyRow label="Size" navigator={navigator}>
              <NumberField label="Mask width" prefix="W" value={size[0] * kx} min={1} onChange={(w) => resize(w / kx, linked && size[0] ? size[1] * (w / kx / size[0]) : size[1])} />
              <button
                type="button"
                title={linked ? "Unlink width and height" : "Link width and height"}
                aria-label={linked ? "Unlink width and height" : "Link width and height"}
                aria-pressed={linked}
                onClick={() => setLinked(!linked)}
                className="mx-[3px] text-[#949494] hover:text-brand-light"
              >
                {linked ? <LuLink2 className="w-3 h-3" /> : <LuUnlink2 className="w-3 h-3" />}
              </button>
              <NumberField label="Mask height" prefix="H" value={size[1] * ky} min={1} onChange={(h) => resize(linked && size[1] ? size[0] * (h / ky / size[1]) : size[0], h / ky)} />
            </PropertyRow>
          )}
          <div className="pb-[5px]" data-property="mask-feather">
            <PropertiesSlider
              label="Feather"
              value={Math.round((pose as any).featherAmount ?? mask.featherAmount ?? 0)}
              onChange={(v) => edit((p) => ({ ...p, featherAmount: Math.max(0, Math.min(100, v)) }))}
              min={0}
              max={100}
              step={1}
              toFixed={0}
              end={navigator}
            />
          </div>
          {b && shapeType === "rectangle" && (
            <div className="pb-[5px]" data-property="mask-corners">
              <PropertiesSlider
                label="Round corners"
                value={Math.round(b.cornerRadius ?? 0)}
                onChange={(v) => edit((p) => ({ ...p, shapeBounds: { ...(p.shapeBounds as Bounds), cornerRadius: Math.max(0, Math.min(100, v)) } }))}
                min={0}
                max={100}
                step={1}
                toFixed={0}
                end={navigator}
              />
            </div>
          )}
        </Section>
      )}
      {/* CapCut's Track mask, under the mask's settings (a shape mask on a video). */}
      {mask && <TrackMaskSection clipId={clipId} mask={mask} />}
      {/* The app's own mask colours (a matte), for masks that paint one; CapCut's cut the clip. */}
      {mask && (mask.maskColorEnabled || (mask.backgroundColorEnabled && (mask.backgroundOpacity ?? 100) > 0)) && (
        <Section title="Display" defaultOpen={false} testId="section-mask-display">
          <MaskOperationsProperties mask={mask} clipId={clipId} />
        </Section>
      )}
    </div>
  );
};

export default MaskPropertiesPanel;
