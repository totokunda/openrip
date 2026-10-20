import React from "react";
import { LuPaintbrush } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useInspectorStore } from "@/lib/inspector";
import type { GroupClipProps, TextClipProps } from "@/lib/types";

/**
 * The inspector of a text template (the Text tab's templates): its words as fields, one for each
 * text in the template. CapCut's template is one clip with fields to fill in; ours is one bar
 * holding ordinary text and shape clips, so each field's "Style" button selects its text for the
 * whole Text tab (font, colour, animation). (It's a container clip, not a Group: lib/bundle.ts.)
 */
const TemplateProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const group = useClipStore((s) => s.getClipById(clipId)) as GroupClipProps | undefined;
  const clips = useClipStore((s) => s.clips);
  const updateClip = useClipStore((s) => s.updateClip);
  if (!group || group.type !== "group") return null;
  // The template's first layer first (the group lists its children from the top).
  const ids = (group.children ?? []).flat().reverse();
  const texts = ids.map((id) => clips.find((c) => c.clipId === id)).filter((c): c is TextClipProps => c?.type === "text");
  return (
    <div className="flex flex-col gap-3 px-3 py-3 min-w-0" data-testid="template-fields">
      <p className="text-[12px] leading-snug text-[#949494]">
        {group.template?.name ? `${group.template.name}: ` : ""}change the words here, and style each text from its brush.
      </p>
      {texts.map((t, n) => (
        <div key={t.clipId} className="flex flex-col gap-1.5" data-testid="template-field">
          <div className="flex items-center justify-between">
            <label className="text-[12px] text-brand-light" htmlFor={`template-field-${t.clipId}`}>
              {t.templateField ?? (texts.length > 1 ? `Text ${n + 1}` : "Text")}
            </label>
            <button
              type="button"
              title="Style this text"
              aria-label="Style this text"
              data-testid="template-field-style"
              onClick={() => {
                useControlsStore.getState().setSelectedClipIds([t.clipId]);
                useInspectorStore.getState().setTab("text", "basic");
              }}
              className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[#949494] hover:text-brand-lighter hover:bg-brand-light/[0.08]"
            >
              <LuPaintbrush className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            id={`template-field-${t.clipId}`}
            data-testid="template-field-input"
            className="w-full h-12 resize-none rounded-[4px] bg-brand px-3 py-2 text-[12px] leading-[1.4] text-brand-lighter outline-none focus:ring-1 focus:ring-[#515151] custom-scrollbar"
            value={t.text ?? ""}
            onChange={(e) => updateClip(t.clipId, { text: e.target.value })}
          />
        </div>
      ))}
      {texts.length === 0 && <p className="text-[12px] text-[#6c6c6c]">This template has no text.</p>}
    </div>
  );
};

export default TemplateProperties;
