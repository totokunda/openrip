import React, { useRef } from "react";
import { LuPipette, LuRotateCcw } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { colorOf, CURVE_CHANNELS, IDENTITY_CURVE, setCurve } from "@/lib/color";
import { useEyedropperStore } from "@/lib/eyedropper";
import type { AnyClipProps, CurveChannel, CurvePointXY, ImageClipProps, VideoClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import Section from "../Section";

/**
 * Adjust ▸ Curves, as CapCut lays it out (docs/plan/capcut-ui-spec.md §4.8c): a block per
 * channel (Luma, Red, Green, Blue) with its dot, eyedropper and reset over a 3:2 graph on
 * #070709 with a 4×4 grid, the curve in white through ringed points. Drag a point to move it;
 * press on the graph to add one there (and drag it); double-click a point to take it out. The
 * ends stay at black and white and move up and down only. CapCut doesn't keyframe curves.
 */

const CHANNELS: Record<CurveChannel, { name: string; color: string }> = {
  luma: { name: "Luma", color: "#ffffff" },
  red: { name: "Red (R)", color: "#ff4b4b" },
  green: { name: "Green (G)", color: "#3fd06a" },
  blue: { name: "Blue (B)", color: "#4b8bff" },
};

/**
 * The curve CapCut draws through the points (docs/parity/colour.md): a cubic bezier between
 * each two, an inner point's handles along the line between its neighbours a sixth of it
 * either way, an end's halfway to its neighbour's near handle; two points make a line.
 * Sampled as a polyline of (x, y) in 0–1.
 */
export const curvePath = (points: CurvePointXY[], steps = 24): CurvePointXY[] => {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  if (p.length < 2) return p;
  if (p.length === 2) return p;
  const n = p.length;
  const left: CurvePointXY[] = [];
  const right: CurvePointXY[] = [];
  for (let i = 1; i < n - 1; i++) {
    const d: CurvePointXY = [(p[i + 1][0] - p[i - 1][0]) / 6, (p[i + 1][1] - p[i - 1][1]) / 6];
    left[i] = [p[i][0] - d[0], p[i][1] - d[1]];
    right[i] = [p[i][0] + d[0], p[i][1] + d[1]];
  }
  right[0] = [(p[0][0] + left[1][0]) / 2, (p[0][1] + left[1][1]) / 2];
  left[n - 1] = [(p[n - 1][0] + right[n - 2][0]) / 2, (p[n - 1][1] + right[n - 2][1]) / 2];
  const out: CurvePointXY[] = [p[0]];
  for (let i = 0; i < n - 1; i++) {
    const [a, b, c, d] = [p[i], right[i], left[i + 1], p[i + 1]];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const f = (k: 0 | 1) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k];
      out.push([f(0), f(1)]);
    }
  }
  return out;
};

