// Tests for preload/src/media/proxy-format.ts: `node --test tests/*.test.ts` in packages/renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deepPixelFormat, describedPixelFormat, proxyVideoArgs, tenBitProxy } from "../../preload/src/media/proxy-format.ts";

test("10-bit and deeper pixel formats are deep, 8-bit ones aren't", () => {
  for (const f of ["yuv422p10le", "yuv420p10le", "p010le", "p210le", "yuva444p12le", "yuv420p16le", "rgb48le"]) assert.equal(deepPixelFormat(f), true, f);
  for (const f of ["yuv420p", "yuvj420p", "nv12", "yuv422p", "rgb24", "bgra", "", undefined]) assert.equal(deepPixelFormat(f), false, String(f));
});

test("the pixel format in FFmpeg's description of a file", () => {
  const iphone = "  Stream #0:0[0x1](und): Video: prores (HQ) (apch / 0x68637061), yuv422p10le(tv, bt2020nc/unknown/unknown, progressive), 3840x2160, 607390 kb/s, 24 fps";
  assert.equal(describedPixelFormat(`Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mov':\n${iphone}\n  Stream #0:1[0x2](und): Audio: pcm_s16le`), "yuv422p10le");
  assert.equal(describedPixelFormat("  Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080"), "yuv420p");
  assert.equal(describedPixelFormat("  Stream #0:0: Audio: aac (LC), 48000 Hz, stereo"), undefined);
});

test("a deep source gets a 10-bit proxy on Apple Silicon only", () => {
  assert.equal(tenBitProxy(true, "darwin", "arm64"), true);
  assert.equal(tenBitProxy(false, "darwin", "arm64"), false);
  assert.equal(tenBitProxy(true, "darwin", "x64"), false);
  assert.equal(tenBitProxy(true, "win32", "x64"), false);
  assert.equal(tenBitProxy(true, "linux", "arm64"), false);
});

test("an 8-bit source keeps its H.264 proxy", () => {
  assert.deepEqual(proxyVideoArgs(false), ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p"]);
});

test("the app's FFmpeg makes a ProRes clip's proxy 10-bit HEVC, every frame a keyframe", { skip: !tenBitProxy(true) }, () => {
  const ffmpeg: string = createRequire(import.meta.url)("ffmpeg-static");
  const describe = (path: string) => spawnSync(ffmpeg, ["-hide_banner", "-i", path], { encoding: "utf8" }).stderr;
  const dir = mkdtempSync(join(tmpdir(), "proxy-format-"));
  try {
    const source = join(dir, "log.mov");
    execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-frames:v", "12", "-c:v", "prores_ks", "-pix_fmt", "yuv422p10le", source]);
    assert.equal(deepPixelFormat(describedPixelFormat(describe(source))), true);
    const proxy = join(dir, "log_proxy.mp4");
    execFileSync(ffmpeg, ["-v", "error", "-i", source, "-g", "1", ...proxyVideoArgs(true), proxy]);
    assert.match(describe(proxy), /Video: hevc \(Main 10\) \(hvc1/);
    assert.equal(describedPixelFormat(describe(proxy)), "yuv420p10le");
    const frames = spawnSync(ffmpeg, ["-hide_banner", "-i", proxy, "-vf", "showinfo", "-f", "null", "-"], { encoding: "utf8" }).stderr;
    assert.deepEqual([...frames.matchAll(/ type:(\w)/g)].map((m) => m[1]), Array(12).fill("I"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
