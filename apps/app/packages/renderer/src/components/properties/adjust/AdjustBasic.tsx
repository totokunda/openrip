import React from "react";
import { pickMediaPaths } from "@app/preload";
import { useClipStore } from "@/lib/clip";
import { clearKeyframes, hasKeyframes, ADJUST_PROPERTIES } from "@/lib/keyframes";
import { ADJUST_SLIDERS, colorOf, hasLegacyAdjustments, migrateLegacyAdjustments, setLut } from "@/lib/color";
import type { AdjustSlider, AnyClipProps, ImageClipProps, KeyframeProperty, VideoClipProps } from "@/lib/types";
import Section from "../Section";
import PropertyRow from "../PropertyRow";
import KeyframedSlider from "../KeyframedSlider";
import DraftAdjustProperties from "../DraftAdjustProperties";
import { InspectorSelect, Subhead } from "../controls";

/**
 * Adjust ▸ Basic, as CapCut lays it out (docs/plan/capcut-ui-spec.md §4.8c, §6.23): a CapCut
 * clip's own adjustments first ("From the CapCut draft"), then LUT (a .cube file or a Hald
 * CLUT image and its intensity) and Adjust's fourteen sliders on CapCut's scale in its groups
 * and order, every one keyframeable (`adjust:<slider>`). A clip that still has the app's
 * first sliders (`brightness`, `contrast`, …: MediaAdjustments) shows them below, with the
 * move onto CapCut's (`migrateLegacyAdjustments`).
 */

type Media = VideoClipProps | ImageClipProps;

/** CapCut's groups and order; its names where they differ from lib/color.ts's. */
const GROUPS: { title: string; keys: AdjustSlider[] }[] = [
  { title: "Color", keys: ["temperature", "tint", "saturation"] },
  // The draft's "brightness" is CapCut's Brilliance, the seventh of its Lightness sliders.
  { title: "Lightness", keys: ["exposure", "contrast", "highlights", "shadows", "whites", "blacks", "brightness"] },
  { title: "Effects", keys: ["sharpen", "clarity", "fade", "vignette"] },
];
const NAMES: Partial<Record<AdjustSlider, string>> = { temperature: "Temp", brightness: "Brilliance" };
/** The colour sliders' gradient tracks, as CapCut paints them. */
const TRACKS: Partial<Record<AdjustSlider, string>> = {
  temperature: "linear-gradient(90deg, #2f4cff, #8c8c8c 50%, #f2e23a)",
  tint: "linear-gradient(90deg, #3fae49, #8c8c8c 50%, #c837e0)",
  saturation: "linear-gradient(90deg, #3a3a3a, #8c5454 50%, #f03030)",
};
const ADJUST_KEYS = ADJUST_SLIDERS.map((s) => `adjust:${s.key}` as KeyframeProperty);

/** The first sliders on their own scales, as the app drew them (legacy). */
const LEGACY: { key: (typeof ADJUST_PROPERTIES)[number]; name: string; min: number; max: number }[] = [
  { key: "brightness", name: "Brightness", min: -100, max: 100 },
  { key: "contrast", name: "Contrast", min: -100, max: 100 },
  { key: "hue", name: "Hue", min: -100, max: 100 },
  { key: "saturation", name: "Saturation", min: -100, max: 100 },
  { key: "sharpness", name: "Sharpness", min: 0, max: 100 },
  { key: "noise", name: "Noise", min: 0, max: 100 },
  { key: "blur", name: "Blur", min: 0, max: 100 },
  { key: "vignette", name: "Vignette", min: 0, max: 100 },
];

const update = (clipId: string, patch: Partial<AnyClipProps>) => useClipStore.getState().updateClip(clipId, patch);
const now = (clipId: string) => useClipStore.getState().getClipById(clipId)!;

