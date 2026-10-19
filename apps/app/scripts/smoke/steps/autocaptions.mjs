// Auto captions (after import timeline, on a clip with speech: IMG_9079, CLIP_NAME=IMG_9079,
// OPENRIP_ENGINE_MUTE=1): the Captions tab opens on Auto captions as CapCut's does (spoken
// language menu with Auto detect first, caption style, keyword and filler switches, Delete
// current captions, Generate); the speech model is downloaded on first use from a local server
// standing in for Hugging Face (the tiny model, from $OPENRIP_MODELS/ggml-tiny.bin; throttled
// so its progress can be seen), checked against its SHA-256 and kept in the profile's models
// folder; Cancel stops a download; Generate shows its progress and ends with a captions track
// whose words roughly match the speech, with each word's timing; a word-by-word style is drawn
// by the engine (the highlighted word moves with the speech, karaoke fills, pop reveals, a box
// follows the word); one undo step; Generate again replaces the track; Delete model; and the
// clip menu's Generate captions opens the panel for the clip.
import http from "node:http";
import path from "node:path";
import { diff, engineFrame, grab, rulerMap, seek, settled, sectionButton } from "./_preview.mjs";
import { bar, checks, savedProject, select } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";

// Words the clip says that even the tiny model gets (IMG_9079: "…English vlog. Today I'm going to the library to read a new book for the weekend.").
const EXPECT = (process.env.SPEECH_EXPECT || "today going library read new book weekend english").split(" ");

/** The mean x (as a fraction of the width) and the number of pixels `test` accepts in the lower part of the frame. */
const lower = (win, test) =>
  win.evaluate((test) => {
    const c = document.getElementById("openrip-engine-frame");
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, Math.floor(t.height * 0.6), t.width, t.height - Math.floor(t.height * 0.6)).data;
    const pick = new Function("r", "g", "b", `return ${test};`);
    let n = 0;
    let sx = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (pick(d[i], d[i + 1], d[i + 2])) {
        n++;
        sx += ((i / 4) % t.width) / t.width;
      }
    }
    return { n, x: n ? sx / n : -1 };
  }, test);

export default async (ctx) => {
  const stop = [];
  try {
    return await run(ctx, stop);
  } finally {
    stop.forEach((f) => f());
  }
};

