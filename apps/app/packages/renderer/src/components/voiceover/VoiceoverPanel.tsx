import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { LuCheck, LuChevronDown, LuChevronUp, LuMic } from "react-icons/lu";
import { voiceoverAsk, voiceoverBegin, voiceoverEnd, voiceoverSaveTake, voiceoverStatus } from "@app/preload";
import type { VoiceoverStatus } from "@app/preload";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { useProjectsStore } from "@/lib/projects";
import { placeVoiceover } from "@/lib/audio";
import { bumpMediaLibraryVersion } from "@/lib/media/library";
import { SmallCheckbox } from "@/components/properties/AudioProperties";
import PropertiesSlider from "@/components/properties/PropertiesSlider";
import { listAudioInputs, MicError, MicRecorder, type AudioInput } from "@/lib/mic";
import { cn } from "@/lib/utils";

/**
 * Recording a voiceover, as CapCut's timeline microphone and Voiceover panel do it
 * (docs/plan/capcut-ui-spec.md §4.14, `31-dialogs/036-voiceover-panel.png`): the panel floats at
 * the window's top right. Record counts 3, 2, 1, then records the chosen input device (the page's
 * own capture, lib/mic.ts) while the timeline plays from the playhead; the level meter and the
 * time follow it. Stop puts the take on a new audio track where the playhead was (lib/audio.ts
 * `placeVoiceover`) and selects it; Discard throws it away, as does closing the panel while it
 * records. The microphone's permission shows under the device, with what to do when it's
 * refused. Volume is a gain on the take (0 to 200, 100 is the microphone's own level), Echo
 * reduction turns on the browser's echo cancellation and noise suppression, and "Mute project"
 * silences the project's playback while it records. The device, volume and both checkboxes are
 * remembered.
 */

type Phase = "idle" | "countdown" | "recording" | "saving";

interface VoiceoverPanelState {
  open: boolean;
  /** What the panel is doing; the toolbar's button shows it too. */
  phase: Phase;
  setOpen: (open: boolean) => void;
  setPhase: (phase: Phase) => void;
}

/** The panel's open state, so the toolbar button and the left panel's Voiceovers can open it. */
export const useVoiceoverPanel = create<VoiceoverPanelState>((set) => ({
  open: false,
  phase: "idle",
  setOpen: (open) => set({ open }),
  setPhase: (phase) => set({ phase }),
}));

