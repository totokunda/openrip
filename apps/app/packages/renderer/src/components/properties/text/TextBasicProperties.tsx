import React from "react";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { clearKeyframes, editProperty, valueAt } from "@/lib/keyframes";
import { useInspectorStore } from "@/lib/inspector";
import type { KeyframeProperty, TextClipProps, TextGradient } from "@/lib/types";
import PropertyRow from "../PropertyRow";
import PropertiesSlider from "../PropertiesSlider";
import KeyframeButton from "../KeyframeButton";
import ColorWell from "./ColorWell";
import FontPicker from "./FontPicker";
import { NumberField, Segments, TextSection, ToggleButton } from "./controls";

/**
 * Text ▸ Basic in CapCut's order and grouping (docs/plan/capcut-ui-spec.md §4.8a): the text
 * box pinned at the top; Font, Font size, Pattern (B U I), Case, Color, Character and Line
 * spacing, Alignment; the clip's Transform and Blend (`transform`, shared with other clips);
 * then the sections that switch on and off: Stroke, Background, Glow, Shadow, and a gradient
 * fill. Keyframeable properties are edited as CapCut edits them (`editProperty`: the key at
 * the playhead while the property has keys), show their value at the playhead and have
 * CapCut's keyframe navigator (‹ ◇ ›) at their row's end.
 */

/** A text property at the playhead, and its edit (see `editProperty`). */
const useKeyed = (clip: TextClipProps | undefined, property: KeyframeProperty) => {
  const frame = useControlsStore((s) => s.focusFrame);
  const fps = useControlsStore((s) => s.fps);
  const updateClip = useClipStore((s) => s.updateClip);
  const value = clip ? valueAt(clip, property, frame, fps || 24) : undefined;
  const set = (v: number | string) => {
    const now = clip && (useClipStore.getState().getClipById(clip.clipId) as TextClipProps | undefined);
    if (now) updateClip(now.clipId, editProperty(now, property, useControlsStore.getState().focusFrame, v));
  };
  return { value, set };
};

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" && v ? v : fallback);

/** The words in a letter case, as the case buttons rewrite them (the importer reads it so). */
export const applyTextTransform = (text: string, textTransform: string) => {
  if (textTransform === "uppercase") return text.toUpperCase();
  if (textTransform === "lowercase") return text.toLowerCase();
  if (textTransform === "capitalize") return text.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return text;
};

/** CapCut's alignment glyphs: lines left, centred, right; the block at the top, middle, bottom. */
const AlignGlyph: React.FC<{ kind: string }> = ({ kind }) => {
  if (kind === "left" || kind === "center" || kind === "right") {
    return (
      <svg viewBox="0 0 12 10" className="w-3 h-2.5" aria-hidden>
        {[1, 5, 9].map((y, i) => {
          const w = i === 1 ? 7 : 11;
          const x = kind === "left" ? 0.5 : kind === "right" ? 11.5 - w : (12 - w) / 2;
          return <rect key={y} x={x} y={y - 0.6} width={w} height={1.2} rx={0.6} fill="currentColor" />;
        })}
      </svg>
    );
  }
  // Vertical: three bars, the block pushed to the top, the middle or the bottom.
  const y = kind === "top" ? 0.5 : kind === "bottom" ? 3.5 : 2;
  return (
    <svg viewBox="0 0 12 12" className="w-3 h-3" aria-hidden>
      <rect x={0.5} y={0} width={11} height={1} rx={0.5} fill="currentColor" opacity={kind === "top" ? 1 : 0} />
      <rect x={0.5} y={11} width={11} height={1} rx={0.5} fill="currentColor" opacity={kind === "bottom" ? 1 : 0} />
      {[2.5, 6, 9.5].map((x) => (
        <rect key={x} x={x - 0.6} y={y + (kind === "top" ? 1.5 : kind === "bottom" ? -1.5 : 0)} width={1.2} height={8} rx={0.6} fill="currentColor" />
      ))}
    </svg>
  );
};

