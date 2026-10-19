// The small moving pictures on the transition, animation and speed-curve cards, drawn by the
// app (no bundled content): two shots meeting through the transition, a picture or a line of
// text going through the animation, and a speed curve's shape. A card shows one still moment
// of its motion and plays it in a loop while hovered (or while `playing`), with the Web
// Animations API, so nothing runs for the cards nobody looks at.
import React, { useEffect, useRef, useState } from "react";
import { GL_TRANSITIONS } from "@/lib/glTransitions";
import { curveSpeedAt, MIN_CURVE_SPEED, MAX_CURVE_SPEED } from "@/lib/speed";
import type { AnimationDirection, SpeedPoint } from "@/lib/types";

type Frames = Keyframe[];
/** One element's keyframes and timing within the loop. */
type Track = { el: string; frames: Frames; easing?: string };

/** How long one loop of a preview takes (ms), and the moment a resting card shows (0–1). */
const LOOP_MS = 2400;

/**
 * Play `tracks` on the elements in `root` (found by `data-part`) while `playing`; otherwise
 * show the loop at `rest`.
 */
const useLoop = (root: React.RefObject<HTMLElement | null>, tracks: Track[], playing: boolean, rest: number, key: string) => {
  const anims = useRef<Animation[]>([]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    anims.current = tracks.flatMap((t) => {
      const node = el.querySelector<HTMLElement>(`[data-part="${t.el}"]`);
      if (!node || typeof node.animate !== "function") return [];
      // The easing goes between each pair of keyframes (holds don't move whatever it is).
      const frames = t.easing ? t.frames.map((f) => ({ easing: t.easing, ...f })) : t.frames;
      return [node.animate(frames, { duration: LOOP_MS, iterations: Infinity, fill: "both" })];
    });
    return () => anims.current.forEach((a) => a.cancel());
    // The tracks follow `key` (the kind and direction).
  }, [key]);
  useEffect(() => {
    for (const a of anims.current) {
      if (playing) a.play();
      else {
        a.pause();
        a.currentTime = rest * LOOP_MS;
      }
    }
  }, [playing, rest, key]);
};

// ---- transitions ---------------------------------------------------------------------------

/** Where an incoming shot starts for a move in `dir` ("left": it travels left, from the right). */
const away = (dir: AnimationDirection, k = 100) =>
  dir === "left" ? `translate(${k}%, 0)` : dir === "right" ? `translate(${-k}%, 0)` : dir === "up" ? `translate(0, ${k}%)` : `translate(0, ${-k}%)`;
const gone = (dir: AnimationDirection, k = 100) => away(dir === "left" ? "right" : dir === "right" ? "left" : dir === "up" ? "down" : "up", k);
/** The inset that hides a shot entirely from the side a wipe in `dir` starts on. */
const wipeFrom = (dir: AnimationDirection) =>
  dir === "left" ? "inset(0 0 0 100%)" : dir === "right" ? "inset(0 100% 0 0)" : dir === "up" ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";

/**
 * A transition's keyframes over the loop: the first shot alone for 30%, the transition over
 * the middle 40% (the cut at 50%), then the second shot.
 */
