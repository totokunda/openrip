import React from "react";
import { cn } from "@/lib/utils";

/** A titled grid of tiles in the left panel (text styles, transitions). */
export const AssetSection: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
  <section className="flex flex-col gap-2">
    <div className="flex flex-col gap-0.5 text-left">
      <h3 className="text-[11.5px] font-medium text-brand-light/90">{title}</h3>
      {note && <p className="text-[10.5px] text-brand-light/45 leading-snug">{note}</p>}
    </div>
    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" }}>
      {children}
    </div>
  </section>
);

/** One tile: a preview box with its name under it. */
export const AssetTile: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
}> = ({ label, onClick, children, active, disabled, testId }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    data-testid={testId}
    title={label}
    className={cn(
      "group flex flex-col gap-1.5 text-left min-w-0 disabled:cursor-not-allowed",
      disabled && "opacity-45",
    )}
  >
    <div
      className={cn(
        "w-full aspect-[4/3] rounded-[6px] bg-brand-background-dark border flex items-center justify-center overflow-hidden transition-colors",
        active ? "border-brand-accent" : "border-brand-light/[0.06] group-enabled:group-hover:border-brand-light/30",
      )}
    >
      {children}
    </div>
    <span className={cn("text-[10.5px] truncate px-0.5", active ? "text-brand-light" : "text-brand-light/60")}>{label}</span>
  </button>
);
