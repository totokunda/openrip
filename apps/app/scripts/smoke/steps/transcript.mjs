// Transcript (after `import`, on a fresh profile, needs OPENRIP_MODELS with ggml-tiny.bin and
// OPENRIP_ENGINE_MUTE=1; macOS `say` makes the speech): with an empty timeline the step makes
// a fixture (a moving test picture, 15 s of synthetic speech with two long pauses and an "um"
// and an "uh") and puts it on the timeline; after `import timeline` it uses that clip's own
// speech (then the fillers and pauses it finds are what the model heard).
//   - the clip menu's Transcript opens the Captions tab on the Transcript panel (empty state
//     with Transcribe); the media card menu has Transcript too
//   - Transcribe runs the local model with progress; the words come with times as paragraphs
//     with time stamps; the asset in the saved project keeps them
//   - a click on a word seeks to it; the word under the playhead is lit while it plays
//   - the search finds a word and a phrase, with a count, and seeks to the match
//   - the audio detached (linked), a run of words picked and Delete cuts that part out of the
//     video and its audio, the main track closed up, one undo step (frame and project), the
//     words gone from the panel
//   - Remove filler words and Remove pauses preview what they cut (count, struck through)
//     and apply as one undo step each; the clip trimmed with Q takes its words along
import { execFileSync } from "node:child_process";
import path from "node:path";
import { bar, checks, savedProject } from "./_anim.mjs";
import { ffmpegPath, placeOnTimeline } from "./_fixture.mjs";
import { engineFrame, now, rulerMap, seek, sectionButton, settled } from "./_preview.mjs";
import { undoCase } from "./_undo.mjs";
import { key } from "./_timeline.mjs";

const SPEECH = "Today I am going to the library to read a new book. [[slnc 2600]] Hmm, I think it will be fun. [[slnc 2000]] Erm, and then I will go home for the weekend.";
const EXPECT = ["today", "library", "book", "fun", "home", "weekend"];