const transitionTracks = (kind: string, dir: AnimationDirection): Track[] => {
  const show = (at: number): Frames => [{ opacity: 0, offset: 0 }, { opacity: 0, offset: at }, { opacity: 1, offset: at }, { opacity: 1, offset: 1 }];
  const pulse = (a: number, peak: number, b: number): Frames => [
    { opacity: 0, offset: 0 },
    { opacity: 0, offset: a },
    { opacity: 1, offset: peak },
    { opacity: 0, offset: b },
    { opacity: 0, offset: 1 },
  ];
  switch (kind) {
    case "mix":
      return [{ el: "b", frames: [{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1, offset: 0.7 }, { opacity: 1, offset: 1 }] }];
    case "black_fade":
    case "white_fade":
      return [
        { el: "b", frames: show(0.5) },
        { el: "fx", frames: pulse(0.3, 0.5, 0.7) },
      ];
    case "white_flash":
      return [
        { el: "b", frames: show(0.5) },
        { el: "fx", frames: pulse(0.42, 0.5, 0.58) },
      ];
    case "blink": {
      // Two lids closing to the middle and opening on the second shot.
      const lid: Frames = [{ transform: "scaleY(0)", offset: 0 }, { transform: "scaleY(0)", offset: 0.3 }, { transform: "scaleY(1)", offset: 0.5 }, { transform: "scaleY(0)", offset: 0.7 }, { transform: "scaleY(0)", offset: 1 }];
      return [
        { el: "b", frames: show(0.5) },
        { el: "lid", frames: lid, easing: "ease-in-out" },
        { el: "lid2", frames: lid, easing: "ease-in-out" },
      ];
    }
    case "pull_in":
    case "pull_out": {
      const [out, into] = kind === "pull_in" ? ["scale(1.7)", "scale(1.7)"] : ["scale(0.55)", "scale(1.5)"];
      return [
        { el: "a", frames: [{ transform: "scale(1)", filter: "blur(0px)", offset: 0 }, { transform: "scale(1)", filter: "blur(0px)", offset: 0.3 }, { transform: out, filter: "blur(3px)", offset: 0.5 }, { transform: out, filter: "blur(3px)", offset: 1 }] },
        { el: "b", frames: [{ opacity: 0, transform: into, filter: "blur(3px)", offset: 0 }, { opacity: 0, transform: into, filter: "blur(3px)", offset: 0.5 }, { opacity: 1, transform: into, filter: "blur(3px)", offset: 0.5 }, { opacity: 1, transform: "scale(1)", filter: "blur(0px)", offset: 0.7 }, { opacity: 1, transform: "scale(1)", filter: "blur(0px)", offset: 1 }] },
      ];
    }
    case "blur":
      return [
        { el: "a", frames: [{ filter: "blur(0px)", offset: 0 }, { filter: "blur(0px)", offset: 0.3 }, { filter: "blur(5px)", offset: 0.5 }, { filter: "blur(5px)", offset: 1 }] },
        { el: "b", frames: [{ opacity: 0, filter: "blur(5px)", offset: 0 }, { opacity: 0, filter: "blur(5px)", offset: 0.5 }, { opacity: 1, filter: "blur(5px)", offset: 0.5 }, { opacity: 1, filter: "blur(0px)", offset: 0.7 }, { opacity: 1, filter: "blur(0px)", offset: 1 }] },
      ];
    case "slide":
      return [{ el: "b", easing: "ease-in-out", frames: [{ transform: away(dir), offset: 0 }, { transform: away(dir), offset: 0.3 }, { transform: "translate(0, 0)", offset: 0.7 }, { transform: "translate(0, 0)", offset: 1 }] }];
    case "push":
      return [
        { el: "a", frames: [{ transform: "translate(0, 0)", offset: 0 }, { transform: "translate(0, 0)", offset: 0.3 }, { transform: gone(dir), offset: 0.7 }, { transform: gone(dir), offset: 1 }] },
        { el: "b", frames: [{ transform: away(dir), offset: 0 }, { transform: away(dir), offset: 0.3 }, { transform: "translate(0, 0)", offset: 0.7 }, { transform: "translate(0, 0)", offset: 1 }] },
      ];
    case "wipe":
      return [{ el: "b", frames: [{ clipPath: wipeFrom(dir), offset: 0 }, { clipPath: wipeFrom(dir), offset: 0.3 }, { clipPath: "inset(0 0 0 0)", offset: 0.7 }, { clipPath: "inset(0 0 0 0)", offset: 1 }] }];
    case "circle":
      return [{ el: "b", frames: [{ clipPath: "circle(0% at 50% 50%)", offset: 0 }, { clipPath: "circle(0% at 50% 50%)", offset: 0.3 }, { clipPath: "circle(75% at 50% 50%)", offset: 0.7 }, { clipPath: "circle(75% at 50% 50%)", offset: 1 }] }];
    case "spin":
      return [
        { el: "a", frames: [{ transform: "rotate(0deg) scale(1)", offset: 0 }, { transform: "rotate(0deg) scale(1)", offset: 0.3 }, { transform: "rotate(180deg) scale(0.2)", offset: 0.5 }, { transform: "rotate(180deg) scale(0.2)", offset: 1 }] },
        { el: "b", frames: [{ opacity: 0, transform: "rotate(-180deg) scale(0.2)", offset: 0 }, { opacity: 0, transform: "rotate(-180deg) scale(0.2)", offset: 0.5 }, { opacity: 1, transform: "rotate(-180deg) scale(0.2)", offset: 0.5 }, { opacity: 1, transform: "rotate(0deg) scale(1)", offset: 0.7 }, { opacity: 1, transform: "rotate(0deg) scale(1)", offset: 1 }] },
      ];
    default:
      // A CapCut transition the engine doesn't draw: a plain cut.
      return [{ el: "b", frames: show(0.5) }];
  }
};

