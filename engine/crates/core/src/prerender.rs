//! Pre-rendering (CapCut's Render menu): timeline ranges composited into the render cache, so
//! preview playback and seeking take them instead of compositing again. Export is not
//! affected: it always composites from the sources.

use std::path::Path;

use openrip_model::{Micros, Project};
use openrip_playback::RenderCache;

use crate::{ExportControl, Result};

/// Keep the render cache's chunks (and the index of them) under `dir`, and read the index an
/// earlier run left there.
pub fn set_render_cache_dir(dir: &Path) {
    RenderCache::global().set_dir(dir);
}

/// Whether this platform can pre-render (it has a video encoder to write the chunks with).
pub fn render_cache_available() -> bool {
    openrip_export::prerender_available() && RenderCache::global().has_dir()
}

/// Show pre-rendered chunks in the preview (on by default; off shows the composited frames,
/// for comparing the two).
pub fn set_render_cache_enabled(on: bool) {
    RenderCache::global().set_enabled(on);
}

/// What a pre-render did.
#[derive(Clone, Debug)]
pub struct PrerenderResult {
    pub rendered: u32,
    pub reused: u32,
    pub frames: u64,
    pub seconds: f64,
}

/// Render the chunks of `project` overlapping `range` (µs; the whole timeline when `None`)
/// that are not rendered yet. Progress is in frames; cancel through `control` (the chunks
/// finished stay). Blocks: call it off the UI thread.
pub fn prerender_project(project: Project, range: Option<(i64, i64)>, control: &ExportControl) -> Result<PrerenderResult> {
    control.reset();
    let s = openrip_export::prerender(project, RenderCache::global(), range.map(|(a, b)| (Micros(a), Micros(b))), |done, total| control.step(done, total))?;
    Ok(PrerenderResult { rendered: s.rendered, reused: s.reused, frames: s.frames, seconds: s.seconds })
}

/// The time ranges of `project` (µs) that are rendered and still valid.
pub fn rendered_ranges(project: &Project) -> Vec<(i64, i64)> {
    RenderCache::global().rendered_ranges(project).into_iter().map(|(a, b)| (a.0, b.0)).collect()
}

/// Delete every rendered chunk.
pub fn clear_render_cache() {
    RenderCache::global().clear();
}

/// Bytes the rendered chunks take.
pub fn render_cache_bytes() -> u64 {
    RenderCache::global().bytes()
}

/// Preview frames taken from chunks and frames composited since the start (with the cache
/// holding something).
pub fn render_cache_stats() -> (u64, u64) {
    let s = RenderCache::global().stats();
    (s.hits, s.misses)
}
