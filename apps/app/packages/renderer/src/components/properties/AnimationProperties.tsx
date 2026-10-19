import React, { useEffect, useState } from "react";
import { LuBan } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import {
  ANIMATION_FIELD,
  animationOf,
  animationsFor,
  maxAnimationDuration,
  type AnimationKind,
  type BuiltinAnimation,
} from "@/lib/animations";
import type { AnyClipProps, ClipAnimation, TextClipProps } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "./PropertiesSlider";
import { AnimationPreview } from "@/components/motion/Previews";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { cn } from "@/lib/utils";

/**
 * The Animation tab, as CapCut's: sub-tabs In, Out and Combo for a video or photo (In, Out and
 * Loop for a text), each a grid of cards with a moving preview, None first, and the chosen
 * one's duration in the footer. These are the animations the engine draws (playback/src/
 * animation.rs, lib/animations.ts); a CapCut draft's others are listed by name and kept as
 * CapCut had them until replaced. A caption with spoken-word timing also picks how it pages its
 * words (caption.rs).
 */

const CAPTION_STYLES = [
  { value: "none", label: "Whole text" },
  { value: "caption_word_color", label: "Three words, spoken one highlighted" },
  { value: "caption_one_word", label: "One word at a time" },
  // OpenRip's own, for captions made from speech (engine/crates/playback/src/caption.rs).
  { value: "orip_highlight", label: "Whole line, word highlighted" },
  { value: "orip_karaoke", label: "Whole line, filling as it's said" },
  { value: "orip_pop", label: "Words appear as they're said" },
  { value: "orip_boxed", label: "Whole line, word on a box" },
];

const NONE = "none";
/** A CapCut animation or caption style the engine doesn't draw: kept as it is. */
const KEEP = "keep";
/** The shortest an animation can be (s). */
const MIN = 0.1;

/** A duration as typed or slid, within the slider's bounds and to hundredths of a second. */
const within = (d: number, max: number) => Math.round(Math.max(MIN, Math.min(d, max)) * 100) / 100;

/** The kinds a clip of this type has, in its sub-tabs' order (none for other types). */
export const animationKinds = (type: AnyClipProps["type"]): AnimationKind[] =>
  type === "video" || type === "image" ? ["in", "out", "combo"] : type === "text" || type === "sticker" ? ["in", "out", "loop"] : [];

export const KIND_LABEL: Record<AnimationKind, string> = { in: "In", out: "Out", combo: "Combo", loop: "Loop" };

/**
 * Give a clip the animation `type` of `kind` ("none" takes it off), keeping the duration it had
 * where it can (within the clip; a Combo spans it). As CapCut does, a Combo replaces the In and
 * Out, and an In or Out replaces a Combo.
 */
export function applyAnimation(clipId: string, kind: AnimationKind, type: string) {
  const { getClipById, updateClip } = useClipStore.getState();
  const clip = getClipById(clipId);
  if (!clip || type === KEEP) return;
  const field = ANIMATION_FIELD[kind];
  if (type === NONE) return updateClip(clipId, { [field]: null } as Partial<AnyClipProps>);
  const fps = useControlsStore.getState().fps || 30;
  const was = (clip as unknown as Record<string, unknown>)[field] as ClipAnimation | null | undefined;
  const builtin = animationsFor(clip.type, kind).find((a) => a.type === type);
  if (!builtin) return;
  const max = Math.max(MIN, maxAnimationDuration(clip, kind, fps));
  const next = animationOf(clip, kind, type, {
    // The duration the clip's animation of this kind had (a draft's undrawn one's too).
    duration: within(was ? was.duration : builtin.defaultDuration, max),
    params: was?.params?.direction && builtin.params?.length ? { direction: was.params.direction } : undefined,
    fps,
  });
  if (!next) return;
  const patch: Record<string, unknown> = { [field]: next };
  if (kind === "combo") Object.assign(patch, { animationIn: null, animationOut: null });
  if ((kind === "in" || kind === "out") && (clip.type === "video" || clip.type === "image")) patch.animationCombo = null;
  updateClip(clipId, patch as Partial<AnyClipProps>);
}

/** A caption-style select row (the label in the 112 px column). */
const Row: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div className="flex flex-row gap-x-2 items-center">
    <h4 className="text-brand-light text-[12px] text-start w-[112px] shrink-0">{label}</h4>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-full min-w-0 !h-[22px] text-[12px] bg-brand-background-light rounded-[4px] text-brand-light">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-brand-background text-brand-light font-poppins z-[101] dark">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[12px]">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

/**
 * A card: a 62 px tile with the animation's preview (played while hovered), its name under it;
 * the chosen one outlined in the accent.
 */
const AnimationCard: React.FC<{
  label: string;
  active: boolean;
  onClick: () => void;
  children: (playing: boolean) => React.ReactNode;
}> = ({ label, active, onClick, children }) => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={label}
      data-testid="anim-card"
      aria-pressed={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex flex-col items-center gap-[7px] w-[62px] min-w-0"
    >
      <div className={cn("relative w-[62px] h-[62px] rounded-[6px] bg-brand-background-light overflow-hidden", active && "ring-[1.5px] ring-brand-accent")}>
        {children(hover)}
      </div>
      <span className={cn("w-[74px] text-[12px] leading-none truncate text-center", active ? "text-brand-light" : "text-[#949494]")}>{label}</span>
    </button>
  );
};

