import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useControlsStore } from "@/lib/control";
import { FRAME_RATES } from "@/lib/preferences";

/**
 * The open project's own settings (the inspector's Modify): its frame rate, and how long a
 * filter clip is when added. The app's preferences are the Settings window's
 * (SettingsWindow.tsx); a new project takes its frame rate from there.
 */
export const ProjectSettingsModal: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const fps = useControlsStore((s) => s.fps);
  const defaultClipLength = useControlsStore((s) => s.defaultClipLength);
  const setFpsWithRescale = useControlsStore((s) => s.setFpsWithRescale);
  const setDefaultClipLength = useControlsStore((s) => s.setDefaultClipLength);
  const [projectFps, setProjectFps] = useState(String(fps || 24));
  const [clipSeconds, setClipSeconds] = useState(String(defaultClipLength || 5));

  // Start from the project's values each time it opens.
  useEffect(() => {
    if (!open) return;
    setProjectFps(String(fps || 24));
    setClipSeconds(String(defaultClipLength || 5));
  }, [open, fps, defaultClipLength]);

  const rates = FRAME_RATES.includes(Number(projectFps)) ? FRAME_RATES : [...FRAME_RATES, Number(projectFps)].sort((a, b) => a - b);
  const label = "text-[12px] text-brand-light";
  const trigger = "w-full h-[22px]! text-[12px] bg-brand-background-light rounded-[4px] border-0";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="project-settings" className="dark w-[512px] max-w-[512px] p-0 gap-0 rounded-[12px]">
        <DialogTitle className="h-[34px] px-4 flex items-center text-[13px] font-semibold text-brand-lighter border-b border-brand-divider">
          Project settings
        </DialogTitle>
        <div className="m-4 rounded-[6px] bg-brand-background-dark px-6 py-4 flex flex-col gap-4 font-poppins">
          <div className="grid grid-cols-[164px_1fr] items-center gap-x-6">
            <span className={label}>Frame rate</span>
            <Select value={projectFps} onValueChange={setProjectFps}>
              <SelectTrigger size="sm" className={trigger}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="dark bg-brand-header text-brand-light z-[101]">
                {rates.map((r) => (
                  <SelectItem key={r} value={String(r)} className="text-[12px]">
                    {r.toFixed(2)} fps
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[164px_1fr] items-center gap-x-6">
            <span className={label}>Filter clip length</span>
            <Select value={clipSeconds} onValueChange={setClipSeconds}>
              <SelectTrigger size="sm" className={trigger}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="dark bg-brand-header text-brand-light z-[101]">
                {["3", "5", "10", "15", "30"].map((v) => (
                  <SelectItem key={v} value={v} className="text-[12px]">
                    {v} s
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-[#7a7a7a] text-left">A photo's length is Settings › Edit › Image duration.</p>
        </div>
        <div className="flex gap-2 px-4 pb-4">
          <Button type="button" className="flex-1 h-7 text-[12px] bg-brand-button hover:bg-brand-hover text-brand-light rounded-[4px]" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1 h-7 text-[12px] bg-brand-accent hover:bg-brand-accent-shade text-brand-lighter rounded-[4px]"
            onClick={() => {
              const f = Number(projectFps);
              if (Number.isFinite(f) && f > 0 && f !== fps) setFpsWithRescale(f);
              const len = Number(clipSeconds);
              if (Number.isFinite(len) && len > 0) setDefaultClipLength(len);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProjectSettingsModal;
