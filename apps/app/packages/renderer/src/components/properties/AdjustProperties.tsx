import React from "react";
import ColorCorrectionProperties from "./ColorCorrectionProperties";
import EffectsProperties from "./EffectsProperties";
import DraftAdjustProperties from "./DraftAdjustProperties";

interface AdjustPropertiesProps {
  clipId: string;
}

const AdjustProperties: React.FC<AdjustPropertiesProps> = ({ clipId }) => {
  return (
    <div className="min-w-0 divide-y divide-brand-light/10">
      <DraftAdjustProperties clipId={clipId} />
      <ColorCorrectionProperties clipId={clipId} />
      <EffectsProperties clipId={clipId} />
    </div>
  );
};

export default AdjustProperties;
