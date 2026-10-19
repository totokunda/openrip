// The cover editor, as CapCut's two steps (31-dialogs/027, 029, 033, 035):
//  1. "Select a cover": the project's picture at the scrubber's time (Select from video, with a
//     filmstrip) or a local image (Local), then Edit cover.
//  2. "Cover design": the picture as the page, with text added from the Text panel (a title, a
//     subtitle, body text), moved and styled; Save writes the cover (the home screen's card and
//     the export dialog show it), Cancel asks "Exit editing?".
// CapCut's templates, stickers, AI tools and AI chat are left out. The timeline's Cover tile and
// the export dialog's Edit cover open it through `openCoverEditor()` (lib/cover.ts).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { LuClapperboard, LuImage, LuLoader, LuTrash2, LuType } from "react-icons/lu";
import { toast } from "sonner";
import { engineThumbnails, pickMediaPaths } from "@app/preload";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { useEnginePreviewStore } from "@/lib/engine-preview";
import { useViewportStore } from "@/lib/viewport";
import { mainTrackOf } from "@/lib/timeline-edit";
import {
  COVER_COLORS,
  COVER_TEXT_KINDS,
  canPickFrames,
  loadImage,
  renderCoverJpeg,
  renderStill,
  resetCover,
  saveCover,
  useCoverStore,
  type CoverSpec,
  type CoverText,
} from "@/lib/cover";
import { fileUrl } from "@/components/home/shared";
import { cn } from "@/lib/utils";

const ACCENT = "#ae81ce";
const TILES = 12;

const filePathOf = (p: string) => (p.startsWith("file://") ? decodeURIComponent(new URL(p).pathname) : p);

/** What the filmstrip shows at each tile: a data URL of the main track's picture there, or null. */
const useFilmstrip = (enabled: boolean, durationUs: number) => {
  const [tiles, setTiles] = useState<(string | null)[]>(() => Array(TILES).fill(null));
  useEffect(() => {
    if (!enabled || durationUs <= 0) return;
    let live = true;
    void (async () => {
      const clip = useClipStore.getState();
      const fps = useControlsStore.getState().fps || 30;
      const main = mainTrackOf(clip.timelines)?.timelineId;
      const totalFrames = (durationUs / 1e6) * fps;
      const plan = Array.from({ length: TILES }, (_, i) => {
        const f = ((i + 0.5) / TILES) * totalFrames;
        const covering = clip.clips.filter((c) => (c.type === "video" || c.type === "image") && !(c as any).hidden && f >= c.startFrame && f < c.endFrame);
        const c = covering.find((x) => x.timelineId === main) ?? covering[0];
        const asset = c && "assetId" in c ? clip.assets?.[(c as any).assetId] ?? clip.getAssetById?.((c as any).assetId) : undefined;
        if (!c || !asset?.path) return null;
        const speed = Number((c as any).speed) || 1;
        const sec = ((c.trimStart ?? 0) + (f - c.startFrame) * speed) / fps;
        return { type: c.type, path: filePathOf(asset.path), sec: Math.max(0, sec) };
      });
      const out: (string | null)[] = Array(TILES).fill(null);
      for (let i = 0; i < TILES; i++) {
        const p = plan[i];
        if (p?.type === "image") out[i] = fileUrl(p.path);
      }
      const byPath = new Map<string, number[]>();
      plan.forEach((p, i) => p?.type === "video" && byPath.set(p.path, [...(byPath.get(p.path) ?? []), i]));
      for (const [path, idx] of byPath) {
        const frames = await engineThumbnails(path, idx.map((i) => Math.round(plan[i]!.sec * 1e6)), 96, false).catch(() => []);
        for (const t of frames) {
          const canvas = document.createElement("canvas");
          canvas.width = t.width;
          canvas.height = t.height;
          canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(t.rgba.buffer as ArrayBuffer, t.rgba.byteOffset, t.width * t.height * 4), t.width, t.height), 0, 0);
          out[idx[t.index]] = canvas.toDataURL("image/jpeg", 0.7);
        }
      }
      if (live) setTiles(out);
    })();
    return () => {
      live = false;
    };
  }, [enabled, durationUs]);
  return tiles;
};

const btn = "h-8 px-4 rounded-[6px] text-[13px] font-medium cursor-pointer transition-colors";

export const CoverEditor: React.FC = () => {
  const open = useCoverStore((s) => s.open);
  const close = useCoverStore((s) => s.closeEditor);
  return open ? <CoverEditorBody onClose={close} /> : null;
};

const CoverEditorBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const saved = useCoverStore.getState().cover;
  const engine = useEnginePreviewStore();
  const durationUs = engine.project?.durationUs ?? 0;
  const aspect = useViewportStore((s) => s.aspectRatio);
  const ratio = aspect && aspect.width > 0 && aspect.height > 0 ? aspect.width / aspect.height : 16 / 9;
  const frames = canPickFrames() && durationUs > 0;

  const [stage, setStage] = useState<"select" | "design">("select");
  const [tab, setTab] = useState<"video" | "local">(saved?.source.kind === "image" || !frames ? "local" : "video");
  const [timeUs, setTimeUs] = useState(() => {
    if (saved?.source.kind === "frame") return saved.source.timeUs;
    const { focusFrame, fps } = useControlsStore.getState();
    return Math.min(Math.max(0, (focusFrame / Math.max(1, fps)) * 1e6), Math.max(0, durationUs - 1));
  });
  const [localPath, setLocalPath] = useState<string | null>(saved?.source.kind === "image" ? saved.source.path : null);
  // The picture shown: the engine's still for `shownTime`, or the local image.
  const [still, setStill] = useState<{ path: string; version: number } | null>(null);
  const [shownTime, setShownTime] = useState<number | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState<CoverText[]>(saved?.texts ?? []);
  const [selected, setSelected] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const tiles = useFilmstrip(stage === "select" && tab === "video" && frames, durationUs);

  // The engine's picture at the scrubber's time, a moment after it stops moving.
  useEffect(() => {
    if (tab !== "video" || !frames) return;
    const mine = ++seq.current;
    setRendering(true);
    const timer = setTimeout(async () => {
      try {
        const r = await renderStill(timeUs);
        if (mine !== seq.current) return;
        if (!r) throw new Error("The engine couldn't draw that frame");
        setStill({ path: r.path, version: mine });
        setShownTime(timeUs);
        setError(null);
      } catch (e) {
        if (mine === seq.current) setError((e as Error).message);
      } finally {
        if (mine === seq.current) setRendering(false);
      }
    }, 140);
    return () => clearTimeout(timer);
  }, [timeUs, tab, frames]);

  const baseUrl = tab === "local" ? (localPath ? fileUrl(localPath) : null) : still ? fileUrl(still.path, still.version) : null;

  const chooseLocal = async () => {
    const [p] = await pickMediaPaths({ title: "Select a cover image", filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "heic", "bmp", "gif", "tiff"] }] });
    if (p) setLocalPath(p);
  };

  const spec = (): CoverSpec => ({
    source: tab === "local" && localPath ? { kind: "image", path: localPath } : { kind: "frame", timeUs },
    texts,
  });

  const save = async () => {
    if (!baseUrl || saving) return;
    setSaving(true);
    try {
      // The picture for the exact time, when the scrubber moved just before.
      let url = baseUrl;
      if (tab === "video" && shownTime !== timeUs) {
        const r = await renderStill(timeUs);
        if (!r) throw new Error("The engine couldn't draw that frame");
        url = fileUrl(r.path, Date.now());
      }
      const jpeg = await renderCoverJpeg(await loadImage(url), texts);
      await saveCover(spec(), jpeg);
      toast("Cover saved");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save the cover");
    } finally {
      setSaving(false);
    }
  };

  const canContinue = !!baseUrl && !error && (tab === "local" || shownTime != null);

  // ---- step 1 ----
  if (stage === "select") {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          data-testid="cover-dialog"
          aria-describedby={undefined}
          className="dark w-[724px] max-w-none p-0 gap-0 rounded-[12px] bg-[#2a2a2b] border-[0.5px] border-[#454545] overflow-hidden text-brand-light [&>button:last-child]:hidden"
        >
          <DialogTitle className="px-4 h-[34px] flex items-center text-[13px] font-semibold text-brand-lighter border-b border-black/60">Select a cover</DialogTitle>
          <DialogDescription className="sr-only">Pick a frame of the project or a local image for its cover</DialogDescription>
          <div className="flex flex-col items-center pt-6 pb-4">
            <div className="h-[400px] flex items-center justify-center" style={{ width: 640 }}>
              <div
                data-testid="cover-preview"
                data-time={tab === "video" ? shownTime ?? "" : ""}
                className="relative bg-[#111] overflow-hidden"
                style={ratio >= 1.6 ? { width: 640, height: 640 / ratio } : { height: 400, width: 400 * ratio }}
              >
                {baseUrl ? (
                  <img src={baseUrl} alt="" draggable={false} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#777] text-[12px] text-center px-6">
                    {tab === "local" ? <LuImage className="w-7 h-7" /> : <LuClapperboard className="w-7 h-7" />}
                    {tab === "local" ? "Choose a picture from your computer" : error ?? "Drawing the frame…"}
                  </div>
                )}
                {rendering && baseUrl && <LuLoader className="absolute right-2 top-2 w-4 h-4 animate-spin text-white/80" />}
              </div>
            </div>

            <div className="mt-4 flex rounded-[6px] bg-[#1f1f20] p-0.5">
              {([["video", "Select from video"], ["local", "Local"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  data-testid={`cover-tab-${k}`}
                  aria-pressed={tab === k}
                  disabled={k === "video" && !frames}
                  title={k === "video" && !frames ? "Needs the engine's preview" : undefined}
                  onClick={() => setTab(k)}
                  className={cn("h-7 px-3 rounded-[5px] text-[12.5px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-default", tab === k ? "bg-[#3b3b3d] text-brand-lighter" : "text-brand-light/70 hover:text-brand-light")}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 w-[676px]">
              {tab === "video" ? (
                <Filmstrip tiles={tiles} durationUs={durationUs} timeUs={timeUs} onTime={setTimeUs} />
              ) : (
                <div className="h-[60px] flex items-center justify-center gap-3 rounded-[4px] bg-[#1f1f20]">
                  <button type="button" data-testid="cover-choose" onClick={() => void chooseLocal()} className={cn(btn, "bg-[#3b3b3d] hover:bg-[#454548]")}>
                    {localPath ? "Choose another image" : "Choose an image"}
                  </button>
                  {localPath && <span className="text-[12px] text-brand-light/55 truncate max-w-[300px]">{localPath.split("/").pop()}</span>}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between px-4 h-[58px] border-t border-black/60">
            {saved ? (
              <button type="button" data-testid="cover-reset" onClick={() => void resetCover().then(onClose)} className={cn(btn, "bg-[#3b3b3d] hover:bg-[#454548] text-brand-light")}>
                Use the first frame
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" data-testid="cover-cancel" onClick={onClose} className={cn(btn, "bg-[#3b3b3d] hover:bg-[#454548] text-brand-light")}>
                Cancel
              </button>
              <button
                type="button"
                data-testid="cover-edit"
                disabled={!canContinue}
                onClick={() => setStage("design")}
                className={cn(btn, "text-black hover:brightness-110 disabled:opacity-50 disabled:cursor-default")}
                style={{ background: ACCENT }}
              >
                Edit cover
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- step 2 ----
  return (
    <CoverDesign
      baseUrl={baseUrl!}
      ratio={ratio}
      texts={texts}
      setTexts={setTexts}
      selected={selected}
      setSelected={setSelected}
      saving={saving}
      exiting={exiting}
      setExiting={setExiting}
      onSave={() => void save()}
      onExit={onClose}
    />
  );
};

const Filmstrip: React.FC<{ tiles: (string | null)[]; durationUs: number; timeUs: number; onTime: (us: number) => void }> = ({ tiles, durationUs, timeUs, onTime }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const fps = useControlsStore((s) => s.fps) || 30;
  const move = useCallback(
    (clientX: number) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * durationUs;
      // On a frame.
      onTime(Math.min(Math.max(0, durationUs - 1), Math.round((t / 1e6) * fps) * (1e6 / fps)));
    },
    [durationUs, fps, onTime],
  );
  const pct = durationUs > 0 ? (timeUs / durationUs) * 100 : 0;
  return (
    <div
      ref={ref}
      data-testid="cover-filmstrip"
      data-time={Math.round(timeUs)}
      data-duration={durationUs}
      className="relative h-[46px] rounded-[2px] bg-black select-none cursor-pointer"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && move(e.clientX)}
    >
      <div className="absolute inset-0 flex overflow-hidden rounded-[2px]">
        {tiles.map((t, i) => (
          <div key={i} className="h-full flex-1 bg-[#161616] overflow-hidden">
            {t && <img src={t} alt="" draggable={false} className="w-full h-full object-cover" />}
          </div>
        ))}
      </div>
      <div className="absolute -top-[12px] bottom-0 w-0 pointer-events-none" style={{ left: `${pct}%` }}>
        <div className="absolute -left-[5px] top-0 w-[10px] h-[13px] rounded-[3px] bg-white border border-black/40" />
        <div className="absolute -left-px top-[12px] bottom-0 w-[2px] bg-white" />
      </div>
    </div>
  );
};

const CoverDesign: React.FC<{
  baseUrl: string;
  ratio: number;
  texts: CoverText[];
  setTexts: React.Dispatch<React.SetStateAction<CoverText[]>>;
  selected: string | null;
  setSelected: (id: string | null) => void;
  saving: boolean;
  exiting: boolean;
  setExiting: (v: boolean) => void;
  onSave: () => void;
  onExit: () => void;
}> = ({ baseUrl, ratio, texts, setTexts, selected, setSelected, saving, exiting, setExiting, onSave, onExit }) => {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [pageH, setPageH] = useState(480);
  const sel = texts.find((t) => t.id === selected) ?? null;

  useEffect(() => {
    const el = pageRef.current?.parentElement?.parentElement;
    if (!el) return;
    const fit = () => setPageH(Math.max(200, Math.min(el.clientHeight - 56, (el.clientWidth - 48) / ratio)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);

  const add = (kind: keyof typeof COVER_TEXT_KINDS) => {
    const k = COVER_TEXT_KINDS[kind];
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    setTexts((ts) => [...ts, { id, text: k.text, x: 0.5, y: kind === "title" ? 0.5 : kind === "subtitle" ? 0.62 : 0.72, size: k.size, color: "#ffffff", bold: k.bold }]);
    setSelected(id);
  };
  const patch = (id: string, p: Partial<CoverText>) => setTexts((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const remove = (id: string) => {
    setTexts((ts) => ts.filter((t) => t.id !== id));
    setSelected(null);
  };

  // Esc asks to exit; Delete removes the selected text unless a field has the keys.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea");
      if (e.key === "Escape" && !exiting) {
        e.preventDefault();
        setExiting(true);
      } else if ((e.key === "Backspace" || e.key === "Delete") && !typing && selected && !exiting) {
        e.preventDefault();
        remove(selected);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const drag = (e: React.PointerEvent, t: CoverText) => {
    e.stopPropagation();
    setSelected(t.id);
    const page = pageRef.current!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) =>
      patch(t.id, {
        x: Math.min(1, Math.max(0, start.tx + (m.clientX - start.x) / page.width)),
        y: Math.min(1, Math.max(0, start.ty + (m.clientY - start.y) / page.height)),
      });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div data-testid="cover-design" className="dark fixed inset-0 z-[150] flex flex-col bg-[#0b0b0c] text-brand-light select-none">
      <div className="h-[44px] shrink-0 flex items-center justify-center bg-[#262627] text-[13px] font-medium text-brand-lighter">Cover design</div>
      <div className="flex-1 min-h-0 flex">
        <div className="w-[56px] shrink-0 flex flex-col items-center pt-[88px]">
          <div className="flex flex-col p-1 rounded-[10px] bg-[#1b1b1c]">
            <span title="Text" className="h-8 w-8 rounded-[6px] bg-[#333335] flex items-center justify-center text-brand-lighter">
              <LuType className="w-4 h-4" />
            </span>
          </div>
        </div>
        <div className="w-[250px] shrink-0 mt-[24px] mb-[24px] rounded-[12px] bg-[#1b1b1c] flex flex-col overflow-hidden" data-testid="cover-text-panel">
          <div className="h-[46px] px-4 flex items-center text-[14px] font-semibold text-brand-lighter border-b border-black/60">Text</div>
          <div className="p-3 flex flex-col gap-2">
            {(Object.keys(COVER_TEXT_KINDS) as (keyof typeof COVER_TEXT_KINDS)[]).map((k) => (
              <button
                key={k}
                type="button"
                data-testid={`cover-add-${k}`}
                onClick={() => add(k)}
                className={cn("h-[42px] rounded-[6px] bg-[#2c2c2e] hover:bg-[#363639] text-brand-lighter cursor-pointer", k === "title" ? "text-[17px] font-semibold" : k === "subtitle" ? "text-[14px] font-semibold" : "text-[12.5px]")}
              >
                {COVER_TEXT_KINDS[k].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col items-center justify-center" onPointerDown={() => setSelected(null)}>
          <div className="flex flex-col" style={{ width: pageH * ratio }}>
          <div className="text-[12px] text-[#8a8a8a] mb-1.5">Page 1</div>
          <div ref={pageRef} data-testid="cover-page" className="relative overflow-hidden bg-black" style={{ height: pageH, width: pageH * ratio }}>
            <img src={baseUrl} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
            {texts.map((t) => (
              <div
                key={t.id}
                data-testid="cover-text"
                data-text-id={t.id}
                data-selected={t.id === selected}
                onPointerDown={(e) => drag(e, t)}
                className="absolute cursor-move whitespace-pre text-center leading-[1.2]"
                style={{
                  left: `${t.x * 100}%`,
                  top: `${t.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  fontSize: Math.max(4, t.size * pageH),
                  fontWeight: t.bold ? 700 : 400,
                  color: t.color,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
                  outline: t.id === selected ? `1.5px solid ${ACCENT}` : undefined,
                  outlineOffset: 3,
                }}
              >
                {t.text}
              </div>
            ))}
          </div>
          </div>
        </div>

        <div className="w-[270px] shrink-0 m-6 mr-6 rounded-[12px] bg-[#1b1b1c] p-4 flex flex-col gap-3 text-[12.5px]" data-testid="cover-props">
          {sel ? (
            <>
              <div className="text-[14px] font-semibold text-brand-lighter">Text</div>
              <textarea
                data-testid="cover-text-input"
                value={sel.text}
                onChange={(e) => patch(sel.id, { text: e.target.value })}
                rows={3}
                className="w-full rounded-[6px] bg-[#2c2c2e] border border-transparent focus:border-[#ae81ce] focus:outline-none p-2 text-brand-lighter resize-none select-text"
              />
              <label className="flex items-center gap-3">
                <span className="w-12 text-brand-light/65">Size</span>
                <input type="range" min={0.02} max={0.3} step={0.005} value={sel.size} data-testid="cover-text-size" onChange={(e) => patch(sel.id, { size: +e.target.value })} className="flex-1 accent-[#ae81ce]" />
                <span className="w-9 text-right tabular-nums text-brand-light/65">{Math.round(sel.size * 100)}</span>
              </label>
              <div className="flex items-center gap-3">
                <span className="w-12 text-brand-light/65">Color</span>
                <div className="flex gap-1.5 flex-wrap">
                  {COVER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Color ${c}`}
                      data-testid="cover-text-color"
                      data-color={c}
                      onClick={() => patch(sel.id, { color: c })}
                      className={cn("h-5 w-5 rounded-full border cursor-pointer", sel.color === c ? "border-white ring-1 ring-[#ae81ce]" : "border-white/30")}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <span className="w-12 text-brand-light/65">Bold</span>
                <input type="checkbox" checked={sel.bold} data-testid="cover-text-bold" onChange={(e) => patch(sel.id, { bold: e.target.checked })} className="accent-[#ae81ce]" />
              </label>
              <button type="button" data-testid="cover-text-delete" onClick={() => remove(sel.id)} className="mt-1 h-8 rounded-[6px] bg-[#2c2c2e] hover:bg-[#363639] text-brand-light flex items-center justify-center gap-2 cursor-pointer">
                <LuTrash2 className="w-3.5 h-3.5" /> Delete text
              </button>
            </>
          ) : (
            <p className="text-[#8a8a8a] leading-[18px]">Add a title, a subtitle or body text from the Text panel, drag it where you want it, then change its words, size and colour here.</p>
          )}
        </div>
      </div>
      <div className="h-[50px] shrink-0 flex items-center justify-end gap-2 px-6 bg-[#161617]">
        <button type="button" data-testid="cover-design-cancel" onClick={() => setExiting(true)} className={cn(btn, "h-7 bg-[#3b3b3d] hover:bg-[#454548] text-brand-lighter")}>
          Cancel
        </button>
        <button type="button" data-testid="cover-save" disabled={saving} onClick={onSave} className={cn(btn, "h-7 text-black hover:brightness-110 disabled:opacity-60")} style={{ background: ACCENT }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {exiting && (
        <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center" data-testid="cover-exit-confirm" onPointerDown={(e) => e.stopPropagation()}>
          <div className="w-[420px] rounded-[12px] bg-[#2b2b2f] p-6">
            <div className="flex items-start justify-between">
              <h3 className="text-[17px] font-semibold text-brand-lighter">Exit editing?</h3>
              <button type="button" aria-label="Close" onClick={() => setExiting(false)} className="text-brand-light/80 hover:text-white cursor-pointer text-[18px] leading-none">
                ×
              </button>
            </div>
            <p className="mt-2 text-[13.5px] text-brand-light/70">Your changes won’t be saved.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" data-testid="cover-exit-cancel" onClick={() => setExiting(false)} className={cn(btn, "bg-[#3b3b3f] hover:bg-[#46464a] text-brand-lighter")}>
                Cancel
              </button>
              <button type="button" data-testid="cover-exit" onClick={onExit} className={cn(btn, "bg-[#e8453c] hover:bg-[#d83d34] text-white")}>
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoverEditor;
