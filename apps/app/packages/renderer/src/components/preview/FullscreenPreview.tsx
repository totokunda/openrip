import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Group, Rect } from "react-konva";
import { engineRender, ENGINE_FRAME_CANVAS_ID, ENGINE_FRAME_EVENT } from "@app/preload";
import { useViewportStore } from "@/lib/viewport";
import { useClipStore } from "@/lib/clip";
import { BASE_LONG_SIDE } from "@/lib/settings";
import VideoPreview from "./clips/VideoPreview";
import ImagePreview from "./clips/ImagePreview";
import ShapePreview from "./clips/ShapePreview";
import TextPreview from "./clips/TextPreview";
import { useControlsStore } from "@/lib/control";
import { AnyClipProps } from "@/lib/types";
import { getApplicatorsForClip } from "@/lib/applicator-utils";
import { useWebGLHaldClut } from "./webgl-filters";
import DrawingPreview from "./clips/DrawingPreview";
import { setEnginePreviewSize, useEngineDraws, useEnginePreviewStore } from "@/lib/engine-preview";
import { shownFrame } from "@/lib/playback-end";
import { usePlayerStore, QUALITY_SCALE } from "@/lib/player";
import { timecode } from "./PlayerBar";
import { ExitFullscreenGlyph, PauseGlyph, PlayGlyph } from "./player-ui";

interface FullscreenPreviewProps {
  onExit: () => void;
}

/**
 * The app's own drawing of the clips at the frame, fitted to `size`: what full screen shows when
 * the engine doesn't draw the preview.
 */
