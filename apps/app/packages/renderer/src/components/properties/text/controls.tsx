import React, { useEffect, useState } from "react";
import { IoCaretDown, IoCaretUp } from "react-icons/io5";
import { LuChevronDown, LuChevronUp, LuRotateCcw } from "react-icons/lu";
import { cn } from "@/lib/utils";

/**
 * The Text tab's controls, drawn as CapCut's inspector draws them (docs/plan/capcut-ui-spec.md
 * §4.8): 22 px fields on `bg.sunken`, 26×22 buttons on `bg.raised`, 12 px labels.
 */

/** CapCut's 12×12 checkbox: grey off, the accent with a white tick on. */
export const SmallCheckbox: React.FC<{ checked: boolean; onChange: (on: boolean) => void; label: string; testId?: string }> = ({ checked, onChange, label, testId }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={label}
    data-testid={testId}
    onClick={() => onChange(!checked)}
    className={cn("w-3 h-3 shrink-0 rounded-[2px] flex items-center justify-center transition-colors", checked ? "bg-brand-accent" : "bg-[#515151] hover:bg-[#5c5c5c]")}
  >
    {checked && (
      <svg viewBox="0 0 12 12" className="w-[9px] h-[9px]" aria-hidden>
        <path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
  </button>
);

/**
 * A section of Text ▸ Basic as CapCut draws one: a 55 px header with a checkbox (when it can be
 * switched on and off), a 12 px semibold title with a caret, and the reset glyph at the right;
 * the rows under it. Switching it on opens it; rows of a section switched off but open dim.
 */
export const TextSection: React.FC<{
  title: string;
  children: React.ReactNode;
  checked?: boolean;
  onCheckedChange?: (on: boolean) => void;
  onReset?: () => void;
  testId?: string;
}> = ({ title, children, checked, onCheckedChange, onReset, testId }) => {
  const switchable = checked !== undefined && !!onCheckedChange;
  const [open, setOpen] = useState(switchable ? !!checked : true);
  // Switched on, it opens (CapCut's sections open with their checkbox).
  useEffect(() => {
    if (checked) setOpen(true);
  }, [checked]);
  const dim = switchable && !checked;
  return (
    <section data-testid={testId} data-section={title} className="px-3 min-w-0">
      <div className="h-[55px] flex flex-row items-center gap-2 min-w-0">
        {switchable && <SmallCheckbox checked={!!checked} onChange={onCheckedChange!} label={title} testId={testId ? `${testId}-on` : undefined} />}
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn("flex flex-row items-center gap-1.5 min-w-0", switchable && "ml-1")}>
          <h4 className="text-[12px] font-semibold text-brand-light truncate">{title}</h4>
          {open ? <IoCaretUp className="w-2.5 h-2.5 text-[#9a9a9a] shrink-0" /> : <IoCaretDown className="w-2.5 h-2.5 text-[#9a9a9a] shrink-0" />}
        </button>
        {onReset && (
          <button type="button" title={`Reset ${title}`} aria-label={`Reset ${title}`} onClick={onReset} className="ml-auto text-brand-light hover:text-brand-lighter disabled:opacity-40" disabled={dim}>
            <LuRotateCcw className="w-[13px] h-[13px]" />
          </button>
        )}
      </div>
      {open && <div className={cn("pb-4 -mt-1 flex flex-col min-w-0", dim && "opacity-40 pointer-events-none")}>{children}</div>}
    </section>
  );
};

/** The ▲▼ stepper beside a field: 16×22 on `bg.raised`. */
export const Stepper: React.FC<{ onUp: () => void; onDown: () => void; label: string; disabled?: boolean }> = ({ onUp, onDown, label, disabled }) => (
  <div className={cn("w-4 h-[22px] shrink-0 flex flex-col rounded-[3px] bg-brand-background-light overflow-hidden", disabled && "opacity-50")}>
    <button type="button" aria-label={`${label} up`} disabled={disabled} onClick={onUp} className="flex-1 flex items-center justify-center hover:bg-brand-light/10">
      <LuChevronUp className="w-2 h-2 text-brand-light" />
    </button>
    <button type="button" aria-label={`${label} down`} disabled={disabled} onClick={onDown} className="flex-1 flex items-center justify-center hover:bg-brand-light/10">
      <LuChevronDown className="w-2 h-2 text-brand-light" />
    </button>
  </div>
);

/**
 * A number in a 54×22 field with its stepper, typed in or stepped, kept within [min, max];
 * the value is shown whole or to `toFixed` places.
 */
export const NumberField: React.FC<{
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  toFixed?: number;
  suffix?: string;
  label: string;
  testId?: string;
}> = ({ value, onChange, min, max, step = 1, toFixed = 0, suffix = "", label, testId }) => {
  const shown = value.toFixed(toFixed);
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = () => {
    const v = Number(text.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(v) && text.trim() !== "" && clamp(v) !== value) onChange(clamp(v));
    else setText(shown);
  };
  return (
    <div className="flex flex-row items-center gap-0.5 shrink-0">
      <input
        aria-label={label}
        data-testid={testId}
        value={focused ? text : `${shown}${suffix}`}
        onFocus={() => {
          setFocused(true);
          setText(shown);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(shown);
            e.currentTarget.blur();
          }
        }}
        className="w-[54px] h-[22px] px-1.5 rounded-[4px] bg-brand text-center text-[12px] tabular-nums text-brand-lighter outline-none focus:ring-1 focus:ring-[#515151]"
      />
      <Stepper label={label} onUp={() => onChange(clamp(value + step))} onDown={() => onChange(clamp(value - step))} />
    </div>
  );
};

/**
 * Buttons sharing one rounded 22 px group on `bg.raised` (CapCut's case and alignment
 * buttons); the chosen one lifts to `bg.button`. With `toggle`, choosing the chosen one again
 * chooses none ("").
 */
export function Segments<T extends string>({
  options,
  value,
  onChange,
  toggle,
  testId,
}: {
  options: { value: T; label: React.ReactNode; title: string }[];
  value: T | "";
  onChange: (v: T | "") => void;
  toggle?: boolean;
  testId?: string;
}) {
  return (
    <div data-testid={testId} role="radiogroup" className="h-[22px] flex flex-row items-center rounded-[4px] bg-brand-background-light p-0 shrink-0">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          aria-label={o.title}
          data-value={o.value}
          onClick={() => onChange(toggle && value === o.value ? "" : o.value)}
          className={cn(
            "h-[22px] min-w-[34px] px-2 flex items-center justify-center rounded-[4px] text-[12px] font-semibold transition-colors",
            value === o.value ? "bg-brand-button text-brand-lighter" : "text-brand-light hover:text-brand-lighter",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A 26×22 button on `bg.raised` that stays down while on (CapCut's B, U, I). */
export const ToggleButton: React.FC<{ on: boolean; onClick: () => void; title: string; children: React.ReactNode; testId?: string }> = ({ on, onClick, title, children, testId }) => (
  <button
    type="button"
    aria-pressed={on}
    title={title}
    aria-label={title}
    data-testid={testId}
    onClick={onClick}
    className={cn("w-[26px] h-[22px] rounded-[4px] flex items-center justify-center transition-colors", on ? "bg-brand-button text-brand-lighter" : "bg-brand-background-light text-brand-light hover:bg-brand-button")}
  >
    {children}
  </button>
);
