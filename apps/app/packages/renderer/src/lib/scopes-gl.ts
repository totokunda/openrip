// The colour oscilloscope's scopes, drawn on the GPU (WebGL2) from the engine's frame.
//
// Each frame is uploaded once as a texture (from the canvas the preload draws the engine's
// frames into, a GPU-to-GPU copy). For each scope a grid of samples of it is drawn as points
// whose place the vertex shader computes from the sample's colour: an RGB parade (each
// channel's value over x, side by side), an RGB waveform (the three channels over x, on top of
// each other, which reads white where they agree and in colour where they don't) and a
// vectorscope (Cb/Cr, BT.601 as CapCut's targets sit). The points add up in a half-float
// buffer; a last pass turns how many fell on each pixel into light. Nothing comes back to the
// CPU, so it keeps up with playback.

export type ScopeKind = "parade" | "waveform" | "vectorscope";

/** A scope's plot, in the canvas's device pixels (y from the top). */
export type ScopeRect = { kind: ScopeKind; x: number; y: number; width: number; height: number };

const POINTS_VS = `#version 300 es
precision highp float;
uniform sampler2D uFrame;
uniform ivec2 uGrid;
uniform int uKind;
flat out vec3 vColor;
void main() {
  int gx = gl_VertexID % uGrid.x;
  int gy = gl_VertexID / uGrid.x;
  // A little hashed jitter inside each sample's cell: no columns left empty between samples
  // (the grid is often coarser than the plot) and no moiré.
  vec2 j = fract(sin(vec2(float(gl_VertexID) * 12.9898, float(gl_VertexID) * 78.233)) * 43758.5453) - 0.5;
  vec2 uv = (vec2(gx, gy) + 0.5 + j) / vec2(uGrid);
  vec3 c = texture(uFrame, uv).rgb;
  vec2 p;
  if (uKind == 2) {
    float y = dot(c, vec3(0.299, 0.587, 0.114));
    // Cb, Cr in -0.5..0.5: the circle's edge is 0.5.
    vec2 cbcr = vec2((c.b - y) / 1.772, (c.r - y) / 1.402);
    p = cbcr * 2.0;
    float m = max(max(c.r, c.g), c.b);
    vColor = mix(vec3(1.0), c / max(m, 0.04), 0.65);
  } else {
    int ch = gl_InstanceID;
    float v = ch == 0 ? c.r : (ch == 1 ? c.g : c.b);
    float x = uKind == 0 ? (float(ch) + uv.x) / 3.0 : uv.x;
    p = vec2(x * 2.0 - 1.0, v * 2.0 - 1.0);
    vColor = ch == 0 ? vec3(1.0, 0.16, 0.16) : (ch == 1 ? vec3(0.18, 1.0, 0.2) : vec3(0.25, 0.3, 1.0));
  }
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;

const POINTS_FS = `#version 300 es
precision highp float;
uniform float uGain;
flat in vec3 vColor;
out vec4 o;
void main() { o = vec4(vColor * uGain, 1.0); }`;

const RESOLVE_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID & 1) == 0 ? -1.0 : 3.0, (gl_VertexID & 2) == 0 ? -1.0 : 3.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const RESOLVE_FS = `#version 300 es
precision highp float;
uniform sampler2D uAcc;
in vec2 vUv;
out vec4 o;
void main() {
  vec3 a = texture(uAcc, vUv).rgb;
  vec3 c = 1.0 - exp(-a);
  // Premultiplied over the black panels.
  o = vec4(c, max(max(c.r, c.g), c.b));
}`;

/** Samples taken of each frame: enough for CapCut's fine traces, few enough to be free. */
const SAMPLES = 220_000;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "program");
  return p;
}

export class ScopeRenderer {
  readonly gl: WebGL2RenderingContext;
  private points: WebGLProgram;
  private resolve: WebGLProgram;
  private frame: WebGLTexture;
  private acc: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private accSize = { w: 0, h: 0 };
  private half: boolean;
  private frameSize = { w: 0, h: 0 };
  /** Draws so far and the last one's time on the CPU (ms), for the harness. */
  stats = { renders: 0, ms: 0, samples: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.half = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");
    this.points = compile(gl, POINTS_VS, POINTS_FS);
    this.resolve = compile(gl, RESOLVE_VS, RESOLVE_FS);
    this.vao = gl.createVertexArray()!;
    const tex = (filter: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.frame = tex(gl.LINEAR);
    this.acc = tex(gl.NEAREST);
    this.fbo = gl.createFramebuffer()!;
  }

  /** Take a new frame (a canvas, image or video frame). */
  upload(source: TexImageSource, width: number, height: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.frame);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.frameSize = { w: width, h: height };
  }

  private ensureAcc(w: number, h: number) {
    if (this.accSize.w === w && this.accSize.h === h) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.acc);
    if (this.half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.acc, 0);
    this.accSize = { w, h };
  }

  /** Draw the scopes into their plots (the canvas cleared around them). */
  render(rects: ScopeRect[]) {
    const t0 = performance.now();
    const gl = this.gl;
    const [W, H] = [this.canvas.width, this.canvas.height];
    this.ensureAcc(W, H);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { w: fw, h: fh } = this.frameSize;
    if (fw > 1 && fh > 1) {
      // A grid of samples with the frame's shape.
      const aspect = fw / fh;
      // Not capped at the frame's size: a small paused frame still fills the plot's columns
      // (the texture filters between its pixels).
      const gw = Math.max(1, Math.round(Math.sqrt(SAMPLES * aspect)));
      const gh = Math.max(1, Math.round(SAMPLES / gw));
      const n = gw * gh;
      this.stats.samples = n;
      gl.useProgram(this.points);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.frame);
      gl.uniform1i(gl.getUniformLocation(this.points, "uFrame"), 0);
      gl.uniform2i(gl.getUniformLocation(this.points, "uGrid"), gw, gh);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.enable(gl.SCISSOR_TEST);
      for (const r of rects) {
        const [x, y, w, h] = [Math.round(r.x), Math.round(H - r.y - r.height), Math.round(r.width), Math.round(r.height)];
        if (w < 2 || h < 2) continue;
        gl.viewport(x, y, w, h);
        gl.scissor(x, y, w, h);
        const kind = r.kind === "parade" ? 0 : r.kind === "waveform" ? 1 : 2;
        gl.uniform1i(gl.getUniformLocation(this.points, "uKind"), kind);
        // Samples per pixel the plot would get if they spread evenly; the gain makes that a
        // soft trace, a crowded pixel bright.
        const spread = kind === 2 ? n / (w * h * 0.25) : (n * (kind === 0 ? 1 : 3)) / (w * h);
        // CapCut's traces are soft: a crowded pixel glows, an even spread is a faint veil.
        const gain = (kind === 2 ? 0.6 : kind === 1 ? 0.32 : 0.3) / Math.max(1e-3, spread);
        gl.uniform1f(gl.getUniformLocation(this.points, "uGain"), this.half ? gain : Math.max(gain, 1 / 255));
        if (kind === 2) gl.drawArrays(gl.POINTS, 0, n);
        else gl.drawArraysInstanced(gl.POINTS, 0, n, 3);
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
    }
    // To the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.resolve);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.acc);
    gl.uniform1i(gl.getUniformLocation(this.resolve, "uAcc"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.stats.renders++;
    this.stats.ms = performance.now() - t0;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.frame);
    gl.deleteTexture(this.acc);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteProgram(this.points);
    gl.deleteProgram(this.resolve);
    gl.deleteVertexArray(this.vao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
