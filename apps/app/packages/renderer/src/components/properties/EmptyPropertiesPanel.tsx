import React, { useEffect } from "react";
import { useProjectsStore } from "@/lib/projects";
import { useViewportStore } from "@/lib/viewport";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { useEnginePreviewStore } from "@/lib/engine-preview";
import { useShellStore } from "@/lib/shell";
import { timecode } from "@/components/preview/PlayerBar";
import { usePreference } from "@/lib/preferences";
import { revealPathInFolder } from "@app/preload";
import { refreshProjects } from "@/lib/project-actions";
import GlobalEdits, { useProjectInspectorTab } from "./project/GlobalEdits";

/**
 * With nothing selected the inspector shows the project, as CapCut's does, in two tabs:
 * Project (its global edits, project/GlobalEdits.tsx) and Details: a label and value grid in
 * two groups (the project; its canvas and timing), and Modify, which opens the project's
 * settings.
 */
const EmptyPropertiesPanel: React.FC = () => {
  const project = useProjectsStore((s) => s.getActiveProject());
  const aspect = useViewportStore((s) => s.aspectRatio);
  const fps = useControlsStore((s) => s.fps);
  const clipDuration = useClipStore((s) => s.clipDuration);
  const clipCount = useClipStore((s) => s.clips.length);
  const mediaCount = useClipStore((s) => Object.keys(s.assets).length);
  const setProjectSettingsOpen = useShellStore((s) => s.setProjectSettingsOpen);
  const timeCodeStyle = usePreference("timeCode");
  // A project made in this session (new, or from a CapCut draft) learns its file from the list.
  useEffect(() => {
    if (project && !project.filePath) void refreshProjects();
  }, [project?.id, project?.filePath]);
  // The engine knows the canvas in pixels once it holds the project.
  const canvas = useEnginePreviewStore((s) => (s.project ? `${s.project.width} × ${s.project.height}` : null));

  const groups: [string, React.ReactNode][][] = [
    [
      ["Name:", project?.name ?? ""],
      [
        "Path:",
        project?.filePath ? (
          <button
            type="button"
            title="Show the file"
            onClick={() => void revealPathInFolder(project.filePath!)}
            className="text-left break-all whitespace-normal hover:underline cursor-pointer"
          >
            {project.filePath}
          </button>
        ) : (
          "–"
        ),
      ],
      ["Imported media:", "Linked where it is"],
      ["Media used:", String(mediaCount)],
    ],
    [
      ["Aspect ratio:", aspect.id === "custom" ? `${aspect.width}:${aspect.height}` : aspect.id],
      ["Resolution:", canvas ?? "–"],
      ["Frame rate:", `${fps.toFixed(2)}fps`],
      ["Length:", timecode(clipDuration, fps, timeCodeStyle)],
      ["Clips:", String(clipCount)],
    ],
  ];

  // CapCut's two tabs: Project (global edits) and Details.
  const tab = useProjectInspectorTab((s) => s.tab);
  const tabButton = (id: "project" | "details", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      data-testid={`project-tab-${id}`}
      onClick={() => useProjectInspectorTab.setState({ tab: id })}
      className={`h-full px-[13px] first:pl-[11px] text-[13px] font-semibold ${tab === id ? "text-brand-accent" : "text-brand-light hover:text-brand-lighter"}`}
    >
      {label}
    </button>
  );

  return (
    <div data-testid="inspector-project" className="flex flex-col h-full min-w-0">
      <div role="tablist" className="h-[42px] shrink-0 flex items-center bg-brand-header border-b-[0.5px] border-brand-hairline">
        {tabButton("project", "Project")}
        {tabButton("details", "Details")}
      </div>
      {tab === "project" ? (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <GlobalEdits />
        </div>
      ) : (
      <>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3">
        {groups.map((rows, i) => (
          <dl key={i} className="py-3 border-b border-brand-divider last:border-b-0">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] items-start py-[7px]">
                <dt className="text-left text-[12px] text-[#7a7a7a]">{k}</dt>
                <dd className="min-w-0 text-left text-[13px] text-[#cccccc] tabular-nums break-words">{v}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
      <div className="h-9 shrink-0 flex items-center justify-end px-3 bg-brand-header">
        <button
          type="button"
          data-testid="project-modify"
          onClick={() => setProjectSettingsOpen(true)}
          className="h-5 w-[72px] rounded-[4px] bg-brand-button hover:bg-brand-hover text-[12px] font-semibold text-brand-lighter transition-colors cursor-pointer"
        >
          Modify
        </button>
      </div>
      </>
      )}
    </div>
  );
};

export default EmptyPropertiesPanel;
