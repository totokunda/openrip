import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TRANSITIONS, applyTransition, nextClipFrames, projectBlink } from "@/components/properties/AnimationProperties";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { useInspectorStore } from "@/lib/inspector";
import type { ImageClipProps, VideoClipProps } from "@/lib/types";
import { AssetSection, AssetTile } from "./AssetSection";

/** Two shots meeting, with the transition's light between them. */
const Preview: React.FC<{ kind: string }> = ({ kind }) => (
  <div className="relative w-[78%] h-[46%] flex rounded-[3px] overflow-hidden">
    <div className="flex-1 bg-brand-light/20" />
    <div className="flex-1 bg-brand-light/45" />
    <div
      className="absolute inset-y-0 left-1/2 -translate-x-1/2"
      style={{
        width: kind === "white_fade" ? "70%" : kind === "blink" ? "8%" : "34%",
        background:
          kind === "blink"
            ? "#000"
            : `linear-gradient(90deg, transparent, rgba(255,255,255,${kind === "white_fade" ? 0.75 : 0.95}), transparent)`,
      }}
    />
  </div>
);

/**
 * The Transitions tab: the transitions the Animation tab offers (the ones the engine draws),
 * given to the selected video or photo, into the clip after it.
 */
const TransitionMenu: React.FC = () => {
  const lastSelected = useControlsStore((s) => s.selectedClipIds[s.selectedClipIds.length - 1]);
  const clip = useClipStore((s) => s.getClipById(lastSelected)) as VideoClipProps | ImageClipProps | undefined;
  const visual = clip && (clip.type === "video" || clip.type === "image") ? clip : null;
  const followed = useClipStore((s) => (visual ? nextClipFrames(s.clips, visual) > 0 : false));
  const blink = useClipStore((s) => projectBlink(s.clips));
  const current = visual?.transitionOut?.type ?? null;
  const offered = TRANSITIONS.filter((t) => t.value !== "blink" || blink || current === "blink");

  const note = !visual
    ? "Select a video or photo on the timeline. The transition plays into the clip after it."
    : !followed
      ? "Shows when a clip starts right where this one ends, on the same track."
      : "Into the clip after the selected one. Its duration is in the Animation tab.";

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-3 pb-8">
        <AssetSection title="Transitions" note={note}>
          {offered.map((t) => (
            <AssetTile
              key={t.value}
              label={t.label}
              testId={`transition-${t.value}`}
              active={current === t.value}
              disabled={!visual}
              onClick={() => {
                if (!visual) return;
                applyTransition(visual.clipId, t.value);
                useInspectorStore.getState().setTab("animation");
              }}
            >
              <Preview kind={t.value} />
            </AssetTile>
          ))}
        </AssetSection>
      </div>
    </ScrollArea>
  );
};

export default TransitionMenu;
