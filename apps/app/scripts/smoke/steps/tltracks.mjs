// Track controls (after import timeline newtext: a text track over the main track). With
// the track headers open, each undone and redone:
//   add       + ▸ Audio track: an empty track at the bottom, which stays through other edits
//   lock      the text track's lock: its clip can't be selected, deleted or dragged; unlock
//   reorder   the audio track's header dragged to the top; a new video track dragged to the
//             bottom stops above the main track (the main track stays the lowest video track)
//   delete    Delete track from the empty audio track's "…" menu; from the text track's
//             right-click menu, taking its clip
import { drag, rulerMap, seek, settled, tallTimeline } from "./_preview.mjs";
import { checks } from "./_anim.mjs";
import { undoCase } from "./_undo.mjs";
import { clipsOn, doc, dragClip, key, mainTrack, rowY } from "./_timeline.mjs";

export default async (ctx) => {
  const { win } = ctx;
  const { check, report } = checks();
  // Room for four tracks; the ruler's mapping again after the resize.
  await tallTimeline(win);
  ctx.map = await rulerMap(win);
  const map = ctx.map;
  const types = (d) => d.timeline.tracks.map((t) => t.type).join(",");
  const header = (id) => win.locator(`[data-track-header="${id}"]`);
  // A track's menu, from its "…" or (tracks without one) a right-click on its header.
  const trackMenu = async (id, viaButton) => {
    if (viaButton) await header(id).locator('[title="Track menu"]').click();
    else await header(id).click({ button: "right", position: { x: 4, y: 6 } });
    await win.waitForTimeout(300);
    return win.getByRole("button", { name: "Delete track", exact: true });
  };

  // Open the headers (drag their rail right).
  const rail = await win.locator("button[aria-label='Drag to resize timeline sidebar']").boundingBox();
  if (rail.x < 60) await drag(win, rail.x, rail.y + rail.height / 2, rail.x + 60, rail.y + rail.height / 2);
  await win.waitForTimeout(500);

  const addTrack = async (label) => {
    await win.locator('[title="Add track"]').click();
    await win.waitForTimeout(300);
    await settled(win, () => win.getByRole("menuitem", { name: label }).click(), { timeout: 1500 });
  };

  // Add: an empty audio track at the bottom.
  let d = await doc(ctx);
  const n0 = d.timeline.tracks.length;
  await undoCase(ctx, check, "add track", () => addTrack("Audio track"), { frame: false });
  d = await doc(ctx);
  const audio = d.timeline.tracks.at(-1);
  check("+ ▸ Audio track adds an empty audio track at the bottom", d.timeline.tracks.length === n0 + 1 && audio.type === "audio", types(d));
  // It stays while other clips change.
  const text = clipsOn(d, d.timeline.tracks.find((t) => t.type === "text").timelineId)[0];
  await seek(win, map, 5);
  await dragClip(ctx, d, text, 1.5, 2.5);
  d = await doc(ctx);
  check("an empty track added stays through other edits", d.timeline.tracks.some((t) => t.timelineId === audio.timelineId), types(d));
  await key(win, "Meta+z");

  // Lock: the text track's clip can't be selected, deleted or moved.
  d = await doc(ctx);
  const textTrack = d.timeline.tracks.find((t) => t.type === "text");
  await undoCase(ctx, check, "lock track", () => settled(win, () => header(textTrack.timelineId).locator('[title="Lock track"]').click(), { timeout: 1500 }), { frame: false });
  d = await doc(ctx);
  check("the lock is saved with the track", d.timeline.tracks.find((t) => t.timelineId === textTrack.timelineId).locked === true);
  const y = await rowY(ctx, d, textTrack.timelineId);
  await win.mouse.click(map.x(1.5), y);
  await win.waitForTimeout(500);
  const tabs = await win.evaluate(() => [...document.querySelectorAll("[role=tab]")].map((e) => e.innerText.trim()).join(","));
  check("a locked track's clip can't be selected", !tabs.includes("Text"), `tabs "${tabs}"`);
  const before = JSON.stringify(clipsOn(d, textTrack.timelineId));
  await key(win, "Backspace");
  await dragClip(ctx, d, text, 1.5, 3.5);
  await key(win, "q");
  check("nor deleted, moved or trimmed", JSON.stringify(clipsOn(await doc(ctx), textTrack.timelineId)) === before);
  await settled(win, () => header(textTrack.timelineId).locator('[title="Unlock track"]').click(), { timeout: 1500 });
  d = await doc(ctx);
  check("unlocked again", !d.timeline.tracks.find((t) => t.timelineId === textTrack.timelineId).locked);

  // Reorder: the audio track's header to the top.
  const dragHeader = async (id, toY) => {
    const b = await header(id).boundingBox();
    await settled(win, () => drag(win, b.x + 6, b.y + b.height / 2, b.x + 6, toY), { timeout: 1500 });
  };
  const top = await header(d.timeline.tracks[0].timelineId).boundingBox();
  await undoCase(ctx, check, "reorder tracks", () => dragHeader(audio.timelineId, top.y + 2), { frame: false });
  d = await doc(ctx);
  check("a track's header dragged to the top moves the track there", d.timeline.tracks[0].timelineId === audio.timelineId, types(d));

  // A new video track dragged to the bottom stops above the main track.
  const main = mainTrack(d);
  await addTrack("Video track");
  d = await doc(ctx);
  const video = d.timeline.tracks[0];
  const last = await header(d.timeline.tracks.at(-1).timelineId).boundingBox();
  await dragHeader(video.timelineId, last.y + last.height + 4);
  d = await doc(ctx);
  const order = d.timeline.tracks.map((t) => t.timelineId);
  check(
    "a video track can't go under the main track",
    mainTrack(d).timelineId === main.timelineId && order.indexOf(video.timelineId) === order.indexOf(main.timelineId) - 1,
    types(d),
  );

  // Delete: the empty audio track; then the text track with its clip.
  await undoCase(ctx, check, "delete empty track", async () => {
    const item = await trackMenu(audio.timelineId, true);
    await settled(win, () => item.click(), { timeout: 1500 });
  }, { frame: false });
  d = await doc(ctx);
  check("Delete track removes the track", !d.timeline.tracks.some((t) => t.timelineId === audio.timelineId), types(d));
  await seek(win, map, 1.5);
  await undoCase(ctx, check, "delete track with its clip", async () => {
    const item = await trackMenu(textTrack.timelineId, false);
    await settled(win, () => item.click());
  });
  d = await doc(ctx);
  check("a deleted track takes its clips", !d.timeline.clips.some((c) => c.type === "text") && !d.timeline.tracks.some((t) => t.timelineId === textTrack.timelineId), types(d));
  const mainDelete = await trackMenu(main.timelineId, true);
  check("the main track can't be deleted while another video track is there", await mainDelete.isDisabled());
  await win.keyboard.press("Escape");
  await ctx.shot("tl-tracks");
  return report();
};