const LegacyStage: React.FC<{ size: { width: number; height: number } }> = ({ size }) => {
  const stageRef = useRef<any>(null);

  const aspectRatio = useViewportStore((s) => s.aspectRatio);
  const { clips, clipWithinFrame, timelines } = useClipStore();
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const haldClutInstance = useWebGLHaldClut();

  // Memoize applicator factory configuration
  const applicatorConfig = useMemo(
    () => ({
      haldClutInstance,
      // Add more shared resources here as needed
    }),
    [haldClutInstance],
  );

  // Get applicators for a specific clip using the factory
  const getClipApplicators = useCallback(
    (clipId: string) => {
      return getApplicatorsForClip(clipId, applicatorConfig);
    },
    [applicatorConfig, focusFrame, timelines, clips],
  );

  // Preload all resources for applicator clips
  useEffect(() => {
    if (!haldClutInstance) return;

    // Preload filter CLUTs
    const filterClips = clips.filter((c) => c.type === "filter");
    const loadPromises = filterClips.map(async (clip: any) => {
      const filterPath = clip.fullPath || clip.smallPath;
      if (filterPath) {
        try {
          await haldClutInstance.preloadClut(filterPath);
        } catch (e) {
          console.warn("Failed to preload CLUT:", filterPath, e);
        }
      }
    });

    // Add preloading for other applicator types here as they are added
    // e.g., mask textures, etc.

    Promise.all(loadPromises).catch(console.error);
  }, [clips, haldClutInstance]);

  const sortClips = useCallback(
    (clips: AnyClipProps[]) => {
      // Treat each group as a single sortable unit; then expand children in defined order
      type GroupUnit = {
        kind: "group";
        id: string;
        y: number;
        start: number;
        children: AnyClipProps[];
      };
      type SingleUnit = {
        kind: "single";
        y: number;
        start: number;
        clip: AnyClipProps;
      };

      const groups = clips.filter((c) => c.type === "group") as AnyClipProps[];
      const childrenSet = new Set<string>(
        groups.flatMap((g) => {
          const nested = ((g as any).children as string[][] | undefined) ?? [];
          return nested.flat();
        }),
      );

      // Build group units
      const groupUnits: GroupUnit[] = groups.map((g) => {
        const y =
          timelines.find((t) => t.timelineId === g.timelineId)?.timelineY ?? 0;
        const start = g.startFrame ?? 0;
        const nested = ((g as any).children as string[][] | undefined) ?? [];
        const childIdsFlat = nested.flat();
        const children = childIdsFlat
          .map((id) => clips.find((c) => c.clipId === id))
          .filter(Boolean) as AnyClipProps[];
        return { kind: "group", id: g.clipId, y, start, children };
      });

      // Build single units for non-group, non-child clips
      const singleUnits: SingleUnit[] = clips
        .filter((c) => c.type !== "group" && !childrenSet.has(c.clipId))
        .map((c) => {
          const y =
            timelines.find((t) => t.timelineId === c.timelineId)?.timelineY ??
            0;
          const start = c.startFrame ?? 0;
          return { kind: "single", y, start, clip: c };
        });

      // Sort units: lower on screen first (higher y), then earlier start
      const units = [...groupUnits, ...singleUnits].sort((a, b) => {
        if (a.y !== b.y) return b.y - a.y;
        return a.start - b.start;
      });

      // Flatten units back to clip list; for groups, expand children in their defined order
      const result: AnyClipProps[] = [];
      for (const u of units) {
        if (u.kind === "single") {
          result.push(u.clip);
        } else {
          // Ensure children are ordered as in group's children list
          result.push(...u.children.reverse());
        }
      }

      return result;
    },
    [timelines, clips],
  );

  const filterClips = useCallback(
    (clips: AnyClipProps[], audio: boolean = false) => {
      const filteredClips = clips.filter((clip) => {
        const timeline = timelines.find(
          (t) => t.timelineId === clip.timelineId,
        );
        if (audio && timeline?.muted) return false;
        if (timeline?.hidden) return false;
        return true;
      });
      return filteredClips;
    },
    [timelines],
  );

  // Compute rect dimensions based on aspect ratio
  const { rectWidth, rectHeight } = useMemo(() => {
    const ratio = aspectRatio.width / aspectRatio.height;
    const baseShortSide = BASE_LONG_SIDE;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return { rectWidth: 0, rectHeight: 0 };
    }
    return { rectWidth: baseShortSide * ratio, rectHeight: baseShortSide };
  }, [aspectRatio.width, aspectRatio.height]);

  // Center the content in fullscreen
  const { scale, position } = useMemo(() => {
    if (!size.width || !size.height || !rectWidth || !rectHeight) {
      return { scale: 1, position: { x: 0, y: 0 } };
    }

    // Calculate scale to fit content in viewport
    const scaleX = size.width / rectWidth;
    const scaleY = size.height / rectHeight;
    const scale = Math.min(scaleX, scaleY);

    // Center the scaled content
    const scaledWidth = rectWidth * scale;
    const scaledHeight = rectHeight * scale;
    const x = (size.width - scaledWidth) / 2;
    const y = (size.height - scaledHeight) / 2;

    return { scale, position: { x, y } };
  }, [size.width, size.height, rectWidth, rectHeight]);

  return (
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        className="bg-transparent"
      >
        <Layer width={size.width} height={size.height}>
          <Group x={position.x} y={position.y} scaleX={scale} scaleY={scale}>
            <Rect x={0} y={0} width={rectWidth} height={rectHeight} fill={"#000000"} />
            {sortClips(filterClips(clips)).map((clip) => {
              const clipAtFrameNoOverlap = clipWithinFrame(clip, focusFrame);

              // Get applicators for clips that support effects (video, image, etc.)
              const applicators = getClipApplicators(clip.clipId);

              switch (clip.type) {
                case "video":
                  return (
                    <VideoPreview
                      key={clip.clipId}
                      {...clip}
                      rectWidth={rectWidth}
                      rectHeight={rectHeight}
                      applicators={applicators}
                      overlap={clipAtFrameNoOverlap}
                      hidden={!clipAtFrameNoOverlap}
                    />
                  );
                case "image":
                  return (
                    <ImagePreview
                      key={clip.clipId}
                      {...clip}
                      rectWidth={rectWidth}
                      rectHeight={rectHeight}
                      applicators={applicators}
                      overlap={clipAtFrameNoOverlap}
                    />
                  );
                case "shape":
                  return (
                    <ShapePreview
                      key={clip.clipId}
                      {...clip}
                      rectWidth={rectWidth}
                      rectHeight={rectHeight}
                      applicators={applicators}
                    />
                  );
                case "sticker":
                  return (
                    <ShapePreview
                      key={clip.clipId}
                      {...(clip as any)}
                      rectWidth={rectWidth}
                      rectHeight={rectHeight}
                      applicators={applicators}
                    />
                  );
                case "text":
                  return (
                    <TextPreview
                      key={clip.clipId}
                      {...clip}
                      rectWidth={rectWidth}
                      rectHeight={rectHeight}
                      applicators={applicators}
                    />
                  );
                case "draw":
                  return (
                    <DrawingPreview
                      key={clip.clipId}
                      {...clip}
                      rectWidth={rectWidth}
                      rectHeight={rectHeight}
                      applicators={applicators}
                    />
                  );
                default:
                  // Applicator clips (filter, mask, processor, etc.) don't render visually
                  return null;
              }
            })}
          </Group>
        </Layer>
      </Stage>
  );
};

