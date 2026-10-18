import React from "react";
import { LuBan, LuScanLine } from "react-icons/lu";
import { IoRefreshOutline } from "react-icons/io5";
import { useClipStore } from "@/lib/clip";
import { cancelTracking, regionOf, trackClip, trackingOf, useTrackingStore } from "@/lib/tracking-run";
import { DEFAULT_TRACKING, TrackDirection, TrackingSettings, withoutTrackedKeys } from "@/lib/tracking";
import type { AnyClipProps } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The Tracking tab of a text, sticker or photo, as CapCut lays it out: the Tracking checkbox,
 * the None and Motion tracking tiles, and for motion tracking the Direction (Both, Forward,
 * Backward) and whether the clip follows the tracked object's Scale and Distance (and, an
 * addition, its Rotation), with Start in the footer. Motion tracking puts a region on the
 * canvas (components/preview/TrackingRegion.tsx) to draw over what to follow in the video
 * under the clip; Start has the engine follow it through the video's frames (with progress,
 * and Cancel) and keys the clip to it (lib/tracking-run.ts). None takes the tracked keys off.
 */

export const DIRECTIONS: { value: TrackDirection; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "forward", label: "Forward" },
  { value: "backward", label: "Backward" },
];

/** CapCut's toggle: a 36×16 pill, the accent when on. */
const Toggle: React.FC<{ on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean; testId?: string }> = ({ on, onChange, label, disabled, testId }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    data-testid={testId}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={cn("relative w-9 h-4 rounded-full transition-colors shrink-0 disabled:opacity-40", on ? "bg-brand-accent" : "bg-brand-button")}
  >
    <span className={cn("absolute top-1 w-2 h-2 rounded-full bg-brand-lighter transition-all", on ? "left-[24px]" : "left-1")} />
  </button>
);

/** A 62 px tile with its icon, its name under it; the chosen one outlined in the accent. */
const Tile: React.FC<{ label: string; active: boolean; disabled?: boolean; onClick: () => void; testId: string; children: React.ReactNode }> = ({ label, active, disabled, onClick, testId, children }) => (
  <button type="button" title={label} data-testid={testId} aria-pressed={active} disabled={disabled} onClick={onClick} className="flex flex-col items-center gap-[7px] w-[74px] disabled:opacity-40">
    <div className={cn("w-[62px] h-[62px] rounded-[6px] bg-brand-background-light flex items-center justify-center", active && "ring-[1.5px] ring-brand-accent")}>{children}</div>
    <span className={cn("text-[12px] leading-none whitespace-nowrap", active ? "text-brand-lighter" : "text-[#949494]")}>{label}</span>
  </button>
);

/** A "Scale  Follow tracking object" row with its toggle. */
const FollowRow: React.FC<{ label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void; testId: string }> = ({ label, on, disabled, onChange, testId }) => (
  <div className="flex items-center justify-between h-[38px]">
    <span className="text-[12px] text-brand-light">
      {label}
      <span className="ml-1.5 text-[#949494]">Follow tracking object</span>
    </span>
    <Toggle label={`${label}: follow tracking object`} on={on} onChange={onChange} disabled={disabled} testId={testId} />
  </div>
);

