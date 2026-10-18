import React, { useEffect, useRef, useState } from "react";
import { LuBold, LuBrush, LuCircle, LuEraser, LuHeart, LuItalic, LuLink2, LuPenTool, LuPlus, LuStar, LuTrash2, LuType, LuUnderline, LuUnlink2, LuX } from "react-icons/lu";
import { TbAlignCenter, TbAlignLeft, TbAlignRight, TbSquareToggle } from "react-icons/tb";
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
  editAllPoses,
  editMaskPose,
  isEmptyMask,
  maskFrame,
  maskNav,
  maskShapeName,
  newEmptyMask,
  newShapeMask,
  pictureBox,
  placeBounds,
  poseAt,
  poseBox,
  remakeMask,
  textBox,
  toggleMaskPose,
} from "@/lib/mask-shapes";
import type { AnyClipProps, MaskClipProps, MaskData, MaskTextStyle, MediaClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import Section from "../Section";
import PropertyRow from "../PropertyRow";
import PropertiesSlider from "../PropertiesSlider";
import { KeyframeNavigator } from "../KeyframeButton";
import { ButtonGroup, Dial, GroupButton, InspectorSelect, NumberField } from "../controls";
import { useWorld } from "../VideoBasicProperties";
import MaskOperationsProperties from "./MaskOperationsProperties";
import TrackMaskSection from "./TrackMaskSection";

/**
 * Video ▸ Mask, as CapCut's (docs/plan/capcut-ui-spec.md §4.8c, §6.17; 18-inspector-video
 * 013–017): the section's checkbox switches the clip's masks on and off; with none, "Add
 * mask"; else the masks as 24 px chips with "+" to add one (a centred rectangle, selected).
 * Then the tiles in CapCut's order (Split, Filmstrip, Circle, Rectangle, Stars, Heart, Text,
 * Brush, Pen), greyed until there's a mask: each gives the selected mask its shape; Brush and
 * Pen make it an empty brush or pen mask and turn on the canvas's brush or pen for it.
 * Then the mask's own controls: a text's words, font, size, B / U / I, spacing and alignment;
 * Mask settings with invert, reset and the pose navigator: for a shape Position, Rotation,
 * Size (linked), Feather and a rectangle's Round corners; for Split Position, Rotation and
 * Feather; for the brush Brush / Eraser / Clear, Brush size, Feather and Expansion; for a pen
 * Transform, Feather and Expansion. Every row keys the mask's pose at the playhead
 * (lib/mask-shapes.ts); the engine draws the masks, with CapCut's handles on the canvas
 * (MaskHandles). A converted CapCut clip's masks show here too.
 */

/** Small glyphs for Split, Filmstrip and Rectangle (OpenRip's own drawings). */
const Glyph: React.FC<{ d: string }> = ({ d }) => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="3" width="20" height="20" rx="1" />
    <path d={d} />
  </svg>
);
const GLYPHS: Record<string, React.ReactNode> = {
  linear: <Glyph d="M3 13 H23" />,
  mirror: <Glyph d="M3 9 H23 M3 17 H23" />,
  circle: <LuCircle className="w-6 h-6" />,
  rectangle: <Glyph d="M8 9 H18 V17 H8 Z" />,
  star: <LuStar className="w-6 h-6" />,
  heart: <LuHeart className="w-6 h-6" />,
  text: <LuType className="w-6 h-6" />,
  brush: <LuBrush className="w-6 h-6" />,
  pen: <LuPenTool className="w-6 h-6" />,
};

/** Fonts the engine finds on the system for a text mask; "System" is the app's default. */
const MASK_FONTS = ["", "Arial", "Helvetica", "Times New Roman", "Georgia", "Verdana", "Courier New", "Trebuchet MS", "Impact", "Comic Sans MS"];

type Media = MediaClipProps;

