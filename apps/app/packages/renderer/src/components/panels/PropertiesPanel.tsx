import React from "react";
import { ResizablePanel } from "../ui/resizable";
import EmptyPropertiesPanel from "../properties/EmptyPropertiesPanel";
import ClipPropertiesPanel from "./ClipPropertiesPanel";
import { useControlsStore } from "@/lib/control";

interface PropertiesPanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
}

/** The right inspector: the selected clip's tabs, or the project's details with nothing selected. */
const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  id = "inspector",
  order,
  defaultSize = 28,
  minSize = 18,
}) => {
  const hasSelection = useControlsStore((s) => s.selectedClipIds.length > 0);
  return (
    <ResizablePanel
      id={id}
      minSize={minSize}
      defaultSize={defaultSize}
      order={order}
      data-testid="inspector"
      className="bg-brand-background rounded-lg flex flex-col min-w-0 overflow-hidden"
    >
      {hasSelection ? <ClipPropertiesPanel /> : <EmptyPropertiesPanel />}
    </ResizablePanel>
  );
};

export default PropertiesPanel;
