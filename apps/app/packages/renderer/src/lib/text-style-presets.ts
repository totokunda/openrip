// Text looks as patches: the inspector's preset grid puts a text preset's look on a text (every
// look field the preset doesn't set goes back to its default, so one look doesn't pile on the
// last), and Save as preset keeps a text's whole look (lib/clip-presets.ts stores it in the user
// data folder as a clip preset with the Text style group). Pure; `node --test` checks it.
import { BASE_TEXT, type TextPreset } from "./text-presets.ts";
import { copyAttributes } from "./clip-attributes.ts";
import type { ClipPreset } from "./clip-preset-data.ts";
import type { TextClipProps } from "./types";

/** What each look field is when a look doesn't say (the defaults of a new text; the sizes of the Background section start at none and centred). */
export const LOOK_DEFAULTS: Partial<TextClipProps> = (() => {
  const { text: _text, fontSize: _size, ...base } = BASE_TEXT;
  return {
    ...base,
    backgroundEnabled: false,
    backgroundColor: "#000000",
    backgroundOpacity: 100,
    backgroundCornerRadius: 0,
    backgroundWidth: 0,
    backgroundHeight: 0,
    backgroundOffsetX: 50,
    backgroundOffsetY: 50,
    letterSpacing: 0,
    lineSpacing: 0,
    fillGradient: null,
    moreStrokes: [],
    glowEnabled: false,
    glowColor: null,
    glowIntensity: 30,
    glowRange: 20,
    glowOffsetX: 0,
    glowOffsetY: 0,
    textEffect: null,
    textCurve: 0,
  };
})();

/** The patch that gives a text a preset's look: its words and animation left out, the font size only when the preset sets one. */
export const lookPatch = (preset: Pick<TextPreset, "props">): Partial<TextClipProps> => {
  const { text: _text, ...props } = JSON.parse(JSON.stringify(preset.props)) as Partial<TextClipProps>;
  return { ...JSON.parse(JSON.stringify(LOOK_DEFAULTS)), ...props };
};

/** Whether a text has a preset's look (every field the preset sets). */
export const hasLook = (clip: TextClipProps, preset: Pick<TextPreset, "props">): boolean => {
  const want = lookPatch(preset) as Record<string, unknown>;
  const { text: _text, ...props } = preset.props as Record<string, unknown>;
  return Object.keys(props).every((k) => JSON.stringify((clip as unknown as Record<string, unknown>)[k] ?? null) === JSON.stringify(want[k] ?? null));
};

/** A text with every look field present (the defaults under what it has), for saving: applying it later then resets what the text left alone. */
export const withLookDefaults = (clip: TextClipProps): TextClipProps => ({ ...JSON.parse(JSON.stringify(LOOK_DEFAULTS)), ...clip });

/** The Text style attributes of a text, whole, as a saved preset keeps them. */
export const textLookAttributes = (clip: TextClipProps) => copyAttributes(withLookDefaults(clip), ["text"]);

/** Whether a saved clip preset is a text style (it was saved from a text and has the Text style group). */
export const isTextStyle = (p: ClipPreset): boolean => p.source === "text" && !!p.attrs.groups.text;

/** A saved text style as a text preset (its look, for adding a new text in it). */
export const savedAsPreset = (p: ClipPreset, words = "Text"): TextPreset => ({
  id: p.id,
  name: p.name,
  props: { ...(p.attrs.groups.text?.fields as Partial<TextClipProps>), text: words },
});
