import React from "react";
import { toast } from "sonner";
import { TEXT_PRESETS } from "@/lib/text-presets";
import { hasLook, lookPatch } from "@/lib/text-style-presets";
import { useClipPresets } from "@/lib/clip-presets";
import { useClipStore } from "@/lib/clip";
import type { TextClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import TextLook from "@/components/menus/TextLook";

/**
 * Text ▸ Basic's preset styles (CapCut's row of looks above Transform): OpenRip's own text
 * presets as small tiles. A click gives the selected text that look (its words, box and, unless
 * the preset sets one, its size stay) in one undo step.
 */
const TextPresetStyles: React.FC<{ clip: TextClipProps }> = ({ clip }) => {
  const updateClip = useClipStore((s) => s.updateClip);
  return (
    <div data-testid="text-preset-styles" className="grid gap-1.5 py-1.5 max-h-[132px] overflow-y-auto custom-scrollbar" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))" }}>
      {TEXT_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          title={p.name}
          aria-label={`Style ${p.name}`}
          data-testid={`text-style-${p.id}`}
          aria-pressed={hasLook(clip, p)}
          onClick={() => updateClip(clip.clipId, lookPatch(p))}
          className={cn("h-[40px] rounded-[4px] bg-brand-background-light hover:bg-brand-button flex items-center justify-center overflow-hidden px-1 border", hasLook(clip, p) ? "border-brand-accent" : "border-transparent")}
        >
          <TextLook look={p.props} text={p.props.text === "Default Text" || !p.props.text ? "Text" : p.props.text} size={14} fit={48} />
        </button>
      ))}
    </div>
  );
};

/** Text ▸ Basic's "Save as preset" button (CapCut's, pinned at the foot of the inspector): keeps the text's look under Text ▸ Yours ▸ Presets. */
export const SaveTextPreset: React.FC<{ clipId: string }> = ({ clipId }) => (
  <div className="sticky bottom-0 z-10 bg-brand-background px-3 py-2 flex flex-row justify-end border-t border-brand-divider">
    <button
      type="button"
      data-testid="text-save-preset"
      onClick={() => {
        const clip = useClipStore.getState().getClipById(clipId) as TextClipProps | undefined;
        if (!clip) return;
        // The list is read from disk first: writing before it was would replace the file with this one preset.
        void useClipPresets
          .getState()
          .load()
          .then(() => {
            const saved = useClipPresets.getState().saveTextStyle(clip);
            toast.success(`Saved "${saved.name}" to Text › Yours › Presets`);
          });
      }}
      className="h-[26px] px-3 rounded-[4px] bg-brand-accent hover:bg-brand-accent-shade text-white text-[12px] font-medium"
    >
      Save as preset
    </button>
  </div>
);

export default TextPresetStyles;
