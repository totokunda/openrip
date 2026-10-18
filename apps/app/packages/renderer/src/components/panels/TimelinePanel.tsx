import React from "react";
import Controls from "../controls/Controls";
import TimelineEditor from "../timeline/TimelineEditor";
import { PanelShell, panelHeaderHandlers, topStrip } from "./PanelShell";

interface TimelinePanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
  /** In a window of its own (lib/panel-windows.ts). */
  detached?: boolean;
}

/** The toolbar is the timeline's header strip. */
const inToolbar = topStrip(32);

/**
 * The timeline across the bottom: its toolbar (edit tools left, switches and zoom right) over
 * the tracks. The toolbar, dragged out of the window, takes it into a window of its own; a
 * right-click there offers Pop out.
 */
const TimelinePanel: React.FC<TimelinePanelProps> = ({
  id = "timeline",
  order,
  defaultSize = 42,
  minSize = 25,
  detached = false,
}) => {
  return (
    <PanelShell
      id={id}
      detached={detached}
      order={order}
      defaultSize={defaultSize}
      minSize={minSize}
      data-testid="timeline"
      className="bg-brand-background flex flex-col rounded-lg w-full overflow-hidden"
      {...panelHeaderHandlers("timeline", detached, inToolbar)}
    >
      <Controls />
      <div className="flex flex-col justify-center flex-1 min-h-0 overflow-auto">
        <TimelineEditor />
      </div>
    </PanelShell>
  );
};

export default TimelinePanel;
