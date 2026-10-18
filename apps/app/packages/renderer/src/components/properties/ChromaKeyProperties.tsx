import React from "react";
import { LuPipette } from "react-icons/lu";
import { IoCaretDown } from "react-icons/io5";
import { useClipStore } from "@/lib/clip";
import { clearKeyframes } from "@/lib/keyframes";
import { CHROMA_PROPERTIES, CHROMA_SLIDERS, chromaKeyOf, clearChroma, setChroma } from "@/lib/compositing";
import { useEyedropperStore } from "@/lib/eyedropper";
import type { AnyClipProps, ImageClipProps, VideoClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import Section from "./Section";
import PropertyRow from "./PropertyRow";
import KeyframedSlider from "./KeyframedSlider";

/**
 * CapCut's colour well: an 84×22 raised frame with the colour inset 2 px and a chevron; a
 * click opens the system's colour picker.
 */
export const ColorWell: React.FC<{ value: string; onChange: (hex: string) => void; label: string; disabled?: boolean }> = ({ value, onChange, label, disabled }) => (
  <label className={cn("relative w-[84px] h-[22px] shrink-0 rounded-[4px] bg-brand-background-light flex items-center p-[2px] gap-0", disabled ? "opacity-50" : "cursor-pointer hover:bg-brand-button")}>
    <span className="h-[18px] w-[62px] rounded-[3px]" style={{ background: value }} />
    <IoCaretDown className="ml-auto mr-[4px] w-2.5 h-2.5 text-brand-light" />
    <input type="color" aria-label={label} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
  </label>
);

/**
 * Remove BG ▸ Chroma key, as CapCut lays it out: the colour to key (picked from the picture
 * with the eyedropper, or chosen in the well), then Intensity, Shadow, Edge smoothing and
 * Spill, each keyframeable. A new key starts at intensity 0, keying nothing until it's raised
 * (CapCut's order: pick, then raise). CapCut's automatic removal is machine learning and
 * isn't offered.
 */
const ChromaKeyProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as VideoClipProps | ImageClipProps | undefined;
  const picking = useEyedropperStore((s) => s.owner === `chroma:${clipId}`);
  if (!clip) return null;
  const chroma = clip.chroma ?? null;
  const update = (patch: Partial<AnyClipProps>) => useClipStore.getState().updateClip(clipId, patch);
  const now = () => useClipStore.getState().getClipById(clipId)!;
  const setColor = (hex: string) => update(setChroma(now(), "color", hex));
  const eyedropper = () => {
    const ed = useEyedropperStore.getState();
    if (picking) ed.stop();
    else ed.start(`chroma:${clipId}`, setColor);
  };
  // The sliders back to 0 and their keys gone; the colour stays.
  const reset = () => {
    const c = now() as VideoClipProps;
    let keyframes = c.keyframes;
    for (const p of CHROMA_PROPERTIES) keyframes = clearKeyframes(keyframes, p);
    update({ keyframes, chroma: c.chroma ? chromaKeyOf(c.chroma.color) : null } as Partial<AnyClipProps>);
  };
  return (
    <div className="min-w-0 divide-y divide-brand-divider">
      <Section
        title="Chroma key"
        checked={chroma != null}
        onCheckedChange={(on) => update(on ? ({ chroma: chromaKeyOf(chroma?.color ?? "#00ff00") } as Partial<AnyClipProps>) : clearChroma())}
        onReset={reset}
        keyframes={{ clipId, properties: CHROMA_PROPERTIES }}
        testId="section-chroma"
      >
        <PropertyRow label="Color picker">
          <button
            type="button"
            title={picking ? "Stop picking" : "Pick a colour from the picture"}
            aria-label="Pick the colour from the picture"
            aria-pressed={picking}
            data-testid="chroma-eyedropper"
            onClick={eyedropper}
            className={cn(
              "w-[22px] h-[22px] rounded-[4px] flex items-center justify-center shrink-0",
              picking ? "bg-brand-accent text-white" : "bg-brand-background-light text-brand-light hover:bg-brand-button",
            )}
          >
            <LuPipette className="w-3 h-3" />
          </button>
          <ColorWell value={chroma?.color ?? "#00ff00"} onChange={setColor} label="Chroma key colour" />
        </PropertyRow>
        {CHROMA_SLIDERS.map((s) => (
          <div key={s.key} className="pb-[5px]">
            <KeyframedSlider clipId={clipId} property={`chroma:${s.key}`} label={s.name} min={0} max={100} />
          </div>
        ))}
      </Section>
    </div>
  );
};

export default ChromaKeyProperties;
