import React, { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useClipStore } from "@/lib/clip";
import { isNeutralColor } from "@/lib/color";
import { savePresetFrom } from "@/lib/adjustment";

/**
 * An adjustment layer's inspector (CapCut's "Adjust" tab; docs/plan/capcut-ui-spec.md §6.23): the
 * video Adjust tab's panels (Basic with LUT and the sliders, HSL, Curves, Color wheel) and the
 * Mask tab, each scrolling above a pinned footer with "Save as preset": the layer's settings go
 * to the Adjustment tab's Yours.
 */
const AdjustmentLayerProperties: React.FC<{ clipId: string; children: React.ReactNode }> = ({ clipId, children }) => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const neutral = isNeutralColor((clip as { color?: never } | undefined)?.color);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2200);
    return () => clearTimeout(t);
  }, [saved]);
  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      <ScrollArea className="flex-1 min-h-0">{children}</ScrollArea>
      <div className="shrink-0 h-[44px] px-3 flex flex-row items-center justify-end gap-3 border-t border-brand-divider bg-brand-background">
        {saved && (
          <span className="text-[12px] text-[#949494]" data-testid="adjustment-preset-saved" role="status">
            Saved to Yours
          </span>
        )}
        <button
          type="button"
          data-testid="adjustment-save-preset"
          disabled={neutral}
          title={neutral ? "Change a setting first" : "Save these settings as a preset"}
          onClick={() => setSaved(!!savePresetFrom(useClipStore.getState().getClipById(clipId)))}
          className="h-[22px] px-3 rounded-[4px] bg-brand-accent hover:bg-brand-accent-shade text-[12px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save as preset
        </button>
      </div>
    </div>
  );
};

export default AdjustmentLayerProperties;
