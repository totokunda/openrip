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
