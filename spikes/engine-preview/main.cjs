// Engine preview spike, wired the way the app will be: the render-ahead pipeline in the
// Rust engine (openrip_node.node), frames picked by the audio clock and handed to the page
// with sharedTexture, under contextIsolation (a preload draws them; no Node in the page).
//   ./run.sh --project=<CapCut draft folder or project JSON> [--seconds=N] [--size=1280x720] [--mute]
const { app, BrowserWindow, sharedTexture } = require("electron");
const path = require("path");
const fs = require("fs");

const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const project = arg("project");
const seconds = Number(arg("seconds", "0"));
const [boxW, boxH] = arg("size", "1280x720").split("x").map(Number);
const mute = process.argv.includes("--mute");
const engine = require(path.join(__dirname, "openrip_node.node"));
const BGRA = { primaries: "bt709", transfer: "srgb", matrix: "rgb", range: "full" };
const now = () => performance.now();

const stats = { ticks: 0, sent: 0, sendErrors: 0, renderMs: [], sendMs: [], avOffsetMs: [] };
const pct = (a, p) => (a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(2) : null);

app.whenReady().then(async () => {
  const info = engine.openProject(project);
  const fit = Math.min(boxW / info.width, boxH / info.height);
  const W = Math.round((info.width * fit) / 2) * 2;
  const H = Math.round((info.height * fit) / 2) * 2;
  const win = new BrowserWindow({
    width: W + 80,
    height: H + 140,
    backgroundColor: "#111",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, "preload.cjs") },
  });
  await win.loadFile("renderer.html", { query: { w: String(W), h: String(H), name: info.name } });

  engine.setPreviewSize(W, H);
  if (mute) engine.setVolume(0);
  engine.startPlayback(0);

  let busy = false;
  const tick = async () => {
    stats.ticks++;
    if (busy) return;
    if (engine.positionUs() >= info.durationUs) engine.startPlayback(0); // loop
    const f = engine.frameForDisplay();
    if (!f) return;
    busy = true;
    stats.renderMs.push(f.renderMs);
    try {
      const t0 = now();
      const imported = sharedTexture.importSharedTexture({
        textureInfo: { pixelFormat: "bgra", codedSize: { width: f.width, height: f.height }, visibleRect: { x: 0, y: 0, width: f.width, height: f.height }, colorSpace: BGRA, timestamp: f.timeUs, handle: { ioSurface: f.ioSurface } },
        allReferencesReleased: () => engine.release(f.id),
      });
      await sharedTexture.sendSharedTexture({ frame: win.webContents.mainFrame, importedSharedTexture: imported }, { timeUs: f.timeUs, renderMs: f.renderMs, durationUs: info.durationUs });
      imported.release();
      stats.sendMs.push(now() - t0);
      stats.sent++;
      const pos = engine.positionUs();
      if (pos >= 0) stats.avOffsetMs.push((pos - f.timeUs) / 1000);
    } catch (e) {
      if (stats.sendErrors++ < 3) console.error("[frame]", e);
      engine.release(f.id);
    }
    busy = false;
  };
  const timer = setInterval(tick, 1000 / 60); // the display's refresh

  if (seconds > 0) {
    setTimeout(async () => {
      clearInterval(timer);
      const page = await win.webContents.executeJavaScript("window.preview && window.preview.stats()");
      const result = {
        project: info.name, size: `${W}x${H}`, fps: info.fps, seconds, isolated: true,
        sent: stats.sent, expectedFrames: Math.round(info.fps * seconds), sendErrors: stats.sendErrors,
        renderMs: { p50: pct(stats.renderMs, 50), p95: pct(stats.renderMs, 95) },
        sendMs: { p50: pct(stats.sendMs, 50), p95: pct(stats.sendMs, 95) },
        avOffsetMs: { p50: pct(stats.avOffsetMs, 50), p95: pct(stats.avOffsetMs, 95) },
        page,
      };
      console.log(JSON.stringify(result));
      fs.appendFileSync(path.join(__dirname, "results.jsonl"), JSON.stringify(result) + "\n");
      engine.stopPlayback();
      engine.close();
      app.quit();
    }, seconds * 1000);
  }
});
