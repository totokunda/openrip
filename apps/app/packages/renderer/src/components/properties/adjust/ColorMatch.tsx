import React, { useEffect, useState } from "react";
import { useClipStore } from "@/lib/clip";
import { colorMatchOf, removeColorMatch, setMatchIntensity } from "@/lib/color-tools";
import { colorMatch, useAnalysisStore, useColorMatchRequest } from "@/lib/analysis";
import { TextSection } from "../text/controls";
import PropertiesSlider from "../PropertiesSlider";
import PropertyRow from "../PropertyRow";
import ReferencePicker from "./ReferencePicker";
import { Analysing } from "./AutoAdjust";

/**
 * Adjust ▸ Basic ▸ Color match, as CapCut's section: switched on, it asks for a reference clip
 * on the timeline; choosing one grades this clip towards the reference's colours (the engine's
 * table from both clips' statistics), Intensity mixes it in, reset puts that back to 100, and
 * the box off takes it off.
 */
const ColorMatch: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const updateClip = useClipStore((s) => s.updateClip);
  const running = useAnalysisStore((s) => s.running);
  const requested = useColorMatchRequest((s) => s.clipId === clipId);
  const [picking, setPicking] = useState(false);
  // The clip menu's Adjust color ▸ Color match opens it here, asking for the reference.
  useEffect(() => {
    if (requested) {
      setPicking(true);
      useColorMatchRequest.setState({ clipId: null });
    }
  }, [requested]);
  useEffect(() => setPicking(false), [clipId]);
  if (!clip) return null;
  const match = colorMatchOf(clip);
  const busy = running?.kind === "match" && running.clipId === clipId;
  const on = !!match || picking || busy;
  const choose = (referenceId: string) => {
    setPicking(false);
    void colorMatch(clipId, referenceId, match?.intensity ?? 100);
  };
  return (
    <TextSection
      title="Color match"
      testId="color-match"
      checked={on}
      onCheckedChange={(next) => {
        if (next) setPicking(true);
        else {
          setPicking(false);
          if (match) updateClip(clipId, removeColorMatch(clip));
        }
      }}
      onReset={match && match.intensity !== 100 ? () => updateClip(clipId, setMatchIntensity(clip, 100)) : undefined}
    >
      <div className="flex flex-col gap-2 min-w-0" data-testid="color-match-body">
        <PropertyRow label="Reference">
          <ReferencePicker value={match?.ref.clipId ?? null} onChange={choose} exclude={clipId} disabled={busy} testId="color-match-reference" />
        </PropertyRow>
        {busy && <Analysing label="Matching" progress={running!.progress} />}
        {match && !busy && <PropertiesSlider label="Intensity" value={match.intensity} onChange={(v) => updateClip(clipId, setMatchIntensity(clip, v))} min={0} max={100} step={1} toFixed={0} />}
        {!match && !busy && <p className="text-[12px] text-[#8a8a8a] leading-snug">Pick the clip whose colours this one should take on.</p>}
      </div>
    </TextSection>
  );
};

export default ColorMatch;
