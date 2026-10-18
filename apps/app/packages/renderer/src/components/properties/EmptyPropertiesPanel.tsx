import React from "react";
import { LuMousePointerClick } from "react-icons/lu";
import { useProjectsStore } from "@/lib/projects";
import { useViewportStore } from "@/lib/viewport";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { useEnginePreviewStore } from "@/lib/engine-preview";

/** "1:05.4" from frames. */
const length = (frames: number, fps: number) => {
  const s = fps > 0 ? frames / fps : 0;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

/** With nothing selected, the inspector shows the project's details, as CapCut's does. */
const EmptyPropertiesPanel: React.FC = () => {
  const project = useProjectsStore((s) => s.getActiveProject());
  const aspect = useViewportStore((s) => s.aspectRatio);
  const fps = useControlsStore((s) => s.fps);
  const clipDuration = useClipStore((s) => s.clipDuration);
  const clipCount = useClipStore((s) => s.clips.length);
  // The engine knows the canvas in pixels once it holds the project.
  const canvas = useEnginePreviewStore((s) => (s.project ? `${s.project.width} × ${s.project.height}` : null));

  const rows: [string, string][] = [
    ["Name", project?.name ?? ""],
    ["Canvas", `${aspect.id === "custom" ? `${aspect.width}:${aspect.height}` : aspect.id}${canvas ? `, ${canvas}` : ""}`],
    ["Frame rate", `${fps} fps`],
    ["Length", length(clipDuration, fps)],
    ["Clips", String(clipCount)],
  ];

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="h-9 shrink-0 flex items-center px-4 border-b border-brand-light/[0.06]">
        <span className="text-[11.5px] text-brand-light">Project</span>
      </div>
      <dl className="flex flex-col gap-2.5 p-4">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-3 min-w-0">
            <dt className="w-20 shrink-0 text-left text-[11px] text-brand-light/45">{k}</dt>
            <dd className="text-left text-[11px] text-brand-light/90 truncate tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 pb-10 text-brand-light/40">
        <LuMousePointerClick className="h-5 w-5" />
        <p className="text-[11px]">Select a clip on the timeline to edit it</p>
      </div>
    </div>
  );
};

export default EmptyPropertiesPanel;
