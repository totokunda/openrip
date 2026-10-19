// What laying a saved template's clips into another project makes of its tracks (the editor's
// Templates tab, lib/templates-tab.ts). Pure (types only), so it is tested with
// `node --test tests/` in packages/renderer.
import type { AnyClipProps, Asset, TimelineProps } from "./types.ts";

/**
 * What laying a template into a project makes of the project's clips, tracks and assets: fresh
 * ids all round (the template can be used again, and again in the same project), every start and
 * end moved to `at`, the template's tracks above the project's (an audio track below, as the
 * timeline keeps them), and an asset the project already has (same file) reused. Pure.
 */
export const mergeTemplate = (
  project: { clips: AnyClipProps[]; timelines: TimelineProps[]; assets: Record<string, Asset> },
  tpl: { clips: AnyClipProps[]; tracks: TimelineProps[]; assets: Record<string, Asset>; fps: number },
  at: number,
  fps: number,
  newId: () => string,
): { clips: AnyClipProps[]; timelines: TimelineProps[]; assets: Record<string, Asset>; ids: string[] } => {
  const scale = tpl.fps > 0 && fps > 0 ? fps / tpl.fps : 1;
  const trackIds = new Map(tpl.tracks.map((t) => [t.timelineId, newId()]));
  const clipIds = new Map(tpl.clips.map((c) => [c.clipId as string, newId()]));
  const linkIds = new Map<string, string>();
  const assets = { ...project.assets };
  const assetIds = new Map<string, string>();
  for (const a of Object.values(tpl.assets)) {
    const have = Object.values(assets).find((x) => x.path === a.path);
    if (have) {
      assetIds.set(a.id, have.id);
      continue;
    }
    const id = newId();
    assetIds.set(a.id, id);
    assets[id] = { ...a, id };
  }
  const shift = (f: unknown) => (typeof f === "number" && Number.isFinite(f) ? Math.round(f * scale) + at : f);
  const clips = tpl.clips.map((c) => {
    const any = c as any;
    const next: any = { ...c, clipId: clipIds.get(c.clipId as string)!, timelineId: trackIds.get(c.timelineId as string) ?? c.timelineId, startFrame: shift(any.startFrame), endFrame: shift(any.endFrame) };
    if (any.groupId) next.groupId = clipIds.get(any.groupId) ?? any.groupId;
    if (any.linkId) {
      if (!linkIds.has(any.linkId)) linkIds.set(any.linkId, newId());
      next.linkId = linkIds.get(any.linkId);
    }
    if (typeof any.assetId === "string") next.assetId = assetIds.get(any.assetId) ?? any.assetId;
    if (Array.isArray(any.assetIdHistory)) next.assetIdHistory = any.assetIdHistory.map((x: string) => assetIds.get(x) ?? x);
    if (Array.isArray(any.children)) next.children = any.children.map((g: string[]) => g.map((id) => clipIds.get(id) ?? id));
    return next as AnyClipProps;
  });
  const tracks = tpl.tracks.map((t) => ({ ...t, timelineId: trackIds.get(t.timelineId)! }));
  const audioBelow = tracks.filter((t) => t.type === "audio");
  const above = tracks.filter((t) => t.type !== "audio");
  // The project's own main track stays the lowest video track: the template's media goes above it.
  const timelines = project.timelines.length === 0 ? tracks : [...above, ...project.timelines, ...audioBelow];
  return { clips: [...project.clips, ...clips], timelines, assets, ids: clips.filter((c) => !(c as any).hidden).map((c) => c.clipId) };
};