/** A shot: a gradient sky with a sun (`warm`) or a mountain (cool). */
const Shot: React.FC<{ warm?: boolean; part: "a" | "b" }> = ({ warm, part }) => (
  <div
    data-part={part}
    className="absolute inset-0 overflow-hidden"
    style={{ background: warm ? "linear-gradient(160deg, #e7a46b 0%, #b5586a 55%, #4b2f55 100%)" : "linear-gradient(170deg, #9cc8e4 0%, #4d86ad 50%, #1f3c55 100%)" }}
  >
    {warm ? (
      <div className="absolute rounded-full" style={{ width: "34%", height: "34%", left: "33%", top: "26%", background: "#ffe3a3", boxShadow: "0 0 12px #ffd38a" }} />
    ) : (
      <div className="absolute inset-x-0 bottom-0" style={{ height: "55%", background: "#24384a", clipPath: "polygon(0 100%, 0 70%, 28% 22%, 46% 52%, 64% 8%, 100% 64%, 100% 100%)" }} />
    )}
  </div>
);

/**
 * The sheet of the shader transitions' previews: one row per transition (the order of
 * lib/glTransitions.ts), eight frames across, each made by the engine's compositor on two
 * sample pictures (`openrip-dev transition-sheet`), so a card shows what the export draws.
 */
const GL_SHEET = new URL("../../assets/transitions/gl-sheet.webp", import.meta.url).href;
const GL_FRAMES = 8;
/** The frames a hovered card plays through: the first picture, the transition, the second. */
const GL_PLAY = [0, 0, 1, 2, 3, 4, 5, 6, 7, 7];
/** The frame a resting card shows (the transition about a third of the way). */
const GL_REST = 3;
const GL_FRAME_MS = 100;

/** A shader transition's card picture: its row of the engine's sheet, played while `playing`. */
export const GlTransitionPreview: React.FC<{ kind: string; playing: boolean }> = ({ kind, playing }) => {
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (!playing) {
      setStep(-1);
      return;
    }
    setStep(0);
    const id = window.setInterval(() => setStep((s) => (s + 1) % GL_PLAY.length), GL_FRAME_MS);
    return () => window.clearInterval(id);
  }, [playing]);
  const row = GL_TRANSITIONS.findIndex((t) => t.type === kind);
  if (row < 0) return null;
  const frame = step < 0 ? GL_REST : GL_PLAY[step];
  return (
    <div
      data-testid="gl-preview"
      data-frame={frame}
      className="absolute inset-0"
      style={{
        backgroundImage: `url(${GL_SHEET})`,
        backgroundSize: `${GL_FRAMES * 100}% ${GL_TRANSITIONS.length * 100}%`,
        backgroundPosition: `${(frame / (GL_FRAMES - 1)) * 100}% ${(row / (GL_TRANSITIONS.length - 1)) * 100}%`,
      }}
    />
  );
};

/** Two shots meeting through the transition `kind`. */
export const TransitionPreview: React.FC<{ kind: string; direction?: AnimationDirection; playing: boolean }> = ({ kind, direction = "left", playing }) =>
  kind.startsWith("gl_") ? <GlTransitionPreview kind={kind} playing={playing} /> : <CssTransitionPreview kind={kind} direction={direction} playing={playing} />;

const CssTransitionPreview: React.FC<{ kind: string; direction: AnimationDirection; playing: boolean }> = ({ kind, direction, playing }) => {
  const root = useRef<HTMLDivElement>(null);
  const tracks = transitionTracks(kind, direction);
  useLoop(root, tracks, playing, 0.46, `${kind}-${direction}`);
  const fx = kind === "black_fade" ? "#000" : "#fff";
  return (
    <div ref={root} className="absolute inset-0 overflow-hidden">
      <Shot warm part="a" />
      <Shot part="b" />
      <div data-part="fx" className="absolute inset-0 opacity-0" style={{ background: fx }} />
      {kind === "blink" && (
        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
          <div data-part="lid" className="h-1/2 bg-black origin-top" style={{ transform: "scaleY(0)" }} />
          <div data-part="lid2" className="h-1/2 bg-black origin-bottom" style={{ transform: "scaleY(0)" }} />
        </div>
      )}
    </div>
  );
};

