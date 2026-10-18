import React from "react";
import { useClipStore } from "@/lib/clip";
import { ADJUST_SLIDERS, colorOf, setAdjust } from "@/lib/color";
import { AUTO_SLIDERS, autoAdjustOf, setAutoIntensity } from "@/lib/color-tools";
import { autoAdjust, autoAdjustOff, useAnalysisStore } from "@/lib/analysis";
import { TextSection } from "../text/controls";
import PropertiesSlider from "../PropertiesSlider";

/** The section's progress line while the engine reads the clip. */
export const Analysing: React.FC<{ label: string; progress: number }> = ({ label, progress }) => (
  <div data-testid="analysing" className="h-[38px] flex flex-row items-center gap-2 text-[12px] text-brand-light">
    <div className="flex-1 h-[3px] rounded-full bg-brand overflow-hidden">
      <div className="h-full bg-brand-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
    </div>
    <span className="tabular-nums text-[#9a9a9a]">
      {label} {Math.round(progress * 100)}%
    </span>
  </div>
);

/**
 * Adjust ▸ Basic ▸ Auto adjust, as CapCut's section: its checkbox reads the clip and sets the
 * Basic sliders from its own statistics (lib/analysis.ts), Intensity scales what it set, reset
 * puts that back to 100, and the box off takes it all off again (the user's own changes stay).
 * The sliders it set are listed under it, each as the Basic ▸ Adjust panel edits it.
 */
const AutoAdjust: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const updateClip = useClipStore((s) => s.updateClip);
  const running = useAnalysisStore((s) => s.running);
  if (!clip) return null;
  const auto = autoAdjustOf(clip);
  const busy = running?.kind === "auto" && running.clipId === clipId;
  const adjust = colorOf(clip).adjust ?? {};
  const touched = AUTO_SLIDERS.filter((k) => auto?.values[k]);
  return (
    <TextSection
      title="Auto adjust"
      testId="auto-adjust"
      checked={!!auto || busy}
      onCheckedChange={(on) => (on ? void autoAdjust(clipId) : autoAdjustOff(clipId))}
      onReset={auto && auto.intensity !== 100 ? () => updateClip(clipId, setAutoIntensity(clip, 100)) : undefined}
    >
      {busy ? (
        <Analysing label="Analysing" progress={running!.progress} />
      ) : auto ? (
        <div className="flex flex-col gap-2 min-w-0" data-testid="auto-adjust-body">
          <PropertiesSlider label="Intensity" value={auto.intensity} onChange={(v) => updateClip(clipId, setAutoIntensity(clip, v))} min={0} max={100} step={1} toFixed={0} />
          {touched.length > 0 ? (
            touched.map((key) => {
              const info = ADJUST_SLIDERS.find((s) => s.key === key)!;
              return (
                <div key={key} data-testid={`auto-${key}`}>
                  <PropertiesSlider label={info.name} value={adjust[key] ?? 0} onChange={(v) => updateClip(clipId, setAdjust(clip, key, Math.round(v)))} min={info.min} max={info.max} step={1} toFixed={0} />
                </div>
              );
            })
          ) : (
            <p className="text-[12px] text-[#8a8a8a]">The clip already looks balanced: nothing to change.</p>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-[#8a8a8a] leading-snug">Sets exposure, contrast, white balance and saturation from the clip's own colours.</p>
      )}
    </TextSection>
  );
};

export default AutoAdjust;
