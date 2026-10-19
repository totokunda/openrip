// The caption inspector and the caption file formats (after `import timeline`, nothing else on the
// timeline; OPENRIP_ENGINE_MUTE=1). fixtures/captions.srt, .lrc and .ass come in through Add
// captions (the file dialog stubbed). Checks, each through the UI and the project as saved:
// - LRC and ASS imports: the cues' times and lines (ASS overrides and comments left out, styles
//   ignored), each one undoable as a step; the track is marked as a captions track;
// - a caption's tabs start with Captions: the numbered list with times, the search box, a click
//   on a row selecting that caption and moving the playhead to it, the words edited in place;
// - Find and replace: the counts, Replace taking one caption, Replace all every caption in any
//   letter case, as one undo step;
// - Text ▸ Apply to all main captions: off, an edit changes the one caption; on, an italic and a
//   font size edit reach every caption of the track as one undo step, the engine redrawing; the
//   words and timing stay each caption's own.
// Shots: `ce1-list` ↔ `27-inspector-caption/002`, `ce2-replace` ↔ `003`, `ce3-text` ↔ `001`.
import { fileURLToPath } from "node:url";
import { engineFrame, rulerMap, seek, settled, now, sectionButton } from "./_preview.mjs";
import { checks, savedProject, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { open, typeIn } from "./_inspector.mjs";

const fx = (n) => fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url));

