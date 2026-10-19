import React, { useEffect, useRef, useState } from "react";
import { IoCaretDown, IoCaretUp } from "react-icons/io5";
import { LuRotateCcw } from "react-icons/lu";
import PropertiesSlider from "./PropertiesSlider";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import type { AnyClipProps, AudioClipProps, ChannelFill, VideoClipProps } from "@/lib/types";
import { CHANNEL_FILLS, LOUDNESS_TARGET, loudnessGain, loudnessStale, setChannelFill } from "@/lib/audio";
import { clearKeyframes, editProperty, hasKeyframes, keyframeAt, localFrame, nextKeyframe, previousKeyframe, toggleKeyframe, valueAt } from "@/lib/keyframes";
import { assetOfClip, mediaSecondsOf, setNormalize, soundSeparated } from "@/lib/audio-tools";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ClipLicense } from "@/components/dialogs/AudioCredits";

/**
 * The Audio tab's Basic sub-tab, as CapCut's (docs/plan/capcut-ui-spec.md §6.19,
 * `20-inspector-audio/001`–`002`): Basic (Volume with its keyframes, Fade in, Fade out),
 * Normalize loudness, and Fill channel. On a video whose sound was detached it shows CapCut's
 * "Audio is separated" state instead, with Recover audio. Every edit goes through the clip
 * store as a patch from lib/audio.ts or lib/keyframes.ts; the engine mixes what they leave.
 */

/** CapCut's 12×12 checkbox: off #515151, on the accent with a white tick. */
export const SmallCheckbox: React.FC<{ checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }> = ({
  checked,
  onChange,
  label,
  disabled,
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      "h-3 w-3 shrink-0 rounded-[2px] flex items-center justify-center transition-colors disabled:opacity-40",
      checked ? "bg-brand-accent" : "bg-[#515151]",
    )}
  >
    {checked && (
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 4.2 L3.3 6 L6.6 2.2" />
      </svg>
    )}
  </button>
);

/**
 * A section as CapCut draws them: a 55 px header with a 12 px semibold title and a disclosure
 * caret, a checkbox before it when the section switches on and off, the reset glyph at its
 * right. Rows under an unchecked section dim but stay.
 */
export const AudioSection: React.FC<{
  title: string;
  children?: React.ReactNode;
  checked?: boolean;
  onCheckedChange?: (on: boolean) => void;
  onReset?: () => void;
  /** False for a section whose body is only a note under its title (no caret). */
  collapsible?: boolean;
  testId?: string;
}> = ({ title, children: body, checked, onCheckedChange, onReset, collapsible = true, testId }) => {
  const [open, setOpen] = useState(true);
  const switchable = checked !== undefined && !!onCheckedChange;
  // Only what folds counts for the caret.
  const children = collapsible ? body : undefined;
  return (
    <section className="px-3 min-w-0 text-left" data-testid={testId} data-section={title}>
      <div className="h-[55px] flex flex-row items-center gap-2 min-w-0">
        {switchable && <SmallCheckbox checked={!!checked} onChange={onCheckedChange!} label={`${title} on`} />}
        <button
          type="button"
          onClick={() => children && setOpen(!open)}
          aria-expanded={open}
          className={cn("flex flex-row items-center gap-1.5 min-w-0", !children && "cursor-default")}
        >
          <h4 className="text-[12px] font-semibold text-brand-light truncate">{title}</h4>
          {children && (open ? <IoCaretUp className="w-2.5 h-2.5 text-[#9a9a9a] shrink-0" /> : <IoCaretDown className="w-2.5 h-2.5 text-[#9a9a9a] shrink-0" />)}
        </button>
        {onReset && (
          <button type="button" title={`Reset ${title}`} aria-label={`Reset ${title}`} onClick={onReset} className="ml-auto text-brand-light hover:text-brand-lighter">
            <LuRotateCcw className="w-[13px] h-[13px]" />
          </button>
        )}
      </div>
      {(open || !collapsible) && body && <div className={cn("pb-4 -mt-1 flex flex-col min-w-0", switchable && !checked && "opacity-50")}>{body}</div>}
    </section>
  );
};

/**
 * CapCut's keyframe navigator (‹ ◇ ›, 30 px) for the clip's volume: ‹ and › go to the key before
 * and after the playhead, the diamond adds a key there with the volume it has (filled in the
 * accent when there's one) or takes it off.
 */
