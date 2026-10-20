import React from "react";
import { cancelCompoundRender, useCompoundRender } from "@/lib/compound-render";

/**
 * While a compound clip is being pre-processed (rendered to the file the clean-up and audio
 * tools read), the line saying so, with its progress and Cancel, in the compound's Video tab.
 */
const CompoundRenderNote: React.FC<{ clipId: string }> = ({ clipId }) => {
  const running = useCompoundRender((s) => s.running);
  if (running?.clipId !== clipId) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[12px] text-[#949494]" data-testid="compound-render-note" data-ratio={running.ratio.toFixed(3)}>
      <span>Pre-processing compound clip… {Math.round(running.ratio * 100)}%</span>
      <button type="button" onClick={cancelCompoundRender} className="text-brand-light hover:text-white">
        Cancel
      </button>
    </div>
  );
};

export default CompoundRenderNote;
