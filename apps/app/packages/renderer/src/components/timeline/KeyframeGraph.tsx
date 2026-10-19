import { trackTop } from "@/lib/timeline-view";
import React, { useMemo, useRef, useState } from "react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import {
  keyframedProperties,
  listKeyframes,
  nextKeyframe,
  previousKeyframe,
  sampleKeyframes,
  setKeyframeEase,
  toggleKeyframe,
} from "@/lib/keyframes";
import { TIME_ZERO_X } from "@/lib/timeline-geometry";
import { useKeyframeGraphStore } from "@/lib/timeline-keyframes";
import type { AnyClipProps, Keyframe, KeyframeCurve, KeyframeEase, KeyframeProperty, KeyframeValue } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The rows over the plot, and the plot's height (CapCut's 20 + 20 + 100 px). */
const ROW = 20;
const PLOT = 100;
const HEIGHT = ROW * 2 + PLOT;

/** A property's name and the group CapCut lists it under. */
const NAMES: Record<string, [string, string]> = {
  position: ["Position", "Transform"],
  scale: ["Scale", "Transform"],
  rotation: ["Rotate", "Transform"],
  opacity: ["Opacity", "Blend"],
  volume: ["Volume", "Audio"],
  intensity: ["Intensity", "Filter"],
};
const nameOf = (p: string): [string, string] => NAMES[p] ?? [p.replace(/^.*:/, "").replace(/^\w/, (c) => c.toUpperCase()), "Adjust"];

/** A key's value's component `c` (numbers only: colours aren't graphed). */
const component = (v: KeyframeValue | undefined, c: number): number => (Array.isArray(v) ? (v[c] ?? v[0]) : Number(v ?? 0));

/** The handles a span's ease gives, in frames and value from its keys (CapCut's presets at 0.4 of the span, flat). */
const handlesOf = (ease: KeyframeEase | undefined, a: Keyframe, b: Keyframe, c: number) => {
  const span = b.frame - a.frame;
  const [va, vb] = [component(a.value, c), component(b.value, c)];
  if (ease && typeof ease === "object") {
    const pick = (v: number | number[] | undefined) => (Array.isArray(v) ? (v[c] ?? v[0] ?? 0) : (v ?? 0));
    return { out: [pick(ease.out.frames), pick(ease.out.value)], in: [pick(ease.in.frames), pick(ease.in.value)] };
  }
  switch (ease) {
    case "easeIn":
      return { out: [0.4 * span, 0], in: [0, 0] };
    case "easeOut":
      return { out: [0, 0], in: [-0.4 * span, 0] };
    case "easeInOut":
      return { out: [0.4 * span, 0], in: [-0.4 * span, 0] };
    default:
      // Straight: handles a third of the way along the line.
      return { out: [span / 3, (vb - va) / 3], in: [-span / 3, (va - vb) / 3] };
  }
};

/** Which preset an ease is, for the curve buttons. */
const presetOf = (ease: KeyframeEase | undefined) => (ease && typeof ease === "object" ? "custom" : (ease ?? "linear"));

const CURVES: { id: "custom" | "easeIn" | "easeOut" | "easeInOut"; label: string; d: string }[] = [
  { id: "custom", label: "Custom curve", d: "M2 12 C6 12 6 2 12 2" },
  { id: "easeIn", label: "Ease in", d: "M2 12 C9 12 11 8 12 2" },
  { id: "easeOut", label: "Ease out", d: "M2 12 C3 6 5 2 12 2" },
  { id: "easeInOut", label: "Ease in and out", d: "M2 12 C8 12 6 2 12 2" },
];

/**
 * CapCut's keyframe graph (⌥K) for the selected clip, over its bar: a group row ("Transform"),
 * a row with the property (its keyed ones to pick from), four curve shapes for the span the
 * playhead is in (custom, ease in, ease out, ease in and out; the current one in the accent) and
 * the ‹ ◆ › navigator, then a 100 px plot of the property's value over the clip with its keys as
 * accent diamonds and, for that span, the curve's two bezier handles: dragging them sets a
 * custom ease (lib/keyframes.ts `setKeyframeEase`). Numeric properties only.
 */
