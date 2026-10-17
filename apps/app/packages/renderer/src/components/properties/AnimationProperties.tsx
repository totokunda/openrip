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

const IN_ANIMATIONS = [
  { value: "type_1", label: "Type 1" },
  { value: "type_2", label: "Type 2" },
  { value: "typewriter", label: "Typewriter" },
];

const CAPTION_STYLES = [
  { value: "none", label: "Whole text" },
  { value: "caption_word_color", label: "Three words, spoken one highlighted" },
  { value: "caption_one_word", label: "One word at a time" },
];

const TRANSITIONS = [
  { value: "white_flash", label: "White Flash" },
  { value: "white_fade", label: "White Fade" },
  { value: "blink", label: "Blink" },
];

const NONE = "none";
/** A CapCut animation or transition the engine doesn't draw: kept as it is. */
const KEEP = "keep";

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
    <h4 className="text-brand-light text-[10.5px] text-start w-1/3 shrink-0">
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
  <div className="flex flex-col gap-y-3 min-w-0 p-4 px-5 border-b border-brand-light/5">
    <h4 className="text-brand-light text-[12px] font-medium text-start mb-1">{title}</h4>
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
  // A transition needs a clip right after this one on its track.
  const hasNext = useClipStore((s) =>
    clip
      ? s.clips.some(
          (c) =>
            c.clipId !== clip.clipId &&
            c.timelineId === clip.timelineId &&
            Math.abs(c.startFrame - clip.endFrame) <= 1,
        )
      : false,
  );
  // Blink draws CapCut's downloaded image sequence: offered when the project has one.
  const blinkResource = useClipStore((s) => {
    for (const c of s.clips) {
      const t = (c as VideoClipProps).transitionOut;
      if (t?.type === "blink" && t.resource) return t.resource;
    }
    return null;
  });
  if (!clip) return null;
  const seconds = Math.max(0.1, (clip.endFrame - clip.startFrame) / fps);

  if (clip.type === "text") {
    const anim = clip.animationIn ?? null;
    const value = !anim ? NONE : anim.type || KEEP;
    const options: Option[] = [{ value: NONE, label: "None" }, ...IN_ANIMATIONS];
    if (value === KEEP) options.push({ value: KEEP, label: `${anim?.name || "CapCut's"} (CapCut)` });
    const setIn = (v: string) => {
      if (v === KEEP) return;
      if (v === NONE) return updateClip(clipId, { animationIn: null });
      const duration = Math.min(anim?.duration ?? 0.5, seconds);
      const next: ClipAnimationIn = { type: v, duration, name: IN_ANIMATIONS.find((a) => a.value === v)?.label };
      updateClip(clipId, { animationIn: next });
    };
    const caption = clip.captionStyle ?? NONE;
    const captionOptions: Option[] = [...CAPTION_STYLES];
    if (!CAPTION_STYLES.some((c) => c.value === caption)) captionOptions.push({ value: caption, label: "CapCut's style" });
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
              value={anim.duration}
              onChange={(d) => updateClip(clipId, { animationIn: { ...anim, duration: Math.max(0.1, Math.min(d, seconds)) } })}
              min={0.1}
              max={Math.max(0.1, Math.min(5, seconds))}
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
              onChange={(v) => updateClip(clipId, { captionStyle: v })}
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
    const setTransition = (v: string) => {
      if (v === KEEP) return;
      if (v === NONE) return updateClip(clipId, { transitionOut: null });
      const next: ClipTransition = {
        type: v,
        duration: Math.min(tr?.duration ?? 0.5, seconds),
        name: TRANSITIONS.find((t) => t.value === v)?.label,
        resource: v === "blink" ? (tr?.type === "blink" ? tr.resource : blinkResource) : null,
      };
      updateClip(clipId, { transitionOut: next });
    };
    return (
      <Section
        title="Transition to the next clip"
        note={
          !hasNext
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
            onChange={(d) => updateClip(clipId, { transitionOut: { ...tr, duration: Math.max(0.1, Math.min(d, seconds)) } })}
            min={0.1}
            max={Math.max(0.1, Math.min(2, seconds))}
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
