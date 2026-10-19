import React, { useState } from "react";
import { LuCheck } from "react-icons/lu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useViewportStore } from "@/lib/viewport";
import { ratioBox } from "@/lib/aspect-presets";
import { PROJECT_ASPECTS, originalRatio, ratioForChoice } from "@/lib/project-canvas";
import Boxed from "./Boxed";

const row = "dark h-7 rounded-[4px] text-[13px] text-brand-light gap-2 px-2 cursor-pointer focus:bg-brand-hover";

/** The ratio's shape at the end of a row, as CapCut's menu draws it. */
const Shape: React.FC<{ width: number; height: number }> = ({ width, height }) => (
  <span className="ml-auto w-4 flex items-center justify-center text-brand-light/60">
    <span className="block rounded-[2px] border border-current" style={ratioBox(width, height, 12)} />
  </span>
);

/**
 * The canvas's size, under the player as in CapCut: Custom (a W:H edited on the canvas, the
 * preview's aspect editing) and the presets.
 */
const RatioMenu: React.FC = () => {
  const aspectRatio = useViewportStore((s) => s.aspectRatio);
  const setAspectRatio = useViewportStore((s) => s.setAspectRatio);
  const isAspectEditing = useViewportStore((s) => s.isAspectEditing);
  const setIsAspectEditing = useViewportStore((s) => s.setAspectEditing);
  const [open, setOpen] = useState(false);
  const label = aspectRatio.id === "custom" ? `${aspectRatio.width}:${aspectRatio.height}` : aspectRatio.id;
  const original = open ? originalRatio() : null;
  const orig = PROJECT_ASPECTS[0];
  const pick = (id: string) => {
    setAspectRatio(ratioForChoice(id, aspectRatio));
    setIsAspectEditing(false);
    setOpen(false);
  };
  const check = (on: boolean) => <span className="w-3.5 text-brand-accent">{on && <LuCheck className="w-3.5 h-3.5" />}</span>;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        title={`Ratio: ${label}`}
        data-testid="ratio-menu"
        className="h-6 px-1 flex items-center rounded-[4px] text-[#cecece] hover:text-brand-lighter hover:bg-brand-light/[0.08] transition-colors cursor-pointer"
      >
        <Boxed>Ratio</Boxed>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        className="dark w-[200px] p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px]"
      >
        {orig && (
          <DropdownMenuItem
            textValue="Original"
            data-testid="ratio-original"
            disabled={!original}
            className={row}
            onClick={() => pick("original")}
          >
            {check(aspectRatio.id === "original")}
            <span>Original</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          textValue="Custom"
          className={row}
          onClick={(e) => {
            // The Edit button inside handles its own clicks.
            if ((e.target as HTMLElement).closest("button")) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (aspectRatio.id !== "custom") {
              setAspectRatio({ width: aspectRatio.width, height: aspectRatio.height, id: "custom" });
              setIsAspectEditing(true);
            }
            setOpen(false);
          }}
        >
          {check(aspectRatio.id === "custom")}
          <span>Custom</span>
          {aspectRatio.id === "custom" ? (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsAspectEditing(!isAspectEditing);
                setOpen(false);
              }}
              className="ml-auto px-2 h-5 text-[11px] bg-brand-button hover:bg-brand-hover rounded-[4px] transition-colors"
            >
              {isAspectEditing ? "Done" : "Edit"}
            </button>
          ) : (
            <span className="ml-auto w-4 flex items-center justify-center text-brand-light/60">
              <span className="block w-3 h-3 rounded-[2px] border border-dashed border-current" />
            </span>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[#434343] mx-1" />
        {PROJECT_ASPECTS.filter((a) => a.id !== "original").map((opt, i, all) => (
          <React.Fragment key={opt.id}>
            <DropdownMenuItem textValue={opt.label} data-testid={`ratio-${opt.id}`} className={row} onClick={() => pick(opt.id)}>
              {check(aspectRatio.id === opt.id)}
              <span className="tabular-nums">{opt.label}</span>
              <Shape width={opt.width} height={opt.height} />
            </DropdownMenuItem>
            {opt.landscape && !all[i + 1]?.landscape && <DropdownMenuSeparator className="bg-[#434343] mx-1" />}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default RatioMenu;
