import React, { useRef } from "react";
import { LuRotateCcw } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { clearKeyframes } from "@/lib/keyframes";
import { colorOf, setWheel, setWheelMode, wheelMode, wheelOf, WheelName } from "@/lib/color";
import type { AnyClipProps, ColorWheel, ImageClipProps, VideoClipProps } from "@/lib/types";
import Section from "../Section";
import KeyframedSlider from "../KeyframedSlider";
import { InspectorSelect } from "../controls";

/**
 * Adjust ▸ Color wheel, as CapCut lays it out (docs/plan/capcut-ui-spec.md §4.8c): the primary
 * wheels' Intensity (keyframeable, `wheels:intensity`), then Shadows (lift), Middle grey
 * (gamma), Highlights (gain) and Offset in a 2×2 grid. Each wheel is a hue ring with a puck
 * that sets its red, green and blue together (CapCut's values, −1…1, summing to nothing so
 * the puck tints without brightening), a grey arc on its right for luma, and R/G/B fields
 * under colour bars. Double-click a wheel to centre it. A dropdown above switches between Primary
 * and Log (CapCut's `021-color-wheel-mode-dropdown`): Log's wheels are Shadow, Middle tone,
 * Highlight and Offset, shifting the picture in log space (OpenRip's own maths, engine
 * adjust.wgsl); each mode keeps its own values and they share the Intensity.
 */

const WHEELS: Record<"primary" | "log", { key: WheelName; name: string }[]> = {
  primary: [
    { key: "lift", name: "Shadows" },
    { key: "gamma", name: "Middle grey" },
    { key: "gain", name: "Highlights" },
    { key: "offset", name: "Offset" },
  ],
  log: [
    { key: "lift", name: "Shadow" },
    { key: "gamma", name: "Middle tone" },
    { key: "gain", name: "Highlight" },
    { key: "offset", name: "Offset" },
  ],
};
const MODES = [
  { value: "primary", label: "Primary" },
  { value: "log", label: "Log" },
];

// The puck's place ↔ the wheel's red, green and blue. The ring runs as CapCut's: red at the
// top, then magenta, blue, cyan, green, yellow clockwise (hue = −angle from the top). A puck
// at the rim in red's direction gives red +1 and green and blue −0.5.
const SCALE = 1.5;
const toRgb = (angle: number, r: number) => {
  const h = (-angle * Math.PI) / 180;
  const [a, b] = [r * SCALE * Math.cos(h), r * SCALE * Math.sin(h)];
  return { red: (2 * a) / 3, green: -a / 3 + b / Math.sqrt(3), blue: -a / 3 - b / Math.sqrt(3) };
};
const toPuck = (w: ColorWheel) => {
  const [R, G, B] = [w.red ?? 0, w.green ?? 0, w.blue ?? 0];
  const a = R - (G + B) / 2;
  const b = (Math.sqrt(3) / 2) * (G - B);
  const r = Math.min(1, Math.hypot(a, b) / SCALE);
  const angle = (-Math.atan2(b, a) * 180) / Math.PI;
  return { r, angle };
};
const round = (v: number) => Math.round(v * 100) / 100;

