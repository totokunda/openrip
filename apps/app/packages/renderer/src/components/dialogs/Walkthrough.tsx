// The first-run walkthrough (Help ▸ Walkthrough): the screen dimmed with a spotlight on one
// region at a time, a step counter, a line about the region, Next and Exit. It opens by itself
// the first time the editor shows (the "walkthroughSeen" preference, kept by the main process)
// and from the menu bar any time. A region that isn't on screen (a panel in a window of its
// own, a layout that hides it) is skipped.
import React, { useEffect, useLayoutEffect, useState } from "react";
import { useShellStore } from "@/lib/shell";
import { usePreferencesStore } from "@/lib/preferences";

type Step = { title: string; text: string; targets: string[] };

const STEPS: Step[] = [
  { title: "Import materials", text: "Add your videos, photos and audio here, or drop them into the panel.", targets: ["media-import", "assets-content"] },
  { title: "Media panel", text: "Everything you add to a project lives in these tabs: media, audio, text, stickers, effects, transitions, captions, filters and more.", targets: ["assets"] },
  { title: "Player", text: "Preview your edit here, and move, scale and rotate what is on screen.", targets: ["player"] },
  { title: "Inspector", text: "Change the selected clip: its position, speed, colour, volume, animations and more.", targets: ["inspector"] },
  { title: "Timeline", text: "Arrange clips on tracks, trim and split them, and add keyframes.", targets: ["timeline"] },
  { title: "Export", text: "When you are done, export your video here.", targets: ["export"] },
];

const PAD = 6;
const CARD_W = 300;

const find = (step: Step): HTMLElement | null => {
  for (const id of step.targets) {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (el && el.getBoundingClientRect().width > 0) return el;
  }
  return null;
};

export const Walkthrough: React.FC = () => {
  const open = useShellStore((s) => s.walkthroughOpen);
  const setOpen = useShellStore((s) => s.setWalkthroughOpen);
  const view = useShellStore((s) => s.view);
  const loaded = usePreferencesStore((s) => s.loaded);
  const seen = usePreferencesStore((s) => s.prefs.walkthroughSeen);
  const save = usePreferencesStore((s) => s.save);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // The first time the editor shows.
  useEffect(() => {
    if (loaded && !seen && view === "editor" && !open) {
      const t = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, [loaded, seen, view, open, setOpen]);

  // Opened (either way): it counts as seen, and starts from the first step.
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    if (!usePreferencesStore.getState().prefs.walkthroughSeen) void save({ walkthroughSeen: true }).catch(() => {});
  }, [open, save]);

  useEffect(() => {
    if (open && view !== "editor") setOpen(false);
  }, [open, view, setOpen]);

  // The step's region; steps with none on screen are passed over.
  useLayoutEffect(() => {
    if (!open) return;
    const step = STEPS[index];
    if (!step) return;
    if (!find(step)) {
      if (index + 1 < STEPS.length) setIndex(index + 1);
      else setOpen(false);
      return;
    }
    const measure = () => {
      const el = find(step);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    const t = setInterval(measure, 300);
    return () => {
      window.removeEventListener("resize", measure);
      clearInterval(t);
    };
  }, [open, index, setOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open || !rect) return null;
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const box = { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };
  // The card sits under the region, else over it, else inside its corner (a region filling the window).
  const below = box.top + box.height + 170 < window.innerHeight;
  const above = box.top - 170 > 0;
  const top = below ? box.top + box.height + 12 : above ? box.top - 160 : box.top + 16;
  const left = Math.max(12, Math.min(window.innerWidth - CARD_W - 12, box.left + (below || above ? 0 : 16)));

  return (
    <div data-testid="walkthrough" className="fixed inset-0 z-[1000]">
      {/* Clicks anywhere else do nothing: the tour is the only thing to use. */}
      <div className="absolute inset-0" />
      <div
        data-testid="walkthrough-spot"
        className="absolute rounded-[8px] pointer-events-none transition-all duration-200"
        style={{ ...box, boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)", outline: "2px solid #ae81ce" }}
      />
      <div data-testid="walkthrough-card" className="absolute text-left font-poppins" style={{ top, left, width: CARD_W }}>
        <div data-testid="walkthrough-step" className="text-[12px] font-semibold text-brand-light/80">
          {index + 1}/{STEPS.length}
        </div>
        <div className="text-[20px] font-semibold text-white leading-tight mt-0.5">{step.title}</div>
        <div className="text-[12px] text-brand-light/80 mt-1.5 leading-snug">{step.text}</div>
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            data-testid="walkthrough-next"
            onClick={() => (last ? setOpen(false) : setIndex(index + 1))}
            className="h-7 px-4 rounded-[4px] text-[12px] font-semibold text-white bg-brand-accent hover:bg-brand-accent-two-shade cursor-pointer"
          >
            {last ? "Done" : "Next"}
          </button>
          <button
            type="button"
            data-testid="walkthrough-exit"
            onClick={() => setOpen(false)}
            className="h-7 px-4 rounded-[4px] text-[12px] font-semibold text-brand-light bg-brand-button hover:bg-brand-hover cursor-pointer"
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
};

export default Walkthrough;
