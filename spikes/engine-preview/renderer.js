// Draws each frame the engine sends (an imported IOSurface) into a canvas.
const { sharedTexture } = require("electron");
const q = new URLSearchParams(location.search);
const canvas = document.getElementById("preview");
canvas.width = Number(q.get("w"));
canvas.height = Number(q.get("h"));
document.getElementById("title").textContent = `${q.get("name")} · engine preview (Rust → IOSurface → sharedTexture)`;
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
const hud = document.getElementById("hud");
const s = { received: 0, firstAt: 0, lastAt: 0, drawMs: [] };
window.__stats = () => {
  const secs = (s.lastAt - s.firstAt) / 1000 || 1;
  const d = [...s.drawMs].sort((a, b) => a - b);
  return { receivedFps: +(s.received / secs).toFixed(1), drawMsP50: d.length ? +d[Math.floor(d.length / 2)].toFixed(2) : null };
};
sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, meta) => {
  const t = performance.now();
  if (!s.firstAt) s.firstAt = t;
  s.lastAt = t;
  s.received++;
  const vf = importedSharedTexture.getVideoFrame();
  ctx.drawImage(vf, 0, 0, canvas.width, canvas.height);
  s.drawMs.push(performance.now() - t);
  vf.close();
  importedSharedTexture.release();
  if (s.received % 10 === 0) {
    hud.textContent = `t ${(meta.timeUs / 1e6).toFixed(2)} / ${(meta.durationUs / 1e6).toFixed(2)} s   render ${meta.renderMs.toFixed(1)} ms   layers ${meta.layers}${meta.skipped ? ` (${meta.skipped} missing)` : ""}   ${window.__stats().receivedFps} fps`;
  }
});
