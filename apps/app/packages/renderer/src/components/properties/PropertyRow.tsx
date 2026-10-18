import React from "react";
import type { KeyframeProperty } from "@/lib/types";
import KeyframeButton from "./KeyframeButton";

/**
 * An inspector row as CapCut lays them out: the label in a 112 px column, the controls (22 px
 * fields) beside it, rows on a 38 px pitch. A keyframeable row names its clip and properties
 * (`clipId`, `keyframes`) and gets CapCut's keyframe navigator (‹ ◇ ›) at its right end;
 * `navigator` puts another there (a mask's poses).
 */
const PropertyRow: React.FC<{
  label: string;
  children: React.ReactNode;
  end?: React.ReactNode;
  clipId?: string;
  keyframes?: KeyframeProperty | KeyframeProperty[];
  navigator?: React.ReactNode;
  disabled?: boolean;
}> = ({ label, children, end, clipId, keyframes, navigator, disabled }) => {
  const nav =
    navigator ??
    (clipId && keyframes ? <KeyframeButton clipId={clipId} properties={Array.isArray(keyframes) ? keyframes : [keyframes]} disabled={disabled} /> : null);
  return (
    <div className="flex flex-row items-center min-h-[38px] min-w-0">
      <div className="w-[112px] shrink-0 text-start">
        <label className={disabled ? "text-[#525252] text-[12px]" : "text-brand-light text-[12px]"}>{label}</label>
      </div>
      <div className="flex-1 min-w-0 flex flex-row items-center gap-2">{children}</div>
      {end && <div className="ml-2 shrink-0 flex items-center">{end}</div>}
      {nav && <div className="ml-[6px] shrink-0 flex items-center">{nav}</div>}
    </div>
  );
};

export default PropertyRow;
