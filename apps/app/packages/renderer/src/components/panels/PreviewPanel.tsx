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
        className="h-7 w-7 flex items-center justify-center rounded-[5px] text-brand-light/70 hover:text-brand-light hover:bg-brand-light/10 transition-colors cursor-pointer"
      >
        <LuMenu className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dark w-48 bg-brand-background/95 backdrop-blur-md border border-brand-light/10 rounded-[8px]">
        <DropdownMenuCheckboxItem data-testid="safe-areas" checked={guides} onCheckedChange={(on) => setGuides(on === true)} className="dark text-[12px]">
          Safe areas
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="dark text-[12px]" onClick={() => zoomToFit()}>
          Zoom to fit
        </DropdownMenuItem>
        <DropdownMenuItem className="dark text-[12px]" onClick={() => setIsFullscreen(true)}>
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
      className="flex flex-col w-full bg-brand-background relative overflow-hidden rounded-md"
    >
      <div className="h-10 shrink-0 relative flex items-center justify-center px-3 border-b border-brand-light/[0.06]">
        <span className="absolute left-3 max-w-[30%] truncate text-[12px] text-brand-light/80" title={projectName}>
          Player <span className="text-brand-light/40 pl-1">{projectName}</span>
        </span>
        <FloatingBar />
        <div className="absolute right-2">
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
