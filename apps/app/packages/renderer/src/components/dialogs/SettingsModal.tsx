import React, { useEffect, useState } from "react";
import { LuSettings } from "react-icons/lu";
import { LuLoader } from "react-icons/lu";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  type AppUpdateEvent,
  type AppUpdateState,
  checkForAppUpdates,
  downloadAppUpdate,
  getAppUpdateState,
  installAppUpdate,
  onAppUpdateEvent,
} from "@app/preload";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useControlsStore } from "@/lib/control";
import { Checkbox } from "@/components/ui/checkbox";
import { useEnginePreviewStore } from "@/lib/engine-preview";

import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
  } from "@/components/ui/tabs";
import { formatErrMessage, looksLikeSslCertError } from "@/lib/formatErrMessage";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const fieldLabelClass =
  "text-brand-light text-[10.5px] font-medium mb-1 flex flex-col gap-1";

function InlineUpdateError({
  message,
  expanded,
  onToggle,
}: {
  message: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const raw = String(message || "").trim();
  const summary = formatErrMessage(raw, { maxLen: 220 });
  const hasDetails = raw.length > 220 || raw.includes("\n");
  const isSsl = looksLikeSslCertError(raw);

  return (
    <div className="text-[10px] text-red-400">
      <div>{summary}</div>
      {isSsl ? (
        <div className="mt-1 text-[10px] text-brand-light/60">
          SSL certificate verification failed. If you&apos;re behind a proxy, install your root CA / configure your
          system certificates (Windows Update can refresh root certs).
        </div>
      ) : null}

      {hasDetails ? (
        <button
          type="button"
          className="mt-1 text-[10px] text-brand-light/70 underline underline-offset-2 hover:text-brand-light"
          onClick={onToggle}
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      ) : null}

      {expanded ? (
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/30 p-2 text-[9.5px] leading-snug text-brand-light/70">
          {raw}
        </pre>
      ) : null}
    </div>
  );
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onOpenChange,
}) => {
  const controlsFps = useControlsStore((s) => s.fps);
  const setGlobalFpsWithRescale = useControlsStore((s) => s.setFpsWithRescale);
  const setGlobalDefaultClipLength = useControlsStore(
    (s) => s.setDefaultClipLength,
  );

  const engineEnabled = useEnginePreviewStore((s) => s.enabled);
  const engineInfoState = useEnginePreviewStore((s) => s.info);
  const engineProject = useEnginePreviewStore((s) => s.project);
  const engineError = useEnginePreviewStore((s) => s.error);
  const setEngineEnabled = useEnginePreviewStore((s) => s.setEnabled);
  const [projectFps, setProjectFps] = useState<string>(
    String(controlsFps || 24),
  );
  const [defaultClipSeconds, setDefaultClipSeconds] = useState<string>("5");

  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(
    null,
  );
  const [isCheckingAppUpdate, setIsCheckingAppUpdate] =
    useState<boolean>(false);
  const [isDownloadingAppUpdate, setIsDownloadingAppUpdate] =
    useState<boolean>(false);
  const [isInstallingAppUpdate, setIsInstallingAppUpdate] =
    useState<boolean>(false);
  const [appUpdateErrorExpanded, setAppUpdateErrorExpanded] =
    useState<boolean>(false);

  const refreshAppUpdate = async () => {
    try {
      const st = await getAppUpdateState();
      setAppUpdateState(st);
    } catch {
      // ignore
    }
  };

  const handleCheckAppUpdate = async () => {
    setIsCheckingAppUpdate(true);
    try {
      await checkForAppUpdates();
      await refreshAppUpdate();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to check for app updates.";
      toast.error(formatErrMessage(msg), {
        description: looksLikeSslCertError(msg)
          ? "SSL certificate verification failed. If you're behind a corporate proxy, install your root CA / configure system certificates."
          : undefined,
      });
    } finally {
      setIsCheckingAppUpdate(false);
    }
  };

  const handleDownloadAppUpdate = async () => {
    setIsDownloadingAppUpdate(true);
    try {
      await downloadAppUpdate();
      await refreshAppUpdate();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to download update.";
      toast.error(formatErrMessage(msg), {
        description: looksLikeSslCertError(msg)
          ? "SSL certificate verification failed. Check your system certificate store / proxy configuration."
          : undefined,
      });
    } finally {
      setIsDownloadingAppUpdate(false);
    }
  };

  const handleInstallAppUpdate = async () => {
    setIsInstallingAppUpdate(true);
    try {
      await installAppUpdate();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to restart and install.";
      toast.error(formatErrMessage(msg));
      setIsInstallingAppUpdate(false);
    }
  };

  // Collapse error details when the underlying error clears/changes.
  useEffect(() => {
    if (!appUpdateState?.errorMessage) setAppUpdateErrorExpanded(false);
  }, [appUpdateState?.errorMessage]);

  const updateStatusLabel = (lastCheckedAt?: number) => {
    if (!lastCheckedAt) return null;
    try {
      return new Date(lastCheckedAt).toLocaleString();
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const offApp = onAppUpdateEvent((_ev: AppUpdateEvent) => {
      if (cancelled) return;
      void refreshAppUpdate();
    });

    void refreshAppUpdate();

    return () => {
      cancelled = true;
      try {
        offApp();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>

      <DialogContent className="w-full max-w-xl dark p-0 h-[500px] gap-0 space-y-0 items-start flex flex-col">
        <DialogTitle className="text-brand-light font-poppins text-xs font-medium px-5 pt-4 h-fit">
            Settings
        </DialogTitle>
        <Tabs defaultValue="project" className="p-5 pt-0 mt-5 w-full flex-1 flex flex-col overflow-hidden">
          <TabsList className="font-poppins text-brand-light/90 dark gap-1 mb-1.5 w-full ">
          <TabsTrigger
              className="data-[state=active]:bg-brand-light/10 data-[state=active]:text-brand-light text-[11px] rounded-[6px] px-2 py-1 w-full!"
              value="project"
            >
             Project
            </TabsTrigger>
            <TabsTrigger
              className="data-[state=active]:bg-brand-light/10 data-[state=active]:text-brand-light text-[11px] rounded-[6px] px-2 py-1 w-full!"
              value="engine"
            >
              Engine
            </TabsTrigger>
            <TabsTrigger
              className="data-[state=active]:bg-brand-light/10 data-[state=active]:text-brand-light text-[11px] rounded-[6px] px-2 py-1 w-full!"
              value="updates"
            >
              Updates
            </TabsTrigger>
          </TabsList>
          <div className="flex-1 overflow-y-auto pb-8 mb-12 pr-2.5 custom-scrollbar">
          <TabsContent value="project">
            <div className="flex flex-col gap-4 font-poppins text-brand-light ">
              <div className="flex flex-col gap-1">
                <label className={fieldLabelClass}>
                  <span>Project FPS</span>
                  <span className="text-[10px] text-brand-light/60 font-normal">
                    The current FPS of the project.
                  </span>
                </label>
                <Select
                  value={projectFps}
                  onValueChange={(value) => {
                    setProjectFps(value);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full h-7.5! text-[11px] bg-brand-background/70 rounded-[6px]"
                  >
                    <SelectValue placeholder="Select FPS" />
                  </SelectTrigger>
                  <SelectContent className="bg-brand-background text-brand-light font-poppins z-101 dark">
                    <SelectItem value="24" className="text-[11px] font-medium">
                      24 FPS
                    </SelectItem>
                    <SelectItem value="25" className="text-[11px] font-medium">
                      25 FPS
                    </SelectItem>
                    <SelectItem value="30" className="text-[11px] font-medium">
                      30 FPS
                    </SelectItem>
                    <SelectItem value="48" className="text-[11px] font-medium">
                      48 FPS
                    </SelectItem>
                    <SelectItem value="60" className="text-[11px] font-medium">
                      60 FPS
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <label className={fieldLabelClass} >
                  <span>Default Clip Length</span>
                  <span className="text-[10px] text-brand-light/60 font-normal">
                    For image, text, shape, and filter clips.
                  </span>
                </label>
                <Select
                  value={defaultClipSeconds}
                  onValueChange={(value) => {
                    setDefaultClipSeconds(value);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full h-7.5! text-[11px] bg-brand-background/70 rounded-[6px]"
                  >
                    <SelectValue placeholder="Select duration" />
                  </SelectTrigger>
                  <SelectContent className="bg-brand-background text-brand-light font-poppins z-101 dark">
                    <SelectItem value="3" className="text-[11px] font-medium">
                      3 seconds
                    </SelectItem>
                    <SelectItem value="5" className="text-[11px] font-medium">
                      5 seconds
                    </SelectItem>
                    <SelectItem value="10" className="text-[11px] font-medium">
                      10 seconds
                    </SelectItem>
                    <SelectItem value="15" className="text-[11px] font-medium">
                      15 seconds
                    </SelectItem>
                    <SelectItem value="30" className="text-[11px] font-medium">
                      30 seconds
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="engine">
            <div className="flex flex-col gap-4 font-poppins text-brand-light">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  className="mt-0.5"
                  checked={engineEnabled}
                  disabled={!engineInfoState?.available}
                  onCheckedChange={(v) => setEngineEnabled(v === true)}
                />
                <span className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium">Use the Rust engine for the preview</span>
                  <span className="text-[10px] text-brand-light/60 font-normal">
                    Draws video, photos and text with OpenRip's native engine. Shapes, drawings and
                    masks are still drawn by the app's own renderer, and filters from the Filters panel
                    don't show yet.
                  </span>
                </span>
              </label>
              <div className="text-[10px] text-brand-light/60 rounded-lg border border-brand-light/10 bg-brand-light/5 p-3 flex flex-col gap-1">
                <span>
                  Engine:{" "}
                  <span className="text-brand-light/85">
                    {engineInfoState == null
                      ? "checking…"
                      : engineInfoState.available
                        ? `openrip-node ${engineInfoState.version}`
                        : `not available (${engineInfoState.error ?? "unknown"})`}
                  </span>
                </span>
                {engineEnabled && engineProject ? (
                  <span>
                    Drawing: {engineProject.width}×{engineProject.height} at {engineProject.fps} fps
                  </span>
                ) : null}
                {engineEnabled && engineError ? <span className="text-red-400/80">{engineError}</span> : null}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="updates">
            <div className="flex flex-col gap-5 font-poppins text-brand-light h-full">
              <div className="flex flex-col gap-2 rounded-lg border border-brand-light/10 bg-brand-light/5 p-3">
                <div className="text-[11px] text-brand-light/80 font-medium">
                  App Update
                </div>
                <div className="text-[10px] text-brand-light/60">
                  Status:{" "}
                  <span className="text-brand-light/85">
                    {appUpdateState?.status || "unknown"}
                  </span>
                  {appUpdateState?.lastCheckedAt ? (
                    <span className="text-brand-light/40">
                      {" "}
                      • Last checked:{" "}
                      {updateStatusLabel(appUpdateState.lastCheckedAt) || "—"}
                    </span>
                  ) : null}
                </div>
                {appUpdateState?.errorMessage ? (
                  <InlineUpdateError
                    message={appUpdateState.errorMessage}
                    expanded={appUpdateErrorExpanded}
                    onToggle={() => setAppUpdateErrorExpanded((v) => !v)}
                  />
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-7.5 px-3 text-[10.5px] font-medium border-brand-light/20 bg-brand hover:bg-brand-background/80 rounded-[6px] flex items-center gap-1.5"
                    onClick={() => void handleCheckAppUpdate()}
                    disabled={isCheckingAppUpdate}
                  >
                    {isCheckingAppUpdate ? (
                      <LuLoader className="w-3.5 h-3.5 text-brand-light/70 animate-spin" />
                    ) : null}
                    Check
                  </Button>

                  {appUpdateState?.status === "available" && (
                    <Button
                      type="button"
                      className="h-7.5 px-3 text-[10.5px] font-medium bg-brand-accent hover:bg-brand-accent-two-shade text-brand-light rounded-[6px] flex items-center gap-1.5"
                      onClick={() => void handleDownloadAppUpdate()}
                      disabled={isDownloadingAppUpdate}
                    >
                      {isDownloadingAppUpdate ? (
                        <LuLoader className="w-3.5 h-3.5 text-brand-light/70 animate-spin" />
                      ) : null}
                      Download
                    </Button>
                  )}

                  {appUpdateState?.status === "downloaded" && (
                    <Button
                      type="button"
                      className="h-7.5 px-3 text-[10.5px] font-medium bg-brand-accent hover:bg-brand-accent-two-shade text-brand-light rounded-[6px] flex items-center gap-1.5"
                      onClick={() => void handleInstallAppUpdate()}
                      disabled={isInstallingAppUpdate}
                    >
                      {isInstallingAppUpdate ? (
                        <LuLoader className="w-3.5 h-3.5 text-brand-light/70 animate-spin" />
                      ) : null}
                      Restart to install
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
          </div>
        </Tabs>
        <div className="px-4 py-3 border-t bg-brand-background rounded-b-[8px] border-brand-light/10 h-16 flex items-center justify-end gap-2 absolute bottom-0 left-0 right-0">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-4 text-[11px] w-full font-medium bg-brand-light/5 hover:bg-brand-light/10 rounded-[6px] text-brand-light font-poppins"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="h-8 px-5 w-full bg-brand-accent hover:bg-brand-accent-two-shade text-brand-light font-poppins text-[11px] font-medium rounded-[6px] border border-brand-accent-two-shade"
            onClick={() => {
              const fpsNumeric = Number(projectFps);
              if (Number.isFinite(fpsNumeric) && fpsNumeric > 0) {
                setGlobalFpsWithRescale(fpsNumeric);
              }
              const defaultLen = Number(defaultClipSeconds);
              if (Number.isFinite(defaultLen) && defaultLen > 0) {
                setGlobalDefaultClipLength(defaultLen);
              }
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </div>
      </DialogContent>
      <button
        onClick={() => onOpenChange(true)}
        className="text-brand-light/90 dark w-8 h-8 flex items-center justify-center rounded-[6px] hover:text-brand-light border border-brand-light/10 bg-brand hover:bg-brand-light/10 transition-all duration-300 cursor-pointer"
      >
        <LuSettings className="w-4 h-4" />
      </button>
    </Dialog>
  )
}