const LutSection: React.FC<{ clipId: string; clip: Media }> = ({ clipId, clip }) => {
  const lut = colorOf(clip).lut ?? null;
  const clips = useClipStore((s) => s.clips);
  // The LUTs this project uses, to pick again; then Import.
  const known = new Map<string, string>();
  for (const c of clips) {
    const l = (c as Media).color?.lut;
    if (l?.path) known.set(l.path, l.name ?? l.path.split(/[\\/]/).pop()!);
  }
  const pick = async () => {
    const [path] = await pickMediaPaths({ title: "Import a LUT", filters: [{ name: "LUTs", extensions: ["cube", "png", "jpg"] }] });
    if (path) update(clipId, setLut(now(clipId), { path, name: path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ""), intensity: lut?.intensity ?? 100 }));
  };
  const choose = (v: string) => {
    if (v === "none") update(clipId, { ...setLut(now(clipId), null), keyframes: clearKeyframes(now(clipId).keyframes, "lut:intensity") });
    else if (v === "import") void pick();
    else update(clipId, setLut(now(clipId), { path: v, name: known.get(v), intensity: lut?.intensity ?? 100 }));
  };
  return (
    <Section
      title="LUT"
      checked={!!lut?.path}
      onCheckedChange={(on) => (on ? void pick() : choose("none"))}
      onReset={() => lut && update(clipId, { ...setLut(now(clipId), { ...lut, intensity: 100 }), keyframes: clearKeyframes(now(clipId).keyframes, "lut:intensity") })}
      keyframes={{ clipId, properties: ["lut:intensity"] }}
      dimOff={false}
      testId="section-lut"
    >
      <PropertyRow label="Name">
        <InspectorSelect
          label="LUT"
          value={lut?.path ?? "none"}
          onChange={choose}
          options={[{ value: "none", label: "None" }, ...[...known].map(([value, label]) => ({ value, label })), { value: "import", label: "Import…" }]}
        />
      </PropertyRow>
      <KeyframedSlider clipId={clipId} property="lut:intensity" label="Intensity" min={0} max={100} disabled={!lut?.path} />
    </Section>
  );
};

const AdjustSection: React.FC<{ clipId: string }> = ({ clipId }) => {
  // Every slider back to 0 and unkeyed (one undo step).
  const reset = () => {
    const c = now(clipId);
    let keyframes = c.keyframes;
    for (const p of ADJUST_KEYS) keyframes = clearKeyframes(keyframes, p);
    update(clipId, { keyframes, color: { ...colorOf(c), adjust: {} } } as Partial<AnyClipProps>);
  };
  return (
    <Section title="Adjust" onReset={reset} keyframes={{ clipId, properties: ADJUST_KEYS }} testId="section-adjust">
      {GROUPS.map((g) => (
        <React.Fragment key={g.title}>
          <Subhead>{g.title}</Subhead>
          {g.keys.map((key) => {
            const s = ADJUST_SLIDERS.find((x) => x.key === key)!;
            return (
              <div key={key} className="pb-[5px]">
                <KeyframedSlider
                  clipId={clipId}
                  property={`adjust:${key}`}
                  label={NAMES[key] ?? s.name}
                  min={s.min}
                  max={s.max}
                  track={TRACKS[key]}
                  origin={s.min < 0 ? 0 : undefined}
                />
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </Section>
  );
};

/** The first sliders a clip still uses, and the one-click move onto CapCut's. */
const LegacySection: React.FC<{ clipId: string; clip: Media }> = ({ clipId, clip }) => {
  const used = LEGACY.filter((l) => (clip as any)[l.key] || hasKeyframes(clip.keyframes, l.key));
  if (!used.length) return null;
  const movable = hasLegacyAdjustments(clip);
  return (
    <Section title="Earlier adjustments" testId="section-legacy">
      <p className="text-[12px] text-[#949494] text-start mb-2">
        This clip uses the app&apos;s first sliders.
        {movable ? " Contrast, saturation, vignette and sharpness move onto the sliders above at the closest value." : " These have no counterpart above and stay as they are."}
      </p>
      {movable && (
        <button
          type="button"
          data-testid="legacy-update"
          onClick={() => update(clipId, migrateLegacyAdjustments(now(clipId)))}
          className="self-start h-[22px] px-3 mb-2 rounded-[4px] bg-brand-accent hover:bg-brand-accent-shade text-[12px] font-semibold text-white"
        >
          Update to the new adjustments
        </button>
      )}
      {used.map((l) => (
        <div key={l.key} className="pb-[5px]">
          <KeyframedSlider clipId={clipId} property={l.key} label={l.name} min={l.min} max={l.max} origin={l.min < 0 ? 0 : undefined} />
        </div>
      ))}
    </Section>
  );
};

const AdjustBasic: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as Media | undefined;
  if (!clip) return null;
  return (
    <div className="min-w-0 divide-y divide-brand-divider">
      <DraftAdjustProperties clipId={clipId} />
      <LutSection clipId={clipId} clip={clip} />
      <AdjustSection clipId={clipId} />
      <LegacySection clipId={clipId} clip={clip} />
    </div>
  );
};

export default AdjustBasic;
