import React from "react";

/**
 * An inspector row as CapCut lays them out: the label in a 112 px column, the controls (22 px
 * fields) beside it, rows on a 38 px pitch.
 */
const PropertyRow: React.FC<{ label: string; children: React.ReactNode; end?: React.ReactNode }> = ({ label, children, end }) => (
  <div className="flex flex-row items-center min-h-[38px] min-w-0">
    <div className="w-[112px] shrink-0 text-start">
      <label className="text-brand-light text-[12px]">{label}</label>
    </div>
    <div className="flex-1 min-w-0 flex flex-row items-center gap-2">{children}</div>
    {end && <div className="ml-2 shrink-0 flex items-center">{end}</div>}
  </div>
);

export default PropertyRow;