const run = async (ctx, stop) => {
  const { app, win, udDir, shot, outDir, fs } = ctx;
  // The caption styles are under Templates, a category at a time (as CapCut's): find the tile in its category.
  const TEMPLATE_SECTIONS = ["templates:basic", "templates:highlight", "templates:karaoke", "templates:pop", "templates:boxed"];
  const styleTile = async (id) => {
    for (const section of TEMPLATE_SECTIONS) {
      await (await sectionButton(win, section)).click();
      await win.waitForTimeout(150);
      if (await win.locator(`[data-testid=caption-style-${id}]`).count()) return win.locator(`[data-testid=caption-style-${id}]`);
    }
    throw new Error(`no caption style ${id}`);
  };
  const pickStyle = async (id) => (await styleTile(id)).click();
  const { check, report } = checks();
  const modelDir = path.join(outDir, "speech-models");
  fs.rmSync(modelDir, { recursive: true, force: true });
  const seedDir = process.env.OPENRIP_MODELS;
  if (!seedDir || !fs.existsSync(path.join(seedDir, "ggml-tiny.bin"))) throw new Error("set OPENRIP_MODELS to a folder with ggml-tiny.bin");
  const tiny = fs.readFileSync(path.join(seedDir, "ggml-tiny.bin"));

  // A stand-in for Hugging Face, slow enough to watch: 1 MB every 50 ms.
  let served = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== "/ggml-tiny.bin") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": tiny.length });
    let at = 0;
    const next = () => {
      if (res.destroyed || at >= tiny.length) return res.end();
      const end = Math.min(tiny.length, at + 1_000_000);
      res.write(tiny.subarray(at, end), () => {
        served += end - at;
        at = end;
        setTimeout(next, 50);
      });
    };
    next();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  stop.push(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  await app.evaluate((_e, [dir, base]) => {
    process.env.OPENRIP_SPEECH_MODELS = dir;
    process.env.OPENRIP_SPEECH_DOWNLOAD_BASE = base;
  }, [modelDir, base]);

  const doc = () => savedProject(win, udDir);
  const autoClips = async () => (await doc()).timeline.clips.filter((c) => c.type === "text" && c.autoCaption).sort((a, b) => +a.startTick - +b.startTick);
  ctx.map ??= await rulerMap(win);
  const video = (await doc()).timeline.clips.find((c) => c.type === "video");
  const videoSecs = (+video.endTick - +video.startTick) / 1e6;
  await seek(win, ctx.map, 0.5);

  // The panel, as CapCut's Auto captions.
  await win.locator("[data-testid=assets-tab-captions]").click();
  await win.waitForTimeout(500);
  const labels = await win.locator("nav[aria-label=Sections] button").allInnerTexts();
  check(`the Captions column: ${labels.join(" / ")}`, labels.join("|") === "Auto captions|Templates|Auto lyrics|Transcript|Add captions");
  check("Auto captions has no style row: the styles are under Templates, as in CapCut", (await win.locator("[data-testid=auto-style-strip]").count()) === 0);
  check("opens on Auto captions", (await win.locator("[data-testid=auto-captions]").count()) === 1);
  const text = await win.locator("[data-testid=auto-captions]").innerText();
  check("Spoken language, Auto detect, keywords, filler words, Delete current captions, Generate", /Spoken language/.test(text) && /Auto detect/.test(text) && /Auto highlight keywords/.test(text) && /Identify filler words/.test(text) && /Delete current captions/.test(text) && /Generate/.test(text));
  await shot("ac1-auto-captions");
  await win.locator("[data-testid=auto-language]").click();
  await win.waitForTimeout(300);
  const langs = await win.locator("[data-testid=auto-language-list] button").allInnerTexts();
  check(`the language menu starts with Auto detect (${langs.slice(0, 5).join(", ")}…)`, langs[0] === "Auto detect" && langs.includes("English") && langs.includes("Spanish") && langs.length > 20);
  await shot("ac2-language-menu");
  await win.locator("[data-testid=auto-language-auto]").click();

  // Pick the tiny model (smaller than the default, for speed), a word-highlight style, filler words off and keywords on.
  await win.locator("[data-testid=auto-model-menu]").click();
  await win.waitForTimeout(300);
  const models = await win.locator("[data-testid=auto-model-menu-list] button").allInnerTexts();
  check(`the model list: ${models.map((m) => m.replace(/\s+/g, " ")).join("; ")}`, models.length === 10 && models.some((m) => /Large v3 Turbo/.test(m)) && models.some((m) => /Tiny \(English\)/.test(m)) && models.every((m) => /MB|GB/.test(m)));
  await shot("ac3-model-menu");
  await win.locator("[data-testid=auto-model-menu-tiny]").click();
  await pickStyle("highlight-yellow");
  await (await sectionButton(win, "auto")).click();
  await win.waitForTimeout(300);
  await win.locator("[role=switch][aria-label='Auto highlight keywords']").click();
  await win.waitForTimeout(200);
  check("the model says it isn't downloaded yet", /downloaded once/.test(await win.locator("[data-testid=auto-model]").innerText()) && (await win.locator("[data-testid=auto-model-download]").count()) === 1);

  // Generate downloads the model first: progress, then Cancel stops it with nothing kept.
  await win.evaluate(() => {
    window.__seen = new Set();
    new MutationObserver(() => {
      const e = document.querySelector("[data-testid=auto-progress]");
      if (e) window.__seen.add(`${e.dataset.phase}`);
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  const clipsBefore = (await doc()).timeline.clips.length;
  await win.locator("[data-testid=auto-generate]").click();
  await win.waitForSelector("[data-testid=auto-progress][data-phase=downloading]", { timeout: 5000 });
  await win.waitForTimeout(700);
  const mid = +(await win.locator("[data-testid=auto-progress]").getAttribute("data-progress"));
  await shot("ac4-downloading");
  check(`the download shows progress (${(mid * 100).toFixed(0)}% after 0.7 s)`, mid > 0.02 && mid < 1);
  await win.locator("[data-testid=auto-cancel]").click();
  await win.waitForSelector("[data-testid=auto-generate]", { timeout: 5000 });
  check("Cancel stops the download: no model kept, no .part left, nothing added", !fs.existsSync(path.join(modelDir, "ggml-tiny.bin")) && !fs.existsSync(path.join(modelDir, "ggml-tiny.bin.part")) && (await doc()).timeline.clips.length === clipsBefore);

  // Generate again: download (verified), then recognize, as one step.
  const f0 = await engineFrame(win);
  const run = await undoCase(ctx, check, "generate captions", async () => {
    await win.locator("[data-testid=auto-generate]").click();
    await win.waitForSelector("[data-testid=auto-progress][data-phase=downloading]", { timeout: 5000 });
    await win.waitForSelector("[data-testid=auto-generate]", { timeout: 120000 });
    await win.waitForTimeout(800);
  });
  const seen = await win.evaluate(() => [...window.__seen]);
  check(`it showed the download and the recognition (${seen.join(", ")})`, seen.includes("downloading") && seen.includes("working"));
  check("the model is in the app data, whole and checked (its SHA-256 matched)", fs.existsSync(path.join(modelDir, "ggml-tiny.bin")) && fs.statSync(path.join(modelDir, "ggml-tiny.bin")).size === tiny.length && !fs.existsSync(path.join(modelDir, "ggml-tiny.bin.part")));
  check("and it read the file from the stand-in server", served >= tiny.length);
  const made = await autoClips();
  const tracks = new Set(made.map((c) => c.timelineId));
  check(`captions on a track of their own (${made.length} captions)`, made.length >= 3 && tracks.size === 1);
  const heard = made.map((c) => c.text.replace(/\n/g, " ")).join(" ");
  const norm = heard.toLowerCase().replace(/[^a-z' ]/g, "");
  const hit = EXPECT.filter((w) => norm.split(" ").includes(w));
  check(`the words match the speech roughly (${hit.length}/${EXPECT.length}): "${heard}"`, hit.length >= Math.ceil(EXPECT.length * 0.6));
  const first = made[0];
  check(
    "each caption has its words with timing, in order, inside the caption",
    made.every((c) => Array.isArray(c.captionWords) && c.captionWords.length > 0 && c.captionWords.every((w, i, a) => w.end >= w.start && w.to > w.from && (i === 0 || (w.start >= a[i - 1].start && w.from >= a[i - 1].to)))),
    JSON.stringify(first.captionWords),
  );
  check("in the chosen style (Yellow word highlight), marked as made from speech", made.every((c) => c.captionStyle === "orip_highlight" && c.captionColor === "#ffe600" && c.spokenWords === true));
  check("the captions sit inside the video's length", +made[made.length - 1].endTick / 1e6 <= videoSecs + 0.6 && +made[0].startTick / 1e6 >= 0);
  check("keywords were flagged (the switch was on)", made.some((c) => c.captionWords.some((w) => w.keyword)), JSON.stringify(made.map((c) => c.captionWords.filter((w) => w.keyword).length)));
  await shot("ac5-generated");

  // Drawn word by word: the yellow word moves right across the line as the speech goes on.
  const cs = +first.startTick / 1e6;
  const words = first.captionWords;
  const yellow = "r > 235 && g > 200 && b < 70";
  const at = async (k) => {
    await seek(win, ctx.map, cs + (words[k].start + words[k].end) / 2);
    await win.waitForTimeout(500);
    return lower(win, yellow);
  };
  if (words.length >= 3) {
    const a = await at(0);
    const b = await at(words.length - 1);
    check(`highlight: the yellow word is drawn and moves along the line (${a.x.toFixed(2)} → ${b.x.toFixed(2)}, ${a.n}/${b.n} px)`, a.n > 60 && b.n > 60 && b.x > a.x + 0.05);
    await shot("ac6-highlight");
  }

  // The other word-by-word styles, from the Templates tab on the selected caption's track.
  await select(ctx, await doc(), first.clipId, cs + (+first.endTick / 1e6 - cs) * 0.75);
  await win.locator("[data-testid=assets-tab-captions]").click();
  await (await sectionButton(win, "templates:basic")).click();
  await win.waitForTimeout(400);
  await shot("ac7-templates");
  const groups = (await win.locator("nav[aria-label=Sections] button").allInnerTexts()).slice(2, 7);
  let styleCount = 0;
  for (const section of TEMPLATE_SECTIONS) {
    await (await sectionButton(win, section)).click();
    await win.waitForTimeout(150);
    styleCount += await win.locator("[data-testid^=caption-style-]").count();
  }
  await (await sectionButton(win, "templates:basic")).click();
  check(`Templates: ${groups.join(", ")}; ${styleCount} styles, a category at a time in a grid with the Generate foot`, groups.join("|") === "Basic|Word highlight|Karaoke fill|Word pop|Boxed word" && styleCount >= 48 && (await win.locator("[data-testid=caption-templates] [data-testid=auto-generate]").count()) === 1);
  const early = cs + (words[0].start + words[0].end) / 2;
  const late = cs + (words[words.length - 1].start + words[words.length - 1].end) / 2;
  const grabAt = async (s) => {
    await seek(win, ctx.map, s);
    await win.waitForTimeout(500);
    return lower(win, "r > 200 && g > 200 && b > 200");
  };
  // A template goes on the selected caption's whole track; a click on the ruler (a seek) drops the selection, so each one selects a caption first.
  const template = async (id) => {
    await select(ctx, await doc(), first.clipId, cs + (+first.endTick / 1e6 - cs) * 0.9);
    const tile = await styleTile(id);
    await settled(win, () => tile.click());
  };
  const frameAt = async (s, test) => {
    await seek(win, ctx.map, s);
    await win.waitForTimeout(500);
    return lower(win, test);
  };
  const white = "r > 200 && g > 200 && b > 200";
  // Karaoke: more of the line is filled (green) late than early.
  await template("karaoke-green");
  const green = "g > 190 && r < 110 && b < 150";
  const k0 = await frameAt(early, green);
  const k1 = await frameAt(late, green);
  check(`karaoke: the line fills as it's said (${k0.n} -> ${k1.n} green pixels)`, k1.n > k0.n * 1.5 && k1.n > 100);
  await shot("ac8-karaoke");
  // Pop: against the highlight (the same font and colours, the whole line shown), the words not yet said are missing early and all there late.
  await template("highlight-yellow");
  await frameAt(early, yellow);
  await grab(win, "hl-early");
  await frameAt(late, yellow);
  await grab(win, "hl-late");
  await template("pop-yellow");
  await frameAt(early, yellow);
  await grab(win, "pop-early");
  await shot("ac9a-pop-early");
  await frameAt(late, yellow);
  await grab(win, "pop-late");
  const d0 = (await diff(win, "hl-early", "pop-early")).n;
  const d1 = (await diff(win, "hl-late", "pop-late")).n;
  check(`pop: words appear as they're said (the frame differs from the highlight's by ${d0} px early, ${d1} px late)`, d0 > 600 && d1 < d0 / 3);
  await shot("ac9-pop");
  // Boxed: the box of the word being said is yellow and moves with it.
  await template("boxed-yellow");
  const x0 = await frameAt(early, yellow);
  const x1 = await frameAt(late, yellow);
  check(`boxed: a yellow box under the word, moving along (${x0.x.toFixed(2)} -> ${x1.x.toFixed(2)}, ${x0.n}/${x1.n} px)`, x0.n > 300 && x1.n > 300 && x1.x > x0.x + 0.05);
  await shot("ac10-boxed");
  // A plain template drops the word-by-word treatment (the text shows whole), the words stay.
  await template("default");
  const plain = await autoClips();
  check("a plain template on the track: whole text, the words kept", plain.every((c) => c.captionStyle === "none" && c.captionWords?.length), JSON.stringify(plain.map((c) => c.captionStyle)));

  // Generate again replaces the track the last one made (back to the yellow highlight), from the Templates foot.
  await pickStyle("highlight-yellow");
  const before = await autoClips();
  await settled(win, async () => {
    await win.locator("[data-testid=auto-generate]").click();
    await win.waitForSelector("[data-testid=auto-progress]", { timeout: 5000 }).catch(() => {});
    await win.waitForSelector("[data-testid=auto-generate]", { timeout: 60000 });
  });
  await win.waitForTimeout(1500);
  const after = await autoClips();
  const tracksAfter = (await doc()).timeline.tracks.filter((t) => after.some((c) => c.timelineId === t.timelineId));
  check(
    `Generate again replaces the track (${before.length} → ${after.length} captions, one track, new clips, yellow again)`,
    after.length === before.length && tracksAfter.length === 1 && !after.some((c) => before.some((b) => b.clipId === c.clipId)) && after.every((c) => c.captionStyle === "orip_highlight"),
  );
  const nTracks = (await doc()).timeline.tracks.length;
  // With "Delete current captions" off, a second track is added.
  await win.locator("[role=checkbox][aria-label='Delete current captions']").click();
  await win.locator("[data-testid=auto-generate]").click();
  await win.waitForSelector("[data-testid=auto-generate]", { timeout: 60000 });
  await win.waitForTimeout(1500);
  check("with Delete current captions off, a second captions track is added", (await doc()).timeline.tracks.length === nTracks + 1);
  await win.locator("[role=checkbox][aria-label='Delete current captions']").click();

  // The clip menu's Generate captions (a video clip), routing to the panel with the clip selected.
  // From Add captions (Templates has a Generate captions button of its own).
  await (await sectionButton(win, "add")).click();
  const d = await doc();
  const v = d.timeline.clips.find((c) => c.type === "video");
  const [vx, vy] = await bar(ctx, d, v.clipId, +v.startTick / 1e6 + videoSecs * 0.8);
  await win.mouse.click(vx, vy);
  await win.mouse.click(vx, vy, { button: "right" });
  await win.waitForTimeout(500);
  const item = win.getByText("Generate captions", { exact: true });
  check("the video clip's menu has Generate captions", (await item.count()) === 1);
  await shot("ac11-clip-menu");
  await item.click();
  await win.waitForTimeout(700);
  check(
    "which opens Auto captions listening to that clip",
    (await win.locator("[data-testid=auto-captions]").count()) === 1 && /selected clip's sound/.test(await win.locator("[data-testid=auto-source]").innerText()),
  );
  await shot("ac12-for-clip");
  // For the clip: its own sound, from the clip's start.
  await win.locator("[role=checkbox][aria-label='Delete current captions']").waitFor();
  await win.locator("[data-testid=auto-generate]").click();
  await win.waitForSelector("[data-testid=auto-generate]", { timeout: 60000 });
  await win.waitForTimeout(1500);
  const forClip = await autoClips();
  check(`for the clip: captions again, from its start (${forClip.length} on ${new Set(forClip.map((c) => c.timelineId)).size} track)`, forClip.length >= 3 && +forClip[0].startTick / 1e6 < 2);

  // Auto lyrics: the same panel, word-by-word styles only.
  await (await sectionButton(win, "lyrics")).click();
  await win.waitForTimeout(400);
  check("Auto lyrics is the same panel, its style from Templates", (await win.locator("[data-testid=auto-lyrics]").count()) === 1 && (await win.locator("[data-testid=auto-style-strip]").count()) === 0);
  await shot("ac13-auto-lyrics");

  // Delete the model: its file goes and the panel offers the download again.
  await (await sectionButton(win, "auto")).click();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=auto-model-delete]").click();
  await win.waitForTimeout(500);
  check("Delete model removes the file", !fs.existsSync(path.join(modelDir, "ggml-tiny.bin")) && (await win.locator("[data-testid=auto-model-download]").count()) === 1);
  void f0;
  void run;
  server.close();
  return report();
};
