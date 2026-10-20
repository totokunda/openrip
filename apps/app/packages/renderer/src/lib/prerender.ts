// Render (CapCut's Render menu): timeline ranges composited ahead of time into the engine's
// render cache, which the preview then plays from, so a heavy stretch plays smoothly. The engine
// keeps the chunks (engine/crates/playback/src/render_cache.rs) under a hash of what they show,
// so an edit makes the chunks it touches unrendered by itself; this file asks for rendering,
// shows its progress (components/timeline/RenderPill.tsx), and keeps the rendered ranges the
// timeline's bar draws (components/timeline/RenderedBar.tsx).
//
// What the menu's items mean: Whole timeline renders everything; In renders the range between
// the In and Out points (lib/range.ts); Out renders everything outside it. Export is not
// affected: it always composites from the sources.
import { create } from "zustand";
import { toast } from "sonner";
import { engineDeleteRenderCache, engineRenderCacheInfo, engineRenderedRanges, enginePrerender, enginePrerenderCancel, onEnginePrerenderProgress, onEngineRenderCacheChanged } from "@app/preload";
import { useControlsStore } from "./control";
import { engineDrawsNow, flushEngineSync, useEnginePreviewStore } from "./engine-preview";
import type { Range } from "./range";

export type RenderScope = "whole" | "in" | "out";

type RenderState = {
  /** Whether this platform can pre-render (null until asked). */
  available: boolean | null;
  /** The rendered, still valid ranges, in frames. */
  ranges: Range[];
  /** The render running, and how far (0–1). */
  running: { progress: number } | null;
};

export const useRenderStore = create<RenderState>(() => ({ available: null, ranges: [], running: null }));

let cancelled = false;

/** Ask the engine which parts of the timeline are rendered now. */
export async function refreshRendered(): Promise<void> {
  const { enabled, info, project } = useEnginePreviewStore.getState();
  if (!enabled || !info?.available || !project) {
    if (useRenderStore.getState().ranges.length) useRenderStore.setState({ ranges: [] });
    return;
  }
  const fps = useControlsStore.getState().fps || 30;
  const ranges = (await engineRenderedRanges()).map(([a, b]) => ({ start: Math.round((a * fps) / 1e6), end: Math.round((b * fps) / 1e6) }));
  const prev = useRenderStore.getState().ranges;
  if (prev.length !== ranges.length || prev.some((r, i) => r.start !== ranges[i].start || r.end !== ranges[i].end)) useRenderStore.setState({ ranges });
}

/** The spans of the timeline (µs) a scope covers; null ends mean the timeline's own. */
function spansOf(scope: RenderScope, range: Range | null, fps: number, durationUs: number): [number | null, number | null][] {
  const us = (f: number) => Math.round((f / fps) * 1e6);
  if (scope === "whole" || !range) return [[null, null]];
  if (scope === "in") return [[us(range.start), us(range.end)]];
  return [
    [0, us(range.start)],
    [us(range.end), durationUs + 1],
  ];
}

/** Render (Whole timeline / In / Out, or an explicit span in frames); progress in `useRenderStore`. */
export async function renderTimeline(scope: RenderScope | Range): Promise<void> {
  if (useRenderStore.getState().running) {
    toast("Rendering is already running");
    return;
  }
  if (!engineDrawsNow()) {
    toast("Rendering needs the engine preview (Settings › Performance)");
    return;
  }
  const info = await engineRenderCacheInfo();
  useRenderStore.setState({ available: info.available });
  if (!info.available) {
    toast("Rendering isn't available here: this platform has no video encoder to write the rendered parts with");
    return;
  }
  const controls = useControlsStore.getState();
  const fps = controls.fps || 30;
  // The engine renders what it holds: let it have the latest edit first.
  await flushEngineSync();
  const durationUs = useEnginePreviewStore.getState().project?.durationUs ?? 0;
  const spans = typeof scope === "string" ? spansOf(scope, controls.range, fps, durationUs) : spansOf("in", scope, fps, durationUs);
  cancelled = false;
  useRenderStore.setState({ running: { progress: 0 } });
  let rendered = 0;
  let failed: string | null = null;
  for (let i = 0; i < spans.length && !cancelled; i++) {
    const off = onEnginePrerenderProgress((done, total) => {
      const ratio = total > 0 ? done / total : 0;
      useRenderStore.setState({ running: { progress: (i + ratio) / spans.length } });
    });
    try {
      const r = await enginePrerender(spans[i][0], spans[i][1]);
      if (r.ok) rendered += r.rendered;
      else if (r.cancelled) cancelled = true;
      else failed = r.error ?? "rendering failed";
    } finally {
      off();
    }
    if (failed) break;
  }
  useRenderStore.setState({ running: null });
  await refreshRendered();
  if (failed) toast.error(failed);
  else if (cancelled) toast("Rendering cancelled");
  else toast(rendered > 0 ? "Rendering finished" : "Already rendered");
}

/** Stop the running render (the parts finished stay rendered). */
export function cancelRender(): void {
  cancelled = true;
  void enginePrerenderCancel();
}

/** Render › Delete rendering cache. */
export async function deleteRenderingCache(): Promise<void> {
  await engineDeleteRenderCache();
  await refreshRendered();
  toast("Rendering cache deleted");
}

let initialized = false;

/** Follow the engine's project and the cache's changes. Safe to call more than once. */
export function initRender(): void {
  if (initialized) return;
  initialized = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refreshRendered(), 120);
  };
  // After each sync (an edit, or a project opened) the same project may key its chunks
  // differently: ask again.
  useEnginePreviewStore.subscribe((s, p) => {
    if (s.version !== p.version || s.enabled !== p.enabled || s.project !== p.project) later();
    if (s.info?.available && !p.info?.available) void engineRenderCacheInfo().then((i) => useRenderStore.setState({ available: i.available }));
  });
  onEngineRenderCacheChanged(later);
  // The frame rate sets how times become frames.
  useControlsStore.subscribe((s, p) => {
    if (s.fps !== p.fps) later();
  });
}