// ---- clip animations -----------------------------------------------------------------------

/** An animation's keyframes on the subject over the loop: an In plays in the first 60%, an Out
 * in the last 60%, a Combo over the whole loop and a Loop twice. */
const animationTracks = (kind: string, type: string, dir: AnimationDirection): Track[] => {
  const span = (frames: Frames, from: number, to: number): Frames => {
    // `frames` over [from, to] of the loop, held before and after.
    const first = { ...frames[0], offset: 0 };
    const last = { ...frames[frames.length - 1], offset: 1 };
    const inner = frames.map((f, i) => ({ ...f, offset: from + ((to - from) * (f.offset ?? i / Math.max(1, frames.length - 1))) }));
    return [first, ...inner, last];
  };
  const shake = (n: number, k: number, fade: "in" | "out" | "none"): Frames =>
    Array.from({ length: n * 2 + 1 }, (_, i) => {
      const q = i / (n * 2);
      const amp = fade === "in" ? 1 - q : fade === "out" ? q : 1;
      return { transform: `translateX(${(i % 2 ? (i % 4 === 1 ? k : -k) : 0) * amp}%)`, offset: q };
    });
  const into: Record<string, Frames> = {
    fade_in: [{ opacity: 0 }, { opacity: 1 }],
    zoom_in: [{ transform: "scale(0.5)", opacity: 0 }, { transform: "scale(0.75)", opacity: 1, offset: 0.5 }, { transform: "scale(1)", opacity: 1 }],
    zoom_out: [{ transform: "scale(1.5)", opacity: 0 }, { transform: "scale(1.25)", opacity: 1, offset: 0.5 }, { transform: "scale(1)", opacity: 1 }],
    slide: [{ transform: away(dir, 140) }, { transform: "translate(0, 0)" }],
    rotate: [{ transform: "rotate(-180deg)", opacity: 0 }, { transform: "rotate(0deg)", opacity: 1 }],
    spin: [{ transform: "rotate(-360deg) scale(0.05)" }, { transform: "rotate(0deg) scale(1)" }],
    bounce: [{ transform: "scale(0.05)" }, { transform: "scale(1.15)", offset: 0.7 }, { transform: "scale(1)" }],
    shake: shake(3, 14, "in"),
    // The typing intros reveal the line from its start.
    type_1: [{ clipPath: "inset(0 100% 0 0)", opacity: 0.4 }, { clipPath: "inset(0 0 0 0)", opacity: 1 }],
    type_2: [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
    typewriter: [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
  };
  const outOf: Record<string, Frames> = {
    fade_out: [{ opacity: 1 }, { opacity: 0 }],
    zoom_in: [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(1.25)", opacity: 1, offset: 0.5 }, { transform: "scale(1.5)", opacity: 0 }],
    zoom_out: [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(0.75)", opacity: 1, offset: 0.5 }, { transform: "scale(0.5)", opacity: 0 }],
    slide: [{ transform: "translate(0, 0)" }, { transform: gone(dir, 140) }],
    rotate: [{ transform: "rotate(0deg)", opacity: 1 }, { transform: "rotate(180deg)", opacity: 0 }],
    spin: [{ transform: "rotate(0deg) scale(1)" }, { transform: "rotate(360deg) scale(0.05)" }],
    bounce: [{ transform: "scale(1)" }, { transform: "scale(1.15)", offset: 0.3 }, { transform: "scale(0.05)" }],
    shake: shake(3, 14, "out"),
  };
  const loop: Record<string, Frames> = {
    swing: [{ transform: "rotate(0deg)" }, { transform: "rotate(10deg)" }, { transform: "rotate(0deg)" }, { transform: "rotate(-10deg)" }, { transform: "rotate(0deg)" }],
    shake: shake(4, 10, "none"),
    pulse: [{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }],
    spin: [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    float: [{ transform: "translateY(0)" }, { transform: "translateY(-12%)" }, { transform: "translateY(0)" }, { transform: "translateY(12%)" }, { transform: "translateY(0)" }],
    blink: [{ opacity: 1 }, { opacity: 0.1 }, { opacity: 1 }],
  };
  const stepped = type === "type_2" || type === "typewriter" ? "steps(6, end)" : undefined;
  if (kind === "in" && into[type]) return [{ el: "subject", frames: span(into[type], 0.05, 0.6), easing: stepped ?? "ease-out" }];
  if (kind === "out" && outOf[type]) return [{ el: "subject", frames: span(outOf[type], 0.4, 0.95), easing: "ease-in" }];
  if ((kind === "combo" || kind === "loop") && loop[type]) {
    const once = loop[type];
    // A Loop goes round twice in the preview's loop.
    const frames = kind === "loop" ? [...once.map((f, i) => ({ ...f, offset: (i / (once.length - 1)) / 2 })), ...once.slice(1).map((f, i) => ({ ...f, offset: 0.5 + ((i + 1) / (once.length - 1)) / 2 }))] : once;
    return [{ el: "subject", frames, easing: "ease-in-out" }];
  }
  return [];
};

/**
 * A picture (video or photo) or a line of text going through the animation `type` of `kind`.
 * Without a type (None) it stands still.
 */
export const AnimationPreview: React.FC<{ subject: "media" | "text"; kind: string; type: string; direction?: AnimationDirection; playing: boolean }> = ({
  subject,
  kind,
  type,
  direction = "left",
  playing,
}) => {
  const root = useRef<HTMLDivElement>(null);
  // A resting In shows its first part, an Out most of its way, so the card says what it does.
  const rest = kind === "in" ? 0.25 : kind === "out" ? 0.8 : 0.3;
  useLoop(root, animationTracks(kind, type, direction), playing, rest, `${kind}-${type}-${direction}`);
  return (
    <div ref={root} className="absolute inset-0 overflow-hidden flex items-center justify-center">
      {subject === "text" ? (
        <span data-part="subject" className="text-[13px] font-semibold tracking-wide text-brand-lighter whitespace-nowrap">
          ABC123
        </span>
      ) : (
        <div data-part="subject" className="relative w-[58%] h-[44%] rounded-[3px] overflow-hidden" style={{ background: "linear-gradient(165deg, #9cc8e4 0%, #4d86ad 55%, #1f3c55 100%)" }}>
          <div className="absolute rounded-full" style={{ width: "26%", height: "34%", left: "60%", top: "14%", background: "#ffe3a3" }} />
          <div className="absolute inset-x-0 bottom-0" style={{ height: "55%", background: "#24384a", clipPath: "polygon(0 100%, 0 70%, 28% 22%, 46% 52%, 64% 8%, 100% 64%, 100% 100%)" }} />
        </div>
      )}
    </div>
  );
};

// ---- speed curves --------------------------------------------------------------------------

/** Where a speed sits on a log scale from CapCut's 0.1× (0) to 10× (1). */
export const speedLevel = (y: number) => (Math.log10(Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, y))) + 1) / 2;

/**
 * A speed curve's shape for its preset card: the speed over the clip, on a log scale, with
 * dashed lines at 3.2× and 0.32× and a line at 1×, in the accent.
 */
export const CurveIcon: React.FC<{ points: SpeedPoint[]; className?: string }> = ({ points, className }) => {
  const W = 62;
  const H = 62;
  const pad = 4;
  const y = (s: number) => pad + (1 - speedLevel(s)) * (H - pad * 2);
  const path = Array.from({ length: 49 }, (_, i) => {
    const q = i / 48;
    return `${i ? "L" : "M"}${(q * W).toFixed(1)},${y(curveSpeedAt(points, q)).toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden>
      {[Math.sqrt(10), 1 / Math.sqrt(10)].map((s) => (
        <line key={s} x1={0} x2={W} y1={y(s)} y2={y(s)} stroke="#8a8a8a" strokeOpacity={0.55} strokeDasharray="3 2" strokeWidth={0.75} />
      ))}
      <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="#8a8a8a" strokeOpacity={0.6} strokeWidth={0.75} />
      <path d={path} fill="none" stroke="var(--color-brand-accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
