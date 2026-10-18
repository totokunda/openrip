// The Settings window's controls, drawn as CapCut's (docs/plan/capcut-ui-spec.md §4.14): rows
// of a 164 px label and a control 188 px in, 22 px tall on a 46 px pitch; path fields with a
// folder button; steppers; selects on the raised grey; checks, toggles and radios in the accent.
import React from "react";
import { LuCheck, LuChevronDown, LuChevronUp, LuCircleHelp, LuFolder, LuTrash2 } from "react-icons/lu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** A row: its label on the left, the control (and any note under it) on the right. */
export const Row: React.FC<{ id: string; label: React.ReactNode; children: React.ReactNode; disabled?: boolean; className?: string }> = ({
  id,
  label,
  children,
  disabled,
  className,
}) => (
  <div data-testid={`settings-row-${id}`} data-disabled={disabled ? "true" : undefined} className={cn("grid grid-cols-[164px_1fr] gap-x-6 mb-6 last:mb-0", className)}>
    <div className={cn("min-h-[22px] flex items-start pt-[3px] text-[12px] leading-4 text-left", disabled ? "text-[#7a7a7a]" : "text-brand-light")}>{label}</div>
    <div className="min-w-0 flex flex-col items-start gap-1.5 text-left">{children}</div>
  </div>
);

/** A line between groups of rows. */
export const Divider = () => <div className="h-px bg-brand-background my-6" />;

/** Helper text under a control. */
export const Help: React.FC<{ children: React.ReactNode; muted?: boolean }> = ({ children, muted }) => (
  <p className={cn("text-[11px] leading-[14px]", muted ? "text-[#7a7a7a]" : "text-[#cccccc]")}>{children}</p>
);

/** Why a row can't be used yet. */
export const NotYet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p data-testid="settings-not-yet" className="text-[11px] leading-[14px] text-[#7a7a7a] italic">
    {children}
  </p>
);

/** The ⓘ after a label, its words on hover. */
export const Tip: React.FC<{ text: string }> = ({ text }) => (
  <span title={text} aria-label={text} className="inline-flex text-[#7a7a7a] hover:text-brand-light cursor-help">
    <LuCircleHelp className="w-3 h-3" />
  </span>
);

/** "/Users/me/Mov…s/projects": the start and end of a long path. */
export const middleEllipsis = (s: string, max = 36) => (s.length <= max ? s : `${s.slice(0, Math.ceil(max / 2) - 1)}…${s.slice(-Math.floor(max / 2))}`);

const square = "h-[22px] w-[22px] shrink-0 rounded-[4px] bg-[#505056] flex items-center justify-center text-brand-lighter";

/** A path and the folder button that picks another. */
export const PathField: React.FC<{ value: string; onPick?: () => void; disabled?: boolean; testId?: string; title?: string }> = ({ value, onPick, disabled, testId, title }) => (
  <div className="flex items-center gap-1 w-full">
    <div
      data-testid={testId}
      title={value || undefined}
      className={cn("h-[22px] w-[242px] rounded-[4px] bg-[#343337] px-2 flex items-center text-[12px] font-medium whitespace-nowrap overflow-hidden", disabled ? "text-[#626262]" : "text-brand-lighter")}
    >
      {value ? middleEllipsis(value) : "—"}
    </div>
    <button
      type="button"
      title={title}
      disabled={disabled || !onPick}
      onClick={onPick}
      data-testid={testId ? `${testId}-pick` : undefined}
      className={cn(square, "disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#5c5c63] cursor-pointer")}
    >
      <LuFolder className="w-3.5 h-3.5" />
    </button>
  </div>
);

/** A size and the bin that clears it. */
export const SizeClear: React.FC<{ bytes: number | null; onClear?: () => void; disabled?: boolean; title?: string; testId?: string }> = ({ bytes, onClear, disabled, title, testId }) => (
  <div className="flex items-center gap-1.5 h-[22px]">
    <span data-testid={testId} data-bytes={bytes ?? undefined} className={cn("text-[12px] font-medium tabular-nums", disabled ? "text-[#7a7a7a]" : "text-brand-lighter")}>
      {bytes == null ? "…" : formatBytes(bytes)}
    </span>
    <button
      type="button"
      title={title}
      disabled={disabled || !onClear}
      onClick={onClear}
      data-testid={testId ? `${testId}-clear` : undefined}
      className={cn(square, "disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#5c5c63] cursor-pointer")}
    >
      <LuTrash2 className="w-3.5 h-3.5" />
    </button>
  </div>
);