const Wheel: React.FC<{ name: string; value: ColorWheel; onChange: (w: ColorWheel) => void; testId: string }> = ({ name, value, onChange, testId }) => {
  const ring = useRef<HTMLDivElement>(null);
  const arc = useRef<HTMLDivElement>(null);
  const SIZE = 120;
  const puck = toPuck(value);
  const px = Math.sin((puck.angle * Math.PI) / 180) * puck.r * (SIZE / 2 - 12);
  const py = -Math.cos((puck.angle * Math.PI) / 180) * puck.r * (SIZE / 2 - 12);
  const setFrom = (e: React.PointerEvent) => {
    const rc = ring.current!.getBoundingClientRect();
    const [dx, dy] = [e.clientX - (rc.x + rc.width / 2), e.clientY - (rc.y + rc.height / 2)];
    const r = Math.min(1, Math.hypot(dx, dy) / (SIZE / 2 - 12));
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const rgb = toRgb(angle, r);
    onChange({ ...value, red: round(rgb.red), green: round(rgb.green), blue: round(rgb.blue) });
  };
  // Luma: up the arc is brighter (−1 at its foot, +1 at its top).
  const setLuma = (e: React.PointerEvent) => {
    const rc = arc.current!.getBoundingClientRect();
    onChange({ ...value, luma: round(Math.max(-1, Math.min(1, 1 - ((e.clientY - rc.y) / rc.height) * 2))) });
  };
  const luma = value.luma ?? 0;
  return (
    <div className="flex flex-col items-center min-w-0" data-testid={testId}>
      <div className="flex flex-row items-center gap-1.5 mb-1.5">
        <span className="text-[12px] text-brand-light">{name}</span>
        <button type="button" title={`Reset ${name}`} aria-label={`Reset ${name}`} onClick={() => onChange({})} className="text-brand-light hover:text-brand-lighter">
          <LuRotateCcw className="w-3 h-3" />
        </button>
      </div>
      <div className="relative" style={{ width: SIZE + 16, height: SIZE }}>
        <div
          ref={ring}
          role="slider"
          aria-label={`${name} colour`}
          aria-valuetext={`red ${value.red ?? 0}, green ${value.green ?? 0}, blue ${value.blue ?? 0}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setFrom(e);
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && setFrom(e)}
          onDoubleClick={() => onChange({ ...value, red: 0, green: 0, blue: 0 })}
          className="absolute left-0 top-0 rounded-full cursor-pointer touch-none"
          style={{
            width: SIZE,
            height: SIZE,
            background: "conic-gradient(from 0deg, #e8455a, #c84fd0 60deg, #4a6bf0 120deg, #3cc8d8 180deg, #4ec85a 240deg, #e8d43c 300deg, #e8455a 360deg)",
          }}
        >
          <div className="absolute inset-[7px] rounded-full" style={{ background: "radial-gradient(circle, #2a2a2a 0%, #161616 100%)" }} />
          <span
            className="absolute w-2.5 h-2.5 rounded-full bg-[#d9d9d9] border border-black/40 pointer-events-none"
            style={{ left: SIZE / 2 - 5 + px, top: SIZE / 2 - 5 + py }}
          />
        </div>
        {/* The luma arc. */}
        <div
          ref={arc}
          role="slider"
          aria-label={`${name} luma`}
          aria-valuenow={luma}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setLuma(e);
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && setLuma(e)}
          onDoubleClick={() => onChange({ ...value, luma: 0 })}
          className="absolute right-0 top-[14px] w-[10px] cursor-ns-resize touch-none"
          style={{ height: SIZE - 28 }}
        >
          <div className="absolute inset-y-0 left-[3px] w-[4px] rounded-full bg-[#5a6270]" />
          <span className="absolute left-0 w-[10px] h-[3px] rounded-full bg-brand-lighter pointer-events-none" style={{ top: `calc(${((1 - luma) / 2) * 100}% - 1.5px)` }} />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-[2px] w-[132px]">
        {(["red", "green", "blue"] as const).map((ch) => (
          <div key={ch} className="flex flex-col items-center">
            <span className="h-1 w-6 rounded-t-[2px]" style={{ background: { red: "#e53935", green: "#7cfc3c", blue: "#2040ff" }[ch] }} />
            <input
              aria-label={`${name} ${ch}`}
              className="w-full h-5 bg-brand rounded-[3px] text-center text-[12px] tabular-nums text-brand-lighter outline-none"
              defaultValue={(value[ch] ?? 0).toFixed(2)}
              key={`${ch}-${value[ch] ?? 0}`}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={(e) => {
                const n = Number(e.currentTarget.value);
                if (Number.isFinite(n) && n !== (value[ch] ?? 0)) onChange({ ...value, [ch]: Math.max(-1, Math.min(1, n)) });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

const AdjustWheels: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as VideoClipProps | ImageClipProps | undefined;
  if (!clip) return null;
  const color = colorOf(clip);
  const mode = wheelMode(color);
  const now = () => useClipStore.getState().getClipById(clipId)!;
  const reset = () => {
    const c = now();
    useClipStore.getState().updateClip(clipId, { keyframes: clearKeyframes(c.keyframes, "wheels:intensity"), color: { ...colorOf(c), wheels: { mode: wheelMode(colorOf(c)) } } } as Partial<AnyClipProps>);
  };
  return (
    <div className="min-w-0 divide-y divide-brand-divider">
      <Section title="Color wheel" onReset={reset} keyframes={{ clipId, properties: ["wheels:intensity"] }} testId="section-wheels">
        <InspectorSelect label="Color wheel mode" value={mode} onChange={(v) => useClipStore.getState().updateClip(clipId, setWheelMode(now(), v as "primary" | "log"))} options={MODES} />
        <div className="mt-3">
          <KeyframedSlider clipId={clipId} property="wheels:intensity" label="Intensity" min={0} max={100} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-y-5 justify-items-center" data-mode={mode}>
          {WHEELS[mode].map((w) => (
            <Wheel key={`${mode}-${w.key}`} name={w.name} testId={`wheel-${w.key}`} value={wheelOf(color, w.key)} onChange={(v) => useClipStore.getState().updateClip(clipId, setWheel(now(), w.key, v))} />
          ))}
        </div>
      </Section>
    </div>
  );
};

export default AdjustWheels;
