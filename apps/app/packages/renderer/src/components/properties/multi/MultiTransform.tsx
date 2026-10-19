import React, { useMemo, useState } from "react";
import {
  PiAlignBottom,
  PiAlignCenterHorizontal,
  PiAlignCenterVertical,
  PiAlignLeft,
  PiAlignRight,
  PiAlignTop,
} from "react-icons/pi";
import { TbLayoutDistributeHorizontal, TbLayoutDistributeVertical } from "react-icons/tb";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { clearKeyframes, valueAt } from "@/lib/keyframes";
import { editProperties, transformAt, usePlayhead } from "@/lib/keyframe-ui";
import { alignOnCanvas, distribute, type Alignment } from "@/lib/align";
import { shared } from "@/lib/multi-edit";
import type { AnyClipProps, KeyframeProperty, KeyframeValue } from "@/lib/types";
import Section from "../Section";
import PropertyRow from "../PropertyRow";
import PropertiesSlider from "../PropertiesSlider";
import { ButtonGroup, Dial, GroupButton, GroupDivider, NumberField, Toggle } from "../controls";
import { useWorld } from "../VideoBasicProperties";

/** The clip types with a transform the panel below edits. */
const VISUAL = new Set(["video", "image", "text", "sticker", "shape"]);

/** The selected clips with a transform, in the order they were selected. */
export const useVisualClips = (ids: string[]): AnyClipProps[] => {
  const clips = useClipStore((s) => s.clips);
  return useMemo(() => ids.map((id) => clips.find((c) => c.clipId === id)).filter((c): c is AnyClipProps => !!c && VISUAL.has(c.type) && !!c.transform), [clips, ids]);
};

/** Edits at the playhead by CapCut's rule, on every clip as the store has it now. */
const editAll = (ids: string[], frame: number, edits: (clip: AnyClipProps) => [KeyframeProperty, KeyframeValue][]) => {
  const { updateClip, getClipById } = useClipStore.getState();
  for (const id of ids) {
    const now = getClipById(id);
    if (now?.transform) updateClip(id, editProperties(now, frame, edits(now)));
  }
};

const fitted = (clip: AnyClipProps) => {
  const t = clip.transform!;
  const base = clip.originalTransform ?? t;
  return { kx: base.width && t.width ? t.width / base.width : 1, ky: base.height && t.height ? t.height / base.height : 1 };
};

/**
 * The Properties tab for several selected clips (CapCut's, docs/plan/capcut-ui-spec.md §6.25):
 * Transform with the values the clips share (a field where they differ shows "-"), an edit
 * setting its value on every one of them in one step, and Align and Distribute on the canvas.
 * Position, scale, rotation and opacity are edited as the single clip's are (a key at the
 * playhead for a clip that has keys); the keyframe diamonds themselves are left out here.
 */
