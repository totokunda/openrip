// What the timeline draws, read from whichever timeline is showing: the new one's test hooks
// (window.__openripTimeline, window.__openripTimelineMedia: components/timeline2) or the old
// one's Konva nodes, which carry the same facts as attributes.

/** A clip's label chips and whether a glyph leads them: { chips, glyph } (glyph 1 or 0), or null. */
export const chipsOf = (win, clipId) =>
  win.evaluate((id) => {
    const media = window.__openripTimelineMedia;
    if (window.__openripTimeline && media) {
      const f = media.media(id);
      return f?.chips ? { chips: f.chips, glyph: f.glyph ? 1 : 0 } : null;
    }
    const g = (window.Konva?.stages ?? []).flatMap((st) => st.find(".clip-chips")).find((n) => n.getAttr("clipId") === id);
    return g ? { chips: g.getAttr("chips"), glyph: g.find("Path").length } : null;
  }, clipId);

/** A clip's waveform as last drawn: { bars, max } (how many bars, the tallest), or null. */
export const waveOf = (win, clipId) =>
  win.evaluate((id) => {
    const media = window.__openripTimelineMedia;
    if (window.__openripTimeline && media) {
      const s = media.media(id)?.sound;
      return s ? { bars: s.heights.length, max: s.maxBar } : null;
    }
    const n = (window.Konva?.stages ?? []).flatMap((st) => st.find(".waveform")).find((x) => x.getAttr("clipId") === id);
    return n ? { bars: (n.getAttr("heights") ?? []).length, max: n.getAttr("maxBar") } : null;
  }, clipId);

/** How many beat dots the timeline draws, on every clip. */
export const beatDotCount = (win) =>
  win.evaluate(() => {
    const media = window.__openripTimelineMedia;
    if (window.__openripTimeline && media) return window.__openripTimeline.layout().clips.reduce((n, b) => n + (media.media(b.id)?.beats ?? 0), 0);
    return (window.Konva?.stages ?? []).flatMap((s) => s.find(".beat-markers")).reduce((n, g) => n + g.getChildren().length, 0);
  });

/** A clip's sound as last drawn: { bars ({x, h} each), line, area (the band's height), max, pxPerFrame }, or null. */
export const soundOf = (win, clipId) =>
  win.evaluate((id) => {
    const media = window.__openripTimelineMedia;
    if (window.__openripTimeline && media) {
      const s = media.media(id)?.sound;
      return s ? { bars: s.heights, line: s.line, area: s.height, max: s.maxBar, pxPerFrame: s.pxPerFrame } : null;
    }
    const n = (window.Konva?.stages ?? []).flatMap((st) => st.find(".waveform")).find((x) => x.getAttr("clipId") === id);
    return n ? { bars: n.getAttr("heights"), line: n.getAttr("line"), area: n.getAttr("area"), max: n.getAttr("maxBar"), pxPerFrame: n.getAttr("pxPerFrame") } : null;
  }, clipId);

/** The colour a sound clip's body is drawn in. */
export const soundBodyOf = (win, clipId) =>
  win.evaluate((id) => {
    const media = window.__openripTimelineMedia;
    if (window.__openripTimeline && media) return media.media(id)?.body ?? null;
    const n = (window.Konva?.stages ?? []).flatMap((s) => s.find(".waveform")).find((x) => x.getAttr("clipId") === id);
    return n?.getParent()?.getChildren()?.[0]?.fill?.() ?? null;
  }, clipId);

/** The keyframe diamonds drawn: their centres on screen, left to right. */
export const diamondsOnScreen = (win) =>
  win.evaluate(() => {
    if (window.__openripTimeline) return window.__openripTimeline.diamonds().map(({ x, y }) => ({ x, y }));
    const stage = (window.Konva?.stages ?? []).find((s) => s.container().closest("[data-testid=timeline]"));
    if (!stage) return [];
    const box = stage.container().getBoundingClientRect();
    return stage
      .find(".keyframe-diamond")
      .map((n) => n.getAbsolutePosition())
      .map((p) => ({ x: box.x + p.x, y: box.y + p.y }))
      .sort((a, b) => a.x - b.x);
  });