const KeyframeGraph: React.FC<{ stageWidth: number }> = ({ stageWidth }) => {
  const open = useKeyframeGraphStore((s) => s.open);
  const chosen = useKeyframeGraphStore((s) => s.property);
  const setProperty = useKeyframeGraphStore((s) => s.setProperty);
  const clipId = useControlsStore((s) => (s.selectedClipIds.length === 1 ? s.selectedClipIds[0] : null));
  const clip = useClipStore((s) => (clipId ? s.getClipById(clipId) : undefined)) as AnyClipProps | undefined;
  const track = useClipStore((s) => s.timelines.find((t) => t.timelineId === clip?.timelineId));
  const [vs, ve] = useControlsStore((s) => s.timelineDuration);
  const fps = useControlsStore((s) => s.fps) || 30;
  const start = clip?.startFrame ?? 0;
  const len = Math.max(1, (clip?.endFrame ?? 0) - start);
  const local = useControlsStore((s) => Math.round(s.focusFrame - start));
  const [comp, setComp] = useState(0);
  const plot = useRef<SVGSVGElement>(null);
  const properties = useMemo(
    () => (clip ? keyframedProperties(clip.keyframes).filter((p) => listKeyframes(clip.keyframes, p).every((k) => typeof k.value !== "string")) : []),
    [clip?.keyframes],
  );
  if (!open || !clip || !track) return null;
  const property = chosen && properties.includes(chosen) ? chosen : properties[0];

  // Where the clip's bar is in the timeline: the panel sits over it, above its bands.
  const perFrame = stageWidth / Math.max(1, ve - vs);
  const x0 = TIME_ZERO_X + (start - vs) * perFrame;
  const left = Math.max(TIME_ZERO_X, x0);
  const right = Math.min(TIME_ZERO_X + stageWidth - 12, x0 + len * perFrame);
  const bandTop = trackTop(track);
  const top = bandTop - HEIGHT >= 22 ? bandTop - HEIGHT : bandTop + (track.timelineHeight ?? 0) - 8;
  if (right - left < 40) return null;
  const W = right - left;
  const xOfFrame = (f: number) => x0 + f * perFrame - left;

  if (!property) {
    return (
      <div data-testid="keyframe-graph" className="absolute z-20 rounded-[4px] bg-brand-background border border-white/80 text-[12px] text-[#949494] flex items-center justify-center" style={{ left, top, width: W, height: ROW * 2 }}>
        Add keyframes to see their graph
      </div>
    );
  }

  const keys = listKeyframes(clip.keyframes, property);
  const comps = Array.isArray(keys[0]?.value) ? (keys[0].value as number[]).length : 1;
  const c = Math.min(comp, comps - 1);
  const [name, group] = nameOf(property);
  // The span the playhead is in (or the first), and its handles.
  const si = Math.max(0, Math.min(keys.length - 2, keys.findIndex((_, i) => i === keys.length - 1 || keys[i + 1].frame > local)));
  const [a, b] = [keys[si], keys[si + 1]];
  const handles = a && b ? handlesOf(a.ease, a, b, c) : null;
  // The value's range over the clip, handles included, with a margin.
  const samples = Array.from({ length: 81 }, (_, i) => (len * i) / 80).map((f) => [f, component(sampleKeyframes(keys, f, property, fps), c)] as const);
  const values = [...samples.map((s) => s[1]), ...(handles && a && b ? [component(a.value, c) + handles.out[1], component(b.value, c) + handles.in[1]] : [])];
  let [lo, hi] = [Math.min(...values), Math.max(...values)];
  if (hi - lo < 1e-6) [lo, hi] = [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.12;
  [lo, hi] = [lo - pad, hi + pad];
  const yOf = (v: number) => 6 + (1 - (v - lo) / (hi - lo)) * (PLOT - 12);
  const valueOfY = (y: number) => lo + (1 - (y - 6) / (PLOT - 12)) * (hi - lo);
  const path = samples.map(([f, v], i) => `${i ? "L" : "M"}${xOfFrame(f).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");

  const setEase = (ease: KeyframeEase) => a && useClipStore.getState().updateClip(clip.clipId, { keyframes: setKeyframeEase(clip.keyframes, property, a.frame, ease) });
  // A custom curve from the handles (`out` and `into` for component c; the others kept).
  const curveWith = (out: number[], into: number[]): KeyframeCurve => {
    const was = a.ease && typeof a.ease === "object" ? a.ease : null;
    const per = (v: number | number[] | undefined, x: number, fill: number) => {
      if (comps === 1) return x;
      const arr = Array.from({ length: comps }, (_, i) => (Array.isArray(v) ? (v[i] ?? fill) : (v ?? fill)));
      // A uniform scale moves both together.
      if (property === "scale") return arr.map(() => x);
      arr[c] = x;
      return arr;
    };
    const base = handlesOf(a.ease, a, b, c);
    return {
      out: { frames: per(was?.out.frames, out[0], base.out[0]), value: per(was?.out.value, out[1], 0) },
      in: { frames: per(was?.in.frames, into[0], base.in[0]), value: per(was?.in.value, into[1], 0) },
    };
  };
  const dragHandle = (which: "out" | "in", e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!handles) return;
    const rect = plot.current!.getBoundingClientRect();
    const span = b.frame - a.frame;
    let raf = 0;
    const move = (ev: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const f = (ev.clientX - rect.left - (x0 - left)) / perFrame;
        const v = valueOfY(ev.clientY - rect.top);
        const out = [...handles.out];
        const into = [...handles.in];
        if (which === "out") [out[0], out[1]] = [Math.min(span, Math.max(0, f - a.frame)), v - component(a.value, c)];
        else [into[0], into[1]] = [Math.max(-span, Math.min(0, f - b.frame)), v - component(b.value, c)];
        setEase(curveWith(out, into));
      });
    };
    const up = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const seek = (k: Keyframe | undefined) => k && useControlsStore.getState().setFocusFrame(Math.round(start + k.frame));
  const atKey = keys.some((k) => Math.abs(k.frame - local) < 0.5);
  const current = a ? presetOf(a.ease) : "linear";

  return (
    <div
      data-testid="keyframe-graph"
      className="absolute z-20 rounded-[4px] overflow-hidden border-[1.5px] border-white bg-brand-background select-none"
      style={{ left, top, width: W, height: HEIGHT }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="h-5 flex items-center px-1.5 bg-brand-button text-[12px] text-brand-light gap-1">
        {group} <span className="text-[8px] text-brand-light/70">▲</span>
      </div>
      <div className="h-5 flex items-center px-1.5 bg-brand-background-light text-[12px] text-brand-light gap-1.5">
        <select
          data-testid="keyframe-graph-property"
          value={property}
          onChange={(e) => setProperty(e.target.value as KeyframeProperty)}
          className="bg-transparent text-[12px] text-brand-light outline-none max-w-[120px]"
        >
          {properties.map((p) => (
            <option key={p} value={p} className="bg-brand-header">
              {nameOf(p)[0]}
            </option>
          ))}
        </select>
        {comps === 2 && property !== "scale" && (
          <div className="flex text-[11px]">
            {["X", "Y"].map((l, i) => (
              <button key={l} type="button" onClick={() => setComp(i)} className={cn("px-1", c === i ? "text-brand-accent" : "text-brand-light/60")}>
                {l}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {CURVES.map((cv) => (
            <button
              key={cv.id}
              type="button"
              title={cv.label}
              data-testid={`keyframe-curve-${cv.id}`}
              aria-pressed={current === cv.id}
              disabled={!a || !b}
              onClick={() => (cv.id === "custom" ? handles && setEase(curveWith(handles.out, handles.in)) : setEase(cv.id))}
              className="w-[18px] h-4 flex items-center justify-center disabled:opacity-30"
            >
              <svg viewBox="0 0 14 14" className="w-3.5 h-3.5">
                <path d={cv.d} fill="none" stroke={current === cv.id ? "var(--color-brand-accent)" : "#cfcfcf"} strokeWidth={1.4} strokeLinecap="round" />
              </svg>
            </button>
          ))}
          <div className="flex items-center ml-2 text-brand-light/80">
            <button type="button" aria-label="Previous keyframe" onClick={() => seek(previousKeyframe(clip.keyframes, property, local))}>
              <LuChevronLeft className="w-3 h-3" />
            </button>
            <button
              type="button"
              aria-label="Keyframe"
              onClick={() => useClipStore.getState().updateClip(clip.clipId, toggleKeyframe(clip, property, start + local, fps))}
              className={cn("w-2.5 h-2.5 rotate-45 border", atKey ? "bg-brand-accent border-brand-accent" : "border-[#9a9a9a]")}
            />
            <button type="button" aria-label="Next keyframe" onClick={() => seek(nextKeyframe(clip.keyframes, property, local))}>
              <LuChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
      <svg ref={plot} width={W} height={PLOT} className="block bg-[#262626]">
        {[0.25, 0.5, 0.75].map((q) => (
          <line key={q} x1={0} x2={W} y1={PLOT * q} y2={PLOT * q} stroke="#4a4a4a" strokeDasharray="1 2" />
        ))}
        <text x={4} y={11} fontSize={10} fill="#949494">
          {hi.toFixed(2)}
        </text>
        <text x={4} y={PLOT - 3} fontSize={10} fill="#949494">
          {lo.toFixed(2)}
        </text>
        <path d={path} fill="none" stroke="#ffffff" strokeWidth={1.25} />
        {keys.map((k) => (
          <rect
            key={k.frame}
            x={xOfFrame(k.frame) - 3.5}
            y={yOf(component(k.value, c)) - 3.5}
            width={7}
            height={7}
            transform={`rotate(45 ${xOfFrame(k.frame)} ${yOf(component(k.value, c))})`}
            fill="#ae81ce"
            stroke="#141414"
            strokeWidth={0.75}
            pointerEvents="none"
          />
        ))}
        {/* The span's handles over its keys (one can sit on its key). */}
        {handles && a && b && (
          <>
            {(
              [
                ["out", a, handles.out],
                ["in", b, handles.in],
              ] as const
            ).map(([which, k, h]) => {
              const [kx, ky] = [xOfFrame(k.frame), yOf(component(k.value, c))];
              const [hx, hy] = [xOfFrame(k.frame + h[0]), yOf(component(k.value, c) + h[1])];
              return (
                <g key={which}>
                  <line x1={kx} y1={ky} x2={hx} y2={hy} stroke="#ae81ce" strokeWidth={1} />
                  <circle
                    data-testid={`keyframe-handle-${which}`}
                    cx={hx}
                    cy={hy}
                    r={4}
                    fill="#262626"
                    stroke="#ae81ce"
                    strokeWidth={1.5}
                    className="cursor-grab"
                    onPointerDown={(e) => dragHandle(which, e)}
                  />
                </g>
              );
            })}
          </>
        )}
        {local >= 0 && local <= len && <line x1={xOfFrame(local)} x2={xOfFrame(local)} y1={0} y2={PLOT} stroke="#ffffff" strokeWidth={1} pointerEvents="none" />}
      </svg>
      <span className="sr-only">{name}</span>
    </div>
  );
};

export default KeyframeGraph;