/** The gradient a fill starts as: the text's colour into a blue, left to right across the text. */
const defaultGradient = (color: string): TextGradient => ({ colors: [color || "#ffffff", "#2f80ed"], angle: 0, span: "text" });

const TextBasicProperties: React.FC<{ clipId: string; transform?: React.ReactNode }> = ({ clipId, transform }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as TextClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const color = useKeyed(clip, "color");
  const fontSize = useKeyed(clip, "fontSize");
  const stroke = useKeyed(clip, "stroke");
  const strokeWidth = useKeyed(clip, "strokeWidth");
  const bgColor = useKeyed(clip, "backgroundColor");
  const bgOpacity = useKeyed(clip, "backgroundOpacity");
  const glowColor = useKeyed(clip, "glowColor");
  const glowIntensity = useKeyed(clip, "glowIntensity");
  const glowRange = useKeyed(clip, "glowRange");
  const shadowColor = useKeyed(clip, "shadowColor");
  const shadowOpacity = useKeyed(clip, "shadowOpacity");
  const shadowBlur = useKeyed(clip, "shadowBlur");
  if (!clip) return null;

  const set = (patch: Partial<TextClipProps>) => updateClip(clipId, patch);
  /** Fields back to their defaults, and the keys of the keyframeable ones off. */
  const reset = (patch: Partial<TextClipProps>, keyed: KeyframeProperty[]) => {
    const keyframes = keyed.reduce((k, p) => clearKeyframes(k, p), clip.keyframes);
    set({ ...patch, keyframes });
  };

  const bold = (clip.fontWeight ?? 400) >= 700;
  const italic = (clip.fontStyle ?? "normal") === "italic";
  const underline = (clip.textDecoration ?? "none") === "underline";
  const textCase = (clip.textTransform ?? "none") === "none" ? "" : (clip.textTransform as "uppercase" | "lowercase" | "capitalize");
  // The shadow's offset as CapCut shows it: a distance and an angle (counter-clockwise from
  // the right, so CapCut's −45° is down and to the right).
  const [sx, sy] = [num(clip.shadowOffsetX, 2), num(clip.shadowOffsetY, 2)];
  const distance = Math.hypot(sx, sy);
  const angle = distance > 0 ? (Math.atan2(-sy, sx) * 180) / Math.PI : -45;
  const setShadow = (d: number, a: number) => {
    const r = (a * Math.PI) / 180;
    set({ shadowOffsetX: +(d * Math.cos(r)).toFixed(3), shadowOffsetY: +(-d * Math.sin(r)).toFixed(3), shadowOffsetLocked: false });
  };
  const gradient = clip.fillGradient ?? null;
  const setGradient = (patch: Partial<TextGradient>) => set({ fillGradient: { ...(gradient ?? defaultGradient(clip.color ?? "#ffffff")), ...patch } });
  const style = clip.textEffect;

  return (
    <div className="flex flex-col min-w-0" data-testid="text-basic">
      {/* The words, pinned while the rows scroll under them. */}
      <div className="sticky top-0 z-10 bg-brand-background px-3 pt-3 pb-1">
        <textarea
          data-testid="text-box"
          aria-label="Text"
          className="w-full h-16 resize-none rounded-[4px] bg-brand px-3 py-2 text-[12px] leading-[1.4] text-brand-lighter outline-none focus:ring-1 focus:ring-[#515151] custom-scrollbar"
          value={clip.text ?? ""}
          onChange={(e) => set({ text: e.target.value })}
        />
      </div>
      <div className="px-3 pb-2 flex flex-col min-w-0">
        <PropertyRow label="Font">
          <FontPicker value={clip.fontFamily ?? "Arial"} onChange={(fontFamily) => set({ fontFamily })} />
        </PropertyRow>
        <div className="py-1.5" data-testid="text-font-size">
          <PropertiesSlider label="Font size" value={num(fontSize.value, 32)} onChange={(v) => fontSize.set(Math.max(1, v))} min={1} max={300} step={1} toFixed={0} end={<KeyframeButton clipId={clipId} properties={["fontSize"]} />} />
        </div>
        <PropertyRow label="Pattern">
          <div className="flex flex-row gap-3">
            <ToggleButton testId="text-bold" title="Bold" on={bold} onClick={() => set({ fontWeight: bold ? 400 : 700 })}>
              <span className="text-[13px] font-bold">B</span>
            </ToggleButton>
            <ToggleButton testId="text-underline" title="Underline" on={underline} onClick={() => set({ textDecoration: underline ? "none" : "underline" })}>
              <span className="text-[13px] underline underline-offset-2">U</span>
            </ToggleButton>
            <ToggleButton testId="text-italic" title="Italic" on={italic} onClick={() => set({ fontStyle: italic ? "normal" : "italic" })}>
              <span className="text-[13px] italic font-serif">I</span>
            </ToggleButton>
          </div>
        </PropertyRow>
        <PropertyRow label="Case">
          <Segments
            testId="text-case"
            toggle
            value={textCase}
            options={[
              { value: "uppercase", label: "TT", title: "Uppercase" },
              { value: "lowercase", label: "tt", title: "Lowercase" },
              { value: "capitalize", label: "Tt", title: "Capitalize each word" },
            ]}
            onChange={(v) => {
              const textTransform = v || "none";
              set({ textTransform, text: applyTextTransform(clip.text ?? "", textTransform) });
            }}
          />
        </PropertyRow>
        <PropertyRow label="Color" clipId={clipId} keyframes="color">
          <ColorWell testId="text-color" label="Color" value={str(color.value, "#ffffff")} onChange={(c) => color.set(c)} />
        </PropertyRow>
        {style && (
          <p data-testid="text-style-note" className="-mt-1 mb-1 text-[12px] leading-snug text-[#949494]">
            {style.id ? `The ${style.name ?? "Effects"} style` : `The draft's style${style.name ? ` “${style.name}”` : ""}`} draws this text's fill and outline.{" "}
            <button type="button" className="text-brand-accent hover:underline" onClick={() => useInspectorStore.getState().setSub("text", "effects")}>
              Effects
            </button>
          </p>
        )}
        {/* CapCut's spacing fields, steps of 1/20 of the font size. */}
        <div className="min-h-[38px] flex flex-row items-center min-w-0">
          <label className="w-[68px] shrink-0 text-start text-[12px] text-brand-light">Character</label>
          <NumberField testId="text-letter-spacing" label="Character spacing" value={num(clip.letterSpacing, 0)} min={-10} max={100} onChange={(letterSpacing) => set({ letterSpacing })} />
          <label className="w-[42px] ml-[22px] shrink-0 text-start text-[12px] text-brand-light">Line</label>
          <NumberField testId="text-line-spacing" label="Line spacing" value={num(clip.lineSpacing, 0)} min={-10} max={100} onChange={(lineSpacing) => set({ lineSpacing })} />
        </div>
        <PropertyRow label="Alignment">
          <div data-testid="text-align" className="h-[22px] flex flex-row items-center rounded-[4px] bg-brand-background-light">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                type="button"
                title={`Align ${a}`}
                aria-label={`Align ${a}`}
                aria-pressed={(clip.textAlign ?? "center") === a}
                onClick={() => set({ textAlign: a })}
                className={`w-[34px] h-[22px] rounded-[4px] flex items-center justify-center ${(clip.textAlign ?? "center") === a ? "bg-brand-button text-brand-lighter" : "text-brand-light hover:text-brand-lighter"}`}
              >
                <AlignGlyph kind={a} />
              </button>
            ))}
            {(["top", "middle", "bottom"] as const).map((a) => (
              <button
                key={a}
                type="button"
                title={`Align to the ${a}`}
                aria-label={`Align to the ${a}`}
                aria-pressed={(clip.verticalAlign ?? "middle") === a}
                onClick={() => set({ verticalAlign: a })}
                className={`w-[34px] h-[22px] rounded-[4px] flex items-center justify-center ${(clip.verticalAlign ?? "middle") === a ? "bg-brand-button text-brand-lighter" : "text-brand-light hover:text-brand-lighter"}`}
              >
                <AlignGlyph kind={a} />
              </button>
            ))}
          </div>
        </PropertyRow>
      </div>
      <div className="min-w-0 divide-y divide-brand-divider border-t border-brand-divider">
        {transform}
        <TextSection
          title="Stroke"
          testId="text-stroke"
          checked={!!clip.strokeEnabled}
          onCheckedChange={(on) => set({ strokeEnabled: on })}
          onReset={() => reset({ stroke: "#000000", strokeWidth: 2 }, ["stroke", "strokeWidth"])}
        >
          <PropertyRow label="Color" clipId={clipId} keyframes="stroke">
            <ColorWell testId="text-stroke-color" label="Stroke color" value={str(stroke.value, "#000000")} onChange={(c) => stroke.set(c)} />
          </PropertyRow>
          <PropertiesSlider label="Thickness" value={num(strokeWidth.value, 2)} onChange={(v) => strokeWidth.set(v)} min={0} max={30} step={0.5} toFixed={1} end={<KeyframeButton clipId={clipId} properties={["strokeWidth"]} />} />
        </TextSection>
        <TextSection
          title="Background"
          testId="text-background"
          checked={!!clip.backgroundEnabled}
          onCheckedChange={(on) => set({ backgroundEnabled: on })}
          onReset={() => reset({ backgroundColor: "#000000", backgroundOpacity: 100, backgroundCornerRadius: 0 }, ["backgroundColor", "backgroundOpacity"])}
        >
          <PropertyRow label="Color" clipId={clipId} keyframes="backgroundColor">
            <ColorWell testId="text-background-color" label="Background color" value={str(bgColor.value, "#000000")} onChange={(c) => bgColor.set(c)} />
          </PropertyRow>
          <div className="flex flex-col gap-2">
            <PropertiesSlider label="Opacity" value={num(bgOpacity.value, 100)} onChange={(v) => bgOpacity.set(v)} min={0} max={100} step={1} toFixed={0} suffix="%" end={<KeyframeButton clipId={clipId} properties={["backgroundOpacity"]} />} />
            <PropertiesSlider label="Rounded rectangle" value={num(clip.backgroundCornerRadius, 0)} onChange={(backgroundCornerRadius) => set({ backgroundCornerRadius })} min={0} max={50} step={1} toFixed={0} />
          </div>
        </TextSection>
        <TextSection
          title="Glow"
          testId="text-glow"
          checked={!!clip.glowEnabled}
          onCheckedChange={(on) => set({ glowEnabled: on })}
          onReset={() => reset({ glowColor: null, glowIntensity: 30, glowRange: 20, glowOffsetX: 0, glowOffsetY: 0 }, ["glowColor", "glowIntensity", "glowRange"])}
        >
          <PropertyRow label="Color" clipId={clipId} keyframes="glowColor">
            <ColorWell testId="text-glow-color" label="Glow color" value={str(glowColor.value, clip.color ?? "#ffffff")} onChange={(c) => glowColor.set(c)} />
          </PropertyRow>
          <div className="flex flex-col gap-2">
            <PropertiesSlider label="Intensity" value={num(glowIntensity.value, 30)} onChange={(v) => glowIntensity.set(v)} min={0} max={100} step={1} toFixed={0} end={<KeyframeButton clipId={clipId} properties={["glowIntensity"]} />} />
            <PropertiesSlider label="Range" value={num(glowRange.value, 20)} onChange={(v) => glowRange.set(v)} min={0} max={100} step={1} toFixed={0} end={<KeyframeButton clipId={clipId} properties={["glowRange"]} />} />
            <PropertiesSlider label="Y-offset" value={num(clip.glowOffsetY, 0)} onChange={(glowOffsetY) => set({ glowOffsetY })} min={-100} max={100} step={1} toFixed={0} />
            <PropertiesSlider label="X-offset" value={num(clip.glowOffsetX, 0)} onChange={(glowOffsetX) => set({ glowOffsetX })} min={-100} max={100} step={1} toFixed={0} />
          </div>
        </TextSection>
        <TextSection
          title="Shadow"
          testId="text-shadow"
          checked={!!clip.shadowEnabled}
          onCheckedChange={(on) => set({ shadowEnabled: on })}
          onReset={() => reset({ shadowColor: "#000000", shadowOpacity: 75, shadowBlur: 4, shadowOffsetX: 2, shadowOffsetY: 2 }, ["shadowColor", "shadowOpacity", "shadowBlur"])}
        >
          <PropertyRow label="Color" clipId={clipId} keyframes="shadowColor">
            <ColorWell testId="text-shadow-color" label="Shadow color" value={str(shadowColor.value, "#000000")} onChange={(c) => shadowColor.set(c)} />
          </PropertyRow>
          <div className="flex flex-col gap-2">
            <PropertiesSlider label="Opacity" value={num(shadowOpacity.value, 75)} onChange={(v) => shadowOpacity.set(v)} min={0} max={100} step={1} toFixed={0} suffix="%" end={<KeyframeButton clipId={clipId} properties={["shadowOpacity"]} />} />
            <PropertiesSlider label="Bluriness" value={num(shadowBlur.value, 4)} onChange={(v) => shadowBlur.set(v)} min={0} max={50} step={1} toFixed={0} end={<KeyframeButton clipId={clipId} properties={["shadowBlur"]} />} />
            <PropertiesSlider label="Distance" value={distance} onChange={(d) => setShadow(Math.max(0, d), angle)} min={0} max={50} step={0.5} toFixed={1} />
            <PropertiesSlider label="Angle" value={angle} onChange={(a) => setShadow(distance || 2, a)} min={-180} max={180} step={1} toFixed={0} suffix="°" />
          </div>
        </TextSection>
        <TextSection
          title="Gradient fill"
          testId="text-gradient"
          checked={!!gradient}
          onCheckedChange={(on) => set({ fillGradient: on ? defaultGradient(clip.color ?? "#ffffff") : null })}
          onReset={() => set({ fillGradient: defaultGradient(clip.color ?? "#ffffff") })}
        >
          <PropertyRow label="Colors">
            <div className="flex flex-row items-center gap-2">
              {(gradient ?? defaultGradient(clip.color ?? "#ffffff")).colors.slice(0, 2).map((c, i) => (
                <ColorWell
                  key={i}
                  testId={`text-gradient-color-${i}`}
                  label={i === 0 ? "Gradient start" : "Gradient end"}
                  value={c.slice(0, 7)}
                  onChange={(next) => {
                    const colors = [...(gradient ?? defaultGradient(clip.color ?? "#ffffff")).colors];
                    colors[i] = next;
                    setGradient({ colors });
                  }}
                />
              ))}
            </div>
          </PropertyRow>
          <PropertiesSlider label="Angle" value={num(gradient?.angle, 0)} onChange={(angle) => setGradient({ angle })} min={-180} max={180} step={1} toFixed={0} suffix="°" />
          <PropertyRow label="Across">
            <Segments
              testId="text-gradient-span"
              value={gradient?.span ?? "character"}
              options={[
                { value: "character", label: "Character", title: "Across each character" },
                { value: "line", label: "Line", title: "Across each line" },
                { value: "text", label: "Text", title: "Across the whole text" },
              ]}
              onChange={(span) => span && setGradient({ span })}
            />
          </PropertyRow>
        </TextSection>
      </div>
    </div>
  );
};

export default TextBasicProperties;