/** Longest side the engine renders full-screen frames at. */
const MAX_SIDE = 3840;

/**
 * The engine's frame, fitted to `size`: a visible canvas that copies the one the preload draws
 * the engine's frames into, each time one arrives. Paused, it asks for the frame at the playhead
 * at its own size; playing, the engine renders at that size times the preview quality.
 */
const EngineStage: React.FC<{ size: { width: number; height: number } }> = ({ size }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const project = useEnginePreviewStore((s) => s.project);
  const version = useEnginePreviewStore((s) => s.version);
  const aspect = useViewportStore((s) => s.aspectRatio);
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const end = useClipStore((s) => s.clipDuration);
  const fps = useControlsStore((s) => s.fps);
  const isPlaying = useControlsStore((s) => s.isPlaying);
  const accurate = useControlsStore((s) => s.isAccurateSeekNeeded);
  const playScale = usePlayerStore((s) => QUALITY_SCALE[s.quality] ?? 1);
  const ratio = project && project.width > 0 && project.height > 0 ? project.width / project.height : aspect.width / aspect.height;
  // The frame's box on screen, fitted and centred.
  const box = useMemo(() => {
    if (!size.width || !size.height || !(ratio > 0)) return { x: 0, y: 0, width: 0, height: 0 };
    const width = Math.min(size.width, size.height * ratio);
    const height = width / ratio;
    return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
  }, [size.width, size.height, ratio]);
  const pixels = useCallback(
    (k: number) => {
      const dpr = window.devicePixelRatio || 1;
      const [w, h] = [box.width * dpr * k, box.height * dpr * k];
      const fit = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
      return { width: Math.max(2, Math.round(w * fit)), height: Math.max(2, Math.round(h * fit)) };
    },
    [box.width, box.height],
  );

  // Copy each engine frame in.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const source = (c.ownerDocument.getElementById(ENGINE_FRAME_CANVAS_ID) ?? document.getElementById(ENGINE_FRAME_CANVAS_ID)) as HTMLCanvasElement | null;
    if (!source) return;
    const copy = () => {
      if (source.width < 2 || source.height < 2) return;
      if (c.width !== source.width || c.height !== source.height) [c.width, c.height] = [source.width, source.height];
      c.getContext("2d", { alpha: false })?.drawImage(source, 0, 0);
    };
    copy();
    source.addEventListener(ENGINE_FRAME_EVENT, copy);
    return () => source.removeEventListener(ENGINE_FRAME_EVENT, copy);
  }, []);

  // Playback renders at this size from now on; a run already going starts again at it.
  const playSize = useMemo(() => pixels(playScale), [pixels, playScale]);
  useEffect(() => {
    if (playSize.width < 4) return;
    setEnginePreviewSize(playSize.width, playSize.height);
    const c = useControlsStore.getState();
    if (c.isPlaying) {
      c.pause();
      c.play();
    }
  }, [playSize]);

  // Paused: the frame at the playhead (the last one on the project's end) at full-screen size.
  useEffect(() => {
    const px = pixels(1);
    if (!fps || isPlaying || box.width < 4) return;
    void engineRender((shownFrame(focusFrame, end) / fps) * 1e6, px.width, px.height, !accurate);
  }, [pixels, focusFrame, end, fps, isPlaying, accurate, version, box.width]);

  return (
    <canvas
      ref={canvas}
      data-testid="fullscreen-frame"
      className="absolute bg-black"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    />
  );
};

/**
 * Full-screen preview (⌘⇧F, or the bottom bar's button), as CapCut's: the frame fitted on a
 * #292929 screen, and a floating 556×44 bar near the bottom with play, the time (now in the
 * accent, then the length), a scrub track with the accent up to a white dot, and the button to
 * leave. The bar fades after 3 s without the mouse moving. Esc or ⌘⇧F leaves.
 */
