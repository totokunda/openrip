// Engine preview spike: open a project with the Rust engine (openrip_node.node), play it in
// real time, and hand each composited IOSurface to the page with sharedTexture (no copies).
//   ./run.sh --project=<CapCut draft folder or project JSON> [--seconds=N] [--size=1280x720] [--mute]
// Video frames follow the engine's audio clock (A/V sync); without an output device they
// follow wall time.
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

const stats = { ticks: 0, rendered: 0, busySkips: 0, sendErrors: 0, renderMs: [], sendMs: [], layers: 0, skipped: 0, avOffsetMs: [], clock: "wall" };
const pct = (a, p) => (a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(2) : null);

app.whenReady().then(async () => {
  const info = engine.openProject(project);
  const fit = Math.min(boxW / info.width, boxH / info.height);
  const W = Math.round((info.width * fit) / 2) * 2;
  const H = Math.round((info.height * fit) / 2) * 2;
  const win = new BrowserWindow({ width: W + 80, height: H + 140, backgroundColor: "#111", webPreferences: { nodeIntegration: true, contextIsolation: false } });
  await win.loadFile("renderer.html", { query: { w: String(W), h: String(H), name: info.name, fps: String(info.fps) } });

  const start = now();
  if (mute) engine.setVolume(0);
  const audio = engine.play(0);
  stats.clock = audio ? "audio" : "wall";
  let busy = false;
  const tick = async () => {
    stats.ticks++;
    if (busy) return stats.busySkips++;
    busy = true;
    if (audio && engine.positionUs() >= info.durationUs) engine.play(0); // loop
    const t = audio ? engine.positionUs() : Math.floor(((now() - start) * 1000) % Math.max(info.durationUs, 1));
    try {
      const f = await engine.renderFrame(t, W, H);
      stats.renderMs.push(f.renderMs);
      stats.layers = f.layers;
      stats.skipped = f.skipped;
      const t0 = now();
      const imported = sharedTexture.importSharedTexture({
        textureInfo: { pixelFormat: "bgra", codedSize: { width: W, height: H }, visibleRect: { x: 0, y: 0, width: W, height: H }, colorSpace: BGRA, timestamp: f.timeUs, handle: { ioSurface: f.ioSurface } },
        allReferencesReleased: () => engine.release(f.id),
      });
      await sharedTexture.sendSharedTexture({ frame: win.webContents.mainFrame, importedSharedTexture: imported }, { timeUs: f.timeUs, renderMs: f.renderMs, layers: f.layers, skipped: f.skipped, durationUs: info.durationUs });
      imported.release();
      stats.sendMs.push(now() - t0);
      // A/V offset: how far the picture we just handed over trails the sound now heard.
      if (audio) stats.avOffsetMs.push((engine.positionUs() - f.timeUs) / 1000);
      stats.rendered++;
    } catch (e) {
      if (stats.sendErrors++ < 3) console.error("[frame]", e);
    }
    busy = false;
  };
  const timer = setInterval(tick, 1000 / info.fps);

  if (seconds > 0) {
    setTimeout(async () => {
      clearInterval(timer);
      const page = await win.webContents.executeJavaScript("window.__stats && window.__stats()");
      const result = {
        project: info.name, size: `${W}x${H}`, fps: info.fps, seconds,
        rendered: stats.rendered, busySkips: stats.busySkips, sendErrors: stats.sendErrors,
        renderMs: { p50: pct(stats.renderMs, 50), p95: pct(stats.renderMs, 95) },
        sendMs: { p50: pct(stats.sendMs, 50), p95: pct(stats.sendMs, 95) },
        clock: stats.clock, avOffsetMs: { p50: pct(stats.avOffsetMs, 50), p95: pct(stats.avOffsetMs, 95) },
        layers: stats.layers, skippedLayers: stats.skipped, page,
      };
      console.log(JSON.stringify(result));
      fs.appendFileSync(path.join(__dirname, "results.jsonl"), JSON.stringify(result) + "\n");
      engine.close();
      app.quit();
    }, seconds * 1000);
  }
});
