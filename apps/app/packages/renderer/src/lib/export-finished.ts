// What happens when an export finishes, beyond the toast: Settings › Edit › Sound for export
// (a short chime, OpenRip's own, made with Web Audio) and General › Notification (a system
// notification through the main process).
import { notify } from "@app/preload";
import { preferences } from "./preferences";

/** Two soft rising notes, about half a second. */
export function playExportChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    const now = ctx.currentTime;
    for (const [i, freq] of [659.25, 987.77].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * 0.14;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    }
    setTimeout(() => void ctx.close().catch(() => {}), 900);
  } catch {
    // no audio output: nothing to play
  }
}

/** Call once an export has written `path`. */
export function exportFinished(path: string) {
  const p = preferences();
  // Scripts can tell how many finished and whether the chime played.
  const body = document.body.dataset;
  body.exportsFinished = String(Number(body.exportsFinished || 0) + 1);
  if (p.exportSound) {
    playExportChime();
    body.exportChimes = String(Number(body.exportChimes || 0) + 1);
  }
  if (p.notifications) void notify("Export completed", path).catch(() => {});
}
