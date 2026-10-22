// The Export dialog, laid out as CapCut's (docs/plan/capcut-ui-spec.md §6.29): the project's cover
// on the left, the settings on the right under the title: Export timeline, Name, Export to, then
// sections that each have a checkbox of their own: Video (Resolution, Bit rate with a Custom
// field, Codec, Format, Frame rate, Color space), Audio (Format), Export GIF (Resolution) and
// Captions (Format, encoding). The footer says what the export will take and weigh, with Cancel
// and Export. Choosing Export swaps the settings for the run's progress, then for what it
// wrote. The choices are written by lib/export-run.ts; their numbers come from
// lib/export-options.ts. The same dialog exports one clip (`scope`), with the sections that make
// sense for it.
import { allClips } from "@/lib/compound";
import { timelineRoot } from "@/lib/timelines";
import React, { useEffect, useRef, useState } from "react";
import { LuCheck, LuChevronDown, LuChevronUp, LuCircleCheck, LuCircleHelp, LuCircleX, LuClapperboard, LuFolder, LuFolderOpen, LuInfo, LuPencil } from "react-icons/lu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { useProjectsStore } from "@/lib/projects";
import { getMediaInfoCached } from "@/lib/media/utils";
import { engineExportCodecs, pickMediaPaths } from "@app/preload";
import { ExportCredits } from "./ExportCredits";
import type { VideoClipProps } from "@/lib/types";
import {
  AUDIO_FORMATS,
  BASIC_CODECS,
  BITRATES,
  CAPTION_FORMATS,
  CODECS,
  FORMATS,
  FRAME_RATES,
  GIF_RESOLUTIONS,
  RESOLUTIONS,
  durationLabel,
  timeLeftLabel,
  estimateBytes,
  isProRes,
  nearestRate,
  needsMov,
  outputSize,
  presetKbps,
  sizeLabel,
  type AudioFormat,
  type BitrateMode,
  type CaptionFormat,
  type Choice,
  type VideoSettings,
} from "@/lib/export-options";
import { cancelExportRun, exportTargets, revealExported, runExport, useExportRun, type ExportSettings } from "@/lib/export-run";
import { timelineCues } from "@/lib/caption-actions";
import { openCoverEditor } from "@/lib/cover";
import { cardSeconds, type ExportScope } from "@/lib/export-scope";
import { imageDurationFrames } from "@/lib/preferences";
import { OPENH264_ATTRIBUTION } from "@/lib/openh264";

export type { ExportScope };

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope?: ExportScope;
}

type Saved = { video: boolean; audio: boolean; gif: boolean; captions: boolean; v: Omit<VideoSettings, "fps"> & { fps?: number }; audioFormat: AudioFormat; gifSize: number; captionFormat: CaptionFormat; path: string };

const KEY = "openrip:export-settings";

const DEFAULTS: Saved = {
  video: true,
  audio: true,
  gif: false,
  captions: false,
  v: { resolution: 1080, bitrate: "recommended", customKbps: 8000, codec: "h264", format: "mp4" },
  audioFormat: "mp3",
  gifSize: 240,
  captionFormat: "srt",
  path: "~/Downloads",
};

const load = (): Saved => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), v: { ...DEFAULTS.v, ...(JSON.parse(raw).v ?? {}) } };
  } catch {
    // no saved choices: the defaults
  }
  return DEFAULTS;
};

const save = (s: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // not saved
  }
};

const row = "grid grid-cols-[105px_1fr] items-start min-h-[38px] pt-[8px]";

