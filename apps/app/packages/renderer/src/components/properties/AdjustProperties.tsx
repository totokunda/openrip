import React from "react";
import ColorCorrectionProperties from "./ColorCorrectionProperties";
import EffectsProperties from "./EffectsProperties";
import DraftAdjustProperties from "./DraftAdjustProperties";
import AutoAdjust from "./adjust/AutoAdjust";
import ColorMatch from "./adjust/ColorMatch";

interface AdjustPropertiesProps {
  clipId: string;
}

const AdjustProperties: React.FC<AdjustPropertiesProps> = ({ clipId }) => {
  return (
    <div className="min-w-0 divide-y divide-brand-light/10">
      {/* CapCut's Basic tab opens with Auto adjust and Color match. */}
      <AutoAdjust clipId={clipId} />
      <ColorMatch clipId={clipId} />
      <DraftAdjustProperties clipId={clipId} />
      <ColorCorrectionProperties clipId={clipId} />
      <EffectsProperties clipId={clipId} />
    </div>
  );
};

export default AdjustProperties;
