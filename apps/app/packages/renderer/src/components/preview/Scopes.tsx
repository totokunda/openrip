import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ENGINE_FRAME_CANVAS_ID, ENGINE_FRAME_EVENT } from "@app/preload";
import { usePlayerStore, type ScopeKind } from "@/lib/player";
import { ScopeRenderer, type ScopeRect } from "@/lib/scopes-gl";

/**
 * The colour oscilloscope (header menu ▸ Color oscilloscope ▸ Show), as CapCut's: black panels
 * in a row under the canvas, 8 px in from the panel's sides and 5 px apart, about 182×127 at
 * the Default layout (they keep that shape as the panel grows): an RGB parade, an RGB
 * waveform and a vectorscope, the first two on a 0–1023 scale with dashed lines at 0, 512 and
 * 1023. Drawn on the GPU from the engine's frame (lib/scopes-gl.ts) each time one arrives.
 */

const GAP = 5;
const INSET = 8;
/** CapCut's panel shape (182×127). */
const ASPECT = 127 / 182;
const LINE = "#333333";

/** The plot inside a waveform panel: CapCut leaves about 5% at the sides and 6% top and bottom. */
const plotOf = (w: number, h: number) => ({ x: w * 0.048, y: h * 0.06, width: w * 0.908, height: h * 0.88 });
/** The vectorscope's circle: centred, its radius 47% of the panel's height. */
const circleOf = (w: number, h: number) => ({ cx: w / 2, cy: h / 2, r: h * 0.469 });

/** The 0 / 512 / 1023 scale of a parade or waveform. */
const WaveScale: React.FC<{ w: number; h: number }> = ({ w, h }) => {
  const p = plotOf(w, h);
  const rows: [string, number][] = [
    ["1023", p.y],
    ["512", p.y + p.height / 2],
    ["0", p.y + p.height],
  ];
  return (
    <>
      {rows.map(([label, y]) => (
        <g key={label}>
          <text x={6} y={y} dy="0.35em" fill={LINE} fontSize={9.5} fontWeight={600} fontFamily="-apple-system, BlinkMacSystemFont, sans-serif">
            {label}
          </text>
          <line x1={label.length * 6 + 12} x2={p.x + p.width} y1={Math.round(y) + 0.5} y2={Math.round(y) + 0.5} stroke={LINE} strokeDasharray="2 1" />
        </g>
      ))}
    </>
  );
};

/** BT.601 75% bars' Cb/Cr: where a vectorscope's targets sit. */
const TARGETS: [string, number, number, number][] = [
  ["R", 0.75, 0, 0],
  ["M", 0.75, 0, 0.75],
  ["B", 0, 0, 0.75],
  ["C", 0, 0.75, 0.75],
  ["G", 0, 0.75, 0],
  ["Y", 0.75, 0.75, 0],
];

const VectorScale: React.FC<{ w: number; h: number }> = ({ w, h }) => {
  const { cx, cy, r } = circleOf(w, h);
  const grey = "#4a4a4a";
  const ticks = Array.from({ length: 24 }, (_, i) => i * 15).filter((a) => a % 90 !== 0);
  // The skin-tone line, about 123° (between R and Y).
  const skin = (123 * Math.PI) / 180;
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={grey} />
      <line x1={cx - r} x2={cx + r} y1={cy} y2={cy} stroke={grey} strokeDasharray="2 1.5" />
      <line x1={cx} x2={cx} y1={cy - r} y2={cy + r} stroke={grey} strokeDasharray="2 1.5" />
      {ticks.map((a) => {
        const t = (a * Math.PI) / 180;
        const [c, s] = [Math.cos(t), -Math.sin(t)];
        return <line key={a} x1={cx + c * r} y1={cy + s * r} x2={cx + c * r * 0.94} y2={cy + s * r * 0.94} stroke={grey} />;
      })}
      <line x1={cx} y1={cy} x2={cx + Math.cos(skin) * r * 0.8} y2={cy - Math.sin(skin) * r * 0.8} stroke={grey} />
      {TARGETS.map(([label, R, G, B]) => {
        const y = 0.299 * R + 0.587 * G + 0.114 * B;
        const [cb, cr] = [(B - y) / 1.772, (R - y) / 1.402];
        const [x0, y0] = [cx + cb * 2 * r, cy - cr * 2 * r];
        const s = Math.max(5, r * 0.085);
        const k = s * 0.45;
        // A box drawn as its four corners, the colour's letter inside.
        const corners = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([dx, dy]) => `M${x0 + dx * s},${y0 + dy * s - dy * k}V${y0 + dy * s}H${x0 + dx * s - dx * k}`);
        return (
          <g key={label}>
            <path d={corners.join("")} fill="none" stroke="#5a5a5a" />
            <text x={x0} y={y0} dy="0.36em" textAnchor="middle" fill="#6a6a6a" fontSize={Math.max(6, s * 1.05)} fontFamily="-apple-system, BlinkMacSystemFont, sans-serif">
              {label}
            </text>
          </g>
        );
      })}
    </>
  );
};

