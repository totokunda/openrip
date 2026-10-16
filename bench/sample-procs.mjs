#!/usr/bin/env node
// Sample CPU / memory of a process family plus system-wide GPU utilization (macOS),
// so OpenRip and CapCut can be measured the exact same way from the outside.
//
//   node bench/sample-procs.mjs --match "CapCut" --seconds 15 --label capcut-4k60
//   node bench/sample-procs.mjs --match "Electron|frame-transport" --seconds 15 --label openrip-spike
//
// --match is a case-insensitive regex tested against each process's full command line.
// CPU % is computed from cumulative CPU-time deltas between samples (ps's own %cpu is a
// long decaying average and misreports short windows). 100% = one core fully busy.
// Add --decoder to also count Apple's shared hardware-decode service (VTDecoderXPCService),
// where VideoToolbox decode work lands for every app.
// GPU time per process comes from the Apple GPU driver's per-client counters in the I/O
// registry (`AGXDeviceUserClient` → `AppUsage[].accumulatedGPUTime`, nanoseconds), the
// same source Activity Monitor uses; no admin rights needed. Reported in ms of GPU time
// per second (1000 = GPU busy the whole time). WindowServer (the system compositor) is
// reported separately as context, since every on-screen app adds work there.
// --delay N waits N seconds before measuring (time to switch apps and press play).
// Prints a JSON summary; per-sample data goes to --out if given.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1]]);
    return acc;
  }, []),
);
const match = new RegExp(args.match || "CapCut", "i");
const seconds = Number(args.seconds || 15);
const intervalMs = Number(args.interval || 500);
const label = args.label || args.match;
const decoderRe = /VTDecoderXPCService/;
const includeDecoder = Boolean(args.decoder);

function gpuUtil() {
  try {
    const out = execFileSync("ioreg", ["-r", "-d", "1", "-c", "IOAccelerator"], { encoding: "utf8" });
    const m = out.match(/"Device Utilization %"=(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** pid -> cumulative GPU nanoseconds, summed over that process's GPU clients. */
function gpuTimesByPid() {
  const out = new Map();
  let text = "";
  try {
    text = execFileSync("ioreg", ["-r", "-c", "AGXDeviceUserClient", "-l", "-w0"], { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch {
    return out;
  }
  for (const block of text.split("+-o ").slice(1)) {
    const creator = block.match(/"IOUserClientCreator" = "pid (\d+), /);
    if (!creator) continue;
    const pid = Number(creator[1]);
    let ns = 0;
    for (const m of block.matchAll(/"accumulatedGPUTime"=(\d+)/g)) ns += Number(m[1]);
    out.set(pid, (out.get(pid) || 0) + ns);
  }
  return out;
}

function parseCpuTime(t) {
  // [[dd-]hh:]mm:ss.ss
  let days = 0;
  if (t.includes("-")) [days, t] = [Number(t.split("-")[0]), t.split("-")[1]];
  const parts = t.split(":").map(Number);
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return days * 86400 + secs;
}

function procs() {
  const out = execFileSync("ps", ["-A", "-ww", "-o", "pid=,time=,rss=,command="], { encoding: "utf8", maxBuffer: 64 << 20 });
  const rows = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, time, rss, cmd] = m;
    if (Number(pid) === process.pid || /sample-procs\.mjs/.test(cmd)) continue;
    const isDecoder = includeDecoder && decoderRe.test(cmd);
    if (!isDecoder && !match.test(cmd)) continue;
    const name = isDecoder
      ? "VTDecoderXPCService (hw decode)"
      : cmd.split("/").filter((p) => /\.app$/.test(p)).pop() || cmd.split(" ")[0].split("/").pop();
    rows.push({ pid: Number(pid), cpuSec: parseCpuTime(time), rssMB: Number(rss) / 1024, name });
  }
  return rows;
}

const delay = Number(args.delay || 0);
if (delay > 0) {
  console.error(`[sample-procs] measuring in ${delay}s...`);
  await new Promise((r) => setTimeout(r, delay * 1000));
}
console.error(`[sample-procs] measuring for ${seconds}s`);
const samples = [];
let prev = new Map(procs().map((r) => [r.pid, r.cpuSec]));
let prevGpu = gpuTimesByPid();
let prevT = Date.now();
const windowServerPid = (() => {
  try {
    return Number(execFileSync("pgrep", ["-x", "WindowServer"], { encoding: "utf8" }).trim().split("\n")[0]) || null;
  } catch {
    return null;
  }
})();
const end = Date.now() + seconds * 1000;
while (Date.now() < end) {
  await new Promise((r) => setTimeout(r, intervalMs));
  const rows = procs();
  const gpuNow = gpuTimesByPid();
  const t = Date.now();
  const dt = (t - prevT) / 1000;
  const gpuMsPerSec = (pid) => {
    const a = prevGpu.get(pid);
    const b = gpuNow.get(pid);
    return a === undefined || b === undefined ? 0 : Math.max(0, b - a) / 1e6 / dt;
  };
  const byName = {};
  let cpuTotal = 0;
  let rssTotalMB = 0;
  let gpuMsTotal = 0;
  for (const r of rows) {
    const before = prev.get(r.pid);
    const cpu = before === undefined ? 0 : (100 * Math.max(0, r.cpuSec - before)) / dt;
    const gpuMs = gpuMsPerSec(r.pid);
    cpuTotal += cpu;
    rssTotalMB += r.rssMB;
    gpuMsTotal += gpuMs;
    byName[r.name] = byName[r.name] || { cpu: 0, rssMB: 0, gpuMs: 0 };
    byName[r.name].cpu += cpu;
    byName[r.name].rssMB += r.rssMB;
    byName[r.name].gpuMs += gpuMs;
  }
  const windowServerGpuMs = windowServerPid ? gpuMsPerSec(windowServerPid) : null;
  samples.push({ t, gpu: gpuUtil(), cpuTotal, rssTotalMB, gpuMsTotal, windowServerGpuMs, byName, pids: rows.length });
  prev = new Map(rows.map((r) => [r.pid, r.cpuSec]));
  prevGpu = gpuNow;
  prevT = t;
}

const stat = (xs) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { mean: +mean.toFixed(1), p95: +v[Math.floor(0.95 * (v.length - 1))].toFixed(1), max: +v[v.length - 1].toFixed(1) };
};
const names = [...new Set(samples.flatMap((s) => Object.keys(s.byName)))];
const summary = {
  label,
  seconds,
  samples: samples.length,
  processes: Math.max(...samples.map((s) => s.pids)),
  cpuPercentTotal: stat(samples.map((s) => s.cpuTotal)),
  rssMBTotal: stat(samples.map((s) => s.rssTotalMB)),
  gpuMsPerSecTotal: stat(samples.map((s) => s.gpuMsTotal)),
  windowServerGpuMsPerSec: stat(samples.map((s) => s.windowServerGpuMs)),
  gpuDeviceUtilPercent: stat(samples.map((s) => s.gpu)),
  byProcess: Object.fromEntries(
    names.map((n) => [
      n,
      {
        cpu: stat(samples.map((s) => s.byName[n]?.cpu ?? 0)),
        gpuMsPerSec: stat(samples.map((s) => s.byName[n]?.gpuMs ?? 0)),
        rssMB: stat(samples.map((s) => s.byName[n]?.rssMB ?? 0)),
      },
    ]),
  ),
};
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ summary, samples }, null, 1));
console.log(JSON.stringify(summary, null, 1));
