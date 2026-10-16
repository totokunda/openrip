// Frame-transport benchmark harness.
//   electron . --mode=shared|overlay|overlay-below --file=media/x.mp4 [--fmt=nv12] [--seconds=10] [--draw=webgpu|canvas2d]
// Prints one JSON line prefixed with RESULT: and exits.
const { app, BrowserWindow, ipcMain, sharedTexture } = require("electron");
const path = require("node:path");
const native = require("./ft_native.node");

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? "1"];
  }),
);
const mode = args.mode || "shared";
const file = path.resolve(__dirname, args.file || "media/test-4k60-hevc.mp4");
const fmt = args.fmt || "nv12";
const seconds = Number(args.seconds || 10);
const draw = args.draw || "webgpu";
const pool = Number(args.pool || 8);
const COLOR_SPACES = {
  nv12: { primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "limited" },
  p010le: { primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", range: "limited" },
  bgra: { primaries: "bt709", transfer: "srgb", matrix: "rgb", range: "full" },
};
const now = () => performance.timeOrigin + performance.now(); // epoch ms, sub-ms precision

const stats = {
  mode, file: path.basename(file), fmt, draw, seconds,
  ticks: 0, sent: 0, underruns: 0, sendErrors: 0,
  sendMs: [], queuedUs: [], presentMs: [], underrunState: [],
};

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(3);
}
function summarize(arr) {
  return { p50: pct(arr, 50), p95: pct(arr, 95), p99: pct(arr, 99), max: pct(arr, 100) };
}

app.whenReady().then(async () => {
  // Watchdog: a hung transport must not block the benchmark matrix.
  setTimeout(() => {
    console.log("RESULT:" + JSON.stringify({
      mode, file: stats.file, fmt, draw, hung: true, ticks: stats.ticks, sent: stats.sent,
      sendErrors: stats.sendErrors, stream: stats.stream ? `${stats.stream.width}x${stats.stream.height}@${stats.stream.fps}` : null,
    }));
    app.exit(2);
  }, (seconds + 20) * 1000);

  const transparent = mode === "overlay-below";
  const win = new BrowserWindow({
    width: 1800, height: 1100, show: true, backgroundColor: transparent ? "#00000000" : "#111111",
    transparent,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  win.webContents.on("render-process-gone", (_e, d) => console.error("[renderer gone]", JSON.stringify(d)));
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) console.error("[renderer console]", message);
  });
  // Listen before loading: some pages report their preview rect during script evaluation.
  const rectPromise = new Promise((resolve) => ipcMain.once("preview-rect", (_e, r) => resolve(r)));
  // Electron can reject loadFile() with ERR_FAILED on pages that start a media stream even
  // though the page loaded; the page reporting its preview rect is the real readiness signal.
  win.loadFile(path.join(__dirname, "renderer.html"), { query: { mode, draw, staticUi: args["static-ui"] ? "1" : "0", uiHz: args["ui-hz"] || "0", willChange: args["will-change"] ? "1" : "0" } })
    .catch((e) => console.error("[loadFile]", e.message));
  const rect = await rectPromise;

  const info = native.open(file, fmt, pool);
  stats.stream = info;
  const fps = Number(args.fps || info.fps || 60);
  const intervalMs = 1000 / fps;

  if (mode.startsWith("overlay")) {
    native.overlayAttach(win.getNativeWindowHandle(), rect.x, rect.y, rect.width, rect.height, mode === "overlay-below");
  }

  // Let the decoder fill its queue before timing starts.
  await new Promise((r) => setTimeout(r, 500));
  const cpuSamples = [];
  const metricsTimer = setInterval(() => {
    cpuSamples.push(app.getAppMetrics().map((m) => ({ type: m.type, cpu: m.cpu.percentCPUUsage })));
  }, 1000);

  let prevOverlayId = null;
  const start = now();
  let nextDue = start;
  const endAt = start + seconds * 1000;

  const tick = async () => {
    const t = now();
    if (t >= endAt) return finish();
    stats.ticks++;
    const f = native.next();
    if (!f) {
      stats.underruns++;
      if (stats.underrunState.length < 5) stats.underrunState.push(native.stats());
    } else {
      stats.queuedUs.push(f.queuedUs / 1000);
      if (mode === "shared") {
        const t0 = now();
        try {
          const imported = sharedTexture.importSharedTexture({
            textureInfo: {
              pixelFormat: fmt,
              codedSize: { width: f.width, height: f.height },
              visibleRect: { x: 0, y: 0, width: f.width, height: f.height },
              colorSpace: COLOR_SPACES[fmt],
              timestamp: f.ptsUs,
              handle: { ioSurface: f.ioSurface },
            },
            allReferencesReleased: () => native.release(f.id),
          });
          await sharedTexture.sendSharedTexture(
            { frame: win.webContents.mainFrame, importedSharedTexture: imported },
            { id: f.id, sentAt: t0 },
          );
          imported.release();
          stats.sendMs.push(now() - t0);
          stats.sent++;
        } catch (e) {
          stats.sendErrors++;
          if (stats.sendErrors < 3) console.error("[send]", e);
          native.release(f.id);
        }
      } else {
        const t0 = now();
        native.overlayPresent(f.id);
        stats.presentMs.push(now() - t0);
        if (prevOverlayId !== null) native.release(prevOverlayId);
        prevOverlayId = f.id;
        stats.sent++;
      }
    }
    nextDue += intervalMs;
    const wait = Math.max(0, nextDue - now());
    setTimeout(tick, wait);
  };

  const finish = async () => {
    clearInterval(metricsTimer);
    const elapsed = (now() - start) / 1000;
    const renderer = await win.webContents.executeJavaScript("window.__stats && window.__stats()");
    // Average CPU per process type over the run (skip the first sample: warm-up).
    const cpu = {};
    for (const sample of cpuSamples.slice(1)) {
      for (const m of sample) cpu[m.type] = (cpu[m.type] || 0) + m.cpu / Math.max(1, cpuSamples.length - 1);
    }
    for (const k of Object.keys(cpu)) cpu[k] = +cpu[k].toFixed(1);
    const out = {
      mode, file: stats.file, fmt, draw: mode === "shared" ? draw : "calayer", targetFps: fps,
      stream: `${info.width}x${info.height}@${info.fps}`,
      elapsedSec: +elapsed.toFixed(2),
      sentFps: +(stats.sent / elapsed).toFixed(1),
      pool, underruns: stats.underruns, underrunState: stats.underrunState, sendErrors: stats.sendErrors,
      mainSendMs: summarize(stats.sendMs), overlayPresentMs: summarize(stats.presentMs),
      decodeQueueMs: summarize(stats.queuedUs),
      renderer, cpuPercent: cpu,
    };
    console.log("RESULT:" + JSON.stringify(out));
    if (args.keep) return;
    native.overlayDetach();
    native.close();
    app.quit();
  };

  setTimeout(tick, 0);
});
