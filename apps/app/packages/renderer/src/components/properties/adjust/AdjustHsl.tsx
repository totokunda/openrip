import React, { useState } from "react";
import { LuPipette } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { clearKeyframes } from "@/lib/keyframes";
import { colorOf, HSL_PARTS, HSL_RANGES } from "@/lib/color";
import { useEyedropperStore } from "@/lib/eyedropper";
import type { AnyClipProps, HslRange, ImageClipProps, KeyframeProperty, VideoClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import Section from "../Section";
import KeyframedSlider from "../KeyframedSlider";

/**
 * Adjust ▸ HSL, as CapCut lays it out (docs/plan/capcut-ui-spec.md §4.8c): an eyedropper and
 * the eight ranges as rings in their colours (the chosen one a filled disc), then the chosen
 * range's Hue, Saturation and Brightness (lightness) on −100…100 with gradient tracks, each
 * keyframeable (`hsl:<range>:<part>`). The eyedropper picks the range nearest in hue to the
 * colour clicked in the picture.
 */

/** Each range's middle hue (degrees), for its tracks and the eyedropper. */
const HUES: Record<HslRange, number> = { red: 0, orange: 30, yellow: 60, green: 120, cyan: 180, blue: 225, purple: 270, magenta: 315 };
const PART_NAMES = { hue: "Hue", saturation: "Saturation", lightness: "Brightness" } as const;

const hueOf = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

const nearestRange = (hue: number): HslRange =>
  (Object.keys(HUES) as HslRange[]).reduce((best, k) => {
    const d = (a: number) => Math.min(Math.abs(a - hue), 360 - Math.abs(a - hue));
    return d(HUES[k]) < d(HUES[best]) ? k : best;
  }, "red");

const tracks = (range: HslRange, swatch: string) => {
  const h = HUES[range];
  return {
    hue: `linear-gradient(90deg, hsl(${h - 40} 85% 55%), hsl(${h} 85% 55%), hsl(${h + 40} 85% 55%))`,
    saturation: `linear-gradient(90deg, #6e6e6e, ${swatch})`,
    lightness: `linear-gradient(90deg, #1a0606, ${swatch}, #ffffff)`,
  };
};

const AdjustHsl: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as VideoClipProps | ImageClipProps | undefined;
  const [range, setRange] = useState<HslRange>("red");
  const picking = useEyedropperStore((s) => s.owner === `hsl:${clipId}`);
  if (!clip) return null;
  const hsl = colorOf(clip).hsl ?? {};
  const properties = HSL_PARTS.map((p) => `hsl:${range}:${p}` as KeyframeProperty);
  const swatch = HSL_RANGES.find((r) => r.key === range)!.swatch;
  // Every range back to 0 and unkeyed.
  const reset = () => {
    const c = useClipStore.getState().getClipById(clipId)!;
    let keyframes = c.keyframes;
    for (const r of HSL_RANGES) for (const p of HSL_PARTS) keyframes = clearKeyframes(keyframes, `hsl:${r.key}:${p}` as KeyframeProperty);
    useClipStore.getState().updateClip(clipId, { keyframes, color: { ...colorOf(c), hsl: {} } } as Partial<AnyClipProps>);
  };
  const eyedropper = () => {
    const ed = useEyedropperStore.getState();
    if (picking) return ed.stop();
    ed.start(`hsl:${clipId}`, (hex) => {
      const h = hueOf(hex);
      if (h != null) setRange(nearestRange(h));
    });
  };
  return (
    <div className="min-w-0 divide-y divide-brand-divider">
      <Section title="HSL" onReset={reset} keyframes={{ clipId, properties }} testId="section-hsl">
        <div className="flex flex-row items-center h-[38px] mb-1" role="radiogroup" aria-label="Colour range">
          <button
            type="button"
            title="Pick a range from the picture"
            aria-label="Pick a range from the picture"
            aria-pressed={picking}
            onClick={eyedropper}
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mr-[12px]",
              picking ? "bg-brand-accent text-white" : "bg-brand-background-light text-brand-light hover:bg-brand-button",
            )}
          >
            <LuPipette className="w-3 h-3" />
          </button>
          {HSL_RANGES.map((r) => {
            const on = r.key === range;
            const changed = Object.values(hsl[r.key] ?? {}).some((v) => v);
            return (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={r.name}
                title={r.name}
                data-testid={`hsl-${r.key}`}
                onClick={() => setRange(r.key)}
                className="relative w-[40px] h-6 flex items-center justify-center shrink-0"
              >
                {on ? (
                  <span className="w-6 h-6 rounded-full border border-white flex items-center justify-center">
                    <span className="w-4 h-4 rounded-full" style={{ background: r.swatch }} />
                  </span>
                ) : (
                  <span className="w-[23px] h-[23px] rounded-full" style={{ border: `3.5px solid ${r.swatch}` }} />
                )}
                {changed && !on && <span className="absolute -bottom-1 w-1 h-1 rounded-full bg-brand-light" />}
              </button>
            );
          })}
        </div>
        {HSL_PARTS.map((p) => (
          <div key={`${range}-${p}`} className="pb-[5px]">
            <KeyframedSlider clipId={clipId} property={`hsl:${range}:${p}` as KeyframeProperty} label={PART_NAMES[p]} min={-100} max={100} track={tracks(range, swatch)[p]} />
          </div>
        ))}
      </Section>
    </div>
  );
};

export default AdjustHsl;
