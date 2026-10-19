// Record (the Media tab's button; after `import` of a small clip, with the timeline still empty;
// run with OPENRIP_FAKE_CAPTURE=1 OPENRIP_ENGINE_MUTE=1, which gives the page a canvas for the
// screen, Chromium's fake camera and a 440 Hz tone for the microphone, so nothing real is
// captured or asked):
// - the Record button opens the panel: Screen, Camera and Screen and camera, the screens listed;
// - a screen recording: 3-2-1, the time counting, Stop saves recordings/Recording 1.mp4 in the
//   project's media (H.264, 640×360, no sound), listed as a card in the Media tab;
// - a camera recording with the microphone: Recording 2.mp4 (the fake camera's 1280×720, AAC sound);
// - Screen and camera: Recording 3.mp4 with the camera's picture over the screen's corner;
// - the screen recording put on the timeline: the engine draws its blue, the saved project has
//   a clip as long as the recording on the file the library links.
import path from "node:path";
import { engineFrame } from "./_preview.mjs";
import { checks, savedProject } from "./_anim.mjs";
import { dragToEmptyTimeline, mediaDir, pixel, probe } from "./_recfixture.mjs";

const panel = (win) => win.locator("[data-testid=record-panel]");
const text = (win, id) => win.locator(`[data-testid=record-${id}]`).innerText();

/** Wait (up to `s` seconds) until the panel's status reads `re`; its text. */
const until = async (win, re, s = 10) => {
  let t = "";
  for (let i = 0; i < s * 10; i++) {
    t = await text(win, "status").catch(() => "");
    if (re.test(t)) return t;
    await win.waitForTimeout(100);
  }
  return t;
};

