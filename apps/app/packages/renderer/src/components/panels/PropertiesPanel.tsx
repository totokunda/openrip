import React from "react";
import EmptyPropertiesPanel from "../properties/EmptyPropertiesPanel";
import ClipPropertiesPanel from "./ClipPropertiesPanel";
import { PanelShell, panelHeaderHandlers, topStrip } from "./PanelShell";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import type { VideoClipProps } from "@/lib/types";
import TransitionProperties from "../properties/TransitionProperties";

interface PropertiesPanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
  /** In a window of its own (lib/panel-windows.ts). */
  detached?: boolean;
}

/** Every inspector view starts with a 42 px header strip (its tabs, or its name). */
const inHeader = topStrip(42);

/**
 * The right inspector: the selected clip's tabs, the selected transition's, or the project's
 * details with nothing selected. Its header strip, dragged out of the window, takes it into a
 * window of its own; a right-click there offers Pop out.
 */
const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  id = "inspector",
  order,
  defaultSize = 28,
  minSize = 18,
  detached = false,
}) => {
  const hasSelection = useControlsStore((s) => s.selectedClipIds.length > 0);
  // A transition selected on the timeline (while it's still there: an undo can take it away).
  const transitionId = useControlsStore((s) => s.selectedTransitionId);
  const hasTransition = useClipStore((s) => !!transitionId && !!(s.getClipById(transitionId) as VideoClipProps | undefined)?.transitionOut);
  return (
    <PanelShell
      id={id}
      detached={detached}
      minSize={minSize}
      defaultSize={defaultSize}
      order={order}
      data-testid="inspector"
      className="bg-brand-background rounded-lg flex flex-col min-w-0 overflow-hidden"
      {...panelHeaderHandlers("inspector", detached, inHeader)}
    >
      {hasSelection ? <ClipPropertiesPanel /> : hasTransition ? <TransitionProperties clipId={transitionId!} /> : <EmptyPropertiesPanel />}
    </PanelShell>
  );
};

export default PropertiesPanel;