/** A choice menu on the raised grey: 22 px tall, its options 34 px (two lines with a note), the chosen one ticked in the accent. */
function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  testId,
  width = 224,
}: {
  value: T;
  options: Choice<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  testId: string;
  width?: number;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={disabled}
        data-testid={testId}
        data-value={String(value)}
        style={{ width }}
        className={cn(
          "h-[22px] rounded-[4px] px-2 flex items-center justify-between gap-2 text-[12px] font-semibold outline-none data-[state=open]:[&>svg]:rotate-180",
          disabled ? "bg-[#2c2c2c] text-[#626262] cursor-default" : "bg-[#3b3b3b] text-[#f2f2f2] cursor-pointer",
        )}
      >
        <span className="truncate">{current?.label ?? String(value)}</span>
        <LuChevronDown className="w-3.5 h-3.5 shrink-0 transition-transform" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        style={{ width }}
        data-testid={`${testId}-menu`}
        className="dark z-[130] bg-[#2c2c2c] border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] p-1 max-h-[300px] overflow-y-auto"
      >
        {options.map((o) => (
          <DropdownMenuItem
            key={String(o.value)}
            data-testid={`${testId}-option`}
            data-value={String(o.value)}
            onSelect={() => onChange(o.value)}
            className={cn("dark text-[12px] text-[#f2f2f2] gap-2 pl-2 pr-2 rounded-[4px] cursor-pointer focus:bg-[#404040] items-start", o.note ? "min-h-[50px] py-1.5" : "h-[34px] items-center")}
          >
            <span className="w-4 h-4 flex justify-center text-brand-accent shrink-0 mt-[1px]">{o.value === value && <LuCheck className="w-3.5 h-3.5" />}</span>
            <span className="flex flex-col min-w-0">
              <span className="font-semibold">{o.label}</span>
              {o.note && <span className="text-[12px] text-[#a8a8a8] font-normal leading-[15px]">{o.note}</span>}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A section's checkbox: 14 px, rounded, the accent when on. */
const Check: React.FC<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId: string; label?: string }> = ({ checked, onChange, disabled, testId, label }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={label}
    data-testid={testId}
    data-checked={checked ? "true" : "false"}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn("w-[14px] h-[14px] rounded-[3px] flex items-center justify-center shrink-0 outline-none", checked ? "bg-brand-accent text-white" : "bg-[#3b3b3b] border border-[#5a5a5a]", disabled && "opacity-40", !disabled && "cursor-pointer")}
  >
    {checked && <LuCheck className="w-[11px] h-[11px]" strokeWidth={3} />}
  </button>
);

/** A section: its checkbox, a 12 px semibold title and ▲ that folds its rows away, on a divider. */
const Section: React.FC<{ id: string; title: string; checked: boolean; onCheck: (v: boolean) => void; disabled?: boolean; children: React.ReactNode }> = ({ id, title, checked, onCheck, disabled, children }) => {
  const [folded, setFolded] = useState(false);
  return (
    <div data-testid={`export-section-${id}`} data-on={checked ? "true" : "false"} className="border-t border-[#373737] pt-[14px] pb-2 first:border-t-0">
      <div className="flex items-center gap-2 h-[22px]">
        <Check checked={checked} onChange={onCheck} disabled={disabled} testId={`export-${id}-check`} label={title} />
        <span className={cn("text-[12px] font-semibold", disabled ? "text-[#626262]" : "text-[#f2f2f2]")}>{title}</span>
        <button type="button" aria-label={folded ? `Show ${title}` : `Hide ${title}`} data-testid={`export-${id}-fold`} onClick={() => setFolded(!folded)} className="text-[#9a9a9a] hover:text-white cursor-pointer">
          {folded ? <LuChevronDown className="w-3 h-3" /> : <LuChevronUp className="w-3 h-3" />}
        </button>
      </div>
      {!folded && <div className={cn("mt-1", !checked && "opacity-100")}>{children}</div>}
    </div>
  );
};

const Label: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) => <div className={cn("text-[12px] leading-[22px]", on ? "text-[#f2f2f2]" : "text-[#525252]")}>{children}</div>;

const Tip: React.FC<{ text: string }> = ({ text }) => (
  <span title={text} className="inline-flex align-middle ml-1 text-[#8a8a8a]">
    <LuCircleHelp className="w-3 h-3" />
  </span>
);

/** The project's cover (or a placeholder), at the project's ratio, with CapCut's "Edit cover" chip. */
const Cover: React.FC<{ cover?: string; version?: number; ratio: number }> = ({ cover, version, ratio }) => {
  const maxW = 270;
  const maxH = 318;
  const h = ratio >= maxW / maxH ? maxW / ratio : maxH;
  const w = h * ratio;
  return (
    <div data-testid="export-cover" style={{ width: w, height: h }} className="relative rounded-[6px] overflow-hidden bg-[#1a1a1a] shrink-0">
      {cover ? <img alt="Cover" draggable={false} src={`app://user-data${encodeURI(cover)}?v=${version ?? 0}`} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-[#5a5a5a]"><LuClapperboard className="w-8 h-8" /></div>}
      <button
        type="button"
        data-testid="export-edit-cover"
        onClick={() => openCoverEditor()}
        className="absolute left-1.5 top-1.5 h-[20px] px-1.5 rounded-[4px] bg-black/55 hover:bg-black/70 text-[12px] font-medium text-white flex items-center gap-1 cursor-pointer"
      >
        <LuPencil className="w-3 h-3" />
        Edit cover
      </button>
    </div>
  );
};

/** H.264 without the hardware encoder waits on Cisco's OpenH264, downloading: what it is, Cisco's credit (its licence asks for it), how far. */
const CodecDownload: React.FC<{ received: number; total: number }> = ({ received, total }) => {
  const percent = total > 0 ? Math.round((received / total) * 100) : 0;
  return (
    <div data-testid="export-codec-download">
      <div className="text-[13px] font-semibold text-[#f2f2f2]">Downloading the H.264 codec…</div>
      <div className="text-[12px] leading-[17px] text-[#a8a8a8] mt-1">
        Exporting H.264 without hardware encoding uses OpenH264, a codec Cisco makes. OpenRip downloads it from Cisco this once and keeps it; Settings › Performance can turn it off.
      </div>
      <div className="text-[12px] text-[#cfcfcf] mt-2" data-testid="export-openh264-credit">
        {OPENH264_ATTRIBUTION}
      </div>
      <div className="mt-6 h-[6px] rounded-full bg-[#3b3b3b] overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-brand-accent rounded-full transition-[width] duration-150" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[12px] text-[#a8a8a8]">
        <span>{received > 0 ? (total > 0 ? `${sizeLabel(received)} of ${sizeLabel(total)}` : sizeLabel(received)) : "Connecting to Cisco…"}</span>
        <span>{total > 0 ? `${percent}%` : ""}</span>
      </div>
    </div>
  );
};

const ProgressView: React.FC<{ onBack: () => void; onClose: () => void; onProRes: () => void; name: string }> = ({ onBack, onClose, onProRes, name }) => {
  const run = useExportRun();
  const percent = Math.round(run.ratio * 100);
  const left = timeLeftLabel(run.startedAt, run.ratio);
  return (
    <div data-testid="export-run" data-phase={run.phase} className="flex-1 min-w-0 pr-5 pt-[14px] flex flex-col">
      {run.phase === "running" && run.download && <CodecDownload received={run.download.received} total={run.download.total} />}
      {run.phase === "running" && !run.download && (
        <>
          <div className="text-[13px] font-semibold text-[#f2f2f2]" data-testid="export-run-title">
            {run.cancelling ? "Cancelling…" : `Exporting ${run.label.toLowerCase()}…`}
          </div>
          <div className="text-[12px] text-[#a8a8a8] mt-1">You can close this window; the export goes on in the background.</div>
          <div className="mt-6 h-[6px] rounded-full bg-[#3b3b3b] overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} data-testid="export-progress">
            <div className="h-full bg-brand-accent rounded-full transition-[width] duration-150" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[12px] text-[#a8a8a8]">
            <span data-testid="export-time-left">{left ? `${left} left` : ""}</span>
            <span data-testid="export-percent">{percent}%</span>
          </div>
        </>
      )}
      {run.phase === "done" && (
        <>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#f2f2f2]">
            <LuCircleCheck className="w-4 h-4 text-brand-accent" />
            <span data-testid="export-done-title">Export completed</span>
          </div>
          <div className="mt-4 flex flex-col gap-2" data-testid="export-files">
            {run.files.map((f) => (
              <div key={f.path} data-testid="export-file" className="rounded-[6px] bg-[#2f2f2f] px-3 py-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-[#f2f2f2]">{f.label}</div>
                  <div className="text-[12px] text-[#a8a8a8] truncate" title={f.path}>
                    {f.note ?? f.path}
                  </div>
                </div>
                {!f.note && (
                  <button type="button" title="Show in Finder" data-testid="export-file-reveal" onClick={() => revealExported(f.path)} className="w-[22px] h-[22px] rounded-[4px] bg-[#505056] hover:bg-[#5c5c63] flex items-center justify-center text-[#e0e0e0] cursor-pointer">
                    <LuFolderOpen className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {/* The library tracks in the project and their credits, to paste into the description. */}
          <ExportCredits />
        </>
      )}
      {run.phase === "failed" && (
        <>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#f2f2f2]">
            <LuCircleX className="w-4 h-4 text-[#e5484d]" />
            Export failed
          </div>
          <div className="mt-3 text-[12px] text-[#cfcfcf] break-words" data-testid="export-error">
            {run.error}
          </div>
          {run.offerProRes && <div className="mt-3 text-[12px] text-[#a8a8a8]">ProRes needs no download: export as ProRes 422 instead (a larger .mov, for editing).</div>}
          {run.files.length > 0 && <div className="mt-3 text-[12px] text-[#a8a8a8]">Written before it stopped: {run.files.map((f) => f.label).join(", ")}.</div>}
        </>
      )}
      {run.phase === "cancelled" && (
        <>
          <div className="text-[13px] font-semibold text-[#f2f2f2]" data-testid="export-cancelled">
            Export cancelled
          </div>
          <div className="mt-2 text-[12px] text-[#a8a8a8]">{run.files.length ? `Already written: ${run.files.map((f) => f.label).join(", ")}.` : `Nothing was written for “${name}”.`}</div>
        </>
      )}
      <div className="mt-auto" />
      <div className="flex justify-end gap-2 pb-[13px]">
        {run.phase === "running" ? (
          <>
            <button type="button" data-testid="export-run-background" onClick={onClose} className="h-[28px] px-4 rounded-[4px] bg-[#4f4f4f] hover:bg-[#5a5a5a] text-[12px] font-semibold text-white cursor-pointer">
              Close
            </button>
            <button type="button" data-testid="export-run-cancel" disabled={run.cancelling} onClick={cancelExportRun} className="h-[28px] px-4 rounded-[4px] bg-[#4f4f4f] hover:bg-[#5a5a5a] disabled:opacity-50 text-[12px] font-semibold text-white cursor-pointer">
              Cancel
            </button>
          </>
        ) : (
          <>
            {run.phase !== "done" && (
              <button type="button" data-testid="export-run-back" onClick={onBack} className="h-[28px] px-4 rounded-[4px] bg-[#4f4f4f] hover:bg-[#5a5a5a] text-[12px] font-semibold text-white cursor-pointer">
                Back
              </button>
            )}
            {run.phase === "failed" && run.offerProRes && (
              <button type="button" data-testid="export-run-prores" onClick={onProRes} className="h-[28px] px-4 rounded-[4px] bg-[#4f4f4f] hover:bg-[#5a5a5a] text-[12px] font-semibold text-white cursor-pointer">
                Export as ProRes
              </button>
            )}
            {run.phase === "done" && run.files.some((f) => !f.note) && (
              <button type="button" data-testid="export-open-folder" onClick={() => revealExported(run.files.find((f) => !f.note)!.path)} className="h-[28px] px-4 rounded-[4px] bg-[#4f4f4f] hover:bg-[#5a5a5a] text-[12px] font-semibold text-white cursor-pointer">
                Open folder
              </button>
            )}
            <button type="button" data-testid="export-run-done" onClick={onClose} className="h-[28px] px-4 rounded-[4px] bg-brand-accent hover:bg-brand-accent-two-shade text-[12px] font-semibold text-white cursor-pointer">
              {run.phase === "done" ? "Done" : "Close"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export const ExportModal: React.FC<ExportModalProps> = ({ open, onOpenChange, scope }) => {
  const run = useExportRun();
  const project = useProjectsStore((s) => s.getActiveProject());
  const aspect = useViewportStore((s) => s.aspectRatio);
  const projectFps = useControlsStore((s) => s.fps);
  const ratio = aspect.width / aspect.height;

  const [saved, setSaved] = useState<Saved>(load);
  const [name, setName] = useState("");
  const [hasAudio, setHasAudio] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [hasCaptions, setHasCaptions] = useState(false);
  const [fps, setFps] = useState(nearestRate(projectFps || 30));
  const wasOpen = useRef(false);
  // Which of the project's timelines the export is of (the one being edited when the dialog opens).
  const timelines = useClipStore((s) => s.projectTimelines);
  const activeTimelineId = useClipStore((s) => s.activeTimelineId);
  const [timelineId, setTimelineId] = useState(activeTimelineId);
  // The codecs this machine's encoders write with the hardware setting as it is (Settings ›
  // Performance); the others stay hidden.
  const [platformCodecs, setPlatformCodecs] = useState<string[]>([]);
  // No codec at all: this computer's engine has no video encoder (Windows and Linux until
  // their encoders are in), so the Video section is off and says so; sound, GIFs and captions still export.
  const [noEncoder, setNoEncoder] = useState(false);
  useEffect(() => {
    if (!open) return;
    // Asked each time the dialog opens: the engine may load after the editor does.
    let live = true;
    void engineExportCodecs().then((c) => {
      if (!live) return;
      setPlatformCodecs(c);
      setNoEncoder(c.length === 0);
    }, () => {});
    return () => {
      live = false;
    };
  }, [open]);

  // What the project (or the clip) holds, read each time the dialog opens.
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    // Opening starts on the timeline being edited; picking another reads that one again.
    const first = !wasOpen.current;
    wasOpen.current = true;
    const { getClipById, activeTimelineId } = useClipStore.getState();
    if (first && timelineId !== activeTimelineId) setTimelineId(activeTimelineId);
    const chosen = first || scope ? activeTimelineId : timelineId;
    // An export is of a whole timeline, whatever compound is open (and the compounds' sound counts).
    const root = timelineRoot(chosen) ?? timelineRoot()!;
    const clips = root.clips;
    const clipDuration = root.clipDuration;
    const rate = useControlsStore.getState().fps || 30;
    const rangeOf = scope?.range;
    const ones = scope ? (rangeOf ? clips.filter((c) => !c.hidden && (c.endFrame ?? 0) > rangeOf.start && (c.startFrame ?? 0) < rangeOf.end) : scope.clipIds.map((id) => getClipById(id)).filter(Boolean)) : [];
    const pool = allClips(scope ? (ones as any[]) : clips);
    const cards = scope?.cards;
    const audible = cards ? cards.some((c) => c.audible) : pool.some((c: any) => {
      if (c.hidden) return false;
      if (c.type === "audio") return true;
      if (c.type === "video") return getMediaInfoCached((c as VideoClipProps).assetId)?.audio !== null;
      return false;
    });
    setHasAudio(audible);
    const span = (() => {
      if (!scope) return (clipDuration || 0) / rate;
      if (cards) return cards.reduce((n, c) => n + cardSeconds(c, imageDurationFrames(rate) / rate), 0);
      if (rangeOf) return (Math.min(rangeOf.end, clipDuration || rangeOf.end) - rangeOf.start) / rate;
      const list = ones as any[];
      return list.length ? (Math.max(...list.map((c) => c.endFrame)) - Math.min(...list.map((c) => c.startFrame))) / rate : 0;
    })();
    setSeconds(Math.max(0, span));
    setHasCaptions(!scope && timelineCues(chosen).length > 0);
    if (!first) return;
    setFps(nearestRate(rate));
    setName(scope?.name || project?.name || "Export");
    // A finished run's screen is for the dialog it was in; a new opening starts at the settings.
    if (useExportRun.getState().phase !== "running") useExportRun.getState().reset();
  }, [open, timelineId]);

  const sections = {
    video: scope ? scope.kind !== "audio" : true,
    audio: true,
    gif: scope ? scope.kind !== "audio" : true,
    captions: !scope,
  };
  const set = (patch: Partial<Saved>) => setSaved((s) => {
    const next = { ...s, ...patch };
    save(next);
    return next;
  });
  const setV = (patch: Partial<Saved["v"]>) => set({ v: { ...saved.v, ...patch } });

  // ProRes and HEVC with alpha are .mov files whatever the Format menu said.
  const video: VideoSettings = { ...saved.v, fps, format: needsMov(saved.v.codec) ? "mov" : saved.v.format };
  const codecs = CODECS.filter((c) => (platformCodecs.length ? platformCodecs : BASIC_CODECS).includes(c.value));
  // A codec this machine can't write now (HEVC with hardware encoding off) gives way to H.264.
  useEffect(() => {
    if (platformCodecs.length && !platformCodecs.includes(saved.v.codec)) setV({ codec: (platformCodecs.includes("h264") ? "h264" : platformCodecs[0]) as Saved["v"]["codec"] });
  }, [platformCodecs]);
  const proRes = isProRes(saved.v.codec);
  const size = outputSize(video.resolution, ratio);
  const on = {
    video: sections.video && saved.video && !noEncoder,
    audio: sections.audio && saved.audio && hasAudio,
    gif: sections.gif && saved.gif,
    captions: sections.captions && saved.captions,
  };

  // Switching to Custom starts from the number the preset was.
  const pickBitrate = (mode: BitrateMode) => {
    if (mode === "custom" && saved.v.bitrate !== "custom") setV({ bitrate: "custom", customKbps: presetKbps(saved.v.bitrate as Exclude<BitrateMode, "custom">, size.width, size.height, fps) });
    else setV({ bitrate: mode });
  };

  const settings: ExportSettings = {
    name,
    path: saved.path,
    video: on.video ? video : null,
    videoAudio: hasAudio,
    audio: on.audio ? saved.audioFormat : null,
    gif: on.gif ? saved.gifSize : null,
    captions: on.captions ? saved.captionFormat : null,
  };
  const est = estimateBytes({ seconds, ratio, video: settings.video, videoHasAudio: hasAudio, audio: settings.audio, gif: settings.gif, captions: !!settings.captions && hasCaptions });
  const anything = exportTargets(settings).length > 0;
  const canExport = anything && name.trim() !== "" && saved.path.trim() !== "" && run.phase !== "running" && seconds > 0;

  const start = () => {
    if (!canExport) return;
    void runExport(settings, scope, scope ? undefined : timelineId);
  };

  // The video couldn't get OpenH264 (offline, or turned off): the same export as ProRes 422.
  const exportProRes = () => {
    setV({ codec: "prores-422" });
    void runExport({ ...settings, video: settings.video && { ...settings.video, codec: "prores-422", format: "mov" } }, scope, scope ? undefined : timelineId);
  };

  const pickFolder = async () => {
    try {
      const picked = await pickMediaPaths({ directory: true, title: "Choose export folder", defaultPath: saved.path || undefined });
      if (Array.isArray(picked) && typeof picked[0] === "string") set({ path: picked[0] });
    } catch {
      // keep the folder
    }
  };

  const showRun = run.phase !== "idle";
  const dim = (b: boolean) => !b;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="export-dialog"
        aria-describedby={undefined}
        className="dark w-[720px] max-w-[720px] h-[663px] p-0 gap-0 flex flex-col bg-[#262626] border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_16px_48px_rgba(0,0,0,0.55)] sm:rounded-[12px] overflow-hidden font-poppins [&>button.absolute]:hidden"
      >
        <div className="h-[34px] shrink-0 border-b border-[#373737] flex items-center px-[10px]">
          <DialogTitle className="text-[12px] font-semibold text-[#f2f2f2] truncate" data-testid="export-title">
            Export-{name || project?.name || ""}
          </DialogTitle>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="w-[350px] shrink-0 pt-[17px] flex justify-center">
            <Cover cover={project?.coverPath} version={project?.lastModified} ratio={Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9} />
          </div>
          {showRun ? (
            <ProgressView name={name} onBack={() => useExportRun.getState().reset()} onProRes={exportProRes} onClose={() => { if (run.phase !== "running") useExportRun.getState().reset(); onOpenChange(false); }} />
          ) : (
            <div className="flex-1 min-w-0 overflow-y-auto pr-[17px] pb-3" data-testid="export-settings">
              <div className={cn(row, "pt-[14px]")}>
                <Label on>Export timeline</Label>
                {!scope && timelines.length > 1 ? (
                  <Select testId="export-timeline" value={timelineId} options={timelines.map((t) => ({ value: t.id, label: t.name }))} onChange={setTimelineId} />
                ) : (
                  <div data-testid="export-timeline" className="text-[12px] leading-[22px] text-[#a8a8a8]">
                    {scope ? (scope.cards ? (scope.cards.length > 1 ? "Selected media" : "Selected media item") : scope.range ? "Range" : scope.clipIds.length > 1 ? "Selected clips" : "Selected clip") : (timelines.find((t) => t.id === activeTimelineId)?.name ?? "Timeline 01")}
                  </div>
                )}
              </div>
              <div className={row}>
                <Label on>Name</Label>
                {scope?.cards && scope.cards.length > 1 ? (
                  <div data-testid="export-name-cards" className="text-[12px] leading-[22px] text-[#a8a8a8]">One file per card, named after it</div>
                ) : (
                <input data-testid="export-name" placeholder="My export" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} className="h-[22px] w-[239px] rounded-[4px] bg-[#343337] px-2 text-[12px] font-medium text-[#f2f2f2] outline-none focus:ring-1 focus:ring-brand-accent/60" />
                )}
              </div>
              <div className={cn(row, "pb-[6px]")}>
                <Label on>Export to</Label>
                <div className="flex items-center gap-1">
                  <input data-testid="export-path" placeholder="/path/to/export" value={saved.path} onChange={(e) => set({ path: e.target.value })} spellCheck={false} title={saved.path} className="h-[22px] w-[212px] rounded-[4px] bg-[#343337] px-2 text-[12px] font-medium text-[#f2f2f2] outline-none text-ellipsis focus:ring-1 focus:ring-brand-accent/60" />
                  <button type="button" data-testid="export-path-pick" title="Choose a folder" onClick={pickFolder} className="h-[22px] w-[22px] rounded-[4px] bg-[#505056] hover:bg-[#5c5c63] flex items-center justify-center text-[#e0e0e0] cursor-pointer">
                    <LuFolder className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {sections.video && (
                <Section id="video" title="Video" checked={on.video} onCheck={(v) => set({ video: v })} disabled={noEncoder}>
                  {noEncoder && (
                    <div className="text-[12px] leading-[17px] pt-1 pb-2 text-[#a8a8a8]" data-testid="export-no-encoder">
                      No video encoder is available on this computer yet, so videos can't be exported here. The sound, a GIF and captions still can.
                    </div>
                  )}
                  <div className={row}>
                    <Label on={on.video}>Resolution</Label>
                    <Select testId="export-resolution" disabled={dim(on.video)} value={video.resolution} options={RESOLUTIONS} onChange={(v) => setV({ resolution: v })} />
                  </div>
                  <div className={row}>
                    <Label on={on.video}>
                      Bit rate
                      {saved.v.bitrate === "custom" && <Tip text="A higher bit rate keeps more detail and makes a larger file." />}
                    </Label>
                    <div className="flex flex-col gap-2">
                      <Select testId="export-bitrate" disabled={!on.video || proRes} value={saved.v.bitrate} options={BITRATES} onChange={pickBitrate} />
                      {saved.v.bitrate === "custom" && (
                        <div className="flex items-center gap-3">
                          <input
                            data-testid="export-bitrate-custom"
                            disabled={dim(on.video)}
                            inputMode="numeric"
                            value={String(saved.v.customKbps)}
                            onChange={(e) => {
                              const n = Number(e.target.value.replace(/[^\d]/g, ""));
                              setV({ customKbps: Math.min(500_000, n) });
                            }}
                            className="h-[22px] w-[120px] rounded-[4px] bg-[#343337] px-2 text-[12px] font-medium text-[#f2f2f2] outline-none focus:ring-1 focus:ring-brand-accent/60 disabled:text-[#626262]"
                          />
                          <span className={cn("text-[12px]", on.video ? "text-[#f2f2f2]" : "text-[#525252]")}>Kbps</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={row}>
                    <Label on={on.video}>Codec</Label>
                    <Select testId="export-codec" disabled={dim(on.video)} value={video.codec} options={codecs.some((c) => c.value === video.codec) ? codecs : CODECS} onChange={(v) => setV({ codec: v })} />
                  </div>
                  <div className={cn("text-[12px] leading-[17px] pt-2 pb-1", on.video ? "text-[#a8a8a8]" : "text-[#525252]")} data-testid="export-codec-note">
                    {video.codec === "h264"
                      ? "The current setting is the same as that of the project. Changing it may affect your video quality."
                      : video.codec === "hevc"
                        ? "HEVC saves space but some players and editors can't open it. Changing it may affect your video quality."
                        : video.codec === "hevc-alpha"
                          ? "Parts of the picture nothing covers are transparent. Plays in Apple's players and editors; saved as a .mov."
                          : "ProRes is an editing format: large files, high quality, saved as a .mov. The bit rate is set by the profile."}
                  </div>
                  <div className={row}>
                    <Label on={on.video}>Format</Label>
                    <Select testId="export-format" disabled={!on.video || needsMov(saved.v.codec)} value={video.format} options={FORMATS} onChange={(v) => setV({ format: v })} />
                  </div>
                  <div className={row}>
                    <Label on={on.video}>Frame rate</Label>
                    <Select testId="export-fps" disabled={dim(on.video)} value={fps} options={FRAME_RATES} onChange={(v) => setFps(v)} />
                  </div>
                  <div className={row}>
                    <Label on={false}>Color space</Label>
                    <div className={cn("text-[12px] leading-[22px]", on.video ? "text-[#f2f2f2]" : "text-[#525252]")} data-testid="export-colorspace">
                      Rec. 709 SDR
                    </div>
                  </div>
                </Section>
              )}

              {sections.audio && (
                <Section id="audio" title="Audio" checked={on.audio} disabled={!hasAudio} onCheck={(v) => set({ audio: v })}>
                  <div className={row}>
                    <Label on={on.audio}>Format</Label>
                    <Select testId="export-audio-format" disabled={dim(on.audio)} value={saved.audioFormat} options={AUDIO_FORMATS} onChange={(v) => set({ audioFormat: v })} />
                  </div>
                  {!hasAudio && <div className="text-[12px] text-[#525252] pt-1">There's no sound in {scope ? (scope.range ? "the range" : scope.clipIds.length > 1 ? "these clips" : "this clip") : "the project"}.</div>}
                </Section>
              )}

              {sections.gif && (
                <Section id="gif" title="Export GIF" checked={saved.gif} onCheck={(v) => set({ gif: v })}>
                  <div className={row}>
                    <Label on={on.gif}>Resolution</Label>
                    <Select testId="export-gif-resolution" disabled={dim(on.gif)} value={saved.gifSize} options={GIF_RESOLUTIONS} onChange={(v) => set({ gifSize: v })} />
                  </div>
                </Section>
              )}

              {sections.captions && (
                <Section id="captions" title="Captions" checked={saved.captions} onCheck={(v) => set({ captions: v })}>
                  <div className={row}>
                    <Label on={on.captions}>Format</Label>
                    <Select testId="export-caption-format" disabled={dim(on.captions)} value={saved.captionFormat} options={CAPTION_FORMATS} onChange={(v) => set({ captionFormat: v })} />
                  </div>
                  <div className={row}>
                    <Label on={false}>Character encoding:</Label>
                    <div className={cn("text-[12px] leading-[22px]", on.captions ? "text-[#f2f2f2]" : "text-[#525252]")}>Unicode / UTF-8</div>
                  </div>
                  {on.captions && !hasCaptions && <div className="text-[12px] text-[#a8a8a8] pt-1" data-testid="export-captions-none">There are no captions on the timeline yet.</div>}
                </Section>
              )}
            </div>
          )}
        </div>
        {!showRun && (
          <div className="h-[53px] shrink-0 border-t border-[#373737] flex items-center px-[22px]" data-testid="export-footer">
            <LuClapperboard className="w-4 h-4 text-[#d0d0d0]" />
            <span className="ml-2 text-[12px] text-[#f2f2f2]" data-testid="export-estimate" data-bytes={Math.round(est.total)} data-seconds={seconds.toFixed(2)}>
              Duration: {durationLabel(seconds)} | Size: about {sizeLabel(est.total)}
            </span>
            <span title="The size is an estimate from the bit rate and the length; the file may differ." className="ml-2 text-[#d0d0d0]">
              <LuInfo className="w-[14px] h-[14px]" />
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" data-testid="export-cancel" onClick={() => onOpenChange(false)} className="h-[28px] w-[71px] rounded-[4px] bg-[#4f4f4f] hover:bg-[#5a5a5a] text-[12px] font-semibold text-white cursor-pointer">
                Cancel
              </button>
              <button type="button" data-testid="export-submit" disabled={!canExport} onClick={start} className="h-[28px] w-[70px] rounded-[4px] bg-brand-accent hover:bg-brand-accent-two-shade disabled:opacity-40 disabled:cursor-not-allowed text-[12px] font-semibold text-white cursor-pointer">
                Export
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ExportModal;