/** One take: Record, the count, `seconds` of recording, Stop; the status line when saved. */
const take = async (win, seconds) => {
  await win.locator("[data-testid=record-start]").click();
  const counting = await until(win, /Recording in [123]/, 2);
  if (!/Recording in [123]…/.test(counting)) throw new Error(`no countdown ("${counting}")`);
  await until(win, /^Recording…$/, 8);
  await win.waitForTimeout(seconds * 1000);
  const time = await text(win, "time");
  await win.locator("[data-testid=record-start]").click();
  return { time, saved: await until(win, /saved to Media|couldn't/, 60) };
};

export default async (ctx) => {
  const { win, shot, fs } = ctx;
  const { check, report } = checks();

  // ---- the panel ----
  await win.locator("[data-testid=media-record]").click();
  await win.waitForTimeout(800);
  check("Record opens the panel", await panel(win).isVisible());
  const tabs = await panel(win).locator("[role=tab]").allInnerTexts();
  check(`Screen, Camera and Screen and camera (${tabs.join(", ")})`, tabs.join(",") === "Screen,Camera,Screen and camera");
  const sources = await panel(win).locator("[data-testid=record-source]").count();
  check(`the screens and windows are listed (${sources})`, sources === 2);
  check(`it starts at ${await text(win, "time")}, "${await text(win, "status")}"`, (await text(win, "time")) === "00:00:00" && (await text(win, "status")) === "Recording not started");
  await shot("rec-1-panel");

  // ---- a screen recording ----
  const dir = path.join(mediaDir(ctx), "recordings");
  const one = await take(win, 2.2);
  check(`the screen take: counted, timed ${one.time}, saved ("${one.saved}")`, /^00:00:0[2-3]$/.test(one.time) && one.saved === "Recording 1 saved to Media");
  const f1 = path.join(dir, "Recording 1.mp4");
  const p1 = fs.existsSync(f1) ? probe(f1) : null;
  check(`Recording 1.mp4 is H.264 640x360 with no sound, ${p1?.seconds}s`, !!p1 && p1.codec === "h264" && p1.width === 640 && p1.height === 360 && !p1.audio && Math.abs(p1.seconds - 2.2) < 0.9, JSON.stringify(p1));
  const link = path.join(mediaDir(ctx), "symlinks", "Recording 1.mp4");
  check("it is linked into the media library", fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink());
  await win.locator("[data-testid=media-card][data-name='Recording 1.mp4']").waitFor({ timeout: 15000 });
  check("the Media tab lists it", (await win.locator("[data-testid=media-card][data-name='Recording 1.mp4']").count()) === 1);
  await shot("rec-2-saved");

  // ---- the camera, with the microphone ----
  await panel(win).locator("[data-testid=record-mode-camera]").click();
  await win.waitForTimeout(600);
  check("Camera lists the cameras and hides the screens", (await panel(win).locator("[data-testid=record-camera] option").count()) >= 1 && (await panel(win).locator("[data-testid=record-source]").count()) === 0);
  await panel(win).locator('[role=checkbox][aria-label="Microphone"]').click();
  const two = await take(win, 2);
  const f2 = path.join(dir, "Recording 2.mp4");
  const p2 = fs.existsSync(f2) ? probe(f2) : null;
  check(`the camera take: Recording 2.mp4 is H.264 ${p2?.width}x${p2?.height} with sound, ${p2?.seconds}s ("${two.saved}")`, two.saved === "Recording 2 saved to Media" && !!p2 && p2.codec === "h264" && p2.width === 1280 && p2.height === 720 && p2.audio && Math.abs(p2.seconds - 2) < 0.9);
  await shot("rec-3-camera");

  // ---- screen and camera ----
  await panel(win).locator("[data-testid=record-mode-both]").click();
  await win.waitForTimeout(600);
  await panel(win).locator('[role=checkbox][aria-label="Microphone"]').click();
  const three = await take(win, 2);
  const f3 = path.join(dir, "Recording 3.mp4");
  const p3 = fs.existsSync(f3) ? probe(f3) : null;
  check(`screen and camera: Recording 3.mp4 is ${p3?.width}x${p3?.height} ("${three.saved}")`, three.saved === "Recording 3 saved to Media" && !!p3 && p3.width === 640 && p3.height === 360);
  // The corner holds the camera's picture; a screen-only take (Recording 1) has the screen's blue there.
  const bg = pixel(f1, 1, 560, 300, 640, 360);
  const corner = pixel(f3, 1, 560, 300, 640, 360);
  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  check(`the camera's picture is over the screen's corner (${corner.join(",")} against ${bg.join(",")})`, far(bg, [29, 59, 92]) < 30 && far(corner, bg) > 40);

  // ---- closing mid-take throws it away ----
  await panel(win).locator("[data-testid=record-mode-screen]").click();
  await win.locator("[data-testid=record-start]").click();
  await until(win, /^Recording…$/, 8);
  await win.waitForTimeout(600);
  await win.locator("[data-testid=record-close]").click();
  await win.waitForTimeout(1200);
  check("closing the panel mid-take throws it away", !(await panel(win).isVisible()) && fs.readdirSync(dir).filter((n) => n.endsWith(".mp4")).length === 3);

  // ---- the recording on the timeline ----
  await dragToEmptyTimeline(win, "Recording 1.mp4");
  const doc = await savedProject(win, ctx.udDir);
  const clip = doc.timeline.clips.find((c) => c.type === "video");
  const asset = clip && doc.assets[clip.assetId];
  const length = clip ? (+clip.endTick - +clip.startTick) / 1e6 : 0;
  check(`it goes on the timeline as long as the recording (${length.toFixed(2)} s, ${asset ? decodeURIComponent(asset.path).split("/").slice(-2).join("/") : "none"})`, !!clip && /symlinks\/Recording 1\.mp4$/.test(decodeURIComponent(asset.path)) && Math.abs(length - p1.seconds) < 0.2);
  const blue = await engineFrame(win, "Math.abs(r-29)<14&&Math.abs(g-59)<14&&Math.abs(b-92)<14");
  check(`the engine draws the recording (${blue.count} of ${blue.w * blue.h} pixels are the screen's blue)`, blue.count > blue.w * blue.h * 0.05);
  await shot("rec-4-on-timeline");
  return report();
};
