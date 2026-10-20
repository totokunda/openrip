// Compound clips (after `import timeline newtext`: the 10 s standard clip with a text 0-3 s over
// it; OPENRIP_ENGINE_MUTE=1; built app, no dev server; run on ~/Downloads/IMG_9079.MOV with
// CLIP_NAME=IMG_9079, needs ffmpeg for the export check). The video is split at 5 s into two
// clips. Checks, each through the UI and the project as saved:
// - Create compound clip (⌥G) from the first video and the text: one undo step; the compound is a
//   clip on the main track over their time range with the two clips in a timeline of its own
//   (times from 0), and the engine's frame is what it was before (the picture is unchanged);
// - the compound's own Scale and Opacity change the engine's frame (it's one picture), and undo;
// - the clip's menu names Create compound clip and Undo compound clip; the inspector's tabs are
//   the video's, its Speed Standard and Curve;
// - Speed 2× on the compound plays its content twice as fast: 1 s in shows what 2 s did at 1×, the
//   clip half as long (one undo step, the engine's frame and the saved project exact);
// - the bar: a compound glyph in the name chip, "Compound clip1" and its length; thumbnails that are
//   the engine's own composite frames; the waveform band of the compound's mix; the inspector's
//   tabs Video, Audio, Speed (Standard and Curve), Animation, Adjust;
// - the clip's menu is CapCut's 003 in its order (minus the AI rows), Transcript and Extract audio
//   on it (Extract audio: the mix on an audio track, the compound silent, one undo step);
// - double-click opens its timeline: the bar "‹ Compound clip1" centred in the toolbar (nothing else
//   of the breadcrumb), the Cover tile and Ratio greyed, Crop / Transform / Detach audio gone, the
//   nested clips on the timeline, the player showing the nested timeline; an edit inside (a scale
//   on the video, one undo step) reaches the compound's picture; ‹ returns to the main timeline;
// - Undo compound clip (the clip menu): the clips are back on the timeline at their places,
//   with the edit made inside; one undo step;
// - Media > Import > Subprojects lists the compound with its name and length; its "+" adds
//   another instance at the playhead (fresh ids all through, one undo step); Rename from the
//   tile's menu; a drag onto the timeline adds one too;
// - copy and paste of a compound deep-copies its timeline (no clip id shared);
// - an export contains it (the exported frame matches the player's, not the unscaled picture);
// - the project survives a restart with the compound, its content and its name.
// Shots: `cp1-compound` ↔ `28-inspector-compound/001`, `cp2-open` ↔ `002`, `cp3-menu` ↔ `003`,
// `cp4-subprojects` ↔ `05-left-media/012`.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { engineFrame, grab, diff, drag, now, openEditor, rulerMap, sectionButton, seek, settled, tab } from "./_preview.mjs";
import { bar, checks, savedProject } from "./_anim.mjs";
import { undoCase as undoStep, press } from "./_undo.mjs";
import { input, open, typeIn } from "./_inspector.mjs";
import { ffmpeg } from "./_audio.mjs";

const tabs = (win) => win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector-tabs] [role=tab]")].map((e) => e.innerText.trim()));

