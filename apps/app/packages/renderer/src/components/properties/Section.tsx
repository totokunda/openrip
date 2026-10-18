import React, { useState } from "react";
import { IoCaretDown, IoCaretUp } from "react-icons/io5";
import { LuRotateCcw } from "react-icons/lu";
import { cn } from "@/lib/utils";
import type { KeyframeProperty } from "@/lib/types";
import KeyframeButton from "./KeyframeButton";
import { Checkbox } from "./controls";

/**
 * A section of an inspector tab as CapCut draws them (docs/plan/capcut-ui-spec.md §4.8): a
 * 12 px semibold title with a disclosure caret, a 12×12 checkbox before it when the section
 * can be switched on and off, and at the right end its own controls, the reset glyph (↺) and
 * a keyframe navigator over the section's properties. Collapsed, a section is 55 px tall;
 * the inspector puts a divider between sections. The rows sit inside a 12 px inset.
 */
const Section: React.FC<{
  title: string;
  children?: React.ReactNode;
  checked?: boolean;
  onCheckedChange?: (on: boolean) => void;
  defaultOpen?: boolean;
  onReset?: () => void;
  /** The section's keyframeable properties: its navigator keys them all at once. */
  keyframes?: { clipId: string; properties: KeyframeProperty[] };
  /** Controls before the reset glyph (Apply to all, the mask's invert). */
  actions?: React.ReactNode;
  /** Another navigator in place of `keyframes`' (a mask's poses). */
  navigator?: React.ReactNode;
  /** Whether rows dim while unchecked; false where a row is what turns it on (a LUT's or canvas's menu). */
  dimOff?: boolean;
  testId?: string;
}> = ({ title, children, checked, onCheckedChange, defaultOpen = true, onReset, keyframes, actions, navigator, dimOff = true, testId }) => {
  const [open, setOpen] = useState(defaultOpen);
  const switchable = checked !== undefined && onCheckedChange;
  // Rows under an unchecked section dim but stay (CapCut's disabled section).
  const dim = switchable && !checked && dimOff;
  return (
    <section className="px-3 min-w-0 text-left" data-testid={testId} data-section={title}>
      <div className="h-[55px] flex flex-row items-center gap-2 min-w-0">
        {switchable && <Checkbox checked={!!checked} onChange={onCheckedChange!} label={`${title} on`} />}
        <button
          type="button"
          onClick={() => children && setOpen(!open)}
          aria-expanded={open}
          className={cn("flex flex-row items-center gap-1.5 min-w-0", !children && "cursor-default")}
        >
          <h4 className="text-[12px] font-semibold text-brand-light truncate">{title}</h4>
          {children && (open ? <IoCaretUp className="w-2.5 h-2.5 text-[#9a9a9a] shrink-0" /> : <IoCaretDown className="w-2.5 h-2.5 text-[#9a9a9a] shrink-0" />)}
        </button>
        <div className="ml-auto flex flex-row items-center gap-[10px] shrink-0">
          {actions}
          {onReset && (
            <button type="button" title={`Reset ${title}`} aria-label={`Reset ${title}`} onClick={onReset} className="text-brand-light hover:text-brand-lighter">
              <LuRotateCcw className="w-[13px] h-[13px]" />
            </button>
          )}
          {navigator ?? (keyframes && <KeyframeButton clipId={keyframes.clipId} properties={keyframes.properties} disabled={dim} />)}
        </div>
      </div>
      {open && children && <div className={cn("pb-4 -mt-1 flex flex-col min-w-0", dim && "opacity-50 pointer-events-none")}>{children}</div>}
    </section>
  );
};

export default Section;