/** The curve's output at input x (on its polyline). */
const curveAt = (points: CurvePointXY[], x: number) => {
  const line = curvePath(points, 48);
  for (let i = 1; i < line.length; i++) {
    if (line[i][0] >= x) {
      const [a, b] = [line[i - 1], line[i]];
      return b[0] > a[0] ? a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]) : b[1];
    }
  }
  return line[line.length - 1][1];
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const CurveEditor: React.FC<{ points: CurvePointXY[]; onChange: (p: CurvePointXY[]) => void; color: string; channel: CurveChannel }> = ({ points, onChange, color, channel }) => {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const [W, H] = [366, 244];
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const at = (e: React.MouseEvent): CurvePointXY => {
    const r = ref.current!.getBoundingClientRect();
    return [clamp01((e.clientX - r.x) / r.width), clamp01(1 - (e.clientY - r.y) / r.height)];
  };
  // A point moved within its neighbours (the ends only up and down).
  const move = (i: number, [x, y]: CurvePointXY) => {
    const next = sorted.map((q) => [...q] as CurvePointXY);
    const last = next.length - 1;
    next[i] = [i === 0 ? 0 : i === last ? 1 : Math.min(next[i + 1][0] - 0.01, Math.max(next[i - 1][0] + 0.01, x)), y];
    onChange(next);
  };
  const line = curvePath(sorted)
    .map(([x, y]) => `${(x * W).toFixed(1)},${((1 - clamp01(y)) * H).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      data-testid={`curve-${channel}`}
      className="w-full h-auto rounded-[2px] bg-brand-hairline touch-none select-none cursor-crosshair overflow-visible"
      onPointerDown={(e) => {
        const p = at(e);
        const r = ref.current!.getBoundingClientRect();
        // On a point: drag it. Elsewhere: a new point there, dragged.
        let i = sorted.findIndex(([x, y]) => Math.hypot((x - p[0]) * r.width, (y - p[1]) * r.height) < 8);
        if (i < 0) {
          if (p[0] <= 0.01 || p[0] >= 0.99) return;
          const next = [...sorted, p].sort((a, b) => a[0] - b[0]);
          i = next.findIndex((q) => q === p);
          onChange(next);
        }
        drag.current = i;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => drag.current != null && move(drag.current, at(e))}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={(e) => {
        const p = at(e);
        const r = ref.current!.getBoundingClientRect();
        const i = sorted.findIndex(([x, y]) => Math.hypot((x - p[0]) * r.width, (y - p[1]) * r.height) < 8);
        if (i > 0 && i < sorted.length - 1) onChange(sorted.filter((_, k) => k !== i));
      }}
    >
      {[1, 2, 3].map((k) => (
        <g key={k} stroke="#202022" strokeWidth="1">
          <line x1={(k * W) / 4} y1={0} x2={(k * W) / 4} y2={H} />
          <line x1={0} y1={(k * H) / 4} x2={W} y2={(k * H) / 4} />
        </g>
      ))}
      <polyline points={line} fill="none" stroke="#ffffff" strokeWidth="1.5" />
      {sorted.map(([x, y], i) => (
        <circle key={i} cx={x * W} cy={(1 - y) * H} r={5} fill="#070709" stroke={channel === "luma" ? "#ffffff" : color} strokeWidth="2.5" />
      ))}
    </svg>
  );
};

const AdjustCurves: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as VideoClipProps | ImageClipProps | undefined;
  const picking = useEyedropperStore((s) => (s.owner?.startsWith(`curves:${clipId}:`) ? s.owner.split(":")[2] : null));
  if (!clip) return null;
  const curves = colorOf(clip).curves ?? {};
  const set = (ch: CurveChannel, p: CurvePointXY[]) => useClipStore.getState().updateClip(clipId, setCurve(useClipStore.getState().getClipById(clipId)!, ch, p));
  const resetAll = () => {
    const c = useClipStore.getState().getClipById(clipId)!;
    useClipStore.getState().updateClip(clipId, { color: { ...colorOf(c), curves: {} } } as Partial<AnyClipProps>);
  };
  // The eyedropper adds a point at the picked colour's level on the channel's curve.
  const eyedropper = (ch: CurveChannel) => {
    const ed = useEyedropperStore.getState();
    if (picking === ch) return ed.stop();
    ed.start(`curves:${clipId}:${ch}`, (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const x = ch === "red" ? r : ch === "green" ? g : ch === "blue" ? b : 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const pts = colorOf(useClipStore.getState().getClipById(clipId)!).curves?.[ch] ?? IDENTITY_CURVE;
      if (x <= 0.01 || x >= 0.99 || pts.some((q) => Math.abs(q[0] - x) < 0.02)) return;
      set(ch, [...pts, [x, curveAt(pts, x)]]);
    });
  };
  return (
    <div className="min-w-0 divide-y divide-brand-divider">
      <Section title="Curves" onReset={resetAll} testId="section-curves">
        {CURVE_CHANNELS.map((ch) => (
          <div key={ch} className="mb-3" data-curve={ch}>
            <div className="h-[38px] flex flex-row items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: CHANNELS[ch].color }} />
              <span className="text-[12px] font-semibold text-brand-light">{CHANNELS[ch].name}</span>
              <div className="ml-auto flex flex-row items-center gap-[10px]">
                <button
                  type="button"
                  title="Add a point at a colour picked from the picture"
                  aria-label={`Pick a level for ${CHANNELS[ch].name}`}
                  aria-pressed={picking === ch}
                  onClick={() => eyedropper(ch)}
                  className={cn("w-5 h-5 rounded-[4px] flex items-center justify-center", picking === ch ? "bg-brand-accent text-white" : "text-brand-light hover:text-brand-lighter")}
                >
                  <LuPipette className="w-[13px] h-[13px]" />
                </button>
                <button type="button" title={`Reset ${CHANNELS[ch].name}`} aria-label={`Reset ${CHANNELS[ch].name}`} onClick={() => set(ch, IDENTITY_CURVE)} className="text-brand-light hover:text-brand-lighter">
                  <LuRotateCcw className="w-[13px] h-[13px]" />
                </button>
              </div>
            </div>
            <CurveEditor channel={ch} color={CHANNELS[ch].color} points={curves[ch]?.length ? curves[ch]! : IDENTITY_CURVE} onChange={(p) => set(ch, p)} />
          </div>
        ))}
      </Section>
    </div>
  );
};

export default AdjustCurves;
