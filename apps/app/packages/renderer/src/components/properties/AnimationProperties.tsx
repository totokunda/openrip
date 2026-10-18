import React from "react";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import {
  ClipAnimationIn,
  ClipTransition,
  ImageClipProps,
  TextClipProps,
  VideoClipProps,
} from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PropertiesSlider from "./PropertiesSlider";

/**
 * The Animation tab: a text's In animation and caption style, and a video or photo's
 * transition into the next clip. These are the ones the engine draws (playback/src/
 * animation.rs, caption.rs, transition.rs); a CapCut draft's others are listed by name and
 * kept as CapCut had them until replaced.
 */

export const IN_ANIMATIONS = [
  { value: "type_1", label: "Type 1" },
  { value: "type_2", label: "Type 2" },
  { value: "typewriter", label: "Typewriter" },
];

const CAPTION_STYLES = [
  { value: "none", label: "Whole text" },
  { value: "caption_word_color", label: "Three words, spoken one highlighted" },
  { value: "caption_one_word", label: "One word at a time" },
];

export const TRANSITIONS = [
  { value: "white_flash", label: "White Flash" },
  { value: "white_fade", label: "White Fade" },
  { value: "blink", label: "Blink" },
];

const NONE = "none";
/** A CapCut animation, caption style or transition the engine doesn't draw: kept as it is. */
const KEEP = "keep";

/** A duration as typed or slid, within the slider's bounds and to hundredths of a second. */
const within = (d: number, max: number) => Math.round(Math.max(0.1, Math.min(d, max)) * 100) / 100;

type AnyClip = ReturnType<typeof useClipStore.getState>["clips"][number];

const clipSeconds = (clip: AnyClip, fps: number) => Math.max(0.1, (clip.endFrame - clip.startFrame) / fps);

// A transition needs a clip starting where this one ends on its track, as the engine draws
// it; the shorter of the two bounds its duration. In frames, 0 when there's none.
export const nextClipFrames = (clips: AnyClip[], clip: AnyClip | undefined) => {
  const next = clip && clips.find((c) => c.clipId !== clip.clipId && c.timelineId === clip.timelineId && c.startFrame === clip.endFrame);
  return next ? next.endFrame - next.startFrame : 0;
};

// Blink draws CapCut's downloaded image sequence: offered when the project has one, on a
// clip or among a draft clip's materials (where it stays when the app replaces it).
export const projectBlink = (clips: AnyClip[]) => {
  for (const c of clips) {
    const t = (c as VideoClipProps).transitionOut;
    if (t?.type === "blink" && t.resource) return t.resource;
    const m = ((c as any).engine?.materials ?? []).find((m: any) => m?.type === "transition" && m.builtin === "blink" && m.resource);
    if (m) return m.resource as string;
  }
  return null;
};

/** The longest In animation a text can have: its length, 5 s at most. */
const inMaxFor = (clip: AnyClip, fps: number) => Math.max(0.1, Math.min(5, clipSeconds(clip, fps)));

/** Give a text the In animation `v` ("none" removes it), keeping its duration where it can. */
export function applyInAnimation(clipId: string, v: string) {
  const { getClipById, updateClip } = useClipStore.getState();
  const clip = getClipById(clipId) as TextClipProps | undefined;
  if (!clip || clip.type !== "text" || v === KEEP) return;
  if (v === NONE) return updateClip(clipId, { animationIn: null });
  const fps = useControlsStore.getState().fps || 30;
  const anim = clip.animationIn ?? null;
  const duration = within(anim?.duration ?? 0.5, inMaxFor(clip, fps));
  const next: ClipAnimationIn = { type: v, duration, name: IN_ANIMATIONS.find((a) => a.value === v)?.label };
  updateClip(clipId, { animationIn: next });
}

/** Give a video or photo the transition `v` into the next clip ("none" removes it). */
export function applyTransition(clipId: string, v: string) {
  const { getClipById, updateClip, clips } = useClipStore.getState();
  const clip = getClipById(clipId) as VideoClipProps | ImageClipProps | undefined;
  if (!clip || (clip.type !== "video" && clip.type !== "image") || v === KEEP) return;
  if (v === NONE) return updateClip(clipId, { transitionOut: null });
  const fps = useControlsStore.getState().fps || 30;
  const seconds = clipSeconds(clip, fps);
  const nextFrames = nextClipFrames(clips, clip);
  const trMax = Math.max(0.1, Math.min(2, seconds, nextFrames ? nextFrames / fps : seconds));
  const tr = clip.transitionOut ?? null;
  const next: ClipTransition = {
    type: v,
    duration: within(tr?.duration ?? 0.5, trMax),
    name: TRANSITIONS.find((t) => t.value === v)?.label,
    resource: v === "blink" ? (tr?.type === "blink" ? tr.resource : projectBlink(clips)) : null,
  };
  updateClip(clipId, { transitionOut: next });
}

