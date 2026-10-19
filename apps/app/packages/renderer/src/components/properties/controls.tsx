import React, { useEffect, useRef, useState } from "react";
import { LuChevronDown, LuChevronUp, LuCheck } from "react-icons/lu";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "@/lib/utils";

// The inspector's small controls, to CapCut's measurements (docs/plan/capcut-ui-spec.md §4.8):
// 22 px controls on raised or sunken greys, the accent only for what's on.

/** CapCut's toggle: a 36×16 pill, the accent with the knob right when on, #4f4f4f when off. */
export const Toggle: React.FC<{ on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }> = ({ on, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={cn(
      "relative w-9 h-4 rounded-full shrink-0 transition-colors disabled:opacity-50",
      on ? "bg-brand-accent" : "bg-brand-button",
    )}
  >
    <span className={cn("absolute top-1 w-2 h-2 rounded-full bg-brand-lighter transition-all", on ? "left-6" : "left-1")} />
  </button>
);

/** CapCut's 12×12 checkbox: #515151 off, the accent with a white tick on. */
export const Checkbox: React.FC<{ checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn("w-3 h-3 rounded-[2px] shrink-0 flex items-center justify-center disabled:opacity-50", checked ? "bg-brand-accent" : "bg-[#515151]")}
  >
    {checked && <LuCheck className="w-[9px] h-[9px] text-white" strokeWidth={3.5} />}
  </button>
);

/** A group subhead inside a section ("Color", "Lightness"): 12 px tertiary over a divider. */
export const Subhead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pt-[10px] pb-[9px] mb-[6px] border-b border-brand-divider">
    <span className="text-[12px] text-[#949494]">{children}</span>
  </div>
);

/**
 * CapCut's dropdown: 22 px on the raised grey, the value on the left and a chevron on the
 * right; its menu marks the current item with a tick in the accent.
 */
export const InspectorSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
  className?: string;
  disabled?: boolean;
}> = ({ value, onChange, options, label, className, disabled }) => (
  <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
    <SelectPrimitive.Trigger
      aria-label={label}
      className={cn(
        "group/sel h-[22px] w-full min-w-0 flex items-center justify-between gap-2 rounded-[4px] bg-brand-background-light hover:bg-brand-button px-2 text-[12px] text-brand-light outline-none disabled:opacity-50",
        className,
      )}
    >
      <span className="truncate text-left">
        <SelectPrimitive.Value />
      </span>
      <SelectPrimitive.Icon asChild>
        <LuChevronDown className="w-3 h-3 shrink-0 text-brand-light group-data-[state=open]/sel:rotate-180 transition-transform" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className="z-[101] min-w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)] overflow-y-auto rounded-[8px] bg-brand-header border-[0.5px] border-black shadow-[inset_0_0_0_0.5px_#494949] p-1 font-poppins"
      >
        <SelectPrimitive.Viewport>
          {options.map((o) => (
            <SelectPrimitive.Item
              key={o.value}
              value={o.value}
              className="relative h-8 flex items-center pl-8 pr-3 rounded-[4px] text-[13px] text-brand-light outline-none cursor-pointer data-[highlighted]:bg-brand-hover"
            >
              <SelectPrimitive.ItemIndicator className="absolute left-2.5 flex items-center">
                <LuCheck className="w-3.5 h-3.5 text-brand-accent" />
              </SelectPrimitive.ItemIndicator>
              <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
            </SelectPrimitive.Item>
          ))}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
);

/** A group of 22 px icon buttons on one raised strip (alignment, presets, flips). */
export const ButtonGroup: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn("h-[22px] w-fit flex flex-row items-center rounded-[4px] bg-brand-background-light", className)}>{children}</div>
);

