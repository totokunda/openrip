// Renderer side of the frame-transport spike.
const { ipcRenderer, sharedTexture } = require("electron");

const q = new URLSearchParams(location.search);
const mode = q.get("mode") || "shared";
const drawMode = q.get("draw") || "webgpu";
const now = () => performance.timeOrigin + performance.now();
document.getElementById("modeLabel").textContent = `· ${mode}${mode === "shared" ? " / " + drawMode : ""}`;
if (mode === "overlay-below") document.body.classList.add("transparent");

const canvas = document.getElementById("preview");
const hud = document.getElementById("hud");
const playhead = document.getElementById("playhead");

const s = { received: 0, drawn: 0, recvMs: [], drawMs: [], rafs: 0, rafsWithNewFrame: 0, firstAt: 0, lastAt: 0 };
let newFrameSinceRaf = false;

function pct(arr, p) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  return +a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(3);
}
window.__stats = () => {
  const secs = (s.lastAt - s.firstAt) / 1000 || 1;
  return {
    receivedFps: +(s.received / secs).toFixed(1),
    drawnFps: +(s.drawn / secs).toFixed(1),
    recvLatencyMs: { p50: pct(s.recvMs, 50), p95: pct(s.recvMs, 95), p99: pct(s.recvMs, 99) },
    drawCpuMs: { p50: pct(s.drawMs, 50), p95: pct(s.drawMs, 95) },
    rafHz: +(s.rafs / secs).toFixed(1),
    rafsWithNewFramePct: s.rafs ? +((100 * s.rafsWithNewFrame) / s.rafs).toFixed(1) : null,
  };
};

// Keep the UI "busy" like an editor during playback: move the playhead every frame.
function raf() {
  s.rafs++;
  if (newFrameSinceRaf) s.rafsWithNewFrame++;
  newFrameSinceRaf = false;
  playhead.style.transform = `translateX(${(performance.now() / 8) % 1400}px)`;
  if (s.rafs % 30 === 0) hud.textContent = JSON.stringify(window.__stats(), null, 1);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

async function setupWebGPU() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });
  const module = device.createShaderModule({
    code: `
      struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
        var p = array<vec2f, 3>(vec2f(-1, -3), vec2f(-1, 1), vec2f(3, 1));
        var o: VSOut;
        o.pos = vec4f(p[i], 0, 1);
        o.uv = vec2f((p[i].x + 1) * 0.5, 1 - (p[i].y + 1) * 0.5);
        return o;
      }
      @group(0) @binding(0) var samp: sampler;
      @group(0) @binding(1) var tex: texture_external;
      @fragment fn fs(in: VSOut) -> @location(0) vec4f {
        return textureSampleBaseClampToEdge(tex, samp, in.uv);
      }`,
  });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
  });
  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
  return (vf) => {
    const external = device.importExternalTexture({ source: vf });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: external }],
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    device.queue.submit([enc.finish()]);
  };
}

function setupCanvas2D() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  return (vf) => ctx.drawImage(vf, 0, 0, canvas.width, canvas.height);
}

(async () => {
  if (mode === "shared") {
    const drawFrame = drawMode === "canvas2d" ? setupCanvas2D() : await setupWebGPU();
    sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }, meta) => {
      const t = now();
      if (!s.firstAt) s.firstAt = t;
      s.lastAt = t;
      s.received++;
      if (meta && meta.sentAt) s.recvMs.push(t - meta.sentAt);
      const vf = importedSharedTexture.getVideoFrame();
      const t0 = performance.now();
      drawFrame(vf);
      s.drawMs.push(performance.now() - t0);
      vf.close();
      importedSharedTexture.release();
      s.drawn++;
      newFrameSinceRaf = true;
    });
  } else {
    canvas.style.background = "transparent";
    s.firstAt = now();
    setInterval(() => (s.lastAt = now()), 250);
  }
  const r = canvas.getBoundingClientRect();
  ipcRenderer.send("preview-rect", { x: r.x, y: r.y, width: r.width, height: r.height });
})();