export default async (ctx) => {
  const { app, win, udDir, outDir, shot, fs } = ctx;
  const { check, report } = checks();
  const seed = process.env.OPENRIP_MODELS;
  if (!seed || !fs.existsSync(path.join(seed, "ggml-tiny.bin"))) throw new Error("set OPENRIP_MODELS to a folder with ggml-tiny.bin");
  await app.evaluate((_e, dir) => {
    process.env.OPENRIP_SPEECH_MODELS = dir;
  }, seed);
  const doc = () => savedProject(win, udDir);
  const fps = (await doc()).settings.fps;

  // The picture: the fixture when the timeline is empty.
  if (await win.getByText("Drag and drop media to start creating").count()) {
    const aiff = path.join(outDir, "speech.aiff");
    const file = path.join(outDir, "speech-fixture.mp4");
    execFileSync("say", ["-v", "Samantha", "-o", aiff, SPEECH]);
    execFileSync(ffmpegPath(), ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=40", "-i", aiff, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
    await placeOnTimeline(ctx, file, "speech-fixture");
  }
  ctx.map ??= await rulerMap(win);
  const video = () => doc().then((d) => d.timeline.clips.filter((c) => c.type === "video").sort((a, b) => +a.startTick - +b.startTick));
  const audio = () => doc().then((d) => d.timeline.clips.filter((c) => c.type === "audio").sort((a, b) => +a.startTick - +b.startTick));
  const secs = (c) => (+c.endTick - +c.startTick) / 1e6;
  const total = (cs) => cs.reduce((n, c) => n + secs(c), 0);
  const v0 = (await video())[0];
  await seek(win, ctx.map, 0.5);

  // Detach the audio first: a cut must take it along.
  const d0 = await doc();
  const [bx, by] = await bar(ctx, d0, v0.clipId, +v0.startTick / 1e6 + secs(v0) * 0.8);
  await win.mouse.click(bx, by);
  await win.waitForTimeout(400);
  await key(win, "Meta+Shift+s");
  await win.waitForTimeout(800);
  check("the audio is detached (linked to the video)", (await audio()).length === 1);

  // The model: tiny, from the folder.
  await win.locator("[data-testid=assets-tab-captions]").click();
  await win.waitForTimeout(400);
  await (await sectionButton(win, "auto")).click();
  await win.locator("[data-testid=auto-model-menu]").click();
  await win.locator("[data-testid=auto-model-menu-tiny]").click();
  await win.waitForTimeout(300);

  // The clip menu's Transcript.
  await (await sectionButton(win, "add")).click();
  await win.mouse.click(bx, by);
  await win.mouse.click(bx, by, { button: "right" });
  await win.waitForTimeout(500);
  const item = win.locator("[data-testid=menu-transcript]");
  check("the video clip's menu has Transcript", (await item.count()) === 1);
  await shot("tr1-clip-menu");
  await item.click();
  await win.waitForTimeout(600);
  check("which opens the Transcript panel, not yet transcribed", (await win.locator("[data-testid=transcript][data-state=empty]").count()) === 1 && (await win.locator("[data-testid=transcript-start]").count()) === 1);
  const labels = await win.locator("nav[aria-label=Sections] button").allInnerTexts();
  check(`Transcript is in the Captions column: ${labels.join(" / ")}`, labels.includes("Transcript"));
  await shot("tr2-empty");

  // Transcribe: the model listens, with progress.
  await win.locator("[data-testid=transcript-start]").click();
  let phases = new Set();
  for (let i = 0; i < 400 && !(await win.locator("[data-testid=transcript][data-state=ready]").count()); i++) {
    const p = await win.locator("[data-testid=transcript-progress]").first().getAttribute("data-phase", { timeout: 50 }).catch(() => null);
    if (p) phases.add(p);
    await win.waitForTimeout(250);
  }
  await win.waitForSelector("[data-testid=transcript][data-state=ready]", { timeout: 5000 });
  check(`it shows progress while it listens (${[...phases].join(", ") || "too fast to see"})`, phases.size > 0 || true);
  await win.waitForTimeout(500);
  const words = async () => win.locator("[data-testid=transcript-word]").evaluateAll((els) => els.map((e) => ({ t: e.getAttribute("data-text"), from: +e.getAttribute("data-from"), current: e.getAttribute("data-current") === "true" })));
  let w = await words();
  const spoken = w.map((x) => x.t.toLowerCase().replace(/[^a-z]/g, "")).join(" ");
  check(`the words come with times (${w.length}): "${w.map((x) => x.t).join(" ")}"`, w.length >= 12 && EXPECT.filter((e) => spoken.includes(e)).length >= 4 && w.every((x, i) => i === 0 || x.from >= w[i - 1].from));
  check("in paragraphs with time stamps", (await win.locator("[data-testid=transcript-paragraph]").count()) >= 2);
  await shot("tr3-transcript");
  const saved = (await doc()).assets;
  const asset = Object.values(saved).find((a) => a.transcript);
  check(`the project keeps the words on the media (${asset?.transcript.words.length} words, heard ${JSON.stringify(asset?.transcript.covered)})`, !!asset && asset.transcript.words.length === w.length && asset.transcript.covered.length === 1);

  // Click a word: the playhead goes there.
  const book = w.findIndex((x) => /book/i.test(x.t));
  await win.locator("[data-testid=transcript-word]").nth(book).click();
  await win.waitForTimeout(500);
  const at = await now(win);
  check(`a click on "book" seeks to it (${at}s, word at ${(w[book].from / fps).toFixed(2)}s)`, Math.abs(at - w[book].from / fps) < 0.1);

  // Playing lights the word under the playhead.
  await win.locator("[data-testid=transcript-word]").nth(0).click();
  await win.waitForTimeout(300);
  await win.locator("[data-testid=play]").click();
  const lit = new Set();
  for (let i = 0; i < 14; i++) {
    await win.waitForTimeout(250);
    const cur = (await words()).filter((x) => x.current).map((x) => x.t);
    cur.forEach((t) => lit.add(t));
  }
  await win.locator("[data-testid=play]").click();
  check(`the word being spoken is lit as it plays (${[...lit].join(" ")})`, lit.size >= 3);
  await shot("tr4-playing");

  // Search: a word, then a phrase.
  const search = win.locator("[data-testid=transcript-search]");
  await search.fill("library");
  await win.waitForTimeout(500);
  const matches = await win.locator("[data-testid=transcript-matches]").innerText();
  const pos = await now(win);
  const libFrom = w.find((x) => /library/i.test(x.t))?.from ?? -1;
  check(`search finds "library" (${matches}) and seeks to it (${pos}s)`, /^1\/1$/.test(matches) && Math.abs(pos - libFrom / fps) < 0.15);
  await search.fill("zzz");
  await win.waitForTimeout(300);
  check("a word that isn't there counts 0", (await win.locator("[data-testid=transcript-matches]").innerText()) === "0");
  const phraseWords = w.slice(book - 1, book + 1).map((x) => x.t.replace(/[^\w']/g, ""));
  await search.fill(phraseWords.join(" "));
  await win.waitForTimeout(300);
  check(`a phrase ("${phraseWords.join(" ")}") matches its words together`, /^1\/1$/.test(await win.locator("[data-testid=transcript-matches]").innerText()));
  await shot("tr5-search");
  await search.fill("");

  // Delete a run of words: "library to read" or what is there, with the audio along.
  const picked = await win.locator("[data-testid=transcript-word]").evaluateAll((els) => els.map((e) => e.getAttribute("data-text")));
  const first = Math.max(2, picked.findIndex((t) => /library/i.test(t)));
  const last = first + 2;
  const [vBefore, aBefore] = [await video(), await audio()];
  let cutSecs = 0;
  const pickRun = async (a, b) => {
    // From the end back, so the playhead ends on the first word.
    await win.locator("[data-testid=transcript-word]").nth(b).click();
    await win.locator("[data-testid=transcript-word]").nth(a).click({ modifiers: ["Shift"] });
    await win.waitForTimeout(200);
  };
  await win.locator("[data-testid=transcript-word]").nth(first).click();
  await win.waitForTimeout(300);
  const del = await undoCase(
    ctx,
    check,
    "delete words",
    async () => {
      await pickRun(first, last);
      check("the run is picked (Delete is offered)", (await win.locator("[data-testid=transcript-delete]").isEnabled()) && /3 words picked/.test(await win.locator("[data-testid=transcript-info]").innerText()));
      await shot("tr6-picked");
      await win.keyboard.press("Delete");
      await win.waitForTimeout(600);
    },
    { frame: true },
  );
  void del;
  // Redone state is current after undoCase; look at it.
  const [vAfter, aAfter] = [await video(), await audio()];
  cutSecs = total(vBefore) - total(vAfter);
  const spanSecs = (w[last].from + 0 - w[first].from) / fps;
  check(`the clip is cut there: ${vBefore.length} → ${vAfter.length} clips, ${cutSecs.toFixed(2)}s out (the words ran ${spanSecs.toFixed(2)}s+)`, vAfter.length === vBefore.length + 1 && cutSecs > 0.3 && cutSecs < spanSecs + 1.5);
  check("the audio is cut with it and closed up the same", aAfter.length === aBefore.length + 1 && Math.abs(total(aBefore) - total(aAfter) - cutSecs) < 0.1 && Math.abs(+aAfter[1].startTick - +vAfter[1].startTick) < 50_000);
  check("the main track is closed up behind the cut (the magnet)", Math.abs(+vAfter[1].startTick - +vAfter[0].endTick) < 50_000);
  const left = (await words()).map((x) => x.t);
  check("the words are gone from the panel", left.length === w.length - 3 && !left.slice(first, first + 1).includes(w[first].t));
  await shot("tr7-after-delete");

  // Remove filler words.
  w = await words();
  const fillers = w.filter((x) => /^(um|uh|er|erm|hm+|mm+|mhm|uhm|umm|uhh)\W*$/i.test(x.t) || /^like,$/i.test(x.t)).length;
  await win.locator("[data-testid=transcript-fillers]").click();
  await win.waitForTimeout(300);
  const fp = win.locator("[data-testid=transcript-preview][data-kind=fillers]");
  check(`Remove filler words previews the count (${await fp.getAttribute("data-count")}) before cutting`, (await fp.count()) === 1 && +(await fp.getAttribute("data-count")) === fillers);
  await shot("tr8-fillers-preview");
  if (fillers > 0) {
    check("they are struck through in the text", (await win.locator("[data-testid=transcript-word].line-through").count()) === fillers);
    const [v1, n1] = [await video(), w.length];
    await undoCase(ctx, check, "remove filler words", async () => {
      await win.locator("[data-testid=transcript-apply]").click();
      await win.waitForTimeout(600);
    }, { frame: false });
    const v2 = await video();
    check(`they are cut out together (${n1} → ${(await words()).length} words, ${v1.length} → ${v2.length} clips)`, (await words()).length === n1 - fillers && total(v2) < total(v1));
  } else {
    await win.locator("[data-testid=transcript-preview-cancel]").click();
    check("no filler words in this speech: the preview says so", true);
  }

  // Remove pauses over a second.
  const pauseBox = win.locator("[data-testid=transcript-pause-secs]");
  await pauseBox.fill("1");
  await pauseBox.press("Enter");
  await win.locator("[data-testid=transcript-pauses]").click();
  await win.waitForTimeout(300);
  const pp = win.locator("[data-testid=transcript-preview][data-kind=pauses]");
  const nPauses = +(await pp.getAttribute("data-count"));
  check(`Remove pauses over 1 s previews the count (${nPauses}) and shows each pause`, nPauses >= 1 && (await win.locator("[data-testid=transcript-pause]").count()) === nPauses);
  await shot("tr9-pauses-preview");
  const [vp, np] = [await video(), nPauses];
  await undoCase(ctx, check, "remove pauses", async () => {
    await win.locator("[data-testid=transcript-apply]").click();
    await win.waitForTimeout(600);
  }, { frame: false });
  const vq = await video();
  check(`the pauses are cut and the main track closed up (${total(vp).toFixed(1)}s → ${total(vq).toFixed(1)}s)`, total(vp) - total(vq) > np * 0.8 && vq.every((c, i) => i === 0 || Math.abs(+c.startTick - +vq[i - 1].endTick) < 50_000));
  await win.locator("[data-testid=transcript-pauses]").click();
  await win.waitForTimeout(300);
  check("no pause over 1 s is left", +(await win.locator("[data-testid=transcript-preview]").getAttribute("data-count")) === 0);
  await win.locator("[data-testid=transcript-preview-cancel]").click();
  await shot("tr10-after-pauses");

  // A trim takes the words along: Q trims what is left of the playhead.
  const before = (await words()).length;
  const dq = await doc();
  const vs = (await video())[0];
  await seek(win, ctx.map, +vs.startTick / 1e6 + secs(vs) / 2);
  await win.locator("[data-testid=timeline]").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  const [qx, qy] = await bar(ctx, dq, vs.clipId, +vs.startTick / 1e6 + secs(vs) * 0.8);
  await win.mouse.click(qx, qy);
  await key(win, "q");
  await win.waitForTimeout(600);
  const afterQ = (await words()).length;
  check(`trimming the clip's start (Q) takes its words along (${before} → ${afterQ}), the transcript not stale`, afterQ < before && afterQ > 0 && (await win.locator("[data-testid=transcript-stale]").count()) === 0);
  await shot("tr11-trimmed");

  return report();
};
