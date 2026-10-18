// Text ▸ Basic and Effects by their controls (after import timeline newtext; the playhead at
// 1.5 s on the text): the text box, Font, Font size, B U I, Case, Color (the picker's Hex
// field), Character and Line spacing, Alignment, Stroke, Background, Glow, Shadow and the
// gradient fill, then an Effects style and None. Each one changes the engine's frame and the
// clip as saved; the main ones are undone and redone with ⌘Z / ⇧⌘Z (`undoCase`: the frame
// and the saved project back exactly). Leaves the clip and the frame on ctx.textTab for
// `texttabcheck`, after `reopen`.
import { engineFrame, seek, settled } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { openTab, undoCase } from "./_undo.mjs";

export default async (ctx) => {
  const { win, udDir, shot } = ctx;
  const { check, report } = checks();
  const first = (await savedProject(win, udDir)).timeline.clips.find((c) => c.type === "text");
  const id = first.clipId;
  const saved = async () => (await savedProject(win, udDir)).timeline.clips.find((c) => c.clipId === id);
  await seek(win, ctx.map, 1.5);
  await select(ctx, await savedProject(win, udDir), id, 1.5);
  await openTab(win, "Text");

  const blur = () => win.evaluate(() => document.activeElement?.blur?.());
  const frame = async () => (await engineFrame(win)).sum;
  const q = (sel) => win.locator(sel).first();
  // A number typed into a field (Enter commits it).
  const type = async (input, value) => {
    await input.scrollIntoViewIfNeeded();
    await input.click({ clickCount: 3 });
    await input.fill(String(value));
    await input.press("Enter");
  };
  // The field of a slider row labelled `label` in a section (or in Basic's rows).
  const slider = (section, label) => win.locator(`[data-testid=${section}] label`, { hasText: new RegExp(`^${label}$`) }).first().locator("xpath=..").locator("input").first();
  // A colour set through a well's picker: its Hex field.
  const color = async (well, hex) => {
    await q(`[data-testid=${well}]`).click();
    const f = q("[data-testid=color-hex]");
    await f.fill(hex);
    await f.press("Enter");
    await win.keyboard.press("Escape");
  };
  const font = async (family) => {
    await q("[data-testid=text-font]").click();
    await q("[data-testid=font-search]").fill(family);
    await win.waitForTimeout(200);
    await q(`[role=listbox] [data-font="${family}"]`).click();
  };
  // One control: the engine's frame changes and the saved clip passes `test`.
  const control = async (name, edit, test) => {
    const f0 = await frame();
    await settled(win, edit);
    await blur();
    const f1 = await frame();
    const clip = await saved();
    return check(`${name}: the engine's picture and the saved clip change`, f1 !== f0 && test(clip), `frame changed ${f1 !== f0}`);
  };
  const undoable = (name, edit) => undoCase(ctx, check, name, async () => settled(win, edit));

  // The words, the font, its size and style.
  await undoable("text box", async () => {
    await q("[data-testid=text-box]").fill("Open\nRip text");
    await blur();
  });
  await undoable("font", () => font("Poppins"));
  check("the font is saved", (await saved()).fontFamily === "Poppins");
  await control("font size", () => type(q("[data-testid=text-font-size] input"), 44), (c) => c.fontSize === 44);
  await undoable("bold", () => q("[data-testid=text-bold]").click());
  await control("italic", () => q("[data-testid=text-italic]").click(), (c) => c.fontStyle === "italic");
  await control("underline", () => q("[data-testid=text-underline]").click(), (c) => c.textDecoration === "underline");
  await control("case", () => q("[data-testid=text-case] [data-value=lowercase]").click(), (c) => c.textTransform === "lowercase" && c.text === "open\nrip text");
  await undoable("colour", () => color("text-color", "FF3030"));
  check("the colour is saved", (await saved()).color === "#ff3030", (await saved()).color);
  await control("character spacing", () => type(q("[data-testid=text-letter-spacing]"), 8), (c) => c.letterSpacing === 8);
  await control("line spacing", () => type(q("[data-testid=text-line-spacing]"), 12), (c) => c.lineSpacing === 12);
  await control("alignment", () => q("[data-testid=text-align] [aria-label='Align right']").click(), (c) => c.textAlign === "right");
  await control("vertical alignment", () => q("[data-testid=text-align] [aria-label='Align to the bottom']").click(), (c) => c.verticalAlign === "bottom");
  await shot("tt1-basic");

  // The sections.
  await undoable("stroke on", () => q("[data-testid=text-stroke-on]").click());
  await control("stroke colour", () => color("text-stroke-color", "00AAFF"), (c) => c.stroke === "#00aaff");
  await control("stroke thickness", () => type(slider("text-stroke", "Thickness"), 6), (c) => c.strokeWidth === 6);
  await control("background on", () => q("[data-testid=text-background-on]").click(), (c) => c.backgroundEnabled === true);
  await control("background colour", () => color("text-background-color", "2040A0"), (c) => c.backgroundColor === "#2040a0");
  await control("background opacity", () => type(slider("text-background", "Opacity"), 50), (c) => c.backgroundOpacity === 50);
  await control("background corners", () => type(slider("text-background", "Rounded rectangle"), 20), (c) => c.backgroundCornerRadius === 20);
  await control("glow on", () => q("[data-testid=text-glow-on]").click(), (c) => c.glowEnabled === true);
  await control("glow colour", () => color("text-glow-color", "00FF00"), (c) => c.glowColor === "#00ff00");
  await undoable("glow intensity", () => type(slider("text-glow", "Intensity"), 80));
  await control("glow range", () => type(slider("text-glow", "Range"), 60), (c) => c.glowRange === 60);
  await control("glow X-offset", () => type(slider("text-glow", "X-offset"), 50), (c) => c.glowOffsetX === 50);
  await control("glow Y-offset", () => type(slider("text-glow", "Y-offset"), -50), (c) => c.glowOffsetY === -50);
  await shot("tt2-sections");
  // The glow off, so the shadow shows on its own.
  await control("glow off", () => q("[data-testid=text-glow-on]").click(), (c) => c.glowEnabled === false);
  await control("shadow on", () => q("[data-testid=text-shadow-on]").click(), (c) => c.shadowEnabled === true);
  await control("shadow colour", () => color("text-shadow-color", "FFD000"), (c) => c.shadowColor === "#ffd000");
  await control("shadow opacity", () => type(slider("text-shadow", "Opacity"), 100), (c) => c.shadowOpacity === 100);
  await control("shadow blur", () => type(slider("text-shadow", "Bluriness"), 10), (c) => c.shadowBlur === 10);
  await control("shadow distance", () => type(slider("text-shadow", "Distance"), 12), (c) => Math.abs(Math.hypot(c.shadowOffsetX, c.shadowOffsetY) - 12) < 0.01);
  await control("shadow angle", () => type(slider("text-shadow", "Angle"), 45), (c) => Math.abs((Math.atan2(-c.shadowOffsetY, c.shadowOffsetX) * 180) / Math.PI - 45) < 0.1);
  await control("gradient on", () => q("[data-testid=text-gradient-on]").click(), (c) => Array.isArray(c.fillGradient?.colors));
  await control("gradient end colour", () => color("text-gradient-color-1", "0000FF"), (c) => c.fillGradient?.colors?.[1] === "#0000ff");
  await control("gradient angle", () => type(slider("text-gradient", "Angle"), 90), (c) => c.fillGradient?.angle === 90);
  await control("gradient across", () => q("[data-testid=text-gradient-span] [data-value=character]").click(), (c) => c.fillGradient?.span === "character");
  await shot("tt3-shadow-gradient");

  // Effects: a style, then None.
  await win.locator("[data-testid=inspector] [role=tab]", { hasText: /^Effects$/ }).click();
  await win.waitForTimeout(400);
  await undoable("effects style", () => q("[data-testid=text-effect-neon]").click());
  check("the style is saved", (await saved()).textEffect?.id === "neon");
  await shot("tt4-effects");
  await control("effects none", () => q("[data-testid=text-effect-none]").click(), (c) => c.textEffect == null);
  await control("effects style again", () => q("[data-testid=text-effect-retro]").click(), (c) => c.textEffect?.id === "retro");

  ctx.textTab = { id, clip: await saved(), frame: await frame() };
  return report();
};
