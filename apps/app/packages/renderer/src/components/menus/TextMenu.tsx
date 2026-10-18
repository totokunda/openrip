import React from "react";
import { LuPlus } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TEXT_PRESETS, addPresetText, type TextPreset } from "@/lib/text-presets";
import { IN_ANIMATIONS, applyInAnimation } from "@/components/properties/AnimationProperties";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { useInspectorStore } from "@/lib/inspector";
import { AssetSection, AssetTile } from "./AssetSection";

/** How a preset looks, drawn with CSS from its own settings. */
const presetStyle = (p: TextPreset): React.CSSProperties => {
  const t = p.props;
  const stroke = t.strokeEnabled ? `${Math.max(1, (t.strokeWidth ?? 2) / 2)}px ${t.stroke ?? "#000"}` : undefined;
  return {
    fontFamily: t.fontFamily ?? "Arial",
    fontWeight: t.fontWeight ?? 400,
    fontStyle: t.fontStyle ?? "normal",
    color: t.color ?? "#ffffff",
    textTransform: t.textTransform === "uppercase" ? "uppercase" : undefined,
    WebkitTextStroke: stroke,
    paintOrder: "stroke fill",
    textShadow: t.shadowEnabled ? `2px 2px ${t.shadowBlur ?? 4}px rgba(0,0,0,0.8)` : undefined,
    background: t.backgroundEnabled ? (t.backgroundColor ?? "#000") : undefined,
    padding: t.backgroundEnabled ? "1px 6px" : undefined,
    borderRadius: t.backgroundEnabled ? 3 : undefined,
  };
};

/**
 * The Text tab: a text added at the playhead in one of the app's styles ("styles"), or the
 * In animations the Animation tab offers, given to the selected text ("animations").
 */
const TextMenu: React.FC<{ part?: "styles" | "animations" }> = ({ part = "styles" }) => {
  const lastSelected = useControlsStore((s) => s.selectedClipIds[s.selectedClipIds.length - 1]);
  const clip = useClipStore((s) => s.getClipById(lastSelected));
  const selectedText = clip?.type === "text" ? clip : null;
  const current = selectedText?.animationIn?.type ?? null;

  const styles = (
    <>
      <button
        type="button"
        data-testid="add-text"
        onClick={() => addPresetText(TEXT_PRESETS[0])}
        className="h-9 w-full rounded-[6px] bg-brand-accent-shade hover:bg-brand-accent-two-shade text-brand-lighter text-[12px] font-medium flex items-center justify-center gap-2 transition-colors"
      >
        <LuPlus className="w-4 h-4" /> Add text
      </button>
      <AssetSection title="Styles" note="Added at the playhead, on a new track at the top.">
        {TEXT_PRESETS.map((p) => (
          <AssetTile key={p.id} label={p.name} onClick={() => addPresetText(p)} testId={`text-preset-${p.id}`}>
            <span className="text-[17px] leading-none whitespace-nowrap" style={presetStyle(p)}>
              {p.props.text === "Default Text" || !p.props.text ? "Text" : p.props.text}
            </span>
          </AssetTile>
        ))}
      </AssetSection>
    </>
  );

  const animations = (
    <AssetSection
      title="Animations"
      note={selectedText ? "An In animation for the selected text. Its duration is in the Animation tab." : "Select a text on the timeline to animate it."}
    >
      {IN_ANIMATIONS.map((a) => (
        <AssetTile
          key={a.value}
          label={a.label}
          testId={`text-animation-${a.value}`}
          active={current === a.value}
          disabled={!selectedText}
          onClick={() => {
            if (!selectedText) return;
            applyInAnimation(selectedText.clipId, a.value);
            useInspectorStore.getState().setTab("animation");
          }}
        >
          <span className="text-[15px] font-medium tracking-wide text-brand-light/80">
            {a.value === "typewriter" ? "Ty|" : a.value === "type_2" ? "T y p" : "Typ"}
          </span>
        </AssetTile>
      ))}
    </AssetSection>
  );

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-3 pb-8">{part === "animations" ? animations : styles}</div>
    </ScrollArea>
  );
};

export default TextMenu;
