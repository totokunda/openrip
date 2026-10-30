// Play, cut the clip under the playhead twice while it plays (split, ⌘B), and report how the
// shown frames fared in each half second around each cut: frames shown, the longest gap
// between them, and how far the picture's time ran from the wall clock.
import { playButton, timelineRect } from "./_preview.mjs";

export default async ({ win, outDir, fs, logs }) => {
  await win.evaluate(() => {
    window.__ep = [];
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((en) => window.__long.push([en.startTime, en.duration]))).observe({ entryTypes: ["longtask"] });
    document.getElementById("openrip-engine-frame").addEventListener("openrip-engine-frame", (e) => window.__ep.push([performance.now(), e.detail?.timeUs ?? -1]));
  });
  const tl = await timelineRect(win);
  await win.mouse.click(tl.x + 20, tl.y + 12);
  await win.waitForTimeout(800);
  const b = await playButton(win).boundingBox();
  const play = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const t0 = await win.evaluate(() => performance.now());
  logs.push(`[editplay] play at ${Date.now() % 1e6}`);
  await win.mouse.click(play.x, play.y);
  const cuts = [];
  // The player's own time every 100 ms, with its wall time, to see whether the playhead runs on.
  await win.evaluate(() => {
    window.__clk = [];
    setInterval(() => { const t = document.querySelector("[data-testid=player-time]"); window.__clk.push([performance.now(), t ? +t.getAttribute("data-time") : -1]); }, 100);
  });
  // PROFILE=1: a CPU profile of the renderer from the first cut on, summed by function.
  const cdp = process.env.PROFILE ? await win.context().newCDPSession(win) : null;
  for (const at of [2000, 5000]) {
    await win.waitForTimeout(Math.max(0, at - ((await win.evaluate(() => performance.now())) - t0)));
    cuts.push(await win.evaluate(() => performance.now()));
    if (cdp && cuts.length === 1) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
    logs.push(`[editplay] cut at ${Date.now() % 1e6}`);
    await win.keyboard.press("Meta+b");
  }
  await win.waitForTimeout(3500);
  await win.mouse.click(play.x, play.y);
  const frames = await win.evaluate(() => window.__ep);
  if (cdp) {
    const { profile } = await cdp.send("Profiler.stop");
    const self = new Map();
    const dt = profile.timeDeltas;
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => {
      const f = byId.get(id).callFrame;
      const k = `${f.functionName || "(anon)"} ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber}`;
      self.set(k, (self.get(k) ?? 0) + dt[i] / 1000);
    });
    // Who called the slow natives: the nearest functions of the app's own code above them.
    const parent = new Map();
    profile.nodes.forEach((n) => (n.children ?? []).forEach((c) => parent.set(c, n.id)));
    const callers = new Map();
    profile.samples.forEach((id, i) => {
      const name = byId.get(id).callFrame.functionName;
      if (!/putImageData|toBlob|drawImage|getImageData|^\(program\)$/.test(name)) return;
      const chain = [];
      for (let p = parent.get(id); p && chain.length < 6; p = parent.get(p)) {
        const f = byId.get(p).callFrame;
        if (f.url.includes("assets/")) chain.push(`${f.functionName || "anon"}:${f.lineNumber}`);
      }
      const k = `${name} <- ${chain.slice(0, 4).join(" < ")}`;
      callers.set(k, (callers.get(k) ?? 0) + dt[i] / 1000);
    });
    fs.writeFileSync(`${outDir}/profile-callers.txt`, [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${v.toFixed(0)} ms ${k}`).join("\n"));
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0)} ms ${k}`);
    fs.writeFileSync(`${outDir}/profile-top.txt`, top.join("\n"));
  }
  const clk = await win.evaluate(() => window.__clk);
  fs.writeFileSync(`${outDir}/clock.json`, JSON.stringify({ t0, cuts, clk: clk.map(([a, b]) => [Math.round(a - t0), +b.toFixed(2)]) }));
  const long = await win.evaluate(() => window.__long);
  fs.writeFileSync(`${outDir}/long.json`, JSON.stringify(long.map(([s, d]) => [Math.round(s - t0), Math.round(d)])));
  const rows = [];
  const lines = [];
  for (const [i, c] of cuts.entries()) {
    for (let w = -1; w < 8; w++) {
      const lo = c + w * 500, hi = lo + 500;
      const f = frames.filter((x) => x[0] >= lo && x[0] < hi);
      const gaps = f.slice(1).map((x, k) => x[0] - f[k][0]);
      const max = gaps.length ? Math.max(...gaps) : 500;
      lines.push(`cut ${i + 1} ${w * 500 >= 0 ? "+" : ""}${w * 500} ms: ${f.length * 2} fps, longest gap ${max.toFixed(0)} ms`);
      rows.push({ cut: i + 1, from: w * 500, fps: f.length * 2, maxGap: max });
    }
  }
  fs.writeFileSync(`${outDir}/editplay.json`, JSON.stringify(rows, null, 2));
  // Playback runs on through each cut: no half second from just before it to three seconds
  // after (where the second cut and the end of the test begin) stalls for 300 ms or more.
  const stalled = rows.filter((r) => r.from >= -500 && r.from <= 2500 && r.maxGap >= 300);
  if (stalled.length) throw new Error(`playback stalled after a cut:\n  ${stalled.map((r) => `cut ${r.cut} ${r.from} ms: longest gap ${r.maxGap.toFixed(0)} ms`).join("\n  ")}`);
  return "\n  " + lines.join("\n  ");
};