interface Option {
  value: string;
  label: string;
}

const Row: React.FC<{
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div className="flex flex-row gap-x-2 items-center">
    <h4 className="text-brand-light text-[12px] text-start w-[112px] shrink-0">
      {label}
    </h4>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className="w-full min-w-0 !h-7.5 text-[11px] bg-brand rounded-[6px] text-brand-light"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-brand-background text-brand-light font-poppins z-[101] dark">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[11px] font-medium">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

const Section: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({
  title,
  note,
  children,
}) => (
  <div className="flex flex-col gap-y-3 min-w-0 px-3 py-3.5 border-b border-brand-light/5">
    <h4 className="text-brand-lighter text-[12.5px] font-semibold text-start mb-1">{title}</h4>
    {children}
    {note && <p className="text-brand-light/50 text-[10px] text-start">{note}</p>}
  </div>
);

const AnimationProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as
    | TextClipProps
    | VideoClipProps
    | ImageClipProps
    | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const fps = useControlsStore((s) => s.fps) || 30;
  const nextFrames = useClipStore((s) => nextClipFrames(s.clips, clip));
  const blinkResource = useClipStore((s) => projectBlink(s.clips));
  if (!clip) return null;
  const seconds = Math.max(0.1, (clip.endFrame - clip.startFrame) / fps);

  if (clip.type === "text") {
    const anim = clip.animationIn ?? null;
    const value = !anim ? NONE : anim.type || KEEP;
    const options: Option[] = [{ value: NONE, label: "None" }, ...IN_ANIMATIONS];
    if (value === KEEP) options.push({ value: KEEP, label: `${anim?.name || "CapCut's"} (CapCut)` });
    // The engine ends an animation longer than its clip (trimmed shorter) with the clip.
    const inMax = inMaxFor(clip, fps);
    const setIn = (v: string) => applyInAnimation(clipId, v);
    // A draft's style the engine doesn't draw comes as "" (a select can't have that value).
    const style = clip.captionStyle ?? NONE;
    const caption = CAPTION_STYLES.some((c) => c.value === style) ? style : KEEP;
    const captionOptions: Option[] = [...CAPTION_STYLES];
    if (caption === KEEP) captionOptions.push({ value: KEEP, label: "CapCut's style" });
    return (
      <>
        <Section
          title="In"
          note={value === KEEP ? "The engine doesn't draw this CapCut animation yet; CapCut's export has it." : undefined}
        >
          <Row label="Animation" value={value} options={options} onChange={setIn} />
          {anim && value !== KEEP && (
            <PropertiesSlider
              label="Duration"
              value={Math.min(anim.duration, seconds)}
              onChange={(d) => updateClip(clipId, { animationIn: { ...anim, duration: within(d, inMax) } })}
              min={0.1}
              max={inMax}
              step={0.1}
              suffix="s"
              toFixed={1}
            />
          )}
        </Section>
        {clip.spokenWords && (
          <Section title="Captions">
            <Row
              label="Words"
              value={caption}
              options={captionOptions}
              onChange={(v) => v !== KEEP && updateClip(clipId, { captionStyle: v })}
            />
          </Section>
        )}
      </>
    );
  }

  if (clip.type === "video" || clip.type === "image") {
    const tr = clip.transitionOut ?? null;
    const value = !tr ? NONE : tr.type || KEEP;
    const options: Option[] = [{ value: NONE, label: "None" }, ...TRANSITIONS.filter((t) => t.value !== "blink" || blinkResource || tr?.type === "blink")];
    if (value === KEEP) options.push({ value: KEEP, label: `${tr?.name || "CapCut's"} (CapCut)` });
    const trMax = Math.max(0.1, Math.min(2, seconds, nextFrames ? nextFrames / fps : seconds));
    const setTransition = (v: string) => applyTransition(clipId, v);
    return (
      <Section
        title="Transition to the next clip"
        note={
          !nextFrames
            ? "Shows when a clip starts right where this one ends, on the same track."
            : value === KEEP
              ? "The engine doesn't draw this CapCut transition yet; CapCut's export has it."
              : undefined
        }
      >
        <Row label="Transition" value={value} options={options} onChange={setTransition} />
        {tr && value !== KEEP && (
          <PropertiesSlider
            label="Duration"
            value={tr.duration}
            onChange={(d) => updateClip(clipId, { transitionOut: { ...tr, duration: within(d, trMax) } })}
            min={0.1}
            max={trMax}
            step={0.1}
            suffix="s"
            toFixed={1}
          />
        )}
      </Section>
    );
  }
  return null;
};

export default AnimationProperties;
