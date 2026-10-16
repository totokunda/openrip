// Runs in the isolated preload world: receives the engine's frames (sharedTexture) and draws
// them into the page's canvas. The page itself gets only a read-only stats function.
const { contextBridge, sharedTexture } = require("electron");

const s = { received: 0, firstAt: 0, lastAt: 0, drawMs: [] };
let ctx = null;
let hud = null;

window.addEventListener("DOMContentLoaded", () => {
  const q = new URLSearchParams(location.search);
  const canvas = document.getElementById("preview");
  canvas.width = Number(q.get("w"));
  canvas.height = Number(q.get("h"));
  ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  hud = document.getElementById("hud");
  document.getElementById("title").textContent = `${q.get("name")} · engine preview (contextIsolation, render-ahead, audio clock)`;
});

sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, meta) => {
  const t = performance.now();
  if (!s.firstAt) s.firstAt = t;
  s.lastAt = t;
  s.received++;
  const vf = importedSharedTexture.getVideoFrame();
  if (ctx) ctx.drawImage(vf, 0, 0, ctx.canvas.width, ctx.canvas.height);
  s.drawMs.push(performance.now() - t);
  vf.close();
  importedSharedTexture.release();
  if (hud && s.received % 10 === 0) {
    hud.textContent = `t ${(meta.timeUs / 1e6).toFixed(2)} / ${(meta.durationUs / 1e6).toFixed(2)} s   render ${meta.renderMs.toFixed(1)} ms   ${stats().receivedFps} fps`;
  }
});

function stats() {
  const secs = (s.lastAt - s.firstAt) / 1000 || 1;
  const d = [...s.drawMs].sort((a, b) => a - b);
  return { receivedFps: +(s.received / secs).toFixed(1), drawMsP50: d.length ? +d[Math.floor(d.length / 2)].toFixed(2) : null };
}

contextBridge.exposeInMainWorld("preview", { stats });
