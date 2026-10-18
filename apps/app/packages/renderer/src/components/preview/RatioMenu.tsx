import React, { useState } from "react";
import { LuCheck, LuChevronDown } from "react-icons/lu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useViewportStore } from "@/lib/viewport";
import { ASPECT_PRESETS, ratioBox } from "@/lib/aspect-presets";

/**
 * The canvas's size, under the player as in CapCut: the presets, or a custom W:H edited on
 * the canvas itself (the preview's aspect editing).
 */
const RatioMenu: React.FC = () => {
  const aspectRatio = useViewportStore((s) => s.aspectRatio);
  const setAspectRatio = useViewportStore((s) => s.setAspectRatio);
  const isAspectEditing = useViewportStore((s) => s.isAspectEditing);
  const setIsAspectEditing = useViewportStore((s) => s.setAspectEditing);
  const [open, setOpen] = useState(false);
  const label = aspectRatio.id === "custom" ? `${aspectRatio.width}:${aspectRatio.height}` : aspectRatio.id;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        title="Canvas ratio"
        data-testid="ratio-menu"
        className="h-7 px-2 flex items-center gap-1.5 rounded-[5px] text-[11px] tabular-nums text-brand-light/80 hover:text-brand-light hover:bg-brand-light/10 transition-colors cursor-pointer"
      >
        <span className="w-4 flex items-center justify-center">
          <span className="block rounded-[2px] border-[1.5px] border-current" style={ratioBox(aspectRatio.width, aspectRatio.height, 13)} />
        </span>
        <span>{label}</span>
        <LuChevronDown className="w-3 h-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="dark w-48 flex flex-col bg-brand-background/95 backdrop-blur-md border border-brand-light/10 rounded-[8px] font-poppins">
        {ASPECT_PRESETS.map((opt) => (
          <DropdownMenuItem
            key={opt.id}
            textValue={opt.name}
            className="dark text-[11.5px] font-medium flex flex-row items-center cursor-pointer gap-x-3 w-full bg-transparent"
            onClick={() => {
              setAspectRatio({ width: opt.width, height: opt.height, id: opt.id });
              setIsAspectEditing(false);
              setOpen(false);
            }}
          >
            <span className="w-6 flex items-center justify-center">
              <span className="block border-[1.5px] border-brand-light rounded-xs" style={ratioBox(opt.width, opt.height, 22)} />
            </span>
            <div className="flex flex-col items-start gap-y-0.5">
              <span>{opt.name}</span>
              <span className="text-brand-light/50 text-[10.5px] font-light">{opt.id}</span>
            </div>
            {aspectRatio.id === opt.id && <LuCheck className="w-4 h-4 ml-auto text-brand-light" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          textValue="Custom"
          className="dark text-[11.5px] font-medium flex flex-row items-center cursor-pointer gap-x-3 w-full bg-transparent"
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
          <span className="w-6 flex items-center justify-center">
            <span className="block w-[20px] h-[20px] border-[1.5px] border-dashed border-brand-light rounded-xs" />
          </span>
          <div className="flex flex-col items-start gap-y-0.5 flex-1">
            <span>Custom</span>
            <span className="text-brand-light/50 text-[10.5px] font-light">
              {aspectRatio.id === "custom" ? `${aspectRatio.width}:${aspectRatio.height}` : "Set W:H"}
            </span>
          </div>
          {aspectRatio.id === "custom" && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsAspectEditing(!isAspectEditing);
                setOpen(false);
              }}
              className="px-3 py-1 text-[10px] bg-brand-light/10 hover:bg-brand-light/20 rounded-[4px] transition-colors"
            >
              {isAspectEditing ? "Done" : "Edit"}
            </button>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default RatioMenu;
