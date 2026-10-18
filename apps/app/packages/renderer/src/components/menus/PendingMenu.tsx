import React from "react";
import type { IconType } from "react-icons";
import { LuMusic, LuSlidersHorizontal, LuSparkles, LuSticker } from "react-icons/lu";
import { useSidebarStore } from "@/lib/sidebar";
import { useInspectorStore } from "@/lib/inspector";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";

/**
 * The left panel's tabs that have nothing to offer yet: what's coming, and what to use
 * meanwhile. Nothing here is a placeholder posing as content.
 */
type Pending = "audio" | "stickers" | "effects" | "adjustment";

const COPY: Record<Pending, { icon: IconType; title: string; body: string }> = {
  audio: {
    icon: LuMusic,
    title: "Music and sound effects are coming",
    body: "A library of openly licensed tracks and sounds will live here. Until then, import audio files in Media and drag them to the timeline.",
  },
  stickers: {
    icon: LuSticker,
    title: "Stickers are coming",
    body: "A sticker library will live here. Stickers in an opened CapCut project already show on the canvas and the timeline.",
  },
  effects: {
    icon: LuSparkles,
    title: "Video effects are coming",
    body: "Effects you can drop on a clip will live here. For colour, blur, sharpness and grain on one clip, use its Adjust tab.",
  },
  adjustment: {
    icon: LuSlidersHorizontal,
    title: "Adjustment layers are coming",
    body: "A layer that adjusts every clip under it will live here. To adjust one clip, select it and open its Adjust tab.",
  },
};

const PendingMenu: React.FC<{ section: Pending }> = ({ section }) => {
  const { icon: Icon, title, body } = COPY[section];
  const openSection = useSidebarStore((s) => s.openSection);
  const lastSelected = useControlsStore((s) => s.selectedClipIds[s.selectedClipIds.length - 1]);
  const selectedType = useClipStore((s) => s.getClipById(lastSelected)?.type);
  const canAdjust = selectedType === "video" || selectedType === "image";

  return (
    <div data-testid={`pending-${section}`} className="h-full flex flex-col items-center justify-center gap-3 px-8 pb-10 text-center">
      <Icon className="w-6 h-6 text-brand-light/35" />
      <h3 className="text-[12px] font-medium text-brand-light/85">{title}</h3>
      <p className="text-[11px] leading-relaxed text-brand-light/50 max-w-[260px]">{body}</p>
      {section === "audio" && (
        <button
          type="button"
          onClick={() => openSection("media")}
          className="mt-1 h-7 px-3 rounded-[6px] text-[11px] text-brand-light/85 bg-brand hover:bg-brand-background-light transition-colors"
        >
          Go to Media
        </button>
      )}
      {(section === "adjustment" || section === "effects") && (
        <button
          type="button"
          disabled={!canAdjust}
          onClick={() => useInspectorStore.getState().setTab("adjust")}
          title={canAdjust ? undefined : "Select a video or photo first"}
          className="mt-1 h-7 px-3 rounded-[6px] text-[11px] text-brand-light/85 bg-brand hover:bg-brand-background-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Open the Adjust tab
        </button>
      )}
    </div>
  );
};

export default PendingMenu;