/**
 * The chosen animation's duration in the footer, as CapCut lays it: the label, the field with
 * its stepper, then the slider.
 */
const DurationFooter: React.FC<{ value: number; max: number; onChange: (d: number) => void }> = ({ value, max, onChange }) => {
  const [text, setText] = useState(`${value.toFixed(1)}s`);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(`${value.toFixed(1)}s`);
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const n = Number(text.replace(/[^0-9.]/g, ""));
    if (isFinite(n) && n > 0) onChange(n);
    else setText(`${value.toFixed(1)}s`);
  };
  const step = (d: number) => onChange(within(value + d, max));
  return (
    <div className="h-9 shrink-0 flex items-center gap-x-2 px-3 bg-brand-header">
      <label className="text-[12px] text-brand-light w-[58px] text-left shrink-0">Duration</label>
      <input
        value={text}
        onFocus={() => {
          setEditing(true);
          setText(value.toFixed(1));
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
      <div className="-ml-1.5 w-4 h-[22px] flex flex-col rounded-[3px] bg-brand-background-light">
        <button type="button" aria-label="Longer" className="flex-1 flex items-center justify-center hover:bg-brand-light/10" onClick={() => step(0.1)}>
          <LuChevronUp className="w-2 h-2 text-brand-light" />
        </button>
        <button type="button" aria-label="Shorter" className="flex-1 flex items-center justify-center hover:bg-brand-light/10" onClick={() => step(-0.1)}>
          <LuChevronDown className="w-2 h-2 text-brand-light" />
        </button>
      </div>
      <Slider className="flex-1 ml-2" value={[Math.min(value, max)]} min={MIN} max={max} step={0.1} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
};

/** The Animation tab's panel for one kind (its sub-tab). */
const AnimationProperties: React.FC<{ clipId: string; kind: AnimationKind }> = ({ clipId, kind }) => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const updateClip = useClipStore((s) => s.updateClip);
  const fps = useControlsStore((s) => s.fps) || 30;
  if (!clip || !animationKinds(clip.type).includes(kind)) return null;
  const field = ANIMATION_FIELD[kind];
  const anim = ((clip as unknown as Record<string, unknown>)[field] as ClipAnimation | null | undefined) ?? null;
  const builtins = animationsFor(clip.type, kind);
  const known = !!anim && builtins.some((b) => b.type === anim.type);
  const kept = !!anim && !known;
  const value = !anim ? NONE : known ? anim.type : KEEP;
  const max = Math.max(MIN, maxAnimationDuration(clip, kind, fps));
  const subject = clip.type === "text" ? "text" : "media";
  const text = clip.type === "text" ? (clip as TextClipProps) : null;
  // A draft's style the engine doesn't draw comes as "" (a select can't have that value).
  const style = text?.captionStyle ?? NONE;
  const caption = CAPTION_STYLES.some((c) => c.value === style) ? style : KEEP;
  const captionOptions = caption === KEEP ? [...CAPTION_STYLES, { value: KEEP, label: "CapCut's style" }] : CAPTION_STYLES;
  const card = (b: BuiltinAnimation) => (
    <AnimationCard key={b.type} label={b.name} active={value === b.type} onClick={() => applyAnimation(clipId, kind, b.type)}>
      {(playing) => <AnimationPreview subject={subject} kind={kind} type={b.type} direction={b.params?.[0]?.default} playing={playing || value === b.type} />}
    </AnimationCard>
  );

  return (
    <div data-testid={`animation-${kind}`} className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {text?.spokenWords && (
          <div className="flex flex-col gap-y-3 px-3 py-3 border-b border-brand-divider">
            <h4 className="text-brand-light text-[12px] font-semibold text-start">Captions</h4>
            <Row label="Words" value={caption} options={captionOptions} onChange={(v) => v !== KEEP && updateClip(clipId, { captionStyle: v } as Partial<AnyClipProps>)} />
          </div>
        )}
        <div className="grid gap-x-4 gap-y-3.5 px-3 pt-3.5 pb-4" style={{ gridTemplateColumns: "repeat(auto-fill, 62px)" }}>
          <AnimationCard label="None" active={value === NONE} onClick={() => applyAnimation(clipId, kind, NONE)}>
            {() => (
              <div className="absolute inset-0 flex items-center justify-center text-[#a0a0a0]">
                <LuBan className="w-6 h-6" strokeWidth={1.5} />
              </div>
            )}
          </AnimationCard>
          {kept && (
            <AnimationCard label={`${anim?.name || "CapCut's"} (CapCut)`} active onClick={() => {}}>
              {() => <div className="absolute inset-0 flex items-center justify-center px-1 text-[10px] leading-tight text-brand-light/80 text-center">{anim?.name || "CapCut"}</div>}
            </AnimationCard>
          )}
          {builtins.map(card)}
        </div>
        {kept && <p className="px-3 pb-3 text-[12px] text-[#949494] text-left">The engine doesn't draw this CapCut animation yet; CapCut's export has it.</p>}
        {kind === "combo" && anim && known && <p className="px-3 pb-3 text-[12px] text-[#949494] text-left">A combo runs over the whole clip.</p>}
      </div>
      {anim && known && kind !== "combo" && (
        <DurationFooter value={Math.min(anim.duration, max)} max={max} onChange={(d) => updateClip(clipId, { [field]: { ...anim, duration: within(d, max) } } as Partial<AnyClipProps>)} />
      )}
    </div>
  );
};

export default AnimationProperties;