/** The timeline toolbar's microphone: opens and closes the panel; red while it records. */
export const VoiceoverButton: React.FC = () => {
  const open = useVoiceoverPanel((s) => s.open);
  const phase = useVoiceoverPanel((s) => s.phase);
  const setOpen = useVoiceoverPanel((s) => s.setOpen);
  const live = phase === "recording" || phase === "countdown";
  return (
    <button
      type="button"
      title="Record voiceover"
      data-testid="tool-voiceover"
      aria-pressed={open}
      onClick={() => setOpen(!open)}
      className={cn(
        "relative h-[23px] w-6 flex items-center justify-center rounded-[4px] cursor-pointer transition-colors",
        open ? "bg-black/40 text-brand-accent" : "text-brand-light/70 hover:text-brand-light",
      )}
    >
      <LuMic className="h-4 w-4" />
      {live && <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[#e5484d]" />}
    </button>
  );
};

/** "HH:MM:SS", as CapCut's panel shows the time recorded. */
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

/** The meter's bars: CapCut's row of thin segments, lit from the left by the level (−60…0 dBFS). */
const BARS = 52;
const litBars = (peak: number) => {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(BARS, Math.round(((db + 60) / 60) * BARS)));
};

/** The permission line under the device: what the system allows, and what to do if it doesn't. */
const permissionLine = (status: VoiceoverStatus | null, denied: boolean): { text: string; refused: boolean } => {
  if (!status) return { text: "Checking the microphone…", refused: false };
  if (!status.available) return { text: "Recording needs the engine, which didn't load.", refused: true };
  if (denied || status.permission === "denied" || status.permission === "restricted")
    return { text: "Microphone access is off. Turn it on for OpenRip in System Settings › Privacy & Security › Microphone, then record again.", refused: true };
  if (status.permission === "not-determined") return { text: "OpenRip will ask for the microphone when you record.", refused: false };
  return { text: "Microphone connected", refused: false };
};

/** A remembered setting of the panel (the input device, volume, echo reduction, mute project). */
const kept = <T,>(key: string, fallback: T): T => {
  try {
    const raw = window.localStorage.getItem(`openrip:voiceover:${key}`);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const keep = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(`openrip:voiceover:${key}`, JSON.stringify(value));
  } catch {}
};

/** CapCut's input device select: the chosen microphone, and a menu of them with a tick on it. */
const DevicePicker: React.FC<{ devices: AudioInput[]; value: string; onChange: (id: string) => void; disabled?: boolean }> = ({ devices, value, onChange, disabled }) => {
  const [menu, setMenu] = useState(false);
  const rows = [{ id: "", label: "System default microphone" }, ...devices];
  const current = rows.find((d) => d.id === value) ?? rows[0];
  return (
    <div className="relative mt-2">
      <button
        type="button"
        data-testid="voiceover-device"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
        className="w-full h-[22px] px-2 rounded-[4px] bg-brand flex items-center justify-between gap-2 text-[12px] text-[#cccccc] disabled:opacity-50"
      >
        <span className="truncate">{current.label}</span>
        {menu ? <LuChevronUp className="w-3 h-3 shrink-0" /> : <LuChevronDown className="w-3 h-3 shrink-0" />}
      </button>
      {menu && (
        <div role="listbox" data-testid="voiceover-device-menu" className="absolute z-10 left-0 right-0 top-[26px] p-1 rounded-[6px] bg-[#2a2a2b] border border-[#3c3c3c] shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
          {rows.map((d) => (
            <button
              key={d.id || "default"}
              type="button"
              role="option"
              aria-selected={d.id === current.id}
              data-testid="voiceover-device-option"
              onClick={() => {
                onChange(d.id);
                setMenu(false);
              }}
              className="w-full h-8 px-2 flex items-center gap-2 rounded-[4px] text-left text-[12px] text-brand-light hover:bg-brand-hover"
            >
              <LuCheck className={cn("w-3.5 h-3.5 shrink-0 text-brand-accent", d.id !== current.id && "invisible")} />
              <span className="truncate">{d.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const VoiceoverPanel: React.FC = () => {
  const open = useVoiceoverPanel((s) => s.open);
  const phase = useVoiceoverPanel((s) => s.phase);
  const setOpen = useVoiceoverPanel((s) => s.setOpen);
  const setPhase = useVoiceoverPanel((s) => s.setPhase);
  const [status, setStatus] = useState<VoiceoverStatus | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [peak, setPeak] = useState(0);
  const [devices, setDevices] = useState<AudioInput[]>([]);
  const [deviceId, setDeviceId] = useState(() => kept("device", ""));
  const [volume, setVolume] = useState(() => kept("volume", 100));
  const [echo, setEcho] = useState(() => kept("echo", false));
  const [muteProject, setMuteProject] = useState(() => kept("mute", false));
  const [saved, setSaved] = useState<string | null>(null);
  const startFrame = useRef(0);
  const played = useRef(false);
  const countdown = useRef<ReturnType<typeof setInterval> | null>(null);
  const mic = useRef<MicRecorder | null>(null);
  const startedAt = useRef(0);
  const clock$ = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    void voiceoverStatus().then(setStatus, () => setStatus(null));
    setDevices(await listAudioInputs());
  };
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  // Microphones plugged in or out while the panel is open.
  useEffect(() => {
    if (!open) return;
    const onChange = () => void listAudioInputs().then(setDevices);
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, [open]);

  const setKept = <T,>(key: string, set: (v: T) => void) => (v: T) => {
    set(v);
    keep(key, v);
  };
  const changeVolume = setKept("volume", setVolume);
  // The slider moves the gain while it records.
  useEffect(() => {
    mic.current?.setGain(volume / 100);
  }, [volume]);

  const stopPlayback = () => {
    if (played.current) useControlsStore.getState().pause();
    played.current = false;
  };
  const endCapture = () => {
    if (clock$.current) clearInterval(clock$.current);
    clock$.current = null;
    setPeak(0);
    void voiceoverEnd();
  };

  const begin = async () => {
    try {
      if (!(await voiceoverAsk())) {
        setPhase("idle");
        setDenied(true);
        void refresh();
        return;
      }
      const device = deviceId && devices.some((d) => d.id === deviceId) ? deviceId : undefined;
      mic.current = await MicRecorder.start({ deviceId: device, gain: volume / 100, echoReduction: echo, onLevel: setPeak });
    } catch (e) {
      setPhase("idle");
      if (e instanceof MicError && e.reason === "denied") setDenied(true);
      else if (e instanceof MicError && e.reason === "missing") setError("That microphone isn't available. Pick another input device.");
      else setError(`Couldn't start recording: ${e instanceof Error ? e.message : String(e)}`);
      void refresh();
      return;
    }
    await voiceoverBegin({ muteProject });
    setElapsed(0);
    startedAt.current = Date.now();
    clock$.current = setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    setPhase("recording");
    void refresh();
    // The timeline plays from the playhead while it records, as CapCut's does.
    const controls = useControlsStore.getState();
    startFrame.current = controls.focusFrame;
    if (!controls.isPlaying && controls.focusFrame < useClipStore.getState().clipDuration) {
      controls.play();
      played.current = true;
    }
  };

  const record = () => {
    setError(null);
    setSaved(null);
    setDenied(false);
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
    setPhase("saving");
    const take = mic.current?.stop();
    mic.current = null;
    endCapture();
    stopPlayback();
    if (!take) {
      setPhase("idle");
      return;
    }
    try {
      const folder = useProjectsStore.getState().getActiveProject()?.folderUuid;
      const done = await voiceoverSaveTake(take.pcm, { folder, rate: take.rate, channels: take.channels });
      const fps = useControlsStore.getState().fps || 30;
      const clip = placeVoiceover(useClipStore.getState(), { path: done.path, durationSec: done.durationSec }, done.url, startFrame.current, fps);
      useControlsStore.getState().setSelectedClipIds([clip.clipId]);
      bumpMediaLibraryVersion();
      setSaved(`${done.path.split("/").pop()?.replace(/\.wav$/i, "")} added to the timeline`);
    } catch (e) {
      setError(`The recording couldn't be saved: ${e instanceof Error ? e.message : String(e)}`);
    }
    setPhase("idle");
  };

  /** Throw the take away (or stop the count before it starts). */
  const discard = async () => {
    if (countdown.current) {
      clearInterval(countdown.current);
      countdown.current = null;
      setPhase("idle");
      return;
    }
    if (phase !== "recording") return;
    mic.current?.cancel();
    mic.current = null;
    endCapture();
    stopPlayback();
    setPhase("idle");
    setElapsed(0);
  };

  const close = () => {
    void discard();
    setOpen(false);
  };

  // Gone mid-take (the editor closed): nothing is left recording.
  useEffect(() => () => {
    if (countdown.current) clearInterval(countdown.current);
    if (clock$.current) clearInterval(clock$.current);
    if (mic.current) {
      mic.current.cancel();
      mic.current = null;
      void voiceoverEnd();
    }
  }, []);

  if (!open) return null;
  const perm = permissionLine(status, denied);
  const live = phase === "recording";
  const lit = litBars(peak);
  const statusText =
    phase === "countdown"
      ? `Recording in ${count}…`
      : live
        ? "Recording…"
        : phase === "saving"
          ? "Saving…"
          : (error ?? saved ?? "Recording not started");

  return createPortal(
    <div
      data-testid="voiceover-panel"
      role="dialog"
      aria-label="Voiceover"
      className="fixed top-[44px] right-3 z-[90] w-[291px] rounded-[12px] bg-[#1b1b1c] border border-[#3c3c3c] shadow-[0_12px_40px_rgba(0,0,0,0.6)] font-poppins select-none text-left"
    >
      <div className="relative h-[34px] flex items-center justify-center border-b border-brand-divider">
        <button type="button" aria-label="Close voiceover" data-testid="voiceover-close" onClick={close} className="absolute left-3 h-3 w-3 rounded-full bg-[#ec6a5e] hover:brightness-110" />
        <h2 className="text-[13px] font-semibold text-brand-lighter">Voiceover</h2>
      </div>
      <div className="mx-[10px] mt-[11px] rounded-[8px] bg-[#242425] px-3 pt-6 pb-4">
        <div className="flex flex-row items-center gap-3">
          <button
            type="button"
            data-testid="voiceover-record"
            aria-label={live ? "Stop recording" : "Record"}
            disabled={phase === "saving" || phase === "countdown" || (!live && perm.refused)}
            onClick={() => (live ? void stop() : record())}
            className="h-12 w-12 shrink-0 rounded-full border-2 border-[#8a8a8a] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {live ? <span className="h-4 w-4 rounded-[3px] bg-[#c8352d]" /> : <span className="h-[38px] w-[38px] rounded-full bg-[#a92f2a]" />}
          </button>
          <div className="min-w-0">
            <div data-testid="voiceover-time" className="text-[18px] font-semibold tabular-nums text-brand-lighter">
              {phase === "countdown" ? clock(0) : clock(elapsed)}
            </div>
            <div data-testid="voiceover-status" className={cn("text-[13px] font-medium truncate", error ? "text-[#e5484d]" : "text-[#949494]")} title={statusText}>
              {statusText}
            </div>
          </div>
        </div>
        <div data-testid="voiceover-meter" data-lit={lit} className="mt-4 h-6 px-1 rounded-[3px] bg-[#121212] flex flex-row items-stretch justify-between py-1">
          {Array.from({ length: BARS }, (_, i) => (
            <span key={i} className="w-[2px] rounded-[1px]" style={{ background: i < lit ? (i >= BARS * 0.9 ? "#e5484d" : i >= BARS * 0.7 ? "#e2b93b" : "#46c46e") : "#2b2b2b" }} />
          ))}
        </div>
        <div className="mt-4 h-px bg-brand-divider" />
        <div className="mt-4 text-[13px] text-brand-light">Input device</div>
        <DevicePicker devices={devices} value={deviceId} onChange={setKept("device", setDeviceId)} disabled={live || phase === "countdown"} />
        <p data-testid="voiceover-permission" data-refused={perm.refused} className={cn("mt-2 text-[12px] leading-snug", perm.refused ? "text-[#e5484d]" : "text-[#6c6c6c]")}>
          {perm.text}
        </p>
        <div className="mt-4" data-testid="voiceover-volume">
          <PropertiesSlider label="Volume" value={volume} onChange={(v) => changeVolume(Math.max(0, Math.min(200, Math.round(v))))} min={0} max={200} step={1} toFixed={0} />
        </div>
        {live && (
          <button type="button" data-testid="voiceover-discard" onClick={() => void discard()} className="mt-3 h-[22px] px-3 rounded-[4px] bg-brand-button text-[12px] text-brand-light hover:brightness-110">
            Discard take
          </button>
        )}
      </div>
      <div className="mx-[10px] mt-3 mb-4 px-2">
        <label className="flex flex-row items-center gap-2 cursor-pointer">
          <SmallCheckbox checked={echo} disabled={live} label="Echo reduction" onChange={setKept("echo", setEcho)} />
          <span data-testid="voiceover-echo" className="text-[13px] font-semibold text-brand-lighter">
            Echo reduction
          </span>
        </label>
        <p className="mt-1 pl-5 text-[12px] leading-snug text-[#cccccc]">Turn on to avoid echo from the speaker</p>
        <div className="my-3 h-px bg-brand-divider" />
        <label className="flex flex-row items-center gap-2 cursor-pointer">
          <SmallCheckbox checked={muteProject} disabled={live} label="Mute project" onChange={setKept("mute", setMuteProject)} />
          <span data-testid="voiceover-mute" className="text-[13px] font-semibold text-brand-lighter">
            Mute project
          </span>
        </label>
        <p className="mt-1 pl-5 text-[12px] leading-snug text-[#cccccc]">Sounds in all clips will be turned off after Mute project turned on</p>
      </div>
    </div>,
    document.body,
  );
};

export default VoiceoverPanel;
