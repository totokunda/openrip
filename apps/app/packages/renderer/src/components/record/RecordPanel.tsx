import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { LuCamera, LuMonitor, LuMonitorPlay } from "react-icons/lu";
import { recordAsk, recordFake, recordSources, recordingSave } from "@app/preload";
import type { RecordSource, RecordSources } from "@app/preload";
import { useControlsStore } from "@/lib/control";
import { useProjectsStore } from "@/lib/projects";
import { bumpMediaLibraryVersion } from "@/lib/media/library";
import { MicError } from "@/lib/mic";
import { listVideoInputs, Recorder, type RecordMode, type VideoInput } from "@/lib/record";
import { SmallCheckbox } from "@/components/properties/AudioProperties";
import { cn } from "@/lib/utils";

/**
 * Record (the Media tab's button, `05-left-media/010-record-hover.png`): a small panel floating
 * at the window's top right, in the Voiceover panel's style. Pick Screen, Camera or Screen and
 * camera, the screen or window to record (with its picture) and the camera, tick Microphone if
 * the sound should come along, then Record: it counts 3, 2, 1, records with the time shown, and
 * Stop saves an MP4 into the project's media (preload `recordingSave`), where it shows in the Media
 * tab like an import. A refused permission is explained and nothing is recorded: macOS has the
 * camera and Screen Recording switches in System Settings › Privacy & Security.
 */

type Phase = "idle" | "countdown" | "recording" | "saving";

interface RecordPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** The panel's open state, so the Media tab's Record button can open it. */
export const useRecordPanel = create<RecordPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

const MODES: { id: RecordMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "screen", label: "Screen", Icon: LuMonitor },
  { id: "camera", label: "Camera", Icon: LuCamera },
  { id: "both", label: "Screen and camera", Icon: LuMonitorPlay },
];

const kept = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(`openrip:record:${key}`);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const keep = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(`openrip:record:${key}`, JSON.stringify(value));
  } catch {}
};

const SCREEN_OFF = "Screen recording is off. Turn it on for OpenRip in System Settings › Privacy & Security › Screen & System Audio Recording, then restart OpenRip.";
const CAMERA_OFF = "Camera access is off. Turn it on for OpenRip in System Settings › Privacy & Security › Camera, then record again.";
const MIC_OFF = "Microphone access is off. Turn it on for OpenRip in System Settings › Privacy & Security › Microphone, then record again.";

