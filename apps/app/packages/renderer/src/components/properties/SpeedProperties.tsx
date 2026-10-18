import React, { useEffect, useRef, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { LuBan, LuChevronDown, LuChevronUp, LuMinus, LuPlus, LuSlidersHorizontal } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import {
  CURVE_PRESETS,
  MAX_CURVE_SPEED,
  MIN_CURVE_SPEED,
  curveSpeedAt,
  hasCurve,
  presetCurve,
  sourceProgressAt,
  timelineProgressAt,
} from "@/lib/speed";
import { linkedClips } from "@/lib/timeline-edit";
import type { AnyClipProps, SpeedCurve, SpeedPoint, VideoClipProps } from "@/lib/types";
import { CurveIcon, speedLevel } from "@/components/motion/Previews";
import { cn } from "@/lib/utils";
import { SmoothSlowMoRow } from "./SmoothSlowMo";

/**
 * The Speed tab, as CapCut's: Standard (a speed from 0.1× to 100× on CapCut's scale, the
 * clip's length before and after, and Change audio pitch; Reset in the footer) and Curve (the
 * curve presets, and an editor for the chosen curve: its points on a speed-over-the-clip graph
 * from 0.1× to 10×, dragged, added at the playhead or deleted, and reset). Speeds and curves go
 * through the store (`updateClip` with `speed`, `setSpeedCurve`), which keeps the clip's media
 * and keys and takes linked clips along (lib/speed.ts `speedPatch`).
 */

/** CapCut's speed slider: its marks, evenly spaced, the speed moving straight between them. */
const MARKS = [0.1, 1, 2, 5, 10, 100];
/** The slider's steps from end to end. */
const STEPS = 1000;

/** A speed's place on the slider (0..STEPS). */
const toSlider = (speed: number) => {
  const s = Math.min(100, Math.max(0.1, speed));
  const i = Math.max(1, MARKS.findIndex((m) => m >= s));
  const [a, b] = [MARKS[i - 1], MARKS[i]];
  return Math.round(((i - 1 + (s - a) / (b - a)) / (MARKS.length - 1)) * STEPS);
};
/** The speed at a place on the slider, to hundredths. */
const fromSlider = (v: number) => {
  const p = (Math.min(STEPS, Math.max(0, v)) / STEPS) * (MARKS.length - 1);
  const i = Math.min(MARKS.length - 2, Math.floor(p));
  return Math.round((MARKS[i] + (MARKS[i + 1] - MARKS[i]) * (p - i)) * 100) / 100;
};

const clampSpeed = (s: number) => Math.round(Math.min(100, Math.max(0.1, s)) * 100) / 100;
const seconds = (s: number) => `${s >= 10 ? s.toFixed(0) : s.toFixed(1)}s`;

/**
 * A number field with CapCut's stepper beside it, committing on Enter or when it loses focus;
 * shown with its unit, edited without it.
 */
const StepField: React.FC<{ value: number; unit: string; digits: number; step: number; onChange: (v: number) => void; testId?: string }> = ({ value, unit, digits, step, onChange, testId }) => {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : `${value.toFixed(digits)}${unit}`;
  const commit = () => {
    setEditing(false);
    const n = Number(text.replace(/[^0-9.]/g, ""));
    if (text !== "" && isFinite(n) && n > 0) onChange(n);
  };
  return (
    <div className="flex items-center shrink-0">
      <input
        data-testid={testId}
        value={shown}
        onFocus={() => {
          setEditing(true);
          setText(value.toFixed(digits));
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        className="w-[54px] h-[22px] rounded-[4px] bg-brand text-center text-[12px] tabular-nums text-brand-lighter outline-none"
      />
      <div className="ml-0.5 w-4 h-[22px] flex flex-col rounded-[3px] bg-brand-background-light">
        <button type="button" aria-label="Up" className="flex-1 flex items-center justify-center hover:bg-brand-light/10" onClick={() => onChange(value + step)}>
          <LuChevronUp className="w-2 h-2 text-brand-light" />
        </button>
        <button type="button" aria-label="Down" className="flex-1 flex items-center justify-center hover:bg-brand-light/10" onClick={() => onChange(value - step)}>
          <LuChevronDown className="w-2 h-2 text-brand-light" />
        </button>
      </div>
    </div>
  );
};

/** CapCut's toggle: a 36×16 pill, the accent when on. */
const Toggle: React.FC<{ on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }> = ({ on, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={cn("relative w-9 h-4 rounded-full transition-colors shrink-0 disabled:opacity-40", on ? "bg-brand-accent" : "bg-brand-button")}
  >
    <span className={cn("absolute top-1 w-2 h-2 rounded-full bg-brand-lighter transition-all", on ? "left-[24px]" : "left-1")} />
  </button>
);

/** "11.6s ⟶" then the new length: the clip's length at 1× and as it is. */
const LengthRow: React.FC<{ before: number; children: React.ReactNode }> = ({ before, children }) => (
  <div className="flex items-center gap-x-2.5 w-full min-w-0">
    <span className="text-[12px] text-brand-light tabular-nums w-9 text-left shrink-0">{seconds(before)}</span>
    <div className="relative flex-1 min-w-0 h-3 flex items-center">
      <div className="w-px h-2 bg-[#5a5a5a]" />
      <div className="flex-1 border-t border-dashed border-[#5a5a5a]" />
      <div className="w-0 h-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-[#5a5a5a]" />
    </div>
    {children}
  </div>
);

/** The clip's speed fields and its media length (frames as it plays at 1×). */
const useSpeedClip = (clipId: string) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as VideoClipProps | undefined;
  const fps = useControlsStore((s) => s.fps) || 30;
  const len = Math.max(1, (clip?.endFrame ?? 0) - (clip?.startFrame ?? 0));
  const speed = Math.max(0.1, Number(clip?.speed || 1));
  return { clip, fps, len, speed, media: len * speed };
};

/** The Standard view. */
const StandardSpeed: React.FC<{ clipId: string }> = ({ clipId }) => {
  const { clip, fps, len, speed, media } = useSpeedClip(clipId);
  const updateClip = useClipStore((s) => s.updateClip);
  if (!clip) return null;
  const curved = hasCurve(clip);
  // A speed typed or slid goes to hundredths; one from a typed length is exact, so the clip
  // keeps its media.
  const setSpeed = (s: number, exact = false) => {
    if (useControlsStore.getState().isPlaying) useControlsStore.getState().pause();
    updateClip(clipId, { speed: exact ? Math.min(100, Math.max(0.1, s)) : clampSpeed(s) } as Partial<AnyClipProps>);
  };
  // Change audio pitch goes on the clip and the clips linked to it (its detached sound).
  const setPitch = (on: boolean) => {
    const { clips } = useClipStore.getState();
    for (const c of [clip, ...linkedClips(clips, clip)]) {
      if (c.type === "video" || c.type === "audio") updateClip(c.clipId, { changePitch: on } as Partial<AnyClipProps>);
    }
  };
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pt-2">
        <div className="flex flex-col items-start w-full min-w-0 py-2">
          <label className="text-brand-light text-[12px] mb-2.5">Speed</label>
          <div className="flex flex-row items-center gap-x-[18px] w-full min-w-0">
            <SliderPrimitive.Root
              className="relative flex flex-1 touch-none select-none items-center h-4"
              value={[toSlider(speed)]}
              min={0}
              max={STEPS}
              step={1}
              onValueChange={(v) => setSpeed(fromSlider(v[0]))}
            >
              <SliderPrimitive.Track className="relative h-0.5 w-full grow rounded-full bg-brand-hover">
                <SliderPrimitive.Range className="absolute h-full bg-brand-lighter" />
              </SliderPrimitive.Track>
              {/* CapCut's marks: 0.1×, 1×, 2×, 5×, 10×, 100×. */}
              {MARKS.map((m, i) => (
                <span key={m} title={`${m}x`} className="absolute w-px h-2 bg-brand-lighter/80 pointer-events-none" style={{ left: `${(i / (MARKS.length - 1)) * 100}%` }} />
              ))}
              <SliderPrimitive.Thumb aria-label="Speed" className="block h-3 w-2 rounded-[2px] bg-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent" />
            </SliderPrimitive.Root>
            <StepField testId="speed-value" value={speed} unit="x" digits={2} step={0.1} onChange={setSpeed} />
          </div>
        </div>
        {curved && <p className="text-[12px] text-[#949494] text-left pb-2">The clip plays by a curve: a speed here takes its place.</p>}
        <div className="flex flex-col items-start w-full min-w-0 py-2">
          <label className="text-brand-light text-[12px] mb-2">Duration</label>
          <LengthRow before={media / fps}>
            {/* A length in whole frames, the speed that gives it. */}
            <StepField testId="speed-duration" value={len / fps} unit="s" digits={1} step={0.1} onChange={(d) => setSpeed(media / Math.max(1, Math.round(d * fps)), true)} />
          </LengthRow>
        </div>
        <div className="flex items-center justify-between h-[38px]">
          <label className={cn("text-[12px]", curved ? "text-[#525252]" : "text-brand-light")}>Change audio pitch</label>
          {/* A curve's sound always follows its speed (CapCut ignores the toggle then). */}
          <Toggle label="Change audio pitch" on={!!clip.changePitch} onChange={setPitch} disabled={curved} />
        </div>
        {clip.type === "video" && <SmoothSlowMoRow clipId={clipId} />}
      </div>
      <div className="h-9 shrink-0 flex items-center justify-end px-3 bg-brand-header">
        <button
          type="button"
          data-testid="speed-reset"
          disabled={speed === 1 && !curved}
          onClick={() => updateClip(clipId, { speed: 1 } as Partial<AnyClipProps>)}
          className="h-[22px] w-[72px] rounded-[4px] bg-brand-button text-[12px] font-semibold text-brand-lighter hover:bg-[#5a5a5a] disabled:opacity-40"
        >
          Reset
        </button>
      </div>
    </div>
  );
};

/** A preset card: a 62 px tile with the curve's shape, its name under it. */
const PresetCard: React.FC<{ label: string; active: boolean; onClick: () => void; children: React.ReactNode }> = ({ label, active, onClick, children }) => (
  <button type="button" title={label} data-testid="curve-card" aria-pressed={active} onClick={onClick} className="flex flex-col items-center gap-[7px] w-[62px]">
    <div className={cn("relative w-[62px] h-[62px] rounded-[6px] bg-brand-background-light overflow-hidden flex items-center justify-center", active && "ring-[1.5px] ring-brand-accent")}>{children}</div>
    <span className={cn("w-[74px] text-[12px] leading-none truncate text-center", active ? "text-brand-lighter" : "text-brand-light")}>{label}</span>
  </button>
);

/** How close (as a share of the clip) the playhead must be to a point for − to delete it. */
const NEAR = 0.02;
/** The graph's height (px) and the margin round its plot. */
const GRAPH_H = 150;
const PAD_Y = 12;

/**
 * The curve editor: the curve's speed over the clip (its media, left to right) on a log scale
 * from 0.1× to 10×, its points as handles, and the playhead. A point drags up and down (its
 * speed) and along (between its neighbours; the ends stay at the ends); a click elsewhere moves
 * the playhead there; + adds a point at the playhead, − deletes the one there (or the selected
 * one, also with Delete); Reset puts the preset's points back.
 */
const CurveEditor: React.FC<{ clipId: string; curve: SpeedCurve }> = ({ clipId, curve }) => {
  const { clip, fps, len, media } = useSpeedClip(clipId);
  const setSpeedCurve = useClipStore((s) => s.setSpeedCurve);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  const [picked, setPicked] = useState<number | null>(null);
  const start = clip?.startFrame ?? 0;
  // The playhead's place in the clip's media (only re-rendering when it's in the clip and moves).
  const head = useControlsStore((s) => {
    const q = (s.focusFrame - start) / len;
    return q >= 0 && q <= 1 ? Math.round(sourceProgressAt(curve.points, q) * 1000) / 1000 : null;
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const points = [...curve.points].sort((a, b) => a.x - b.x);
  const H = GRAPH_H;
  const xOf = (p: number) => p * width;
  const yOf = (s: number) => PAD_Y + (1 - speedLevel(s)) * (H - 2 * PAD_Y);
  const speedOfY = (y: number) => {
    const level = 1 - (y - PAD_Y) / (H - 2 * PAD_Y);
    return Math.round(Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, Math.pow(10, level * 2 - 1))) * 100) / 100;
  };
  const commit = (next: SpeedPoint[]) => setSpeedCurve(clipId, { ...(curve.preset ? { preset: curve.preset } : {}), points: next });
  // The curve's line: the speed where each part of the media plays.
  const path = Array.from({ length: 97 }, (_, i) => {
    const p = i / 96;
    const s = curveSpeedAt(points, timelineProgressAt(points, p));
    return `${i ? "L" : "M"}${xOf(p).toFixed(1)},${yOf(s).toFixed(1)}`;
  }).join(" ");
  const nearHead = head == null ? -1 : points.findIndex((q) => Math.abs(q.x - head) <= NEAR);
  const removable = (i: number) => i > 0 && i < points.length - 1;
  // CapCut keeps points at least 3 frames of media apart.
  const gap = Math.max(0.01, 3 / Math.max(1, media));
  const crowded = head == null || points.some((q) => Math.abs(q.x - head) < gap);

  const dragPoint = (i: number, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setPicked(i);
    const rect = box.current!.getBoundingClientRect();
    let frame = 0;
    const move = (ev: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = points.map((q) => ({ ...q }));
        const lo = i === 0 ? 0 : next[i - 1].x + gap;
        const hi = i === next.length - 1 ? 1 : next[i + 1].x - gap;
        if (removable(i)) next[i].x = Math.round(Math.min(hi, Math.max(lo, (ev.clientX - rect.left) / width)) * 1000) / 1000;
        next[i].y = speedOfY(ev.clientY - rect.top);
        commit(next);
      });
    };
    const up = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const addAtHead = () => {
    if (head == null) return;
    const s = Math.round(curveSpeedAt(points, timelineProgressAt(points, head)) * 100) / 100;
    commit([...points, { x: head, y: s }].sort((a, b) => a.x - b.x));
  };
  const remove = (i: number) => {
    if (!removable(i)) return;
    commit(points.filter((_, j) => j !== i));
    setPicked(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picked == null || (e.key !== "Delete" && e.key !== "Backspace")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!removable(picked)) return;
      // Ahead of the timeline's Delete (which would delete the clip).
      e.preventDefault();
      e.stopImmediatePropagation();
      remove(picked);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  const reset = () => {
    const fresh = presetCurve(curve.preset ?? "Custom") ?? presetCurve("Custom");
    if (fresh) setSpeedCurve(clipId, fresh);
    setPicked(null);
  };
  const seekTo = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / width));
    useControlsStore.getState().setFocusFrame(Math.round(start + timelineProgressAt(points, p) * len));
    setPicked(null);
  };

  return (
    <div data-testid="curve-editor" className="mx-3 mb-3 rounded-[8px] bg-[#0b0b0b] overflow-hidden">
      <div className="flex items-center gap-x-3 h-[38px] px-3">
        <span className="text-[12px] text-brand-light w-[58px] text-left shrink-0">Duration</span>
        <LengthRow before={media / fps}>
          <span data-testid="curve-duration" className="text-[12px] text-brand-lighter tabular-nums">{seconds(len / fps)}</span>
        </LengthRow>
      </div>
      <div ref={box} data-testid="curve-graph" className="relative border-y border-[#1d1d1f] select-none" style={{ height: H }} onPointerDown={seekTo}>
        <svg width={width} height={H} className="absolute inset-0">
          {[MAX_CURVE_SPEED, Math.sqrt(10), 1, 1 / Math.sqrt(10), MIN_CURVE_SPEED].map((s) => (
            <line key={s} x1={0} x2={width} y1={yOf(s)} y2={yOf(s)} stroke="#2c2c2e" strokeDasharray={s === 1 ? undefined : "4 3"} strokeWidth={1} />
          ))}
          <path d={path} fill="none" stroke="#e6e6e6" strokeWidth={1.5} />
          {head != null && <line x1={xOf(head)} x2={xOf(head)} y1={0} y2={H} stroke="#ffffff" strokeWidth={1.5} />}
        </svg>
        {[["10x", MAX_CURVE_SPEED], ["1x", 1], ["0.1x", MIN_CURVE_SPEED]].map(([label, s]) => (
          <span key={label} className="absolute left-2 text-[11px] text-[#6c6c6c] tabular-nums pointer-events-none" style={{ top: yOf(s as number) + (s === MAX_CURVE_SPEED ? 2 : s === MIN_CURVE_SPEED ? -15 : 2) }}>
            {label}
          </span>
        ))}
        {points.map((q, i) => (
          <div
            key={i}
            role="slider"
            aria-label={`Point ${i + 1}`}
            aria-valuenow={q.y}
            aria-valuemin={MIN_CURVE_SPEED}
            aria-valuemax={MAX_CURVE_SPEED}
            data-testid="curve-point"
            title={`${q.y.toFixed(2)}x`}
            onPointerDown={(e) => dragPoint(i, e)}
            className={cn(
              "absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 cursor-grab",
              picked === i ? "bg-brand-accent border-white" : "bg-[#3b3b3b] border-[#d8d8d8]",
            )}
            style={{ left: xOf(q.x), top: yOf(q.y) }}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-x-2 h-[42px] px-3">
        <button type="button" data-testid="curve-reset" onClick={reset} className="h-[22px] px-4 rounded-[4px] bg-brand-button text-[12px] font-semibold text-brand-lighter hover:bg-[#5a5a5a]">
          Reset
        </button>
        {nearHead >= 0 && removable(nearHead) ? (
          <button type="button" title="Delete point" data-testid="curve-remove" onClick={() => remove(nearHead)} className="w-[22px] h-[22px] rounded-[4px] bg-brand-button flex items-center justify-center text-brand-lighter hover:bg-[#5a5a5a]">
            <LuMinus className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            title="Add a point at the playhead"
            data-testid="curve-add"
            disabled={crowded}
            onClick={addAtHead}
            className="w-[22px] h-[22px] rounded-[4px] bg-brand-button flex items-center justify-center text-brand-lighter hover:bg-[#5a5a5a] disabled:opacity-40"
          >
            <LuPlus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};

/** The Curve view: the presets, and the chosen curve's editor. */
const CurveSpeed: React.FC<{ clipId: string }> = ({ clipId }) => {
  const { clip } = useSpeedClip(clipId);
  const setSpeedCurve = useClipStore((s) => s.setSpeedCurve);
  if (!clip) return null;
  const curve = hasCurve(clip) ? clip.speedCurve! : null;
  const current = curve ? (curve.preset ?? "Custom") : null;
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto custom-scrollbar">
      <div className="grid gap-x-4 gap-y-3.5 px-3 pt-3.5 pb-4" style={{ gridTemplateColumns: "repeat(auto-fill, 62px)" }}>
        <PresetCard label="None" active={!curve} onClick={() => setSpeedCurve(clipId, null)}>
          <LuBan className="w-6 h-6 text-[#a0a0a0]" strokeWidth={1.5} />
        </PresetCard>
        {CURVE_PRESETS.map((p) => (
          <PresetCard key={p.name} label={p.name} active={current === p.name} onClick={() => current !== p.name && setSpeedCurve(clipId, presetCurve(p.name))}>
            {p.name === "Custom" ? <LuSlidersHorizontal className="w-6 h-6 text-brand-accent" /> : <CurveIcon points={p.points} className="w-full h-full" />}
          </PresetCard>
        ))}
      </div>
      {curve && <CurveEditor clipId={clipId} curve={curve} />}
    </div>
  );
};

/** The Speed tab's panel for one of its sub-tabs. */
const SpeedProperties: React.FC<{ clipId: string; mode: "standard" | "curve" }> = ({ clipId, mode }) => {
  const freeze = useClipStore((s) => !!(s.getClipById(clipId) as VideoClipProps | undefined)?.freeze);
  if (freeze) return <p className="px-3 py-4 text-[12px] text-[#949494] text-left">A freeze frame holds one frame: it has no speed.</p>;
  return mode === "curve" ? <CurveSpeed clipId={clipId} /> : <StandardSpeed clipId={clipId} />;
};

export default SpeedProperties;