const MaskPropertiesPanel: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as Media | undefined;
  const selectedMaskId = useControlsStore((s) => s.selectedMaskId);
  const setSelectedMaskId = useControlsStore((s) => s.setSelectedMaskId);
  // The canvas tool the Brush and Pen tiles bring out (the mask tool's brush or pen).
  const maskToolOut = useViewportStore((s) => s.tool === "mask");
  const canvasTool = useMaskStore((s) => s.tool);
  const brushSize = useMaskStore((s) => s.brushSize);
  const erase = useMaskStore((s) => s.erase);
  const drawing = maskToolOut ? (canvasTool === "pen" ? "pen" : canvasTool === "draw" ? "brush" : canvasTool === "lasso" ? "lasso" : null) : null;
  const { frame, fps } = usePlayhead();
  const { px } = useWorld();
  const [linked, setLinked] = useState(true);
  const masks: MaskClipProps[] = (clip as any)?.masks ?? [];
  const mask = masks.find((m) => m.id === selectedMaskId) ?? masks[0];
  // Select the first mask when none is (outside render: it updates another store).
  useEffect(() => {
    if (masks.length && !masks.some((m) => m.id === selectedMaskId)) setSelectedMaskId(masks[0].id);
  }, [masks.length, selectedMaskId]);
  // The old lasso tool's closed outline is a new mask: back to the pointer with it selected.
  const count = useRef(masks.length);
  useEffect(() => {
    if (drawing === "lasso" && masks.length > count.current) {
      setSelectedMaskId(masks[masks.length - 1].id);
      useViewportStore.getState().setTool("pointer");
    }
    count.current = masks.length;
  }, [masks.length, drawing]);
  if (!clip?.transform) return null;

  const store = () => useClipStore.getState();
  const now = () => store().getClipById(clipId) as Media;
  const setMasks = (next: MaskClipProps[]) => store().updateClip(clipId, { masks: next } as Partial<AnyClipProps>);
  const replace = (m: MaskClipProps) => setMasks(((now() as any).masks ?? []).map((x: MaskClipProps) => (x.id === m.id ? m : x)));
  const current = () => ((now() as any).masks ?? []).find((m: MaskClipProps) => m.id === mask?.id) as MaskClipProps | undefined;
  const playheadFrame = () => maskFrame(now(), useControlsStore.getState().focusFrame);

  // The canvas's brush or pen for the selected mask: the strokes go on it (its first stroke
  // makes a mask of another shape a brush mask), a closed path becomes it.
  const drawFor = (tool: "draw" | "pen", eraser = false) => {
    const ms = useMaskStore.getState();
    ms.setTool(tool);
    ms.setErase(eraser);
    ms.setActiveMaskId(mask?.id ?? null);
    useViewportStore.getState().setTool("mask");
  };
  const brushOn = (eraser: boolean) => drawFor("draw", eraser);
  // Add mask / "+": a rectangle centred on the picture, selected (CapCut's new mask).
  const addMask = () => {
    const c = now();
    if (useViewportStore.getState().tool === "mask") useViewportStore.getState().setTool("pointer");
    const m = newShapeMask(c, "rectangle", maskFrame(c, useControlsStore.getState().focusFrame));
    setMasks([...((c as any).masks ?? []), m]);
    setSelectedMaskId(m.id);
  };
  // A tile gives the selected mask its shape. Brush and Pen make it an empty brush or pen mask
  // (the clip shows whole until something is drawn, as CapCut's) and bring out the canvas's
  // brush or pen for it; a pen path already drawn is edited by its handles instead.
  const pick = (id: string) => {
    if (!mask) return;
    const tool = id === "pen" ? "pen" : id === "brush" ? "draw" : null;
    if (tool) {
      if (mask.tool !== tool && !(tool === "pen" && mask.tool === "lasso")) replace(remakeMask(mask, newEmptyMask(now(), tool, playheadFrame())));
      if (tool === "pen" && !isEmptyMask(mask) && (mask.tool === "pen" || mask.tool === "lasso")) {
        if (useViewportStore.getState().tool === "mask") useViewportStore.getState().setTool("pointer");
        return;
      }
      return drawFor(tool);
    }
    if (useViewportStore.getState().tool === "mask") useViewportStore.getState().setTool("pointer");
    replace(changeMaskShape(mask, id as MaskShape, mask.transform ?? now().transform!));
  };
  const masksOn = !(clip as any).masksOff;

  const pose: MaskData | undefined = mask ? poseAt(mask, maskFrame(clip, frame), fps) : undefined;
  const b = pose?.shapeBounds as Bounds | undefined;
  const shapeType = (mask?.tool === "shape" ? (b?.shapeType ?? "rectangle") : mask?.tool) as string | undefined;
  // The mask's units against the canvas's pixels: the picture as drawn now over the scale the
  // mask was drawn at (the engine scales a mask with its clip).
  const mt = mask?.transform ?? clip.transform;
  const shown = transformAt(clip, frame, fps) ?? clip.transform;
  const kx = ((shown.scaleX || 1) / (mt.scaleX || 1)) * px;
  const ky = ((shown.scaleY || 1) / (mt.scaleY || 1)) * px;
  const { w: W, h: H } = pictureBox(mt);
  const box = pose ? poseBox(pose) : null;
  const centre: [number, number] = b ? boundsCentre(b) : box ? [box.x + box.width / 2, box.y + box.height / 2] : [W / 2, H / 2];
  const size: [number, number] = box ? [box.width * (box.scaleX ?? 1), box.height * (box.scaleY ?? 1)] : [0, 0];

  // An edit of the pose at the playhead (CapCut's rule), from the mask as the store has it.
  const edit = (fn: (p: MaskData) => MaskData) => {
    const m = current();
    if (m) replace(editMaskPose(m, playheadFrame(), fps, fn));
  };
  const moveTo = (c: [number, number]) =>
    edit((p) => {
      if (p.shapeBounds) return { ...p, shapeBounds: placeBounds(p.shapeBounds as Bounds, c) };
      const [dx, dy] = [c[0] - centre[0], c[1] - centre[1]];
      if (p.penPath) return { ...p, penPath: { closed: true, points: p.penPath.points.map((a) => ({ x: a.x + dx, y: a.y + dy, ix: a.ix + dx, iy: a.iy + dy, ox: a.ox + dx, oy: a.oy + dy })) } };
      if (p.lassoPoints) return { ...p, lassoPoints: p.lassoPoints.map((v, i) => v + (i % 2 ? dy : dx)) };
      return p;
    });
  const resize = (w: number, h: number) =>
    edit((p) => {
      const sb = p.shapeBounds as Bounds;
      return sb ? { ...p, shapeBounds: placeBounds({ ...sb, width: Math.max(1, w), height: Math.max(1, h), scaleX: 1, scaleY: 1 }, boundsCentre(sb)) } : p;
    });
  const turn = (r: number) => edit((p) => ({ ...p, shapeBounds: placeBounds({ ...(p.shapeBounds as Bounds), rotation: r }, boundsCentre(p.shapeBounds as Bounds)) }));
  // A text's words or style: every pose (they hold one text), its box re-measured about its middle.
  const setText = (patch: Partial<MaskTextStyle>) => {
    const m = current();
    if (!m) return;
    replace(
      editAllPoses(m, (p) => {
        if (!p.text || !p.shapeBounds) return p;
        const text = { ...p.text, ...patch };
        const sized = textBox(text);
        return { ...p, text, shapeBounds: placeBounds({ ...(p.shapeBounds as Bounds), ...sized, scaleX: 1, scaleY: 1 }, boundsCentre(p.shapeBounds as Bounds)) };
      }),
    );
  };

  const nav = mask ? maskNav(mask, clip, frame) : { keyed: false, at: false };
  const navigator = mask ? <KeyframeNavigator nav={nav} name={`mask:${mask.id}`} onToggle={() => replace(toggleMaskPose(current()!, playheadFrame(), fps))} /> : null;
  // Back to the shape's defaults: centred, its first size, upright, no feather, unkeyed.
  const reset = () => {
    const m = current();
    if (!m) return;
    if (m.tool === "shape") {
      const fresh = newShapeMask(now(), (b?.shapeType ?? "rectangle") as MaskShape, playheadFrame());
      const keep = pose?.text ? { text: pose.text } : {};
      const first = Object.values(fresh.keyframes)[0] as MaskData;
      replace({ ...m, keyframes: { [playheadFrame()]: { ...first, ...keep } }, featherAmount: 0, expansion: 0, inverted: false, keyed: false, transform: fresh.transform });
    } else replace(editAllPoses({ ...m, featherAmount: 0, expansion: 0, inverted: false }, (p) => ({ ...p, featherAmount: undefined, expansion: undefined })));
  };
  const feather = Math.round((pose as any)?.featherAmount ?? mask?.featherAmount ?? 0);
  const expansion = Math.round((pose as any)?.expansion ?? mask?.expansion ?? 0);
  const slider = (label: string, value: number, set: (v: number) => void, min: number, max: number, testId: string, origin?: number) => (
    <div className="pb-[5px]" data-property={testId}>
      <PropertiesSlider label={label} value={value} onChange={(v) => set(Math.max(min, Math.min(max, Math.round(v))))} min={min} max={max} step={1} toFixed={0} origin={origin} end={navigator} />
    </div>
  );
  const text = pose?.text;
  const isBrush = drawing === "brush" || mask?.tool === "draw";

  return (
    <div className="min-w-0 divide-y divide-brand-divider" data-testid="mask-panel">
      <Section
        title="Mask"
        testId="section-mask"
        checked={masksOn}
        onCheckedChange={(on) => store().updateClip(clipId, { masksOff: on ? undefined : true } as Partial<AnyClipProps>)}
      >
        {masks.length === 0 ? (
          <button
            type="button"
            data-testid="mask-add"
            onClick={addMask}
            className="self-start mb-3 h-[23px] px-3 rounded-full bg-brand-background-light hover:bg-brand-button text-[12px] text-brand-lighter flex flex-row items-center gap-1.5"
          >
            <LuPlus className="w-3.5 h-3.5" />
            Add mask
          </button>
        ) : (
          <div className="flex flex-row flex-wrap items-center gap-2 mb-3">
            {masks.map((m, i) => (
              <div key={m.id} className="group relative">
                <button
                  type="button"
                  data-testid={`mask-chip-${i}`}
                  onClick={() => setSelectedMaskId(m.id)}
                  className={cn(
                    "h-6 min-w-[112px] px-3 rounded-full text-[12px] whitespace-nowrap",
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
              title="Add mask"
              aria-label="Add mask"
              data-testid="mask-add"
              onClick={addMask}
              className="w-6 h-6 rounded-full flex items-center justify-center bg-brand-background-light text-brand-light hover:bg-brand-button"
            >
              <LuPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {/* The tiles shape the selected mask; greyed until there is one. */}
        <div className="flex flex-row flex-wrap gap-x-[17px] gap-y-2">
          {MASK_SHAPES.map((s) => {
            const own = s.id === "pen" ? ["pen", "lasso"] : s.id === "brush" ? ["draw"] : ["shape"];
            const selected = drawing
              ? s.id === (drawing === "lasso" ? "pen" : drawing)
              : !!mask && own.includes(mask.tool) && (own[0] !== "shape" || shapeType === s.id || (s.id === "circle" && shapeType === "ellipse"));
            return (
              <button key={s.id} type="button" disabled={!mask} data-testid={`mask-shape-${s.id}`} onClick={() => pick(s.id)} className="flex flex-col items-center gap-1 w-[60px] group disabled:opacity-30 disabled:cursor-default">
                <span className={cn("w-[60px] h-[60px] rounded-[6px] bg-brand-background-light flex items-center justify-center text-brand-light", mask && "group-hover:bg-brand-button", selected && "outline outline-[1.5px] outline-brand-accent")}>
                  {GLYPHS[s.id]}
                </span>
                <span className="text-[12px] text-[#949494]">{s.name}</span>
              </button>
            );
          })}
        </div>
        {drawing === "pen" && <p className="mt-3 text-[12px] text-[#949494] text-start" data-testid="mask-drawing">Click to add points on the picture, drag to curve, click the first point to close.</p>}
      </Section>

      {/* A text mask's words and style (CapCut's 015). */}
      {mask && text && (
        <section className="px-3 pt-3 pb-2 min-w-0 text-left" data-testid="section-mask-text">
          <textarea
            aria-label="Mask text"
            value={text.content}
            onChange={(e) => setText({ content: e.target.value })}
            className="w-full h-16 rounded-[4px] bg-brand px-2.5 py-2 text-[12px] text-brand-lighter resize-none outline-none"
          />
          <PropertyRow label="Font">
            <InspectorSelect label="Mask font" value={text.font || "system"} onChange={(v) => setText({ font: v === "system" ? "" : v })} options={MASK_FONTS.map((f) => ({ value: f || "system", label: f || "System" }))} />
          </PropertyRow>
          <div className="pb-[5px]">
            <PropertiesSlider label="Font size" value={Math.round(text.size * ky)} onChange={(v) => setText({ size: Math.max(1, v) / ky })} min={1} max={300} step={1} toFixed={0} />
          </div>
          <PropertyRow label="Pattern">
            <div className="flex flex-row gap-3">
              {(
                [
                  ["bold", "Bold", LuBold],
                  ["underline", "Underline", LuUnderline],
                  ["italic", "Italic", LuItalic],
                ] as const
              ).map(([key, title, Icon]) => (
                <button
                  key={key}
                  type="button"
                  title={title}
                  aria-label={title}
                  aria-pressed={!!text[key]}
                  onClick={() => setText({ [key]: !text[key] })}
                  className={cn("w-[26px] h-[22px] rounded-[4px] flex items-center justify-center", text[key] ? "bg-brand text-brand-lighter" : "bg-brand-background-light text-brand-light hover:bg-brand-button")}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          </PropertyRow>
          <PropertyRow label="Character">
            <NumberField label="Character spacing" value={Math.round((text.letterSpacing ?? 0) * 100)} onChange={(v) => setText({ letterSpacing: v / 100 })} />
            <span className="ml-3 mr-2 text-[12px] text-brand-light">Line</span>
            <NumberField label="Line spacing" value={Math.round((text.lineSpacing ?? 0) * 100)} onChange={(v) => setText({ lineSpacing: v / 100 })} />
          </PropertyRow>
          <PropertyRow label="Alignment">
            <ButtonGroup>
              {(
                [
                  ["left", "Align left", TbAlignLeft],
                  ["center", "Centre", TbAlignCenter],
                  ["right", "Align right", TbAlignRight],
                ] as const
              ).map(([a, title, Icon]) => (
                <GroupButton key={a} title={title} active={(text.align ?? "center") === a} onClick={() => setText({ align: a })}>
                  <Icon className="w-4 h-4" />
                </GroupButton>
              ))}
            </ButtonGroup>
          </PropertyRow>
        </section>
      )}

      {(mask && pose) || isBrush ? (
        <Section
          title="Mask settings"
          onReset={mask ? reset : undefined}
          actions={
            mask && (
              <button
                type="button"
                title="Invert"
                aria-label="Invert the mask"
                aria-pressed={!!mask.inverted}
                data-testid="mask-invert"
                disabled={isEmptyMask(mask)}
                onClick={() => replace({ ...current()!, inverted: !mask.inverted })}
                className={cn("w-[18px] h-[18px] rounded-[3px] flex items-center justify-center disabled:opacity-40", mask.inverted ? "bg-brand-accent text-white" : "text-brand-light hover:text-brand-lighter")}
              >
                <TbSquareToggle className="w-[15px] h-[15px]" />
              </button>
            )
          }
          navigator={navigator ?? undefined}
          testId="section-mask-settings"
        >
          {isBrush ? (
            <>
              {/* CapCut's brush, eraser and clear (016). */}
              <div className="flex flex-row items-center gap-3 h-[38px]">
                <button type="button" title="Brush" aria-label="Brush" aria-pressed={drawing === "brush" && !erase} data-testid="mask-brush-paint" onClick={() => brushOn(false)} className={cn("w-7 h-7 rounded-[4px] flex items-center justify-center", drawing === "brush" && !erase ? "bg-brand text-brand-lighter" : "bg-brand-background-light text-brand-light hover:bg-brand-button")}>
                  <LuBrush className="w-4 h-4" />
                </button>
                <button type="button" title="Eraser" aria-label="Eraser" aria-pressed={drawing === "brush" && erase} data-testid="mask-brush-erase" onClick={() => brushOn(true)} className={cn("w-7 h-7 rounded-[4px] flex items-center justify-center", drawing === "brush" && erase ? "bg-brand text-brand-lighter" : "bg-brand-background-light text-brand-light hover:bg-brand-button")}>
                  <LuEraser className="w-4 h-4" />
                </button>
                <span className="w-px h-3 bg-brand-hover" />
                <button
                  type="button"
                  title="Clear the strokes"
                  aria-label="Clear the strokes"
                  disabled={!mask || mask.tool !== "draw" || isEmptyMask(mask)}
                  data-testid="mask-brush-clear"
                  onClick={() => current() && replace(editAllPoses(current()!, (p) => ({ ...p, brushStrokes: [] })))}
                  className="w-7 h-7 rounded-[4px] flex items-center justify-center bg-brand-background-light text-brand-light hover:bg-brand-button disabled:opacity-40"
                >
                  <LuTrash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="pb-[5px]">
                <PropertiesSlider label="Brush size" value={brushSize} onChange={(v) => useMaskStore.getState().setBrushSize(Math.max(1, Math.min(200, Math.round(v))))} min={1} max={200} step={1} toFixed={0} />
              </div>
              {mask?.tool === "draw" && slider("Feather", feather, (v) => edit((p) => ({ ...p, featherAmount: v })), 0, 100, "mask-feather")}
              {mask?.tool === "draw" && slider("Expansion", expansion, (v) => edit((p) => ({ ...p, expansion: v })), -100, 100, "mask-expansion", 0)}
            </>
          ) : mask?.tool === "pen" || mask?.tool === "lasso" ? (
            <>
              {/* The path's place keys with the pose: drag its anchors and handles on the picture. */}
              <PropertyRow label="Transform" navigator={navigator} disabled>
                <span />
              </PropertyRow>
              {slider("Feather", feather, (v) => edit((p) => ({ ...p, featherAmount: v })), 0, 100, "mask-feather")}
              {slider("Expansion", expansion, (v) => edit((p) => ({ ...p, expansion: v })), -100, 100, "mask-expansion", 0)}
            </>
          ) : (
            b && (
              <>
                <PropertyRow label="Position" navigator={navigator}>
                  <NumberField label="Mask position X" prefix="X" value={(centre[0] - W / 2) * kx} onChange={(x) => moveTo([W / 2 + x / kx, centre[1]])} />
                  <NumberField label="Mask position Y" prefix="Y" value={(H / 2 - centre[1]) * ky} onChange={(y) => moveTo([centre[0], H / 2 - y / ky])} className="ml-1.5" />
                </PropertyRow>
                <PropertyRow label="Rotation" navigator={navigator}>
                  <NumberField label="Mask rotation" value={b.rotation ?? 0} unit="°" digits={1} onChange={turn} />
                  <div className="ml-[52px]">
                    <Dial value={b.rotation ?? 0} label="Mask rotation dial" onChange={turn} />
                  </div>
                </PropertyRow>
                {shapeType !== "linear" && shapeType !== "text" && (
                  <PropertyRow label="Size" navigator={navigator}>
                    {shapeType !== "mirror" && (
                      <>
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
                      </>
                    )}
                    <NumberField label="Mask height" prefix="H" value={size[1] * ky} min={1} onChange={(h) => resize(shapeType !== "mirror" && linked && size[1] ? size[0] * (h / ky / size[1]) : size[0], h / ky)} />
                  </PropertyRow>
                )}
                {slider("Feather", feather, (v) => edit((p) => ({ ...p, featherAmount: v })), 0, 100, "mask-feather")}
                {shapeType === "rectangle" &&
                  slider("Round corners", Math.round(b.cornerRadius ?? 0), (v) => edit((p) => ({ ...p, shapeBounds: { ...(p.shapeBounds as Bounds), cornerRadius: v } })), 0, 100, "mask-corners")}
              </>
            )
          )}
        </Section>
      ) : null}
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