/** A select row: the label in its column, the select filling the rest (CapCut's Direction). */
export const SelectRow: React.FC<{ label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean; testId?: string }> = ({ label, value, options, onChange, disabled, testId }) => (
  <div className="flex items-center gap-x-2 h-[38px]">
    <span className="text-[12px] text-brand-light w-[104px] shrink-0">{label}</span>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger data-testid={testId} size="sm" className="flex-1 min-w-0 !h-[22px] text-[12px] bg-brand-background-light border-0 rounded-[4px] text-brand-light">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-brand-background text-brand-light font-poppins z-[101] dark">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[12px]">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

/** The footer's progress while the engine tracks: the bar, the share done, and Cancel. */
export const TrackProgress: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const share = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="flex items-center gap-x-2 flex-1 min-w-0" data-testid="tracking-progress" data-done={done} data-total={total}>
      <div className="flex-1 h-1 rounded-full bg-brand-button overflow-hidden">
        <div className="h-full bg-brand-accent transition-[width] duration-100" style={{ width: `${share * 100}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-brand-light w-8 text-right">{Math.round(share * 100)}%</span>
      <button type="button" data-testid="tracking-cancel" onClick={() => cancelTracking()} className="h-[22px] px-3 rounded-[4px] bg-brand-button text-[12px] font-semibold text-brand-lighter hover:bg-[#5a5a5a]">
        Cancel
      </button>
    </div>
  );
};

const TrackingProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const updateClip = useClipStore((s) => s.updateClip);
  const running = useTrackingStore((s) => s.running);
  const note = useTrackingStore((s) => s.notes[clipId]);
  if (!clip) return null;
  const settings = trackingOf(clip);
  const busy = !!running;
  const mine = running?.clipId === clipId && !running.maskId;
  const set = (patch: Partial<TrackingSettings>) => updateClip(clipId, { tracking: { ...settings, ...patch } } as Partial<AnyClipProps>);
  // None takes the keys a track wrote off; Motion tracking puts the region on the canvas.
  const choose = (mode: TrackingSettings["mode"]) => {
    if (mode === settings.mode) return;
    if (mode === "none") {
      updateClip(clipId, { keyframes: settings.video ? withoutTrackedKeys(clip, settings) : clip.keyframes, tracking: { ...settings, mode, video: undefined } } as Partial<AnyClipProps>);
    } else {
      useTrackingStore.getState().setRegion(clipId, regionOf(clip));
      set({ mode });
    }
  };
  const enable = (on: boolean) => {
    if (on) set({ enabled: true });
    else updateClip(clipId, { keyframes: settings.video ? withoutTrackedKeys(clip, settings) : clip.keyframes, tracking: { ...settings, enabled: false, mode: "none", video: undefined } } as Partial<AnyClipProps>);
  };
  const reset = () => {
    useTrackingStore.getState().setRegion(clipId, regionOf({ ...clip, tracking: undefined } as AnyClipProps));
    updateClip(clipId, { keyframes: settings.video ? withoutTrackedKeys(clip, settings) : clip.keyframes, tracking: { ...DEFAULT_TRACKING, mode: "motion" } } as Partial<AnyClipProps>);
  };
  const motion = settings.enabled && settings.mode === "motion";
  return (
    <div className="flex flex-col h-full min-h-0" data-testid="tracking-panel">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 pt-[18px]">
        <div className="flex items-center justify-between h-5">
          <label className="flex items-center gap-x-2 cursor-pointer">
            <Checkbox data-testid="tracking-enabled" checked={settings.enabled} onCheckedChange={(v) => enable(v === true)} disabled={busy} className="h-[14px] w-[14px] rounded-[3px]" />
            <span className="text-[13px] font-semibold text-brand-lighter">Tracking</span>
          </label>
          {motion && (
            <button type="button" title="Reset" data-testid="tracking-reset" onClick={reset} disabled={busy} className="text-brand-light hover:text-brand-lighter disabled:opacity-40">
              <IoRefreshOutline className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-x-[10px] mt-[18px]">
          <Tile label="None" testId="tracking-none" active={settings.mode === "none"} disabled={!settings.enabled || busy} onClick={() => choose("none")}>
            <LuBan className="w-7 h-7 text-brand-light" strokeWidth={1.5} />
          </Tile>
          <Tile label="Motion tracking" testId="tracking-motion" active={settings.mode === "motion"} disabled={!settings.enabled || busy} onClick={() => choose("motion")}>
            <LuScanLine className="w-7 h-7 text-brand-lighter" strokeWidth={1.5} />
          </Tile>
        </div>
        {motion && (
          <div className="mt-[22px] flex flex-col">
            <SelectRow label="Direction" testId="tracking-direction" value={settings.direction} options={DIRECTIONS} onChange={(v) => set({ direction: v as TrackDirection })} disabled={busy} />
            <FollowRow label="Scale" testId="tracking-scale" on={settings.scale} disabled={busy} onChange={(scale) => set({ scale })} />
            <FollowRow label="Distance" testId="tracking-distance" on={settings.distance} disabled={busy} onChange={(distance) => set({ distance })} />
            <FollowRow label="Rotation" testId="tracking-rotation" on={settings.rotation} disabled={busy} onChange={(rotation) => set({ rotation })} />
            {note && (
              <p className="text-[11px] text-brand-accent leading-[15px] pt-2" data-testid="tracking-note">
                {note}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="h-9 shrink-0 flex items-center justify-end gap-x-2 px-3 bg-brand-header">
        {mine ? (
          <TrackProgress done={running!.done} total={running!.total} />
        ) : (
          <button
            type="button"
            data-testid="tracking-start"
            disabled={!motion || busy}
            onClick={() => void trackClip(clipId)}
            className="h-[22px] w-[72px] rounded-[4px] bg-brand-accent text-[12px] font-semibold text-white hover:bg-brand-accent-two-shade disabled:bg-brand-button disabled:text-brand-light/60"
          >
            Start
          </button>
        )}
      </div>
    </div>
  );
};

export default TrackingProperties;
