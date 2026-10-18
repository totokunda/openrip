import React from "react";
import { LuMenu } from "react-icons/lu";
import Preview from "../preview/Preview";
import { ResizablePanel } from "../ui/resizable";
import FloatingBar from "../preview/clips/FloatingBar";
import PlayerBar from "../preview/PlayerBar";
import SafeAreaGuides from "../preview/SafeAreaGuides";
import { useControlsStore } from "@/lib/control";
import { useProjectsStore } from "@/lib/projects";
import { usePlayerStore } from "@/lib/player";
import { useViewportStore } from "@/lib/viewport";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PreviewPanelProps {
  id?: string;
  order?: number;
  defaultSize?: number;
  minSize?: number;
}

/** The player's menu, at its header's right as in CapCut: guides and views. */
const PlayerMenu: React.FC = () => {
  const guides = usePlayerStore((s) => s.guides);
  const setGuides = usePlayerStore((s) => s.setGuides);
  const zoomToFit = useViewportStore((s) => s.zoomToFit);
  const setIsFullscreen = useControlsStore((s) => s.setIsFullscreen);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Player menu"
        data-testid="player-menu"
        className="h-6 w-6 flex items-center justify-center rounded-[4px] text-[#67676f] hover:text-brand-light hover:bg-brand-light/[0.08] transition-colors cursor-pointer"
      >
        <LuMenu className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dark w-[200px] p-1 bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px]">
        <DropdownMenuCheckboxItem data-testid="safe-areas" checked={guides} onCheckedChange={(on) => setGuides(on === true)} className="dark h-8 text-[13px] text-brand-light rounded-[4px] focus:bg-brand-hover">
          Safe areas
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator className="bg-brand-hover mx-1" />
        <DropdownMenuItem className="dark h-8 text-[13px] text-brand-light rounded-[4px] pl-8 focus:bg-brand-hover" onClick={() => zoomToFit()}>
          Zoom to fit
        </DropdownMenuItem>
        <DropdownMenuItem className="dark h-8 text-[13px] text-brand-light rounded-[4px] pl-8 focus:bg-brand-hover" onClick={() => setIsFullscreen(true)}>
          Full screen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * The player: a header with its name, the canvas tools (select, draw, text, mask, shape),
 * the zoom and its menu; the canvas; and the time, transport, quality, ratio and full screen
 * under it.
 */
const PreviewPanel: React.FC<PreviewPanelProps> = ({
  id = "player",
  order,
  defaultSize = 40,
  minSize = 25,
}) => {
  const guides = usePlayerStore((s) => s.guides);
  const isFullscreen = useControlsStore((s) => s.isFullscreen);
  const projectName = useProjectsStore((s) => s.getActiveProject()?.name ?? "");

  return (
    <ResizablePanel
      id={id}
      defaultSize={defaultSize}
      minSize={minSize}
      order={order}
      data-testid="player"
      className="flex flex-col w-full bg-brand-background relative overflow-hidden rounded-lg"
    >
      {/* The header strip: the player's name, the canvas tools (OpenRip's own) and its menu. */}
      <div className="@container h-[42px] shrink-0 flex items-center gap-2 pl-3 pr-2.5 bg-brand-header border-b-[0.5px] border-brand-hairline">
        {/* Even sides keep the tools centred; the name gives way when the player is narrow. */}
        <span className="flex-1 min-w-0 truncate text-left text-[13px] text-white @max-[420px]:hidden" title={projectName}>
          Player<span className="text-brand-light/45">-{projectName}</span>
        </span>
        <div className="shrink-0">
          <FloatingBar />
        </div>
        <div className="flex-1 flex justify-end">
          <PlayerMenu />
        </div>
      </div>
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <Preview />
        {guides && !isFullscreen && <SafeAreaGuides />}
      </div>
      <PlayerBar />
    </ResizablePanel>
  );
};

export default PreviewPanel;
