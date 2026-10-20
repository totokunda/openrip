import React from "react";
import PlayerBar from "../preview/PlayerBar";
import PlayerMenu from "../preview/PlayerMenu";
import PlayerStage from "../preview/PlayerStage";
import { PanelShell, panelHeaderHandlers } from "./PanelShell";
import TimelineSwitcher from "../preview/TimelineSwitcher";

interface PreviewPanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
  /** In a window of its own (lib/panel-windows.ts). */
  detached?: boolean;
}

/**
 * The player, as CapCut's: a header with its name and its menu (oscilloscope, guides and
 * rulers, still frames); the canvas, with the scopes under it when shown; and the bottom bar.
 * There is no tool row: text comes from the Text tab, shapes and the Pen from the Stickers
 * tab and masks from the Mask tab, and their keys (T, S; V or H to go back) still work, with
 * a chip on the canvas while one is on (and CapCut's "Click to start drawing" for the Pen).
 */
const PreviewPanel: React.FC<PreviewPanelProps> = ({
  id = "player",
  order,
  defaultSize = 40,
  minSize = 25,
  detached = false,
}) => {
  return (
    <PanelShell
      id={id}
      detached={detached}
      defaultSize={defaultSize}
      minSize={minSize}
      order={order}
      data-testid="player"
      className="flex flex-col w-full bg-brand-background relative overflow-hidden rounded-lg"
    >
      {/* The header strip: the player's name and its menu. Dragged out of the window, the
          player goes into a window of its own (lib/panel-windows.ts). */}
      <div {...panelHeaderHandlers("player", detached)} className="h-[42px] shrink-0 flex items-center gap-2 pl-3 pr-2.5 bg-brand-header border-b-[0.5px] border-brand-hairline">
        <TimelineSwitcher />
        <PlayerMenu />
      </div>
      {/* The canvas area (rulers, guides, overlays) and the scopes: preview/PlayerStage.tsx. */}
      <PlayerStage />
      <PlayerBar />
    </PanelShell>
  );
};

export default PreviewPanel;