const Scopes: React.FC = () => {
  const kinds = usePlayerStore((s) => s.scopeKinds);
  const row = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(1, kinds.length);
  const panelW = Math.max(40, (width - 2 * INSET - GAP * (n - 1)) / n);
  // CapCut's panel shape for three across, whatever the number shown.
  const threeW = Math.max(40, (width - 2 * INSET - GAP * 2) / 3);
  const panelH = Math.round(Math.min(260, Math.max(70, threeW * ASPECT)));

  // What the renderer draws: read by its draw, which runs on frames and on layout changes.
  const layout = useRef({ kinds, panelW, panelH });
  layout.current = { kinds, panelW, panelH };
  const redraw = useRef<() => void>(() => {});
  useEffect(() => redraw.current(), [kinds, panelW, panelH]);

  // The renderer, for as long as the panels show.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const doc = c.ownerDocument;
    const win = doc.defaultView ?? window;
    let renderer: ScopeRenderer;
    try {
      renderer = new ScopeRenderer(c);
      setFailed(null);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    (c as any).__scopes = renderer;
    let frameCanvas: HTMLCanvasElement | null = null;
    let raf = 0;
    let dirty = true;
    const draw = () => {
      raf = 0;
      const { kinds, panelW, panelH } = layout.current;
      const dpr = win.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      const [w, h] = [Math.max(2, Math.round(r.width * dpr)), Math.max(2, Math.round(r.height * dpr))];
      if (c.width !== w || c.height !== h) [c.width, c.height] = [w, h];
      if (dirty && frameCanvas && frameCanvas.width > 2 && frameCanvas.height > 2) {
        renderer.upload(frameCanvas, frameCanvas.width, frameCanvas.height);
        dirty = false;
      }
      const rects: ScopeRect[] = [];
      kinds.forEach((kind, i) => {
        const x0 = (INSET + i * (panelW + GAP)) * dpr;
        if (kind === "vectorscope") {
          const { cx, cy, r: rad } = circleOf(panelW, panelH);
          rects.push({ kind, x: x0 + (cx - rad) * dpr, y: (cy - rad) * dpr, width: 2 * rad * dpr, height: 2 * rad * dpr });
        } else {
          const p = plotOf(panelW, panelH);
          rects.push({ kind, x: x0 + p.x * dpr, y: p.y * dpr, width: p.width * dpr, height: p.height * dpr });
        }
      });
      renderer.render(rects);
    };
    const schedule = () => {
      if (!raf) raf = win.requestAnimationFrame(draw);
    };
    // A frame is drawn as it arrives (a few tenths of a ms on the CPU), so the scopes follow
    // every frame played; layout changes wait for the next animation frame.
    const onFrame = () => {
      dirty = true;
      if (raf) {
        win.cancelAnimationFrame(raf);
        raf = 0;
      }
      draw();
    };
    redraw.current = schedule;
    // The canvas the engine's frames are drawn into (made by EngineFrame), in this document
    // or the main window's.
    const attach = () => {
      const found = (doc.getElementById(ENGINE_FRAME_CANVAS_ID) ?? document.getElementById(ENGINE_FRAME_CANVAS_ID)) as HTMLCanvasElement | null;
      if (found === frameCanvas) return;
      frameCanvas?.removeEventListener(ENGINE_FRAME_EVENT, onFrame);
      frameCanvas = found;
      frameCanvas?.addEventListener(ENGINE_FRAME_EVENT, onFrame);
      onFrame();
    };
    attach();
    const poll = win.setInterval(attach, 1000);
    return () => {
      win.clearInterval(poll);
      if (raf) win.cancelAnimationFrame(raf);
      frameCanvas?.removeEventListener(ENGINE_FRAME_EVENT, onFrame);
      redraw.current = () => {};
      delete (c as any).__scopes;
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={row} data-testid="scopes" className="shrink-0 relative" style={{ height: panelH + 4 }}>
      <div className="absolute flex" style={{ left: INSET, right: INSET, top: 4, height: panelH, gap: GAP }}>
        {kinds.map((k: ScopeKind) => (
          <div key={k} data-testid={`scope-${k}`} className="relative rounded-[4px] bg-black" style={{ width: panelW, height: panelH }} />
        ))}
      </div>
      <canvas ref={canvas} data-testid="scopes-canvas" className="absolute left-0 right-0 pointer-events-none" style={{ top: 4, height: panelH, width: "100%" }} />
      <div className="absolute flex pointer-events-none" style={{ left: INSET, right: INSET, top: 4, height: panelH, gap: GAP }}>
        {kinds.map((k) => (
          <svg key={k} width={panelW} height={panelH} className="shrink-0 overflow-hidden">
            {k === "vectorscope" ? <VectorScale w={panelW} h={panelH} /> : <WaveScale w={panelW} h={panelH} />}
          </svg>
        ))}
      </div>
      {failed && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-brand-light/50">Scopes need WebGL 2 ({failed})</div>}
    </div>
  );
};

export default Scopes;
