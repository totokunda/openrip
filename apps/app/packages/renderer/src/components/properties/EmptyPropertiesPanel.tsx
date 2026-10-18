import React, { useState } from "react";
import { LuFolderOpen, LuMousePointerClick } from "react-icons/lu";
import { useProjectsStore } from "@/lib/projects";
import { useViewportStore } from "@/lib/viewport";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { useEnginePreviewStore } from "@/lib/engine-preview";
import { timecode } from "@/components/preview/PlayerBar";
import { revealPathInFolder } from "@app/preload";
import { cn } from "@/lib/utils";

const when = (ms?: number) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");

/**
 * With nothing selected the inspector shows the project, as CapCut's does: its canvas, frame
 * rate and length (Project), and where it's saved and when (Details).
 */
const EmptyPropertiesPanel: React.FC = () => {
  const [tab, setTab] = useState<"project" | "details">("project");
  const project = useProjectsStore((s) => s.getActiveProject());
  const aspect = useViewportStore((s) => s.aspectRatio);
  const fps = useControlsStore((s) => s.fps);
  const clipDuration = useClipStore((s) => s.clipDuration);
  const clipCount = useClipStore((s) => s.clips.length);
  const mediaCount = useClipStore((s) => Object.keys(s.assets).length);
  // The engine knows the canvas in pixels once it holds the project.
  const canvas = useEnginePreviewStore((s) => (s.project ? `${s.project.width} × ${s.project.height}` : null));

  const rows: [string, React.ReactNode][] =
    tab === "project"
      ? [
          ["Name", project?.name ?? ""],
          ["Ratio", aspect.id === "custom" ? `${aspect.width}:${aspect.height}` : aspect.id],
          ["Canvas", canvas ?? "–"],
          ["Frame rate", `${fps} fps`],
          ["Length", timecode(clipDuration, fps)],
          ["Clips", String(clipCount)],
        ]
      : [
          [
            "Saved at",
            project?.filePath ? (
              <button
                type="button"
                title="Show the file"
                onClick={() => void revealPathInFolder(project.filePath!)}
                className="flex items-start gap-1.5 text-left break-all whitespace-normal hover:text-brand-light cursor-pointer"
              >
                <LuFolderOpen className="w-3.5 h-3.5 shrink-0 mt-px" />
                {project.filePath}
              </button>
            ) : (
              "–"
            ),
          ],
          ["Created", when(project?.createdAt)],
          ["Edited", when(project?.lastModified)],
          ["Media used", String(mediaCount)],
        ];

  const tabButton = (id: "project" | "details", label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      data-testid={`inspector-${id}-tab`}
      className={cn(
        "relative h-9 px-3 text-[12.5px] transition-colors cursor-pointer",
        "after:absolute after:left-3 after:right-3 after:bottom-0 after:h-[2px] after:rounded-full",
        tab === id ? "text-brand-light after:bg-brand-accent" : "text-brand-light/55 hover:text-brand-light after:bg-transparent",
      )}
    >
      {label}
    </button>
  );

  return (
    <div data-testid="inspector-project" className="flex flex-col h-full min-w-0">
      <div className="h-9 shrink-0 flex items-center px-1 border-b border-brand-light/[0.06]">
        {tabButton("project", "Project")}
        {tabButton("details", "Details")}
      </div>
      <dl className="flex flex-col gap-3 p-4">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-3 min-w-0">
            <dt className="w-20 shrink-0 text-left text-[12px] text-brand-light/45">{k}</dt>
            <dd className="min-w-0 text-left text-[12px] text-brand-light/90 tabular-nums truncate">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 pb-10 text-brand-light/40">
        <LuMousePointerClick className="h-5 w-5" />
        <p className="text-[12px]">Select a clip on the timeline to edit it</p>
      </div>
    </div>
  );
};

export default EmptyPropertiesPanel;
