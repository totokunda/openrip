import React from "react";

/** A word in a thin box: CapCut's way of labelling the player's quality and ratio buttons. */
const Boxed: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="px-[3px] h-3 flex items-center rounded-[2px] border border-current text-[9px] font-semibold leading-none tabular-nums">{children}</span>
);

export default Boxed;