export default async (ctx) => {
  const { app, win, udDir, shot } = ctx;
  const { check, report } = checks();
  ctx.map ??= await rulerMap(win);
  const doc = () => savedProject(win, udDir);
  const clipsOf = async (track) => (await doc()).timeline.clips.filter((c) => c.type === "text" && (!track || c.timelineId === track)).sort((a, b) => +a.startTick - +b.startTick);
  const near = (a, b) => Math.abs(a - b) < 0.6 / 24;
  const secs = (c) => [+c.startTick / 1e6, +c.endTick / 1e6];

  // The file dialog returns whatever the step set last.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("dialog:pick-media");
    ipcMain.handle("dialog:pick-media", async () => [globalThis.__captionPick]);
  });
  const importFile = async (name) => {
    await app.evaluate((_, p) => void (globalThis.__captionPick = p), fx(name));
    await win.locator("[data-testid=assets-tab-captions]").click();
    await (await sectionButton(win, "add")).click();
    await win.waitForTimeout(300);
    await settled(win, () => win.locator("[data-testid=captions-import]").click());
  };

  // LRC: four lines (an empty tag ends the second; the repeated line twice; the last shows 3 s).
  await seek(win, ctx.map, 0.5);
  await undoCase(ctx, check, "import an LRC file", () => importFile("captions.lrc"));
  const lrc = await clipsOf();
  const lt = lrc.map(secs);
  check(
    `LRC: four captions with the lines' times ${JSON.stringify(lt.map((p) => p.map((v) => +v.toFixed(2))))}`,
    lrc.length === 4 && near(lt[0][0], 0.5) && near(lt[0][1], 2) && near(lt[1][1], 3.5) && near(lt[2][0], 4) && near(lt[2][1], 5) && near(lt[3][1], 8) && lrc[1].text === "Second lyric line" && lrc[3].text === "Repeated line",
    lrc.map((c) => c.text).join(" | "),
  );
  const lrcTrack = lrc[0].timelineId;
  check("the LRC's track is marked as a captions track", (await doc()).timeline.tracks.find((t) => t.timelineId === lrcTrack)?.captions === true);
  // Take it away again so the next file's track is the only one.
  await select(ctx, await doc(), lrc[0].clipId, 1.0);
  await win.keyboard.press("Meta+z");
  await win.waitForTimeout(600);
  await win.keyboard.press("Meta+Shift+z");
  await win.waitForTimeout(600);

  // ASS: three captions (the Comment line is left out, overrides dropped, \N a line break).
  await undoCase(ctx, check, "import an ASS file", () => importFile("captions.ass"));
  const ass = (await clipsOf()).filter((c) => c.timelineId !== lrcTrack);
  const at = ass.map(secs);
  check(
    `ASS: three captions, overrides and the comment left out ${JSON.stringify(ass.map((c) => c.text))}`,
    ass.length === 3 && ass[0].text === "Hello, world" && ass[1].text === "First of two\nSecond of two" && ass[2].text === "Last one" && near(at[0][0], 0.5) && near(at[1][0], 2) && near(at[2][1], 5.5),
  );

  // The SRT is the one the inspector is exercised on: remove the others by undo, then import it.
  for (let i = 0; i < 2; i++) {
    await win.evaluate(() => document.activeElement?.blur?.());
    await win.keyboard.press("Meta+z");
    await win.waitForTimeout(600);
  }
  check("both imports undone", (await clipsOf()).length === 0, `${(await clipsOf()).length} texts left`);
  await importFile("captions.srt");
  let caps = await clipsOf();
  check("the SRT's four captions are back", caps.length === 4);
  const track = caps[0].timelineId;

  // The caption inspector: Captions tab first.
  await seek(win, ctx.map, 0.5);
  await select(ctx, await doc(), caps[0].clipId, 0.6);
  const tabs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector-tabs] [role=tab]")].map((e) => e.innerText.trim()));
  check(`a caption's tabs start with Captions (${tabs.join(", ")})`, tabs[0] === "Captions" && tabs.includes("Text"));
  const rows = win.locator("[data-testid=caption-row]");
  const texts = () => win.locator("[data-testid=caption-row-text]").evaluateAll((els) => els.map((e) => e.value));
  check("the list has the four captions in time order", (await rows.count()) === 4 && (await texts())[0] === "The first caption" && (await texts())[3] === "And the last", JSON.stringify(await texts()));
  const numbers = await rows.evaluateAll((els) => els.map((e) => e.innerText.split("\n")[0].trim()));
  const times = await rows.evaluateAll((els) => els.map((e) => e.innerText.trim().split("\n").pop().trim()));
  check(`rows numbered 1 to 4 with their start times ${JSON.stringify(times)}`, numbers.join() === "1,2,3,4" && times[0] === "0:00.2" || times[0] === "0:00.3", numbers.join());
  await shot("ce1-list");

  // Search narrows the rows, keeping each one's number.
  await win.locator("[data-testid=caption-search]").fill("SECOND");
  await win.waitForTimeout(300);
  const found = await rows.evaluateAll((els) => els.map((e) => e.innerText.split("\n")[0].trim()));
  check("the search finds the second caption in any letter case, still numbered 2", found.join() === "2", found.join());
  await win.locator("[data-testid=caption-search]").fill("");
  await win.waitForTimeout(300);

  // A click on a row selects that caption and moves the playhead to its start (3.0 s).
  await rows.nth(2).click({ position: { x: 6, y: 6 } });
  await win.waitForTimeout(700);
  const head = await now(win);
  const selectedRow = await win.locator("[data-testid=caption-row][data-selected=true]").getAttribute("data-clip-id");
  check(`a click on row 3 selects it and moves the playhead to ${head.toFixed(2)} s`, selectedRow === caps[2].clipId && Math.abs(head - 3) < 0.1);

  // The words edited in place.
  await rows.nth(0).click({ position: { x: 6, y: 6 } });
  await win.waitForTimeout(500);
  await undoCase(ctx, check, "editing a caption's words in the list", async () => {
    const box = win.locator("[data-testid=caption-row-text]").first();
    await box.click();
    await box.fill("The first caption, edited");
    await win.waitForTimeout(500);
  });
  caps = await clipsOf();
  check("the edit reached the clip as saved", caps[0].text === "The first caption, edited", caps[0].text);

  // Find and replace.
  await win.locator("[data-testid=caption-find-replace]").click();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=caption-find]").fill("CAPTION");
  await win.locator("[data-testid=caption-replace]").fill("line");
  await win.waitForTimeout(300);
  const count = await win.locator("[data-testid=caption-replace-count]").innerText();
  check(`the dialog counts the matches (${count})`, /1 match in 1 caption/.test(count), count);
  await shot("ce2-replace");
  await win.locator("[data-testid=caption-replace-one]").click();
  await win.waitForTimeout(600);
  check("Replace takes the one caption that has it", (await clipsOf())[0].text === "The first line, edited");
  await win.locator("[data-testid=caption-find]").fill("e");
  await win.locator("[data-testid=caption-replace]").fill("E");
  await win.waitForTimeout(200);
  await undoCase(ctx, check, "Replace all", async () => {
    await settled(win, () => win.locator("[data-testid=caption-replace-all]").click());
    await win.waitForTimeout(400);
  });
  caps = await clipsOf();
  check(`Replace all rewrote every caption, any case ${JSON.stringify(caps.map((c) => c.text))}`, caps[0].text === "ThE first linE, EditEd" && caps[2].text === "Third, aftEr a gap" && caps[3].text === "And thE last" && !caps.some((c) => /e/.test(c.text)));

  // Apply to all main captions.
  await win.locator("[data-testid=caption-list]").waitFor();
  await open(win, "Text", "Basic");
  await win.waitForTimeout(400);
  check("Text ▸ Basic has Apply to all main captions, off at first", (await win.locator("[data-testid=caption-apply-all-check]").getAttribute("aria-checked")) === "false");
  await shot("ce3-text");
  const italic = win.locator("[data-testid=text-italic]");
  await undoCase(ctx, check, "an italic edit with Apply to all off", () => settled(win, () => italic.click()));
  let after = await clipsOf();
  check("only the selected caption went italic", after[0].fontStyle === "italic" && after.slice(1).every((c) => c.fontStyle !== "italic"), after.map((c) => c.fontStyle).join());
  await settled(win, () => italic.click());
  await settled(win, () => win.locator("[data-testid=caption-apply-all-check]").click());
  const f1 = (await engineFrame(win)).sum;
  await undoCase(ctx, check, "an italic edit with Apply to all on", () => settled(win, () => italic.click()));
  after = await clipsOf();
  check("with it on, every caption on the track went italic", after.length === 4 && after.every((c) => c.fontStyle === "italic"), after.map((c) => c.fontStyle).join());
  await undoCase(ctx, check, "a font size edit with Apply to all on", async () => {
    await typeIn(win, "Font size", 44);
  });
  after = await clipsOf();
  check(
    "the font size reached every caption; words and timing are their own",
    after.every((c) => c.fontSize === 44) && after[2].text === "Third, aftEr a gap" && near(secs(after[2])[0], 3) && near(secs(after[0])[0], 0.25),
    after.map((c) => c.fontSize).join(),
  );
  check("the engine draws the new size", (await engineFrame(win)).sum !== f1);
  await shot("ce4-applied");
  const outsider = (await doc()).timeline.clips.filter((c) => c.type === "text" && c.timelineId !== track);
  check("captions of no other track were touched", outsider.length === 0 || outsider.every((c) => c.fontSize !== 44));
  return report();
};
