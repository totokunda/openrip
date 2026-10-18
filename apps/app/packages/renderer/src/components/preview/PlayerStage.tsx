import React, { useRef, useState } from "react";
import Preview from "./Preview";
import ToolChip from "./ToolChip";
import SafeAreaGuides from "./SafeAreaGuides";
import Rulers, { RULER_SIZE } from "./Rulers";
import Guides from "./Guides";
import Scopes from "./Scopes";
import { ZoomNavigator } from "./ZoomPopover";
import { useControlsStore } from "@/lib/control";
import { usePlayerStore } from "@/lib/player";
import { useViewportStore } from "@/lib/viewport";
import { useKeepFit } from "@/lib/player-zoom";

/** CapCut leaves this much between the canvas (or the scopes) and the bottom bar. */
const BAR_GAP = 26;

/**
 * Where the frame is in the canvas area, as an empty box: nothing to see or click, but it lets
 * scripts find the frame (data-testid "player-frame") without redoing the viewport's sums.
 */
const FrameBox: React.FC = () => {
  const position = useViewportStore((s) => s.position);
  const scale = useViewportStore((s) => s.scale);
  const b = useViewportStore((s) => s.contentBounds);
  if (!b) return null;
  return (
    <div
      data-testid="player-frame"
      aria-hidden
      className="absolute pointer-events-none"
      style={{ left: position.x + b.x * scale, top: position.y + b.y * scale, width: b.width * scale, height: b.height * scale }}
    />
  );
};

/**
 * The player's body, between its header and its bottom bar, as CapCut's: the canvas area (the
 * rulers along its top and left when shown, the guides, the safe areas, the zoom navigator and
 * the tool chip over the canvas) and, when the oscilloscope shows, its scopes under it, then a
 * margin above the bar. The frame fills the canvas area (or keeps its zoom) as these come and go.
 */
const PlayerStage: React.FC = () => {
  const rulers = usePlayerStore((s) => s.rulers);
  const scopes = usePlayerStore((s) => s.scopes);
  const safeAreas = usePlayerStore((s) => s.safeAreas);
  const isFullscreen = useControlsStore((s) => s.isFullscreen);
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  useKeepFit(areaRef);
  const inset = rulers && !isFullscreen ? RULER_SIZE : 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ paddingBottom: BAR_GAP }}>
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {rulers && !isFullscreen && <Rulers area={area} />}
        <div
          ref={(el) => {
            areaRef.current = el;
            setArea(el);
          }}
          data-testid="player-canvas-area"
          className="absolute right-0 bottom-0 overflow-hidden"
          style={{ left: inset, top: inset }}
        >
          <Preview />
          {!isFullscreen && <FrameBox />}
          {safeAreas && !isFullscreen && <SafeAreaGuides />}
          {!isFullscreen && <Guides />}
          {!isFullscreen && <ZoomNavigator />}
          {!isFullscreen && <ToolChip />}
        </div>
      </div>
      {scopes && !isFullscreen && <Scopes />}
    </div>
  );
};

export default PlayerStage;