/** Bytes as CapCut writes them: 3.17GB, 556.84MB, 0B. */
export const formatBytes = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v.toFixed(0) : v.toFixed(2)}${units[i]}`;
};

/** A number with up and down arrows; typing commits on Enter or leaving the field. */
export const Stepper: React.FC<{
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  testId?: string;
  disabled?: boolean;
}> = ({ value, onChange, step = 1, min = -Infinity, max = Infinity, decimals = 0, testId, disabled }) => {
  const show = (v: number) => v.toFixed(decimals);
  const [text, setText] = React.useState(show(value));
  React.useEffect(() => setText(show(value)), [value, decimals]);
  const clamp = (v: number) => Math.min(max, Math.max(min, Number(v.toFixed(decimals))));
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v)) onChange(clamp(v));
    else setText(show(value));
  };
  return (
    <div className="flex items-center gap-0.5">
      <input
        data-testid={testId}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(clamp(value + (e.key === "ArrowUp" ? step : -step)));
          }
        }}
        className="h-[22px] w-[58px] rounded-[4px] bg-brand px-2 text-center text-[12px] font-medium tabular-nums text-brand-lighter outline-none focus:ring-1 focus:ring-brand-accent/60 disabled:text-[#626262]"
      />
      <div className="h-[22px] w-[15px] rounded-[4px] bg-brand-background-light flex flex-col items-center justify-center">
        <button type="button" disabled={disabled} aria-label="More" data-testid={testId ? `${testId}-up` : undefined} onClick={() => onChange(clamp(value + step))} className="h-[11px] flex items-center text-brand-light hover:text-brand-lighter cursor-pointer">
          <LuChevronUp className="w-3 h-3" />
        </button>
        <button type="button" disabled={disabled} aria-label="Less" data-testid={testId ? `${testId}-down` : undefined} onClick={() => onChange(clamp(value - step))} className="h-[11px] flex items-center text-brand-light hover:text-brand-lighter cursor-pointer">
          <LuChevronDown className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

/** A menu of choices on the raised grey, the chosen one ticked in the accent. */
export function Choice<T extends string | number>({
  value,
  options,
  onChange,
  width = 355,
  testId,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  width?: number;
  testId?: string;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        disabled={disabled}
        data-testid={testId}
        style={{ width }}
        className="h-[22px] rounded-[4px] bg-brand-background-light px-2 flex items-center justify-between gap-2 text-[12px] font-medium text-brand-lighter outline-none disabled:opacity-40 cursor-pointer data-[state=open]:[&>svg]:rotate-180"
      >
        <span className="truncate">{current?.label ?? String(value)}</span>
        <LuChevronDown className="w-3.5 h-3.5 shrink-0 transition-transform" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        style={{ width }}
        className="dark z-[130] bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] p-1"
      >
        {options.map((o) => (
          <DropdownMenuItem
            key={String(o.value)}
            data-testid={testId ? `${testId}-option` : undefined}
            data-value={String(o.value)}
            onSelect={() => onChange(o.value)}
            className="dark h-8 text-[13px] text-brand-light gap-2 px-2 rounded-[4px] cursor-pointer focus:bg-brand-hover"
          >
            <span className="w-4 flex justify-center text-brand-accent">{o.value === value && <LuCheck className="w-3.5 h-3.5" />}</span>
            <span>{o.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A tick box and its words. */
export const Check: React.FC<{ checked: boolean; onChange?: (v: boolean) => void; children?: React.ReactNode; disabled?: boolean; testId?: string; tip?: string }> = ({
  checked,
  onChange,
  children,
  disabled,
  testId,
  tip,
}) => (
  <label className={cn("flex items-start gap-2 text-[12px] font-medium leading-4", disabled ? "text-[#7a7a7a] cursor-not-allowed" : "text-brand-lighter cursor-pointer")}>
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "mt-[1px] h-[14px] w-[14px] shrink-0 rounded-[3px] flex items-center justify-center",
        checked ? "bg-brand-accent text-white" : "bg-[#505056]",
        disabled && "opacity-50",
      )}
    >
      {checked && <LuCheck className="w-2.5 h-2.5" strokeWidth={4} />}
    </button>
    {children != null && <span className="flex items-center gap-1">{children}{tip && <Tip text={tip} />}</span>}
  </label>
);

/** An on/off switch. */
export const Toggle: React.FC<{ on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; testId?: string }> = ({ on, onChange, disabled, testId }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    disabled={disabled}
    data-testid={testId}
    onClick={() => onChange?.(!on)}
    className={cn("relative h-4 w-[30px] rounded-full transition-colors", on ? "bg-brand-accent" : "bg-brand-button", disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}
  >
    <span className={cn("absolute top-[2px] h-3 w-3 rounded-full bg-white transition-all", on ? "left-[16px]" : "left-[2px]")} />
  </button>
);

/** One of a set of choices. */
export const Radio: React.FC<{ checked: boolean; onChange?: () => void; children?: React.ReactNode; testId?: string; disabled?: boolean; className?: string }> = ({
  checked,
  onChange,
  children,
  testId,
  disabled,
  className,
}) => (
  <label className={cn("flex items-center gap-2 text-[12px] font-medium", disabled ? "text-[#7a7a7a]" : "text-brand-lighter cursor-pointer", className)}>
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange?.()}
      className={cn("h-[14px] w-[14px] shrink-0 rounded-full flex items-center justify-center", checked ? "border-[1.5px] border-brand-accent" : "border-[1.5px] border-[#505056]")}
    >
      {checked && <span className="h-[7px] w-[7px] rounded-full bg-brand-accent" />}
    </button>
    {children}
  </label>
);

/** A small grey button (Linkage's Settings). */
export const SmallButton: React.FC<{ children: React.ReactNode; onClick?: () => void; disabled?: boolean; testId?: string; title?: string }> = ({ children, onClick, disabled, testId, title }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    data-testid={testId}
    className="h-[22px] px-3 rounded-[4px] bg-brand-button text-[12px] font-semibold text-brand-lighter hover:bg-[#5a5a5a] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
  >
    {children}
  </button>
);
