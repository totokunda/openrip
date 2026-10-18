import React from "react";
import { ResizablePanel } from "../ui/resizable";
import EmptyPropertiesPanel from "../properties/EmptyPropertiesPanel";
import ClipPropertiesPanel from "./ClipPropertiesPanel";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import type { VideoClipProps } from "@/lib/types";
import TransitionProperties from "../properties/TransitionProperties";

interface PropertiesPanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
}

/**
 * The right inspector: the selected clip's tabs, the selected transition's, or the project's
 * details with nothing selected.
 */
const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  id = "inspector",
  order,
  defaultSize = 28,
  minSize = 18,
}) => {
  const hasSelection = useControlsStore((s) => s.selectedClipIds.length > 0);
  // A transition selected on the timeline (while it's still there: an undo can take it away).
  const transitionId = useControlsStore((s) => s.selectedTransitionId);
  const hasTransition = useClipStore((s) => !!transitionId && !!(s.getClipById(transitionId) as VideoClipProps | undefined)?.transitionOut);
  return (
    <ResizablePanel
      id={id}
      minSize={minSize}
      defaultSize={defaultSize}
      order={order}
      data-testid="inspector"
      className="bg-brand-background rounded-lg flex flex-col min-w-0 overflow-hidden"
    >
      {hasSelection ? <ClipPropertiesPanel /> : hasTransition ? <TransitionProperties clipId={transitionId!} /> : <EmptyPropertiesPanel />}
    </ResizablePanel>
  );
};

export default PropertiesPanel;
