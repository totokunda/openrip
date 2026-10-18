import React, { useState } from "react";
import Preview from "../preview/Preview";
import { ResizablePanel } from "../ui/resizable";
import FloatingBar from "../preview/clips/FloatingBar";
import PlayerBar from "../preview/PlayerBar";
import SafeAreaGuides from "../preview/SafeAreaGuides";
import { useControlsStore } from "@/lib/control";

interface PreviewPanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
}

/** Safe-area guides stay on or off between sessions. */
const GUIDES_KEY = "openrip:safe-areas";
const readGuides = () => {
  try {
    return window.localStorage.getItem(GUIDES_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * The player: its canvas tools (select, draw, text, mask, shape) and zoom in a header, the
 * canvas, and the transport, ratio and full screen under it.
 */
const PreviewPanel: React.FC<PreviewPanelProps> = ({
  id = "player",
  order,
  defaultSize = 45,
  minSize = 25,
}) => {
  const [guides, setGuides] = useState(readGuides);
  const isFullscreen = useControlsStore((s) => s.isFullscreen);
  const toggleGuides = () =>
    setGuides((on) => {
      try {
        window.localStorage.setItem(GUIDES_KEY, on ? "0" : "1");
      } catch {}
      return !on;
    });

  return (
    <ResizablePanel
      id={id}
      defaultSize={defaultSize}
      minSize={minSize}
      order={order}
      data-testid="player"
      className="flex flex-col w-full bg-brand-background relative overflow-hidden rounded-md"
    >
      <div className="h-10 shrink-0 relative flex items-center justify-center px-3 border-b border-brand-light/[0.06]">
        <span className="absolute left-3 text-[11.5px] text-brand-light/80">Player</span>
        <FloatingBar />
      </div>
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <Preview />
        {guides && !isFullscreen && <SafeAreaGuides />}
      </div>
      <PlayerBar guides={guides} onToggleGuides={toggleGuides} />
    </ResizablePanel>
  );
};

export default PreviewPanel;
