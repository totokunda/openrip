import React from "react";
import { ResizablePanel } from "../ui/resizable";
import Controls from "../controls/Controls";
import TimelineEditor from "../timeline/TimelineEditor";

interface TimelinePanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
}

/** The timeline across the bottom: its toolbar (edit tools left, switches and zoom right) over the tracks. */
const TimelinePanel: React.FC<TimelinePanelProps> = ({
  id = "timeline",
  order,
  defaultSize = 42,
  minSize = 25,
}) => {
  return (
    <ResizablePanel
      id={id}
      order={order}
      defaultSize={defaultSize}
      minSize={minSize}
      data-testid="timeline"
      className="bg-brand-background flex flex-col rounded-lg w-full overflow-hidden"
    >
      <Controls />
      <div className="flex flex-col justify-center flex-1 min-h-0 overflow-auto">
        <TimelineEditor />
      </div>
    </ResizablePanel>
  );
};

export default TimelinePanel;