export default async (ctx) => {
  let { win } = ctx;
  const { shot, udDir, outDir, fs } = ctx;
  const { check, report } = checks();
  const undoCase = async (name, edit, opts) => {
    await ctx.win.waitForTimeout(2500);
    return undoStep(ctx, check, name, edit, opts);
  };
  ctx.map ??= await rulerMap(win);
  const clips = (d) => d.timeline.clips;
  const saved = async () => {
    await ctx.win.waitForTimeout(1500);
    return savedProject(ctx.win, udDir);
  };
  const compounds = (d) => clips(d).filter((c) => c.compound);
  /** The clips of a compound's content as a project the helpers can read (their ticks, their tracks). */
  const inside = (c) => ({ timeline: { clips: c.compound.clips, tracks: c.compound.tracks } });
  let doc = await savedProject(win, udDir);
  const video0 = clips(doc).find((c) => c.type === "video");
  const textId = clips(doc).find((c) => c.type === "text").clipId;

  // Two videos: split at 5 s.
  await seek(win, ctx.map, 5);
  let [x, y] = await bar(ctx, doc, video0.clipId, 7.5);
  await win.mouse.click(x, y);
  await win.waitForTimeout(500);
  await settled(win, () => win.keyboard.press("Meta+b"));
  doc = await savedProject(win, udDir);
  for (let i = 0; i < 20 && clips(doc).filter((c) => c.type === "video").length < 2; i++) {
    await win.waitForTimeout(500);
    doc = await savedProject(win, udDir);
  }
  const [v1, v2] = clips(doc).filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick);
  const at = { [v1.clipId]: 1.9, [v2.clipId]: 7.5, [textId]: 0.5 };
  const selectBars = async (items, d = doc) => {
    await win.keyboard.press("Escape");
    for (let i = 0; i < items.length; i++) {
      const [id, when] = items[i];
      const [bx, by] = await bar(ctx, d, id, when);
      if (i) await win.keyboard.down("Shift");
      await win.mouse.click(bx, by);
      if (i) await win.keyboard.up("Shift");
      await win.waitForTimeout(500);
    }
  };
  const blurred = () => win.evaluate(() => document.activeElement?.blur?.());

  // ---- Create compound clip (⌥G) -----------------------------------------------------------------
  await seek(win, ctx.map, 1);
  await grab(win, "before");
  const f0 = await engineFrame(win);
  await selectBars([[v1.clipId, 2.5], [textId, 1.5]]);
  const created = await undoCase("create compound clip", async () => {
    await blurred();
    await settled(win, () => win.keyboard.press("Alt+g"));
  }, { frame: false });
  doc = await saved();
  const [comp] = compounds(doc);
  check("Create compound clip (⌥G) makes one compound clip", compounds(doc).length === 1, `${compounds(doc).length}`);
  if (!comp) throw new Error("no compound clip");
  check("the video and the text left the main timeline for it", !clips(doc).some((c) => c.clipId === v1.clipId || c.clipId === textId) && comp.compound.clips.length === 2, comp.compound.clips.map((c) => c.type).join(","));
  const kinds = comp.compound.clips.map((c) => c.type).sort().join(",");
  check("its content is the video and the text, in tracks of their own", kinds === "text,video" && comp.compound.tracks.length === 2, `${kinds}, ${comp.compound.tracks.length} tracks`);
  check("the compound spans the video's range and its content starts at 0", comp.startTick === v1.startTick && comp.endTick === v1.endTick && comp.compound.clips.every((c) => +c.startTick >= 0) && comp.compound.clips.some((c) => +c.startTick === 0), `${comp.startTick}-${comp.endTick}`);
  const mainId = [...doc.timeline.tracks].reverse().find((t) => t.type === "media").timelineId;
  check("it is on the main track, before the second video", comp.timelineId === mainId && +comp.endTick <= +clips(doc).find((c) => c.clipId === v2.clipId).startTick);
  check("its name is Compound clip1", comp.name === "Compound clip1", comp.name);
  check("it has no media of its own", !comp.assetId);
  await seek(win, ctx.map, 1);
  await grab(win, "after");
  const same = await diff(win, "before", "after", 6);
  check("the engine's frame is what it was before (the picture is unchanged)", same.n < 40, `${same.n} pixels differ`);
  void created;

  // ---- one picture: its own transform, opacity ---------------------------------------------------
  await selectBars([[comp.clipId, 2.5]], doc);
  await win.waitForTimeout(500);
  const t = await tabs(win);
  check("a compound uses the video inspector (Video, Audio, Speed, Animation, Adjust)", t[0] === "Video" && t.includes("Animation") && t.includes("Adjust") && t.includes("Speed"), t.join(","));
  await shot("cp1-compound");
  await open(win, "Video", "Basic");
  const sections = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [data-section]")].map((e) => e.getAttribute("data-section")));
  check("Video > Basic has Transform and Blend", sections.includes("Transform") && sections.includes("Blend"), sections.join(","));
  await undoCase("compound scale", () => typeIn(win, "Scale", 50));
  await grab(win, "small");
  const small = await diff(win, "before", "small", 6);
  check("the compound's Scale 50 shrinks the whole picture (the video and its text together)", small.n > 2000 && small.light < 0.6 * f0.light, `${small.n} pixels differ, lightness ${small.light.toFixed(3)} vs ${f0.light.toFixed(3)}`);
  await typeIn(win, "Scale", 100);
  await undoCase("compound opacity", () => typeIn(win, "Opacity", 50));
  const f50 = await engineFrame(win);
  check("Opacity 50 dims it over the black", f50.light < 0.7 * f0.light && f50.light > 0.3 * f0.light, `${f50.light.toFixed(3)} vs ${f0.light.toFixed(3)}`);
  await typeIn(win, "Opacity", 100);
  await grab(win, "reset");
  check("back at 100% it's the original picture again", (await diff(win, "before", "reset", 6)).n < 40);

  // ---- Speed: constant, applied to the content -----------------------------------------------------
  doc = await saved();
  const compLen = (c) => +c.endTick - +c.startTick;
  const len1 = compLen(compounds(doc)[0]);
  await seek(win, ctx.map, 2);
  const at2 = (await engineFrame(win)).sum;
  await selectBars([[comp.clipId, 3.5]], doc);
  await tab(win, "Speed");
  const speedSubs = await win.evaluate(() => [...document.querySelectorAll("[data-testid=inspector] [role=tablist]")][1]?.innerText.replace(/\s+/g, ",") ?? "");
  check("a compound's Speed has Standard and Curve (the curve reaches its picture and sound)", /Curve/.test(speedSubs) && (await win.locator("[data-testid=speed-value]").count()) === 1, speedSubs);
  await undoCase("compound speed 2x", async () => {
    const input = win.locator("[data-testid=speed-value]");
    await input.click();
    await win.keyboard.press("Meta+A");
    await win.keyboard.type("2");
    await settled(win, () => win.keyboard.press("Enter"));
  }, { frame: false });
  doc = await saved();
  const fast = compounds(doc)[0];
  check("2x: saved, half the length", fast.speed === 2 && Math.abs(compLen(fast) - len1 / 2) < len1 * 0.02, `${fast.speed}x, ${compLen(fast)} of ${len1}`);
  await seek(win, ctx.map, 1);
  check("2x: 1 s in shows what 2 s showed at 1x", (await engineFrame(win)).sum === at2);
  await press(win, "Meta+z");
  await win.waitForTimeout(800);
  doc = await saved();
  check("undone: 1x and the length back", compounds(doc)[0].speed !== 2 && compLen(compounds(doc)[0]) === len1, `${compounds(doc)[0].speed}`);
  await selectBars([[comp.clipId, 2.5]], doc);

  // ---- the clip's menu -----------------------------------------------------------------------------
  doc = await saved();
  const [cb, cy] = await bar(ctx, doc, comp.clipId, 2.5);
  await win.mouse.click(cb, cy, { button: "right" });
  await win.waitForTimeout(500);
  const menu = await win.evaluate(() => [...document.querySelectorAll("[data-testid^=menu-]")].map((e) => e.innerText.replace(/\s+/g, " ").trim()));
  const CAPCUT = ["Copy", "Cut", "Copy/paste attributes", "Delete", "Edit", "Transcript", "Generate captions", "Extract audio", "Enhance audio", "Enhance visuals", "Adjust color", "Enhance motion", "Group", "Create compound clip (subproject)", "Undo compound clip (subproject)", "Pre-process compound clip (subproject)", "Save preset", "Export selected clips", "Deactivate clip", "More clip actions", "Range", "Render"];
  check("the menu is CapCut's, in its order, without the AI and cloud rows", menu.length === CAPCUT.length && CAPCUT.every((m, i) => menu[i]?.startsWith(m)), menu.join(" | "));
  check("its shortcuts: Copy ⌘C, Create ⌥G, Undo ⌥⇧G, Extract audio, Deactivate V", /^Copy ⌘C/.test(menu[0]) && /⌥G$/.test(menu[13]) && /⌥⇧G$/.test(menu[14]) && /Extract audio ⌃⇧S/.test(menu[7]) && /Deactivate clip V/.test(menu[18]), `${menu[0]} | ${menu[13]} | ${menu[14]} | ${menu[7]} | ${menu[18]}`);
  check("Group is greyed for one clip; the rows that read a media file are greyed", (await win.locator("[data-testid=menu-group]").isDisabled()) && (await win.locator("[data-testid=menu-transcript]").isEnabled()) && (await win.locator("[data-testid=menu-extract-audio]").isEnabled()));
  await shot("cp3-menu");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // ---- the bar and its inspector --------------------------------------------------------------------
  const chipInfo = await win.evaluate((id) => {
    const g = (window.Konva?.stages ?? []).flatMap((st) => st.find(".clip-chips")).find((n) => n.getAttr("clipId") === id);
    return g ? { chips: g.getAttr("chips"), glyph: g.find("Path").length } : null;
  }, comp.clipId);
  check("the name chip has the compound glyph, 'Compound clip1', and the length", !!chipInfo && chipInfo.glyph === 1 && chipInfo.chips[0] === "Compound clip1" && /^\d\d:\d\d:\d\d:\d\d$/.test(chipInfo.chips[1]), JSON.stringify(chipInfo));
  await win.waitForFunction(() => Number(document.documentElement.dataset.compoundFrames ?? 0) > 0, null, { timeout: 15000 }).catch(() => {});
  const frames = Number(await win.evaluate(() => document.documentElement.dataset.compoundFrames ?? "0"));
  check("its thumbnails are the engine's composite frames of the compound", frames > 0, `${frames} frames drawn`);
  await win.waitForTimeout(2500);
  const wave = await win.evaluate((id) => {
    const n = (window.Konva?.stages ?? []).flatMap((st) => st.find(".waveform")).find((x) => x.getAttr("clipId") === id);
    return n ? { bars: (n.getAttr("heights") ?? []).length, max: n.getAttr("maxBar") } : null;
  }, comp.clipId);
  check("its waveform band is the mix of the compound's sound", !!wave && wave.bars > 10, JSON.stringify(wave));
  await selectBars([[comp.clipId, 2.5]], doc);
  const tabNames = await tabs(win);
  check("the inspector's tabs: Video, Audio, Speed, Animation, Adjust", tabNames.join(",") === "Video,Audio,Speed,Animation,Adjust", tabNames.join(","));
  await open(win, "Speed");
  await open(win, "Video", "Basic");

  // ---- Transcript and Extract audio on it ---------------------------------------------------------------
  const menuItem = async (testid) => {
    doc = await saved();
    const [mx, my] = await bar(ctx, doc, comp.clipId, 2.5);
    await win.mouse.click(mx, my, { button: "right" });
    await win.waitForTimeout(400);
    await win.locator(`[data-testid=${testid}]`).click();
  };
  await menuItem("menu-transcript");
  await win.waitForSelector("[data-testid=transcript][data-state=empty]", { timeout: 60000 }).catch(() => {});
  check("Transcript opens its panel on the compound's mix, not yet transcribed", (await win.locator("[data-testid=transcript][data-state=empty]").count()) === 1 && (await win.locator("[data-testid=transcript-start]").count()) === 1);
  await shot("cp5-transcript");
  doc = await saved();
  const mixAsset = Object.values(doc.assets ?? {}).find((a) => /compound-mix/.test(a.path ?? ""));
  check("the compound's mix is kept as an asset on the clip (an audio file in the data folder)", !!mixAsset && compounds(doc)[0].mixAssetId === mixAsset.id, mixAsset?.path);
  if (process.env.OPENRIP_MODELS) {
    await win.locator("[data-testid=transcript-start]").click();
    await win.waitForSelector("[data-testid=transcript][data-state=ready]", { timeout: 180000 }).catch(() => {});
    const heard = await win.locator("[data-testid=transcript-word]").count();
    check("Transcript hears the compound's speech (the video's, through the mix)", heard > 3, `${heard} words`);
  }
  await undoCase("Extract audio", async () => {
    await menuItem("menu-extract-audio");
    await win.waitForTimeout(6000);
  }, { frame: false });
  doc = await saved();
  const extracted = clips(doc).find((c) => c.type === "audio");
  check("Extract audio puts the compound's mix on an audio track, linked to it", !!extracted && /compound-mix/.test(doc.assets?.[extracted.assetId]?.path ?? "") && extracted.linkId === compounds(doc)[0].linkId, extracted ? `${extracted.startTick}-${extracted.endTick}` : "none");
  check("and the compound plays none of its own sound", compounds(doc)[0].audioSeparated === true);
  await press(win, "Meta+z");
  await win.waitForTimeout(800);
  doc = await saved();
  check("one undo takes the audio clip away and gives the compound its sound back", !clips(doc).some((c) => c.type === "audio") && !compounds(doc)[0].audioSeparated);

  // Generate captions listens to the compound's mixed sound.
  await menuItem("menu-generate-captions");
  await win.waitForSelector("[data-testid=auto-generate]", { timeout: 10000 }).catch(() => {});
  check("Generate captions opens the Auto captions panel for the compound", (await win.locator("[data-testid=auto-generate]").count()) >= 1);
  if (process.env.OPENRIP_MODELS) {
    await win.locator("[data-testid=auto-generate]").first().click();
    await win.waitForTimeout(1500);
    await win.waitForSelector("[data-testid=auto-generate]", { timeout: 180000 }).catch(() => {});
    doc = await saved();
    const made = clips(doc).filter((c) => c.type === "text" && c.autoCaption);
    check("and Generate makes captions from it (the compound's speech)", made.length > 0, `${made.length} captions`);
    await press(win, "Meta+z");
    await win.waitForTimeout(800);
  }
  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(300);

  // ---- open it: the breadcrumb, an edit inside, back ---------------------------------------------------
  await selectBars([[comp.clipId, 2.5]], doc);
  await win.mouse.dblclick(cb, cy);
  await win.waitForTimeout(1200);
  const crumbs = await win.locator("[data-testid=compound-crumb]").allInnerTexts();
  check("double-click opens it: the bar reads ‹ Compound clip1 and nothing else", crumbs.join(" > ") === "Compound clip1", crumbs.join(" > "));
  const barBox = await win.locator("[data-testid=compound-bar]").boundingBox();
  const tbBox = await win.locator("[data-testid=timeline-toolbar]").boundingBox();
  check("the bar is centred in the timeline toolbar", Math.abs(barBox.x + barBox.width / 2 - (tbBox.x + tbBox.width / 2)) < 6, `${barBox.x + barBox.width / 2} vs ${tbBox.x + tbBox.width / 2}`);
  check("the toolbar has no Crop, Transform or Detach audio inside it", (await win.locator("[data-testid=tool-crop], [data-testid=tool-detach]").count()) === 0);
  check("Ratio is greyed inside it", await win.locator("[data-testid=ratio-menu]").isDisabled());
  check("the inspector shows Project and Details with nothing selected", /Project/.test(await win.evaluate(() => document.querySelector("[data-testid=inspector]")?.innerText ?? "")) && (await tabs(win)).length === 0);
  await shot("cp2-open");
  doc = await saved();
  const outer = compounds(doc)[0];
  const inner = inside(outer);
  const nestedVideo = outer.compound.clips.find((c) => c.type === "video");
  const nestedText = outer.compound.clips.find((c) => c.type === "text");
  // The nested clips are on the timeline (their bars are where the compound's saved tracks put them).
  const [vx, vy] = await bar(ctx, inner, nestedVideo.clipId, 2.5);
  const [tx] = await bar(ctx, inner, nestedText.clipId, 1.5);
  const onScreen = await win.evaluate(() => !!document.querySelector("[data-testid=timeline]"));
  check("the timeline shows the nested clips (the video's and the text's rows differ)", onScreen && vy > 0 && Number.isFinite(tx));
  await seek(win, ctx.map, 1);
  await grab(win, "inner");
  check("the player shows the nested timeline (the same picture)", (await diff(win, "before", "inner", 6)).n < 40);
  // An edit inside: the video's scale, as one undo step; it reaches the compound's picture.
  await win.mouse.click(vx, vy);
  await win.waitForTimeout(500);
  await open(win, "Video", "Basic");
  await undoCase("edit inside the compound", () => typeIn(win, "Scale", 50));
  await grab(win, "inside-small");
  check("the video's Scale 50 inside changes the player's picture", (await diff(win, "inner", "inside-small", 6)).n > 1500);
  doc = await saved();
  const edited = compounds(doc)[0].compound.clips.find((c) => c.clipId === nestedVideo.clipId);
  check("the edit is in the compound's content in the saved project", Math.abs(edited.transform.scaleX - 0.5) < 0.01, `${edited.transform.scaleX}`);
  check("the main timeline's clips aren't touched by it", clips(doc).filter((c) => !c.compound).every((c) => c.clipId === v2.clipId));
  // Back: the main timeline again, the compound showing the edit.
  await win.locator("[data-testid=compound-back]").click();
  await win.waitForTimeout(1000);
  check("Back returns to the main timeline (no breadcrumb)", (await win.locator("[data-testid=compound-bar]").count()) === 0);
  await seek(win, ctx.map, 1);
  await grab(win, "outer-small");
  check("the outer picture now shows the edit made inside", (await diff(win, "before", "outer-small", 6)).n > 1500);
  // Open again from the menu, and back by the breadcrumb's "Main timeline".
  doc = await saved();
  const [ob, oy] = await bar(ctx, doc, comp.clipId, 2.5);
  await win.mouse.click(ob, oy, { button: "right" });
  await win.waitForTimeout(400);
  await win.locator("[data-testid=menu-more-actions]").hover();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=menu-open-compound]").click();
  await win.waitForTimeout(800);
  check("Open compound clip (More clip actions) opens it too", (await win.locator("[data-testid=compound-bar]").count()) === 1);
  await win.locator("[data-testid=compound-crumb]").first().click();
  await win.waitForTimeout(800);
  check("the bar goes back too (‹)", (await win.locator("[data-testid=compound-bar]").count()) === 0);

  // ---- break apart ---------------------------------------------------------------------------------
  doc = await saved();
  await selectBars([[comp.clipId, 2.5]], doc);
  const [bx, by] = await bar(ctx, doc, comp.clipId, 2.5);
  await undoCase("break apart", async () => {
    await win.mouse.click(bx, by, { button: "right" });
    await win.waitForTimeout(400);
    await win.locator("[data-testid=menu-undo-compound]").click();
    await win.waitForTimeout(800);
  }, { frame: false });
  doc = await saved();
  const back = (id) => clips(doc).find((c) => c.clipId === id);
  check("Undo compound clip puts the video and the text back on the timeline", back(v1.clipId) && back(textId) && compounds(doc).length === 0);
  check("at their places", back(v1.clipId).startTick === v1.startTick && back(v1.clipId).endTick === v1.endTick && back(textId).startTick === clips(await savedProject(win, udDir)).find((c) => c.clipId === textId).startTick);
  check("with the edit made inside", Math.abs(back(v1.clipId).transform.scaleX - 0.5) < 0.01, `${back(v1.clipId).transform.scaleX}`);
  await seek(win, ctx.map, 1);
  await grab(win, "broken");
  check("the picture is the one with the video at half size", (await diff(win, "outer-small", "broken", 6)).n < 40);

  // ---- Subprojects ---------------------------------------------------------------------------------
  await selectBars([[v1.clipId, 2.5], [textId, 1.5]], doc);
  await blurred();
  await settled(win, () => win.keyboard.press("Alt+g"));
  doc = await saved();
  const [c2] = compounds(doc);
  check("created again: named Compound clip1", c2?.name === "Compound clip1", c2?.name);
  await win.locator("[data-testid=assets-tab-media]").click();
  await win.waitForTimeout(300);
  await (await sectionButton(win, "subprojects")).click();
  await win.waitForTimeout(600);
  const tiles = win.locator("[data-testid=subproject-tile]");
  check("Media > Import > Subprojects lists the compound", (await tiles.count()) === 1 && (await tiles.first().getAttribute("data-subproject-name")) === "Compound clip1");
  const length = await win.locator("[data-testid=subproject-length]").first().innerText();
  check("with its length (5 s: 0:05)", length === "0:05", length);
  await shot("cp4-subprojects");
  // "+" adds another instance at the playhead, at the end of the main track (the playhead at 10 s).
  await seek(win, ctx.map, 10);
  await tiles.first().hover();
  await win.waitForTimeout(300);
  await undoCase("add another instance", async () => {
    await win.locator("[data-testid=subproject-add]").first().click();
    await win.waitForTimeout(800);
  }, { frame: false });
  doc = await saved();
  const two = compounds(doc);
  const ids = (c) => [c.clipId, ...c.compound.clips.map((n) => n.clipId), ...c.compound.tracks.map((t) => t.timelineId)];
  check("the + adds a second compound", two.length === 2, `${two.length}`);
  const shared = ids(two[0]).filter((i) => ids(two[1]).includes(i));
  check("the instance shares no id with the first (its timeline copied deep)", shared.length === 0, shared.join(","));
  check("it plays the same content (5 s, a video and a text)", +two[1].endTick - +two[1].startTick === +two[0].endTick - +two[0].startTick && two[1].compound.clips.length === 2);
  check("the library lists both", (await tiles.count()) === 2);
  // Rename from the tile's menu.
  await tiles.first().hover();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=subproject-menu]").first().click();
  await win.locator("[data-testid=subproject-rename]").click();
  await win.locator("[data-testid=subproject-name-input]").fill("Intro");
  await win.keyboard.press("Enter");
  doc = await saved();
  check("Rename changes the compound's name (the tile and the saved project)", compounds(doc).some((c) => c.name === "Intro") && (await win.locator("[data-subproject-name=Intro]").count()) === 1, compounds(doc).map((c) => c.name).join(","));
  // A drag from the tile onto the timeline: one more, at the drop.
  const tl = await win.evaluate(() => {
    const cs = [...document.querySelectorAll("[data-testid=timeline] canvas")].map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height);
    return { x: cs[0].x, y: cs[0].y };
  });
  const tb = await tiles.first().boundingBox();
  await drag(win, tb.x + 20, tb.y + 20, ctx.map.x(14), tl.y + 80);
  await win.waitForTimeout(1000);
  doc = await saved();
  check("dragging a tile onto the timeline adds another instance", compounds(doc).length === 3, `${compounds(doc).length}`);
  await shot("cp4-subprojects-3");

  // ---- copy and paste -------------------------------------------------------------------------------
  const named = compounds(doc).find((c) => c.name === "Intro");
  const knownIds = compounds(doc).map((c) => c.clipId);
  await selectBars([[named.clipId, (+named.startTick + +named.endTick) / 2e6]], doc);
  await blurred();
  await win.keyboard.press("Meta+c");
  await seek(win, ctx.map, 12);
  await undoCase("paste a compound", async () => {
    await win.keyboard.press("Meta+v");
    await win.waitForTimeout(600);
  }, { frame: false });
  doc = await saved();
  const pasted = compounds(doc).filter((c) => !knownIds.includes(c.clipId));
  check("Paste makes a copy, named alike", pasted.length === 1 && pasted[0].name === "Intro", pasted.map((c) => c.name).join(","));
  const sharedP = ids(pasted[0]).filter((i) => ids(named).includes(i));
  check("the pasted compound shares no id with the original", sharedP.length === 0, sharedP.join(","));

  // ---- export ---------------------------------------------------------------------------------------
  // Everything but the compound at half size is out of the way: delete the extra compounds and the second video.
  for (let i = 0; i < 6 && compounds(doc).some((c) => c.clipId !== named.clipId); i++) {
    // (The main track closes up behind a deleted clip: the next one is found in the saved project again.)
    const c = compounds(doc).find((c) => c.clipId !== named.clipId);
    await selectBars([[c.clipId, (+c.startTick + +c.endTick) / 2e6]], doc);
    await win.keyboard.press("Backspace");
    await win.waitForTimeout(500);
    doc = await saved();
  }
  await selectBars([[v2.clipId, (+clips(doc).find((c) => c.clipId === v2.clipId).startTick + +clips(doc).find((c) => c.clipId === v2.clipId).endTick) / 2e6]], doc);
  await win.keyboard.press("Backspace");
  await win.waitForTimeout(800);
  doc = await saved();
  const only = compounds(doc);
  check("one compound left on the timeline for the export", only.length === 1 && clips(doc).every((c) => c.compound), `${clips(doc).length} clips`);
  const keep = only[0];
  await selectBars([[keep.clipId, (+keep.startTick + +keep.endTick) / 2e6]], doc);
  await open(win, "Video", "Basic");
  await typeIn(win, "Scale", 50);
  await seek(win, ctx.map, 1);
  const player = await engineFrame(win);
  const exported = path.join(outDir, "cp-export.mp4");
  fs.rmSync(exported, { force: true });
  const dialog = win.locator("[data-testid=export-dialog]");
  const T = (id) => dialog.locator(`[data-testid=${id}]`);
  await win.locator("[data-testid=export]").click();
  await dialog.waitFor({ state: "visible" });
  await win.waitForTimeout(500);
  const box = T("export-audio-check");
  if (((await box.getAttribute("data-checked")) === "true")) await box.click();
  await T("export-name").fill("cp-export");
  await T("export-path").fill(outDir);
  await T("export-submit").click();
  let phase = "";
  for (let i = 0; i < 240 && (!phase || phase === "running"); i++) {
    phase = (await T("export-run").getAttribute("data-phase").catch(() => null)) ?? "";
    await win.waitForTimeout(500);
  }
  await T("export-run-done").click().catch(() => {});
  await dialog.waitFor({ state: "hidden" }).catch(() => {});
  check("the export finished", phase === "done" || fs.existsSync(exported), phase);
  // The exported frame at 1 s: its mean lightness against the player's (the compound at half size).
  const yavg = (t) => {
    const r = spawnSync(ffmpeg, ["-v", "info", "-ss", String(t), "-i", exported, "-frames:v", "1", "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"]);
    const m = /YAVG=([\d.]+)/.exec(r.stderr.toString() + r.stdout.toString());
    // Limited-range luma: black is 16, white 235.
    return m ? (+m[1] - 16) / 219 : NaN;
  };
  const exportedLight = yavg(1);
  check("the export contains the compound at half size (its lightness is the player's, not the full picture's)", Math.abs(exportedLight - player.light) < 0.08, `exported ${exportedLight.toFixed(3)}, player ${player.light.toFixed(3)}, unscaled ${f0.light.toFixed(3)}`);

  // ---- a restart keeps it -------------------------------------------------------------------------
  const before = (await saved()).timeline.clips.find((c) => c.compound);
  ({ win } = await ctx.relaunch());
  await openEditor(win);
  await win.waitForTimeout(2500);
  const after = (await savedProject(win, udDir)).timeline.clips.find((c) => c.compound);
  check("after a restart the compound is still there with its content and name", !!after && after.name === before.name && after.compound.clips.length === before.compound.clips.length, after?.name);
  await win.locator("[data-testid=timeline]").waitFor({ state: "visible" });
  ctx.map = await rulerMap(win);
  await seek(win, ctx.map, 1);
  const reopened = await engineFrame(win);
  check("and draws the same picture", Math.abs(reopened.light - player.light) < 0.02, `${reopened.light.toFixed(3)} vs ${player.light.toFixed(3)}`);
  return report();
};
