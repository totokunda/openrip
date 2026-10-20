// The open project's settings (the inspector's Modify), as CapCut's (docs/plan/capcut-ui-spec.md
// §6.16): Details (name, where it's saved, imported media, colour space, layers; then the
// timeline's aspect ratio, resolution and frame rate) and Performance (proxies). Changes wait
// for Save; the canvas and frame rate go through the stores, so they undo as one step and are
// saved in the project. Rows OpenRip can't honour are shown disabled with a note.
import React, { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { getProjectsDir, pickFolder, setProjectsDir } from "@app/preload";
import { cn } from "@/lib/utils";
import { useControlsStore } from "@/lib/control";
import { useViewportStore } from "@/lib/viewport";
import { useProjectsStore } from "@/lib/projects";
import { useClipStore } from "@/lib/clip";
import { FRAME_RATES } from "@/lib/preferences";
import { ASPECT_ID_ORIGINAL, PROJECT_ASPECTS, adaptedSize, currentCanvasSize, MAX_SIDE, MIN_SIDE, originalRatio, ratioForChoice, ratioLabel, ratioOfSize } from "@/lib/project-canvas";
import { ratioBox } from "@/lib/aspect-presets";
import { refreshProjects, renameProject } from "@/lib/project-actions";
import { copyMediaFor, setCopyMedia } from "@/lib/media/copy-mode";
import { Choice, Divider, NotYet, PathField, Radio, Row, Stepper, Tip, Toggle } from "./settings/controls";

type Tab = "details" | "performance";

const Shape: React.FC<{ width: number; height: number }> = ({ width, height }) => (
  <span className="block rounded-[2px] border border-current" style={ratioBox(width, height, 12)} />
);

const sectionLabel = "text-[12px] text-[#7a7a7a] text-left mb-3";

export const ProjectSettingsModal: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const project = useProjectsStore((s) => s.getActiveProject());
  const aspect = useViewportStore((s) => s.aspectRatio);
  const canvasSize = useViewportStore((s) => s.canvasSize);
  const fps = useControlsStore((s) => s.fps);
  const defaultClipLength = useControlsStore((s) => s.defaultClipLength);
  const arrangeOn = useClipStore((s) => s.arrangeLayers);
  const hasMedia = useClipStore((s) => s.clips.some((c) => c.type === "video" || c.type === "image"));

  const [tab, setTab] = useState<Tab>("details");
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const [savedDir, setSavedDir] = useState("");
  const [aspectId, setAspectId] = useState(aspect.id);
  const [custom, setCustom] = useState(false);
  const [size, setSize] = useState({ width: 1920, height: 1080 });
  const [projectFps, setProjectFps] = useState(fps || 24);
  const [clipSeconds, setClipSeconds] = useState(defaultClipLength || 5);
  const [copyMedia, setCopyMediaDraft] = useState(false);
  const [arrange, setArrange] = useState(true);
  const [busy, setBusy] = useState(false);

  // Each opening starts from the project's values.
  useEffect(() => {
    if (!open) return;
    setTab("details");
    setName(project?.name ?? "");
    setAspectId(aspect.id);
    setCustom(canvasSize != null);
    setSize(currentCanvasSize());
    setProjectFps(fps || 24);
    setClipSeconds(defaultClipLength || 5);
    setCopyMediaDraft(copyMediaFor(project?.folderUuid));
    setArrange(arrangeOn);
    void getProjectsDir().then((r) => {
      setDir(r.dir);
      setSavedDir(r.dir);
    });
    // Only on opening: the stores' values at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosenRatio = useMemo(() => ratioForChoice(aspectId, aspect), [aspectId, aspect]);

  const aspectOptions = useMemo(() => {
    const list = PROJECT_ASPECTS.map((a, i, all) => ({
      value: a.id,
      label: a.label,
      disabled: a.id === ASPECT_ID_ORIGINAL && !hasMedia,
      end: <Shape width={a.id === ASPECT_ID_ORIGINAL ? (originalRatio()?.width ?? a.width) : a.width} height={a.id === ASPECT_ID_ORIGINAL ? (originalRatio()?.height ?? a.height) : a.height} />,
      separatorAfter: a.id === ASPECT_ID_ORIGINAL || (a.landscape && !all[i + 1]?.landscape),
    }));
    // A size from the player's own Ratio menu or a custom one isn't in CapCut's list: it's shown as the current choice.
    if (!list.some((o) => o.value === aspectId)) list.unshift({ value: aspectId, label: aspectId === "custom" ? ratioLabel(chosenRatio) : aspectId, disabled: false, end: <Shape width={chosenRatio.width} height={chosenRatio.height} />, separatorAfter: false });
    return list;
  }, [aspectId, chosenRatio, hasMedia]);

  const rateOptions = useMemo(() => {
    const rates = FRAME_RATES.includes(projectFps) ? FRAME_RATES : [...FRAME_RATES, projectFps].sort((a, b) => a - b);
    return rates.map((r) => ({ value: r, label: `${r.toFixed(2)} fps` }));
  }, [projectFps]);

  const pickAspect = (id: string) => {
    setAspectId(id);
    // A custom size keeps its width and takes the new shape.
    if (custom) {
      const r = ratioForChoice(id, aspect);
      setSize((s) => ({ width: s.width, height: Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(s.width / (r.width / r.height)))) }));
    }
  };

  // Custom pixels: the aspect ratio follows the size (a preset's name when it matches one).
  const setPixels = (next: { width: number; height: number }) => {
    setSize(next);
    setAspectId(ratioOfSize(next.width, next.height).id);
  };

  const chooseResolution = (mode: "adapted" | "custom") => {
    if (mode === "custom") {
      setCustom(true);
      setSize(adaptedSize(chosenRatio));
    } else {
      setCustom(false);
    }
  };

  const onSave = async () => {
    setBusy(true);
    try {
      // The canvas and the frame rate, now, so they're one step of the undo history.
      let ratio = chosenRatio;
      let pixels: { width: number; height: number } | null = null;
      if (custom) {
        pixels = { width: Math.round(size.width), height: Math.round(size.height) };
        const fromSize = ratioOfSize(pixels.width, pixels.height);
        // The ratio the user chose, or the size's own when it says another.
        const fits = Math.abs(pixels.width / pixels.height / (ratio.width / ratio.height) - 1) < 0.005;
        ratio = fits ? ratio : fromSize;
      }
      const view = useViewportStore.getState();
      const sameRatio = view.aspectRatio.width === ratio.width && view.aspectRatio.height === ratio.height && view.aspectRatio.id === ratio.id;
      const sameSize = (view.canvasSize?.width ?? 0) === (pixels?.width ?? 0) && (view.canvasSize?.height ?? 0) === (pixels?.height ?? 0);
      if (!sameRatio || !sameSize) view.setCanvas(ratio, pixels);
      const controls = useControlsStore.getState();
      if (Number.isFinite(projectFps) && projectFps > 0 && projectFps !== controls.fps) controls.setFpsWithRescale(projectFps);
      if (clipSeconds > 0 && clipSeconds !== controls.defaultClipLength) controls.setDefaultClipLength(clipSeconds);

      if (copyMedia !== copyMediaFor(project?.folderUuid)) {
        const n = await setCopyMedia(project?.folderUuid, copyMedia);
        if (copyMedia) toast(n > 0 ? `Copied ${n} media file${n === 1 ? "" : "s"} into the project` : "New imports are copied into the project");
      }
      if (arrange && !arrangeOn) {
        useClipStore.getState().enableArrangeLayers();
        toast("Arrange layers is on: tracks can be put in any order");
      }
      if (project && name.trim() && name.trim() !== project.name) await renameProject(project, name);
      if (dir && dir !== savedDir) {
        const r = await setProjectsDir(dir);
        if (r.success) {
          toast(`Project moved to ${r.data.dir}`);
          await refreshProjects();
        } else {
          toast.error(r.error);
          return;
        }
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const well = "rounded-[6px] bg-brand-background-dark px-6";

  const detailsTab = (
    <div className={cn(well, "py-6")}>
      <p className={sectionLabel}>Details</p>
      <Row id="name" label="Name">
        <input
          data-testid="ps-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-[22px] w-full rounded-[4px] bg-[#343337] px-2 text-[12px] font-medium text-brand-lighter outline-none focus:ring-1 focus:ring-brand-accent/60"
        />
      </Row>
      <Row id="saveTo" label="Save to">
        <PathField
          testId="ps-save-to"
          value={dir}
          title="Choose the folder projects are kept in"
          onPick={async () => {
            const picked = await pickFolder({ title: "Save to", defaultPath: dir || undefined });
            if (picked) setDir(picked);
          }}
        />
      </Row>
      <Row id="importedMedia" label="Imported media">
        <Radio checked={copyMedia} onChange={() => setCopyMediaDraft(true)} testId="ps-copy-media">
          Copy media to project
        </Radio>
        <Radio checked={!copyMedia} onChange={() => setCopyMediaDraft(false)} testId="ps-stay-media">
          Stay in original location
        </Radio>
      </Row>
      <Row id="colorSpace" label="Color space">
        <Choice
          testId="ps-color-space"
          width={264}
          value="rec709"
          options={[
            { value: "rec709", label: "Rec. 709 SDR" },
            { value: "rec2020", label: "Rec. 2020 SDR", disabled: true },
            { value: "hlg", label: "Rec. 2100 HLG", disabled: true },
            { value: "pq", label: "Rec. 2100 PQ", disabled: true },
          ]}
          onChange={() => {}}
          footer="OpenRip edits and exports in Rec. 709 SDR; HLG footage is converted to it."
        />
      </Row>
      <Row id="arrangeLayers" label={<span className="inline-flex items-center gap-1">Arrange layers <Tip text="On, tracks can be put in any order, so a text track can sit under a video track. Off, they stay in bands by kind: text, stickers, effects, overlays, the main track, audio." /></span>}>
        <Toggle on={arrange} disabled={arrangeOn} onChange={setArrange} testId="ps-arrange-layers" />
        <p data-testid="ps-arrange-note" className="text-[12px] leading-[16px] text-[#e6b422]">*Cannot be turned off after turned on</p>
      </Row>
      <Divider />
      <p className={sectionLabel}>Timeline settings</p>
      <Row id="applyTo" label="Apply to">
        <span className="text-[12px] leading-[22px] text-brand-lighter">Timeline 01</span>
      </Row>
      <Row id="aspectRatio" label="Aspect ratio">
        <Choice testId="ps-aspect" width={264} menuWidth={240} value={aspectId} options={aspectOptions} onChange={pickAspect} />
      </Row>
      <Row id="resolution" label="Resolution">
        <Choice
          testId="ps-resolution"
          width={264}
          value={custom ? "custom" : "adapted"}
          options={[
            { value: "adapted", label: "Adapted" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(v) => chooseResolution(v)}
        />
        {custom && (
          <div className="flex items-center gap-2" data-testid="ps-pixels">
            <Stepper testId="ps-width" value={size.width} min={MIN_SIDE} max={MAX_SIDE} step={2} onChange={(v) => setPixels({ width: v, height: size.height })} />
            <span className="text-[12px] text-[#7a7a7a]">×</span>
            <Stepper testId="ps-height" value={size.height} min={MIN_SIDE} max={MAX_SIDE} step={2} onChange={(v) => setPixels({ width: size.width, height: v })} />
          </div>
        )}
      </Row>
      <Row id="frameRate" label={<span className="inline-flex items-center gap-1">Frame rate <Tip text="Changing the frame rate keeps every clip's place in time." /></span>}>
        <Choice testId="ps-fps" width={264} value={projectFps} options={rateOptions} onChange={setProjectFps} />
      </Row>
      <Row id="filterLength" label="Filter clip length">
        <Choice
          testId="ps-filter-length"
          width={264}
          value={clipSeconds}
          options={[3, 5, 10, 15, 30].map((v) => ({ value: v, label: `${v} s` }))}
          onChange={setClipSeconds}
        />
      </Row>
    </div>
  );

  const performanceTab = (
    <div className={cn(well, "py-6")}>
      <Row id="proxy" label="Proxy" disabled>
        <Toggle on={false} disabled testId="ps-proxy" />
      </Row>
      <Row id="proxyResolution" label="Resolution" disabled>
        <Choice
          testId="ps-proxy-resolution"
          width={264}
          disabled
          value="720"
          options={[
            { value: "720", label: "720P" },
            { value: "540", label: "540P" },
          ]}
          onChange={() => {}}
        />
        <NotYet>OpenRip plays the original media through its engine, so proxies aren't used.</NotYet>
      </Row>
    </div>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <DialogPrimitive.Content
          data-testid="project-settings"
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[512px] max-h-[calc(100vh-24px)] flex flex-col rounded-[12px] border border-[#3c3c3c] bg-brand-background shadow-[0_16px_48px_rgba(0,0,0,0.55)] font-poppins outline-none select-none"
        >
          <DialogPrimitive.Title className="h-[34px] shrink-0 px-[10px] flex items-center text-[13px] font-semibold text-brand-lighter border-b border-brand-divider">
            Project settings
          </DialogPrimitive.Title>
          <div className="px-[15px] pt-[14px] shrink-0">
            <div role="tablist" className="h-6 rounded-[4px] bg-brand grid grid-cols-2">
              {(["details", "performance"] as Tab[]).map((id) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  data-testid={`ps-tab-${id}`}
                  onClick={() => setTab(id)}
                  className={cn("h-6 rounded-[4px] text-[12px] font-semibold cursor-pointer capitalize", tab === id ? "bg-brand-background-light text-brand-lighter" : "text-brand-light hover:text-brand-lighter")}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>
          <div data-testid={`ps-panel-${tab}`} className="mx-[15px] mt-[14px] max-h-[min(602px,calc(100vh-180px))] overflow-y-auto overflow-x-hidden custom-scrollbar rounded-[6px]">
            {tab === "details" ? detailsTab : performanceTab}
          </div>
          <div className="shrink-0 flex gap-2 px-[15px] pt-[14px] pb-[15px]">
            <button type="button" data-testid="ps-cancel" onClick={() => onOpenChange(false)} className="h-7 flex-1 rounded-[4px] bg-brand-button text-[13px] font-semibold text-brand-lighter hover:bg-[#5a5a5a] cursor-pointer">
              Cancel
            </button>
            <button type="button" data-testid="ps-save" disabled={busy || !name.trim()} onClick={() => void onSave()} className="h-7 flex-1 rounded-[4px] bg-brand-accent text-[13px] font-semibold text-white hover:bg-brand-accent-shade disabled:opacity-60 cursor-pointer">
              Save
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default ProjectSettingsModal;