export const MultiTransform: React.FC<{ ids: string[] }> = ({ ids }) => {
  const clips = useVisualClips(ids);
  const { frame, fps } = usePlayhead();
  const { world, px } = useWorld();
  const [uniform, setUniform] = useState(true);
  const all = clips.map((c) => c.clipId);
  if (!clips.length) return null;

  const rows = clips.map((c) => {
    const { kx, ky } = fitted(c);
    const scale = valueAt(c, "scale", frame, fps) as number[];
    const centre = valueAt(c, "position", frame, fps) as number[];
    return {
      sx: scale[0] * kx * 100,
      sy: (scale[1] ?? scale[0]) * ky * 100,
      x: (centre[0] - world.width / 2) * px,
      y: (world.height / 2 - centre[1]) * px,
      rotation: Number(valueAt(c, "rotation", frame, fps)),
    };
  });
  const sx = shared(rows.map((r) => r.sx), 0.5);
  const sy = shared(rows.map((r) => r.sy), 0.5);
  const x = shared(rows.map((r) => r.x), 0.5);
  const y = shared(rows.map((r) => r.y), 0.5);
  const rot = shared(rows.map((r) => r.rotation), 0.005);
  const setScale = (vx: number, vy: number) =>
    editAll(all, frame, (c) => {
      const { kx, ky } = fitted(c);
      return [["scale", [Math.max(1, vx) / 100 / kx, Math.max(1, vy) / 100 / ky]]];
    });
  // Position as CapCut shows it: pixels from the canvas's middle, y up. One axis leaves the other as each clip has it.
  const setX = (v: number) =>
    editAll(all, frame, (c) => {
      const centre = valueAt(c, "position", frame, fps) as number[];
      return [["position", [world.width / 2 + v / px, centre[1]]]];
    });
  const setY = (v: number) =>
    editAll(all, frame, (c) => {
      const centre = valueAt(c, "position", frame, fps) as number[];
      return [["position", [centre[0], world.height / 2 - v / px]]];
    });
  const setRotation = (r: number) => editAll(all, frame, () => [["rotation", r]]);

  const place = (centres: Map<string, [number, number]>) => {
    const { updateClip, getClipById } = useClipStore.getState();
    for (const [id, centre] of centres) {
      const now = getClipById(id);
      if (now) updateClip(id, editProperties(now, frame, [["position", centre]]));
    }
  };
  const shown = () => clips.map((c) => ({ id: c.clipId, transform: transformAt(c, frame, fps)! }));
  const align = (to: Alignment) => place(alignOnCanvas(shown(), to, world));
  const spread = (axis: "horizontal" | "vertical") => place(distribute(shown(), axis));

  // Back to CapCut's defaults on every clip: 100 %, centred, upright, none of them keyed.
  const reset = () => {
    const { updateClip, getClipById } = useClipStore.getState();
    for (const id of all) {
      const now = getClipById(id);
      if (!now?.transform) continue;
      const { kx, ky } = fitted(now);
      let keyframes = now.keyframes;
      for (const p of ["scale", "position", "rotation"] as const) keyframes = clearKeyframes(keyframes, p);
      const plain = { ...now, keyframes } as AnyClipProps;
      updateClip(id, {
        keyframes,
        ...editProperties(plain, frame, [
          ["rotation", 0],
          ["scale", [1 / kx, 1 / ky]],
          ["position", [world.width / 2, world.height / 2]],
        ]),
      });
    }
  };

  const scaleRow = (label: string, value: number, mixed: boolean, set: (v: number) => void) => (
    <div className="pb-[5px]" data-property="scale">
      <PropertiesSlider label={label} value={value} mixed={mixed} onChange={set} min={1} max={500} step={1} toFixed={0} suffix="%" />
    </div>
  );

  return (
    <Section title="Transform" onReset={reset} testId="section-transform">
      {uniform ? (
        scaleRow("Scale", sx.value, sx.mixed, (v) => setScale(v, v))
      ) : (
        <>
          {scaleRow("Scale width", sx.value, sx.mixed, (v) => setScale(v, sy.mixed ? v : sy.value))}
          {scaleRow("Scale height", sy.value, sy.mixed, (v) => setScale(sx.mixed ? v : sx.value, v))}
        </>
      )}
      <PropertyRow label="Uniform scale">
        <div className="flex-1" />
        <Toggle on={uniform} label="Uniform scale" onChange={(on) => setUniform(on)} />
      </PropertyRow>
      <PropertyRow label="Position">
        <NumberField label="Position X" prefix="X" value={x.value} mixed={x.mixed} onChange={setX} />
        <NumberField label="Position Y" prefix="Y" value={y.value} mixed={y.mixed} onChange={setY} className="ml-1.5" />
      </PropertyRow>
      <PropertyRow label="Rotate">
        <NumberField label="Rotate" value={rot.value} mixed={rot.mixed} unit="°" digits={2} onChange={setRotation} />
        <div className="ml-[52px]">
          <Dial value={rot.value} label="Rotate dial" onChange={setRotation} />
        </div>
      </PropertyRow>
      <div className="mt-1.5 flex flex-row flex-wrap items-center gap-2">
        {/* CapCut's alignment group, with Distribute (three or more clips) at its end. */}
        <ButtonGroup>
          <GroupButton title="Align left" testId="multi-align-left" onClick={() => align("left")}>
            <PiAlignLeft className="h-4 w-4" />
          </GroupButton>
          <GroupButton title="Centre horizontally" testId="multi-align-center-h" onClick={() => align("center-h")}>
            <PiAlignCenterHorizontal className="h-4 w-4" />
          </GroupButton>
          <GroupButton title="Align right" testId="multi-align-right" onClick={() => align("right")}>
            <PiAlignRight className="h-4 w-4" />
          </GroupButton>
          <GroupDivider />
          <GroupButton title="Align top" testId="multi-align-top" onClick={() => align("top")}>
            <PiAlignTop className="h-4 w-4" />
          </GroupButton>
          <GroupButton title="Centre vertically" testId="multi-align-center-v" onClick={() => align("center-v")}>
            <PiAlignCenterVertical className="h-4 w-4" />
          </GroupButton>
          <GroupButton title="Align bottom" testId="multi-align-bottom" onClick={() => align("bottom")}>
            <PiAlignBottom className="h-4 w-4" />
          </GroupButton>
          <GroupDivider />
          <GroupButton title="Distribute horizontally" testId="multi-distribute-h" disabled={clips.length < 3} onClick={() => spread("horizontal")}>
            <TbLayoutDistributeVertical className="h-4 w-4" />
          </GroupButton>
          <GroupButton title="Distribute vertically" testId="multi-distribute-v" disabled={clips.length < 3} onClick={() => spread("vertical")}>
            <TbLayoutDistributeHorizontal className="h-4 w-4" />
          </GroupButton>
        </ButtonGroup>
      </div>
    </Section>
  );
};

/** Blend for several clips: the opacity they share, set on every one. */
export const MultiBlend: React.FC<{ ids: string[] }> = ({ ids }) => {
  const clips = useVisualClips(ids);
  const { frame, fps } = usePlayhead();
  if (!clips.length) return null;
  const opacity = shared(clips.map((c) => Number(valueAt(c, "opacity", frame, fps))), 0.5);
  const reset = () => {
    const { updateClip, getClipById } = useClipStore.getState();
    for (const c of clips) {
      const now = getClipById(c.clipId);
      if (now?.transform) updateClip(c.clipId, { keyframes: clearKeyframes(now.keyframes, "opacity"), transform: { ...now.transform, opacity: 100 } } as Partial<AnyClipProps>);
    }
  };
  return (
    <Section title="Blend" onReset={reset} testId="section-blend">
      <div data-property="opacity">
        <PropertiesSlider
          label="Opacity"
          value={opacity.value}
          mixed={opacity.mixed}
          min={0}
          max={100}
          step={1}
          toFixed={0}
          suffix="%"
          onChange={(v) => editAll(clips.map((c) => c.clipId), useControlsStore.getState().focusFrame, () => [["opacity", Math.min(100, Math.max(0, v))]])}
        />
      </div>
    </Section>
  );
};