export const RecordPanel: React.FC = () => {
  const open = useRecordPanel((s) => s.open);
  const setOpen = useRecordPanel((s) => s.setOpen);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setModeState] = useState<RecordMode>(() => kept("mode", "screen"));
  const [list, setList] = useState<RecordSources | null>(null);
  const [sourceId, setSourceId] = useState<string>("");
  const [cameras, setCameras] = useState<VideoInput[]>([]);
  const [cameraId, setCameraId] = useState<string>(() => kept("camera", ""));
  const [microphone, setMicrophone] = useState<boolean>(() => kept("mic", false));
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const recorder = useRef<Recorder | null>(null);
  const countdown = useRef<ReturnType<typeof setInterval> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  const setMode = (m: RecordMode) => {
    setModeState(m);
    keep("mode", m);
  };

  const refresh = async () => {
    const needScreen = mode !== "camera";
    if (needScreen) {
      try {
        const res = await recordSources();
        setList(res);
        setSourceId((cur) => (res.sources.some((s) => s.id === cur) ? cur : (res.sources.find((s) => s.kind === "screen") ?? res.sources[0])?.id ?? ""));
      } catch {
        setList({ permission: "unknown", sources: [] });
      }
    }
    if (mode !== "screen") setCameras(await listVideoInputs());
  };
  useEffect(() => {
    if (open && phase === "idle") void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const finishTimers = () => {
    if (countdown.current) clearInterval(countdown.current);
    if (timer.current) clearInterval(timer.current);
    countdown.current = null;
    timer.current = null;
  };

  const begin = async () => {
    try {
      if (mode !== "screen" && !(await recordAsk("camera"))) {
        setPhase("idle");
        setMessage({ text: CAMERA_OFF, error: true });
        return;
      }
      if (microphone && !(await recordAsk("microphone"))) {
        setPhase("idle");
        setMessage({ text: MIC_OFF, error: true });
        return;
      }
      if (mode !== "camera" && list && (list.permission === "denied" || list.permission === "restricted")) {
        setPhase("idle");
        setMessage({ text: SCREEN_OFF, error: true });
        return;
      }
      recorder.current = await Recorder.start({ mode, sourceId, cameraId: cameraId || undefined, microphone, fake: await recordFake().catch(() => false), onEnded: () => void stop() });
    } catch (e) {
      setPhase("idle");
      if (e instanceof MicError && e.reason === "denied") setMessage({ text: mode === "camera" ? CAMERA_OFF : SCREEN_OFF, error: true });
      else if (e instanceof MicError && e.reason === "missing") setMessage({ text: mode === "screen" ? "That screen or window isn't available any more. Pick another." : "No camera was found.", error: true });
      else setMessage({ text: `Couldn't start recording: ${e instanceof Error ? e.message : String(e)}`, error: true });
      return;
    }
    startedAt.current = Date.now();
    setElapsed(0);
    timer.current = setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    setPhase("recording");
  };

  const record = () => {
    setMessage(null);
    setPhase("countdown");
    setCount(3);
    let n = 3;
    countdown.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCount(n);
        return;
      }
      clearInterval(countdown.current!);
      countdown.current = null;
      void begin();
    }, 1000);
  };

  const stop = async () => {
    const rec = recorder.current;
    if (!rec || phaseRef.current !== "recording") return;
    recorder.current = null;
    finishTimers();
    setPhase("saving");
    try {
      const blob = await rec.stop();
      const folder = useProjectsStore.getState().getActiveProject()?.folderUuid;
      const fps = useControlsStore.getState().fps || 30;
      const saved = await recordingSave(await blob.arrayBuffer(), { folder, hasAudio: rec.hasAudio, fps });
      bumpMediaLibraryVersion();
      setMessage({ text: `${saved.path.split("/").pop()?.replace(/\.mp4$/i, "")} saved to Media`, error: false });
    } catch (e) {
      setMessage({ text: `The recording couldn't be saved: ${e instanceof Error ? e.message : String(e)}`, error: true });
    }
    setPhase("idle");
  };

  /** Throw the take away, or stop the count before it starts. */
  const discard = () => {
    if (countdown.current) {
      finishTimers();
      setPhase("idle");
      return;
    }
    if (phaseRef.current !== "recording") return;
    recorder.current?.cancel();
    recorder.current = null;
    finishTimers();
    setPhase("idle");
    setElapsed(0);
  };

  const close = () => {
    discard();
    setOpen(false);
  };

  // Gone mid-take (the editor closed): nothing is left capturing.
  useEffect(() => () => {
    finishTimers();
    recorder.current?.cancel();
    recorder.current = null;
  }, []);

  if (!open) return null;
  const live = phase === "recording";
  const busy = phase !== "idle";
  const screenRefused = mode !== "camera" && (list?.permission === "denied" || list?.permission === "restricted");
  const statusText = phase === "countdown" ? `Recording in ${count}…` : live ? "Recording…" : phase === "saving" ? "Saving…" : (message?.text ?? "Recording not started");
  const sources: RecordSource[] = list?.sources ?? [];

  return createPortal(
    <div
      data-testid="record-panel"
      role="dialog"
      aria-label="Record"
      className="fixed top-[44px] right-3 z-[90] w-[291px] rounded-[12px] bg-[#1b1b1c] border border-[#3c3c3c] shadow-[0_12px_40px_rgba(0,0,0,0.6)] font-poppins select-none text-left"
    >
      <div className="relative h-[34px] flex items-center justify-center border-b border-brand-divider">
        <button type="button" aria-label="Close record" data-testid="record-close" onClick={close} className="absolute left-3 h-3 w-3 rounded-full bg-[#ec6a5e] hover:brightness-110" />
        <h2 className="text-[13px] font-semibold text-brand-lighter">Record</h2>
      </div>
      <div className="mx-[10px] mt-[11px] rounded-[8px] bg-[#242425] px-3 pt-4 pb-4">
        <div className="flex flex-row items-center gap-3">
          <button
            type="button"
            data-testid="record-start"
            aria-label={live ? "Stop recording" : "Record"}
            disabled={phase === "saving" || phase === "countdown" || (!live && (screenRefused || (mode !== "camera" && sources.length === 0 && !!list)))}
            onClick={() => (live ? void stop() : record())}
            className="h-12 w-12 shrink-0 rounded-full border-2 border-[#8a8a8a] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {live ? <span className="h-4 w-4 rounded-[3px] bg-[#c8352d]" /> : <span className="h-[38px] w-[38px] rounded-full bg-[#a92f2a]" />}
          </button>
          <div className="min-w-0">
            <div data-testid="record-time" className="text-[18px] font-semibold tabular-nums text-brand-lighter">
              {phase === "countdown" ? clock(0) : clock(elapsed)}
            </div>
            <div data-testid="record-status" data-error={message?.error ? "true" : "false"} className={cn("text-[13px] font-medium", message?.error ? "text-[#e5484d] leading-snug" : "text-[#949494] truncate")} title={statusText}>
              {statusText}
            </div>
          </div>
        </div>
        {live && (
          <button type="button" data-testid="record-discard" onClick={discard} className="mt-3 h-[22px] px-3 rounded-[4px] bg-brand-button text-[12px] text-brand-light hover:brightness-110">
            Discard take
          </button>
        )}
        <div className="mt-4 h-px bg-brand-divider" />
        <div role="tablist" aria-label="What to record" className="mt-3 grid grid-cols-3 gap-1">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              data-testid={`record-mode-${id}`}
              disabled={busy}
              onClick={() => setMode(id)}
              className={cn(
                "h-[46px] rounded-[4px] flex flex-col items-center justify-center gap-0.5 text-[10.5px] leading-tight text-center px-1 disabled:opacity-50",
                mode === id ? "bg-brand-hover text-brand-accent" : "bg-brand text-brand-light hover:bg-brand-hover",
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
        {mode !== "camera" && (
          <>
            <div className="mt-3 text-[13px] text-brand-light">Screen or window</div>
            <div data-testid="record-sources" className="mt-2 grid grid-cols-2 gap-1.5 max-h-[148px] overflow-y-auto pr-0.5">
              {sources.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-testid="record-source"
                  data-id={s.id}
                  aria-pressed={sourceId === s.id}
                  disabled={busy}
                  onClick={() => setSourceId(s.id)}
                  className={cn("rounded-[4px] p-1 text-left bg-brand border disabled:opacity-50", sourceId === s.id ? "border-brand-accent" : "border-transparent hover:bg-brand-hover")}
                >
                  <div className="h-[44px] rounded-[2px] bg-[#121212] overflow-hidden flex items-center justify-center">
                    {s.thumbnail ? <img src={s.thumbnail} alt="" className="w-full h-full object-contain" /> : <LuMonitor className="w-4 h-4 text-[#6c6c6c]" />}
                  </div>
                  <div className="mt-1 text-[11px] text-[#cccccc] truncate" title={s.name}>
                    {s.name}
                  </div>
                </button>
              ))}
              {list && sources.length === 0 && <div className="col-span-2 text-[12px] text-[#6c6c6c]">No screens or windows to record.</div>}
            </div>
          </>
        )}
        {mode !== "screen" && (
          <>
            <div className="mt-3 text-[13px] text-brand-light">Camera</div>
            <select
              data-testid="record-camera"
              disabled={busy}
              value={cameraId}
              onChange={(e) => {
                setCameraId(e.target.value);
                keep("camera", e.target.value);
              }}
              className="mt-2 w-full h-[22px] px-1.5 rounded-[4px] bg-brand text-[12px] text-[#cccccc] disabled:opacity-50"
            >
              <option value="">System default camera</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </>
        )}
        {screenRefused && (
          <p data-testid="record-permission" data-refused="true" className="mt-2 text-[12px] leading-snug text-[#e5484d]">
            {SCREEN_OFF}
          </p>
        )}
      </div>
      <div className="mx-[10px] mt-3 mb-4 px-2">
        <label className="flex flex-row items-center gap-2 cursor-pointer">
          <SmallCheckbox
            checked={microphone}
            disabled={busy}
            label="Microphone"
            onChange={(v) => {
              setMicrophone(v);
              keep("mic", v);
            }}
          />
          <span data-testid="record-mic" className="text-[13px] font-semibold text-brand-lighter">
            Microphone
          </span>
        </label>
        <p className="mt-1 pl-5 text-[12px] leading-snug text-[#cccccc]">Record your voice with it, from the Voiceover panel's input device</p>
      </div>
    </div>,
    document.body,
  );
};

export default RecordPanel;
