import React from "react";
import { cn } from "@/lib/utils";
import { useClipStore } from "@/lib/clip";
import { KeyNav, keyNavOf, seekTo, toggleKeysInStore, usePlayheadIfKeyed } from "@/lib/keyframe-ui";
import type { KeyframeProperty } from "@/lib/types";

/**
 * CapCut's keyframe navigator at the right end of a row or a section header (docs/plan/
 * capcut-ui-spec.md §4.8): ‹ goes to the key before the playhead, the diamond toggles a key at
 * the playhead (hollow: none there; filled in the accent: one there), › goes to the key after.
 * The arrows dim when there's no key that way. 30 px wide.
 */
export const KeyframeNavigator: React.FC<{
  nav: KeyNav;
  onToggle: () => void;
  /** What it keys, for its tooltip and for tests (`data-keyframe`). */
  name: string;
  disabled?: boolean;
}> = ({ nav, onToggle, name, disabled }) => {
  const arrow = (to: number | undefined, label: string, d: string) => (
    <button
      type="button"
      title={to === undefined ? undefined : label}
      aria-label={label}
      disabled={disabled || to === undefined}
      onClick={() => to !== undefined && seekTo(to)}
      className="h-[22px] w-[7px] flex items-center justify-center text-[#949494] hover:text-brand-lighter disabled:text-[#565656] disabled:cursor-default"
    >
      <svg width="5" height="9" viewBox="0 0 5 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
  return (
    <div className="w-[30px] h-[22px] shrink-0 flex items-center justify-between" data-keyframe={name} data-at={nav.at}>
      {arrow(nav.prev, "Previous keyframe", "M4 1 L1 4.5 L4 8")}
      <button
        type="button"
        title={nav.at ? "Remove keyframe" : "Add keyframe"}
        aria-label={nav.at ? `Remove the keyframe of ${name}` : `Add a keyframe of ${name}`}
        aria-pressed={nav.at}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "group/kf h-[22px] w-[12px] flex items-center justify-center disabled:cursor-default",
          nav.at ? "text-brand-accent" : "text-[#8a8a8a] hover:text-brand-lighter disabled:text-[#565656]",
        )}
      >
        <svg width="11" height="11" viewBox="0 0 11 11">
          <rect x="2.2" y="2.2" width="6.6" height="6.6" rx="0.8" transform="rotate(45 5.5 5.5)" fill={nav.at ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      {arrow(nav.next, "Next keyframe", "M1 1 L4 4.5 L1 8")}
    </div>
  );
};

/** The navigator over one or more of a clip's keyframeable properties, from the store. */
const KeyframeButton: React.FC<{ clipId: string; properties: KeyframeProperty[]; disabled?: boolean }> = ({ clipId, properties, disabled }) => {
  const clip = useClipStore((s) => s.getClipById(clipId));
  const { frame } = usePlayheadIfKeyed(clip, properties);
  return (
    <KeyframeNavigator
      nav={keyNavOf(clip, properties, frame)}
      onToggle={() => toggleKeysInStore(clipId, properties)}
      name={properties.join(",")}
      disabled={disabled || !clip}
    />
  );
};

export default KeyframeButton;