const VolumeKeyframes: React.FC<{ clip: AnyClipProps }> = ({ clip }) => {
  const updateClip = useClipStore((s) => s.updateClip);
  const fps = useControlsStore((s) => s.fps) || 30;
  // Without keys nothing here depends on the playhead, so it doesn't re-render as it moves.
  const keyed = hasKeyframes(clip.keyframes, "volume");
  const frame = useControlsStore((s) => (keyed ? s.focusFrame : -1));
  const local = localFrame(clip, frame);
  const at = !!keyframeAt(clip.keyframes, "volume", local);
  const prev = previousKeyframe(clip.keyframes, "volume", local);
  const next = nextKeyframe(clip.keyframes, "volume", local);
  const seek = (f: number) => useControlsStore.getState().setFocusFrame((clip.startFrame ?? 0) + f);
  const arrow = (to: number | undefined, label: string, d: string) => (
    <button
      type="button"
      aria-label={label}
      disabled={to === undefined}
      onClick={() => to !== undefined && seek(to)}
      className="h-[22px] w-[7px] flex items-center justify-center text-[#949494] hover:text-brand-lighter disabled:text-[#565656] disabled:cursor-default"
    >
      <svg width="5" height="9" viewBox="0 0 5 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
  return (
    <div className="w-[30px] h-[22px] shrink-0 flex items-center justify-between" data-keyframe="volume" data-at={at}>
      {arrow(prev?.frame, "Previous keyframe", "M4 1 L1 4.5 L4 8")}
      <button
        type="button"
        title={at ? "Remove keyframe" : "Add keyframe"}
        aria-pressed={at}
        onClick={() => updateClip(clip.clipId, toggleKeyframe(clip, "volume", useControlsStore.getState().focusFrame, fps))}
        className={cn("h-[22px] w-[12px] flex items-center justify-center", at ? "text-brand-accent" : "text-[#8a8a8a] hover:text-brand-lighter")}
      >
        <svg width="11" height="11" viewBox="0 0 11 11">
          <rect x="2.2" y="2.2" width="6.6" height="6.6" rx="0.8" transform="rotate(45 5.5 5.5)" fill={at ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      {arrow(next?.frame, "Next keyframe", "M1 1 L4 4.5 L1 8")}
    </div>
  );
};

/** CapCut's dropdown: 22 px, the raised fill, the value left and a chevron right. */
const FillSelect: React.FC<{ value: ChannelFill; onChange: (v: ChannelFill) => void; disabled: boolean }> = ({ value, onChange, disabled }) => (
  <Select value={value} onValueChange={(v) => onChange(v as ChannelFill)} disabled={disabled}>
    <SelectTrigger
      size="sm"
      data-testid="fill-channel"
      className="w-full min-w-0 !h-[22px] px-2 text-[12px] border-0 shadow-none rounded-[4px] bg-brand-background-light text-brand-light disabled:bg-[#2c2c2c] disabled:text-[#626262] disabled:opacity-100"
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="dark p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light z-[101]">
      {CHANNEL_FILLS.map((f) => (
        <SelectItem key={f.id} value={f.id} className="h-8 text-[13px] rounded-[4px] focus:bg-brand-hover">
          {f.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/** CapCut's "Audio is separated": the video's sound is on its own audio clip. Recover audio gives the video its sound back. */
const SoundSeparated: React.FC<{ clip: VideoClipProps }> = ({ clip }) => {
  const recover = () => {
    const s = useClipStore.getState();
    const asset = assetOfClip(clip);
    if (!asset) return;
    // The video's file whole again, as an asset of its own (the audio clip keeps its half).
    const whole = s.addAsset({ ...asset, id: undefined, path: asset.path.replace(/#video$/, "") });
    s.updateClip(clip.clipId, { assetId: whole.id } as Partial<AnyClipProps>);
  };
  return (
    <div data-testid="audio-separated" className="flex flex-col items-center justify-center text-center px-8 pt-24 pb-10 gap-2">
      <svg width="70" height="30" viewBox="0 0 70 30" fill="none" stroke="#8a8a8a" strokeWidth="1.5">
        <rect x="1" y="1" width="58" height="13" rx="2.5" />
        <path d="M1 14 v6 h14" strokeDasharray="2 2" />
        <rect x="16" y="17" width="53" height="11" rx="2.5" />
      </svg>
      <h3 className="mt-4 text-[16px] font-semibold text-white">Audio is separated</h3>
      <p className="text-[12px] leading-snug text-[#6c6c6c] max-w-[270px]">Only this clip's own sound comes back. The audio clip that was separated stays as it is.</p>
      <button
        type="button"
        onClick={recover}
        className="mt-3 w-[120px] h-[26px] rounded-[4px] bg-brand-accent text-[12px] font-semibold text-brand-lighter hover:brightness-110"
      >
        Recover audio
      </button>
    </div>
  );
};

interface AudioPropertiesProps {
  clipId: string;
}

const AudioProperties: React.FC<AudioPropertiesProps> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as AudioClipProps | VideoClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const fps = useControlsStore((s) => s.fps) || 30;
  // Only a clip whose volume has keys follows the playhead (the value shown is the keys' there).
  const keyed = !!clip && hasKeyframes(clip.keyframes, "volume");
  const frame = useControlsStore((s) => (keyed ? s.focusFrame : (clip?.startFrame ?? 0)));
  const [measuring, setMeasuring] = useState(false);
  const remeasured = useRef<string | null>(null);

  const isSeparated = soundSeparated(clip);
  const loudness = clip?.loudness ?? null;
  const stale = !!clip && loudnessStale(clip, fps, mediaSecondsOf(clip));

  const normalize = async (on: boolean) => {
    setMeasuring(on);
    try {
      await setNormalize(clipId, on);
    } finally {
      setMeasuring(false);
    }
  };

  // A trim moved the range normalising measured: measure the new one (once per range).
  useEffect(() => {
    if (!clip || !stale || measuring) return;
    const key = `${clip.trimStart}:${clip.startFrame}:${clip.endFrame}:${(clip as VideoClipProps).speed ?? 1}`;
    if (remeasured.current === key) return;
    remeasured.current = key;
    void normalize(true);
  }, [stale, clip?.trimStart, clip?.startFrame, clip?.endFrame]);

  if (!clip) return null;
  if (isSeparated) return <SoundSeparated clip={clip as VideoClipProps} />;

  const volume = Number(valueAt(clip, "volume", frame, fps) ?? 0);
  const length = Math.max(0.1, ((clip.endFrame ?? 0) - (clip.startFrame ?? 0)) / fps);
  const setVolume = (v: number) => {
    const now = useClipStore.getState().getClipById(clipId);
    if (now) updateClip(clipId, editProperty(now, "volume", useControlsStore.getState().focusFrame, v));
  };
  const resetBasic = () => {
    const now = useClipStore.getState().getClipById(clipId);
    if (!now) return;
    updateClip(clipId, { volume: 0, fadeIn: 0, fadeOut: 0, ...(hasKeyframes(now.keyframes, "volume") ? { keyframes: clearKeyframes(now.keyframes, "volume") } : {}) } as Partial<AnyClipProps>);
  };
  const channel = clip.channel ?? "none";
  const gain = loudnessGain(clip);

  return (
    <div data-testid="audio-basic" className="min-w-0 divide-y divide-brand-divider">
      <AudioSection title="Basic" onReset={resetBasic} testId="audio-section-basic">
        <div className="flex flex-col gap-y-[9px]">
          <div className="flex flex-row items-end gap-[5px] min-w-0" data-property="volume">
            <div className="flex-1 min-w-0">
              <PropertiesSlider label="Volume" value={volume} onChange={setVolume} suffix="dB" min={-60} max={20} step={0.1} toFixed={1} />
            </div>
            <VolumeKeyframes clip={clip} />
          </div>
          {/* Fades have no keys: a navigator's width left empty keeps their fields under Volume's. */}
          <div data-property="fadeIn" className="pr-[35px] min-w-0">
            <PropertiesSlider
              label="Fade in"
              value={Math.min(clip.fadeIn ?? 0, length)}
              onChange={(v) => updateClip(clipId, { fadeIn: Math.max(0, Math.min(length, v)) })}
              suffix="s"
              min={0}
              max={length}
              step={0.1}
            />
          </div>
          <div data-property="fadeOut" className="pr-[35px] min-w-0">
            <PropertiesSlider
              label="Fade out"
              value={Math.min(clip.fadeOut ?? 0, length)}
              onChange={(v) => updateClip(clipId, { fadeOut: Math.max(0, Math.min(length, v)) })}
              suffix="s"
              min={0}
              max={length}
              step={0.1}
            />
          </div>
        </div>
      </AudioSection>
      <AudioSection
        title="Normalize loudness"
        checked={!!loudness?.enabled}
        onCheckedChange={(on) => void normalize(on)}
        collapsible={false}
        testId="audio-section-loudness"
      >
        <p className="text-[12px] leading-snug text-[#949494]">Normalize the loudness of the selected clip to a target level.</p>
        {loudness?.enabled && (
          <p data-testid="loudness-state" className="mt-2 text-[12px] tabular-nums text-brand-light">
            {measuring
              ? "Measuring…"
              : loudness.measured == null
                ? "Nothing to measure: the clip is silent here."
                : `${LOUDNESS_TARGET} LUFS target · measured ${loudness.measured.toFixed(1)} LUFS · ${gain >= 0 ? "+" : "−"}${Math.abs(gain).toFixed(1)} dB`}
          </p>
        )}
      </AudioSection>
      <AudioSection
        title="Fill channel"
        checked={channel !== "none"}
        onCheckedChange={(on) => updateClip(clipId, setChannelFill(clip, on ? "left" : "none"))}
        onReset={() => updateClip(clipId, setChannelFill(clip, "none"))}
        testId="audio-section-channel"
      >
        <FillSelect value={channel} disabled={channel === "none"} onChange={(v) => updateClip(clipId, setChannelFill(clip, v))} />
      </AudioSection>
      {/* A library track (Music, Sound effects) keeps its licence, author and source. */}
      {assetOfClip(clip)?.credit && (
        <AudioSection title="License" collapsible={false} testId="audio-section-license">
          <ClipLicense credit={assetOfClip(clip)!.credit!} />
        </AudioSection>
      )}
    </div>
  );
};

export default AudioProperties;