const FullscreenPreview: React.FC<FullscreenPreviewProps> = ({ onExit: onExitProp }) => {
  // The caller's function changes with every render of the preview: the effects below keep to
  // the latest without starting again.
  const exitRef = useRef(onExitProp);
  exitRef.current = onExitProp;
  const onExit = useCallback(() => exitRef.current(), []);
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [showBar, setShowBar] = useState(true);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draws = useEngineDraws();
  const focusFrame = useControlsStore((s) => s.focusFrame);
  const fps = useControlsStore((s) => s.fps);
  const isPlaying = useControlsStore((s) => s.isPlaying);
  const play = useControlsStore((s) => s.play);
  const pause = useControlsStore((s) => s.pause);
  const setFocusFrame = useControlsStore((s) => s.setFocusFrame);
  const clipDuration = useClipStore((s) => s.clipDuration);
  const track = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The window goes full screen with it, and leaving full screen (Esc, the green button)
  // leaves the preview.
  useEffect(() => {
    const doc = root.current?.ownerDocument ?? document;
    const target = doc.documentElement;
    let entered = false;
    const onChange = () => {
      if (doc.fullscreenElement) entered = true;
      else if (entered) onExit();
    };
    doc.addEventListener("fullscreenchange", onChange);
    if (!doc.fullscreenElement) target.requestFullscreen?.().catch(() => {});
    return () => {
      doc.removeEventListener("fullscreenchange", onChange);
      if (doc.fullscreenElement) doc.exitFullscreen?.().catch(() => {});
    };
  }, [onExit]);

  const wake = useCallback(() => {
    setShowBar(true);
    if (hide.current) clearTimeout(hide.current);
    hide.current = setTimeout(() => setShowBar(false), 3000);
  }, []);
  useEffect(() => {
    wake();
    return () => {
      if (hide.current) clearTimeout(hide.current);
    };
  }, [wake]);

  useEffect(() => {
    const win = root.current?.ownerDocument.defaultView ?? window;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [onExit]);

  const progress = scrub ?? (clipDuration > 0 ? Math.min(1, focusFrame / clipDuration) : 0);
  const seekTo = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setScrub(f);
    setFocusFrame(Math.min(clipDuration, Math.round(f * clipDuration)));
  };

  return (
    <div ref={root} data-testid="fullscreen-preview" className="fixed inset-0 z-[9999] bg-[#292929]" style={{ cursor: showBar ? "default" : "none" }} onMouseMove={wake}>
      {draws ? <EngineStage size={size} /> : <LegacyStage size={size} />}
      <div
        data-testid="fullscreen-bar"
        className={`absolute left-1/2 -translate-x-1/2 bottom-[67px] w-[556px] max-w-[calc(100%-32px)] h-11 flex items-center gap-3 pl-4 pr-3 rounded-[8px] bg-[#0a0a0c] transition-opacity duration-300 ${showBar ? "opacity-100" : "opacity-0"}`}
      >
        <button
          type="button"
          data-testid="fullscreen-play"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={() => (isPlaying ? pause() : play())}
          className="w-5 h-5 flex items-center justify-center text-[#e6e6e6] hover:text-white cursor-pointer"
        >
          {isPlaying ? <PauseGlyph className="w-[10px] h-[12px]" /> : <PlayGlyph className="w-[10px] h-[12px]" />}
        </button>
        <span className="text-[12px] tabular-nums whitespace-nowrap">
          <span className="text-brand-accent">{timecode(focusFrame, fps)}</span>
          <span className="text-[#5a5a5a] px-1">/</span>
          <span className="text-brand-lighter">{timecode(clipDuration, fps)}</span>
        </span>
        <div
          ref={track}
          data-testid="fullscreen-scrub"
          className="relative flex-1 h-4 ml-6 flex items-center cursor-pointer"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            if (isPlaying) pause();
            seekTo(e.clientX);
          }}
          onPointerMove={(e) => {
            if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) seekTo(e.clientX);
          }}
          onPointerUp={() => setScrub(null)}
        >
          <div className="absolute inset-x-0 h-[2px] rounded-full bg-[#2c2c30]" />
          <div className="absolute left-0 h-[2px] rounded-full bg-brand-accent" style={{ width: `${progress * 100}%` }} />
          <div className="absolute w-[9px] h-[9px] -ml-[4.5px] rounded-full bg-white border-2 border-brand-accent" style={{ left: `${progress * 100}%` }} />
        </div>
        <span className="w-px h-3 bg-[#5a5a5a]" />
        <button type="button" data-testid="fullscreen-exit" aria-label="Exit full screen" onClick={onExit} className="w-5 h-5 flex items-center justify-center text-[#e6e6e6] hover:text-white cursor-pointer">
          <ExitFullscreenGlyph className="w-[13px] h-[13px]" />
        </button>
      </div>
    </div>
  );
};

export default FullscreenPreview;
