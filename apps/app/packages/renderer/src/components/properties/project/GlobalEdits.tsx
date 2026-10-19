import React from "react";
import { create } from "zustand";
import { LuPalette } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { consistentOn, consistentReference, consistentReferenceId, mainTrackClips } from "@/lib/color-tools";
import { colorsConsistentOff, makeColorsConsistent, useAnalysisStore } from "@/lib/analysis";
import { SmallCheckbox } from "../text/controls";
import PropertyRow from "../PropertyRow";
import ReferencePicker from "../adjust/ReferencePicker";
import { Analysing } from "../adjust/AutoAdjust";

/** The project inspector's tab (CapCut opens it on Project). */
// Details first, as CapCut shows an empty project (17-inspector-project/010); Project is a click away.
export const useProjectInspectorTab = create<{ tab: "project" | "details" }>(() => ({ tab: "details" }));

/**
 * The project inspector's Project tab: Global edits, as CapCut lists them, each a row with its
 * icon, name and a checkbox at the right. Make colors consistent matches every clip on the main
 * track to one reference (the clip under the playhead to begin with; changed with Reference),
 * as one step; off, it takes those matches off again. CapCut's AI suggestions aren't here.
 */
const GlobalEdits: React.FC = () => {
  const clips = useClipStore((s) => s.clips);
  const timelines = useClipStore((s) => s.timelines);
  const running = useAnalysisStore((s) => s.running);
  const on = consistentOn(clips, timelines);
  const referenceId = consistentReferenceId(clips, timelines);
  const busy = running?.kind === "consistent";
  const main = mainTrackClips(clips, timelines);
  const toggle = (next: boolean) => {
    if (!next) {
      colorsConsistentOff();
      return;
    }
    const reference = consistentReference(clips, timelines, useControlsStore.getState().focusFrame);
    if (reference) void makeColorsConsistent(reference.clipId);
  };
  return (
    <div data-testid="global-edits" className="px-3 pt-4 pb-3 min-w-0">
      <h3 className="text-[15px] font-semibold text-[#8a8a8a] text-left">Global edits</h3>
      <div data-testid="make-colors-consistent" className="mt-3 h-[40px] rounded-[6px] bg-brand-background-light/50 px-3 flex flex-row items-center gap-2.5">
        <LuPalette className="w-[15px] h-[15px] text-brand-light shrink-0" />
        <span className="flex-1 text-left text-[13px] text-brand-light truncate">Make colors consistent</span>
        <SmallCheckbox checked={on || busy} onChange={toggle} label="Make colors consistent" testId="make-colors-consistent-on" />
      </div>
      <div className="px-1 pt-1">
        {busy && <Analysing label="Matching" progress={running!.progress} />}
        {on && !busy && (
          <PropertyRow label="Reference">
            <ReferencePicker value={referenceId} onChange={(id) => void makeColorsConsistent(id)} testId="consistent-reference" />
          </PropertyRow>
        )}
        {!on && !busy && main.length < 2 && <p className="pt-2 text-[12px] text-[#8a8a8a] text-left">Needs two or more clips on the main track.</p>}
      </div>
    </div>
  );
};

export default GlobalEdits;
