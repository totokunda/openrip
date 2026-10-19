// The timeline's Linkage settings, as CapCut's (docs/plan/capcut-ui-spec.md §6.26, 31-dialogs/038):
// a window over a dimmed screen with the sentence "When linkage is turned on, the selected items
// will move or get deleted with the clips on the main track.", a grid of kinds (Text, Effects,
// Stickers, Filters, Adjust, Overlay, Audio, Sound effects), each a small picture of its bar
// over a checkbox, then Select all, Cancel and Done. The boxes wait for Done; what's switched
// off is kept in the preferences (`linkageOff`) and lib/clip.ts follows it.
import React, { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { TIMELINE_COLORS } from "@/lib/timeline-colors";
import { LINK_KINDS, type LinkKind } from "@/lib/linkage";
import { usePreferencesStore } from "@/lib/preferences";
import { Checkbox } from "@/components/ui/checkbox";

const COLOR: Record<LinkKind, string> = {
  text: TIMELINE_COLORS.text,
  effects: TIMELINE_COLORS.effect,
  stickers: TIMELINE_COLORS.sticker,
  filters: TIMELINE_COLORS.filter,
  adjust: TIMELINE_COLORS.adjustment,
  overlay: TIMELINE_COLORS.video,
  audio: TIMELINE_COLORS.fromVideoBg,
  soundEffects: TIMELINE_COLORS.music,
};

/** A kind's picture: its bar, in the colour the timeline draws it in (sound with a few waveform bars). */
const Tile: React.FC<{ kind: LinkKind; label: string }> = ({ kind, label }) => {
  const sound = kind === "audio" || kind === "soundEffects";
  return (
    <div className="h-[72px] w-full rounded-[8px] bg-white/[0.06] flex items-center justify-center px-2.5">
      <div className="relative h-[26px] w-full rounded-[3px] overflow-hidden text-[11px] text-white/90 px-1.5 leading-[26px]" style={{ background: COLOR[kind] }}>
        {label}
        {sound && (
          <div className="absolute inset-x-1 bottom-0 flex items-end gap-[2px] h-3">
            {Array.from({ length: 22 }, (_, i) => (
              <span key={i} className="w-[2px] rounded-t-[1px] bg-white/40" style={{ height: 2 + ((i * 7) % 9) }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const LinkageDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const off = usePreferencesStore((s) => s.prefs.linkageOff);
  const save = usePreferencesStore((s) => s.save);
  const [on, setOn] = useState<Record<string, boolean>>({});

  // Each opening starts from what's saved.
  useEffect(() => {
    if (open) setOn(Object.fromEntries(LINK_KINDS.map((k) => [k.id, !(off ?? []).includes(k.id)])));
  }, [open, off]);

  const all = LINK_KINDS.every((k) => on[k.id]);
  const done = () => {
    void save({ linkageOff: LINK_KINDS.filter((k) => !on[k.id]).map((k) => k.id) });
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <DialogPrimitive.Content
          data-testid="linkage-dialog"
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[620px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] flex flex-col rounded-[12px] border border-[#3c3c3c] bg-brand-background shadow-[0_16px_48px_rgba(0,0,0,0.55)] font-poppins outline-none select-none"
        >
          <DialogPrimitive.Title className="h-[40px] shrink-0 flex items-center justify-center text-[13px] font-semibold text-brand-lighter border-b border-brand-divider">
            Linkage settings
          </DialogPrimitive.Title>
          <div className="px-5 pt-4 pb-3 overflow-y-auto">
            <p className="text-[12px] text-brand-light mb-4">When linkage is turned on, the selected items will move or get deleted with the clips on the main track.</p>
            <div className="grid grid-cols-4 gap-x-3 gap-y-4">
              {LINK_KINDS.map((k) => (
                <label key={k.id} className="flex flex-col gap-2 cursor-pointer">
                  <Tile kind={k.id} label={k.label} />
                  <span className="flex items-center gap-2 text-[12px] text-brand-lighter">
                    <Checkbox data-testid={`linkage-${k.id}`} checked={!!on[k.id]} onCheckedChange={(v) => setOn((o) => ({ ...o, [k.id]: v === true }))} />
                    {k.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center h-[52px] shrink-0 px-5 border-t border-brand-divider">
            <label className="flex items-center gap-2 text-[12px] text-brand-lighter cursor-pointer">
              <Checkbox data-testid="linkage-all" checked={all} onCheckedChange={(v) => setOn(Object.fromEntries(LINK_KINDS.map((k) => [k.id, v === true])))} />
              Select all
            </label>
            <div className="ml-auto flex gap-2">
              <button type="button" data-testid="linkage-cancel" onClick={() => onOpenChange(false)} className="h-7 w-[84px] rounded-[4px] bg-brand-background-light text-[12px] text-brand-lighter hover:bg-brand-hover">
                Cancel
              </button>
              <button type="button" data-testid="linkage-done" onClick={done} className={cn("h-7 w-[84px] rounded-[4px] bg-brand-accent text-[12px] font-semibold text-white hover:opacity-90")}>
                Done
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default LinkageDialog;