export const GroupButton: React.FC<{ title: string; onClick: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean; testId?: string }> = ({
  title,
  onClick,
  children,
  active,
  disabled,
  testId,
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    disabled={disabled}
    data-testid={testId}
    onClick={onClick}
    className={cn(
      "h-full w-7 flex items-center justify-center transition-colors cursor-pointer first:rounded-l-[4px] last:rounded-r-[4px] disabled:opacity-40 disabled:cursor-default",
      active ? "bg-brand-button text-brand-accent" : "text-brand-light hover:bg-brand-button",
    )}
  >
    {children}
  </button>
);

export const GroupDivider = () => <span className="w-px h-3 bg-brand-hover" />;

/**
 * A 22 px number field (68 px wide in X/Y pairs) with an optional grey prefix inside ("X",
 * "Y", "W") and a unit after the value, and CapCut's 16 px stepper beside it. It commits on
 * Enter or when it loses focus; Escape puts the value back.
 */
export const NumberField: React.FC<{
  value: number;
  onChange: (v: number) => void;
  prefix?: React.ReactNode;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  label: string;
  className?: string;
  disabled?: boolean;
  /** Several clips with different values: the field shows "-" until it's edited. */
  mixed?: boolean;
}> = ({ value, onChange, prefix, unit = "", step = 1, min = -Infinity, max = Infinity, digits = 0, label, className, disabled, mixed }) => {
  const shown = Number.isFinite(value) ? value.toFixed(digits) : "0";
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  const commit = () => {
    const n = Number(text.replace(/[^0-9.+-]/g, ""));
    if (text.trim() !== "" && Number.isFinite(n) && (mixed || n.toFixed(digits) !== shown)) onChange(Math.min(max, Math.max(min, n)));
    else setText(shown);
  };
  const nudge = (d: number) => !disabled && onChange(Math.min(max, Math.max(min, Number(shown) + d)));
  return (
    <div className={cn("flex flex-row items-center shrink-0", className)}>
      <div className="relative w-[68px] h-[22px]">
        {prefix != null && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-[#949494] pointer-events-none">{prefix}</span>}
        <input
          aria-label={label}
          disabled={disabled}
          value={focused ? text : mixed ? "-" : `${shown}${unit}`}
          onFocus={() => {
            setFocused(true);
            setText(mixed ? "" : shown);
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              setText(shown);
              setFocused(false);
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
          className={cn(
            "w-full h-full rounded-[4px] bg-brand text-center text-[12px] tabular-nums text-brand-lighter outline-none disabled:opacity-50",
            prefix != null && "pl-5",
          )}
        />
      </div>
      <div className="ml-0.5 w-4 h-[22px] flex flex-col rounded-[3px] bg-brand-background-light">
        <button type="button" aria-label={`${label} up`} disabled={disabled} onClick={() => nudge(step)} className="flex-1 flex items-center justify-center hover:bg-brand-light/10 rounded-t-[3px]">
          <LuChevronUp className="w-2 h-2 text-brand-light" />
        </button>
        <button type="button" aria-label={`${label} down`} disabled={disabled} onClick={() => nudge(-step)} className="flex-1 flex items-center justify-center hover:bg-brand-light/10 rounded-b-[3px]">
          <LuChevronDown className="w-2 h-2 text-brand-light" />
        </button>
      </div>
    </div>
  );
};

/**
 * CapCut's rotation dial: a 17 px dark disc with a white tick at the angle (0° points right,
 * clockwise positive). Dragging round it turns the value (in whole degrees; ⇧ in 15° steps).
 */
export const Dial: React.FC<{ value: number; onChange: (deg: number) => void; label: string; disabled?: boolean }> = ({ value, onChange, label, disabled }) => {
  const ref = useRef<HTMLDivElement>(null);
  const turns = useRef(0);
  const angleAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.y + r.height / 2), e.clientX - (r.x + r.width / 2)) * 180) / Math.PI;
  };
  const set = (e: React.PointerEvent) => {
    let a = angleAt(e);
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    // Keep the whole turns the value had, so dragging past ±180° goes on round.
    onChange(Math.round(a + turns.current * 360));
  };
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        turns.current = Math.round((value - angleAt(e)) / 360);
        set(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(e)}
      className={cn("relative w-[17px] h-[17px] rounded-full bg-brand border border-[#3e3e42] shrink-0", disabled ? "opacity-50" : "cursor-pointer")}
    >
      <span
        className="absolute left-1/2 top-1/2 h-[1.5px] w-[5px] bg-brand-lighter origin-left rounded-full"
        style={{ transform: `translateY(-50%) rotate(${value}deg) translateX(2.5px)` }}
      />
    </div>
  );
};
