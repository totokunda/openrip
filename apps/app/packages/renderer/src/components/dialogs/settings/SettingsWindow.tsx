// The Settings window, as CapCut's (docs/plan/capcut-ui-spec.md, the Settings row of §4.14 and
// §6.3): 510×753, the tabs Draft, Edit, Performance and General over a dark well of rows, and
// Cancel and Save. Changes wait for Save (Cancel drops them); clearing the cache happens at
// once. Each row acts where the app does it (lib/preferences.ts lists where); rows OpenRip
// can't honour yet are shown disabled with a note, and CapCut's cloud and account rows (Download
// to, Auto sync, Synced items, Default space, Size limit, Dreamina sync) are left out.
import React, { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  checkForAppUpdates,
  clearCache,
  downloadAppUpdate,
  getAppPaths,
  getAppUpdateState,
  getCacheSize,
  getProjectsDir,
  getProxySize,
  installAppUpdate,
  onAppUpdateEvent,
  pickFolder,
  setProjectsDir,
  type AppUpdateState,
} from "@app/preload";
import { cn } from "@/lib/utils";
import { CACHE_AGES, FRAME_RATES, TARGET_LOUDNESS, usePreferencesStore, type Preferences } from "@/lib/preferences";
import { LANGUAGES, useT } from "@/lib/i18n";
import { useEnginePreviewStore } from "@/lib/engine-preview";
import { refreshProjects } from "@/lib/project-actions";
import { Check, Choice, Divider, Help, NotYet, PathField, Radio, Row, SizeClear, SmallButton, Stepper, Tip, Toggle } from "./controls";

type Tab = "draft" | "edit" | "performance" | "general";
const TABS: Tab[] = ["draft", "edit", "performance", "general"];

/** The part of the preferences the window changed. */
const changes = (from: Preferences, to: Preferences): Partial<Preferences> => {
  const out: Partial<Preferences> = {};
  for (const k of Object.keys(to) as (keyof Preferences)[]) {
    if (JSON.stringify(from[k]) !== JSON.stringify(to[k])) (out as any)[k] = to[k];
  }
  return out;
};

export const SettingsWindow: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const t = useT();
  const prefs = usePreferencesStore((s) => s.prefs);
  const save = usePreferencesStore((s) => s.save);
  const engineEnabled = useEnginePreviewStore((s) => s.enabled);
  const engineInfo = useEnginePreviewStore((s) => s.info);
  const setEngineEnabled = useEnginePreviewStore((s) => s.setEnabled);

  const [tab, setTab] = useState<Tab>("draft");
  const [draft, setDraft] = useState<Preferences>(prefs);
  const [projectsDir, setProjectsDirDraft] = useState("");
  const [savedProjectsDir, setSavedProjectsDir] = useState("");
  const [engineDraft, setEngineDraft] = useState(engineEnabled);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [proxyBytes, setProxyBytes] = useState<number | null>(null);
  const [mediaDir, setMediaDir] = useState("");
  const [update, setUpdate] = useState<AppUpdateState | null>(null);
  const [busy, setBusy] = useState(false);

  // Each opening starts from what's saved.
  useEffect(() => {
    if (!open) return;
    setDraft(usePreferencesStore.getState().prefs);
    setEngineDraft(useEnginePreviewStore.getState().enabled);
    setCacheBytes(null);
    setProxyBytes(null);
    void getProjectsDir().then((r) => {
      setProjectsDirDraft(r.dir);
      setSavedProjectsDir(r.dir);
    });
    void getCacheSize().then(setCacheBytes);
    void getProxySize().then(setProxyBytes);
    void getAppPaths().then((p) => setMediaDir(p.media));
    void getAppUpdateState().then(setUpdate).catch(() => {});
    const off = onAppUpdateEvent(() => void getAppUpdateState().then(setUpdate).catch(() => {}));
    return () => off();
  }, [open]);

  const set = <K extends keyof Preferences>(k: K, v: Preferences[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const onSave = async () => {
    setBusy(true);
    try {
      const patch = changes(prefs, draft);
      if (Object.keys(patch).length) await save(patch);
      if (engineDraft !== engineEnabled) setEngineEnabled(engineDraft);
      if (projectsDir && projectsDir !== savedProjectsDir) {
        const r = await setProjectsDir(projectsDir);
        if (r.success) {
          toast(t("settings.saveTo.moved", { dir: r.data.dir }));
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

  const fpsOptions = useMemo(() => FRAME_RATES.map((f) => ({ value: f, label: t("settings.fps", { fps: f.toFixed(2) }) })), [t]);

  // Edit › Image duration's unit: the value carries over (at the frame rate new projects get).
  const switchImageUnit = (unit: Preferences["imageDurationUnit"]) => {
    if (unit === draft.imageDurationUnit) return;
    const fps = draft.frameRate || 24;
    const v = unit === "frames" ? Math.max(1, Math.round(draft.imageDuration * fps)) : Math.max(0.1, Math.round((draft.imageDuration / fps) * 10) / 10);
    setDraft((d) => ({ ...d, imageDurationUnit: unit, imageDuration: v }));
  };

  const well = "rounded-[6px] bg-brand-background-dark px-6";

  const draftTab = (
    <div className={cn(well, "py-6")}>
      <Row id="saveTo" label={t("settings.saveTo")}>
        <PathField
          testId="settings-save-to"
          value={projectsDir}
          title={t("settings.chooseFolder")}
          onPick={async () => {
            const dir = await pickFolder({ title: t("settings.saveTo"), defaultPath: projectsDir || undefined });
            if (dir) setProjectsDirDraft(dir);
          }}
        />
      </Row>
      <Row id="screenRecording" label={t("settings.screenRecording")} disabled>
        <PathField value="" disabled />
        <NotYet>{t("settings.screenRecording.note")}</NotYet>
      </Row>
      <Row id="cache" label={t("settings.cache")}>
        <Radio testId="settings-cache-keep" checked={!draft.cacheAutoDelete} onChange={() => set("cacheAutoDelete", false)}>
          {t("settings.cache.keep")}
        </Radio>
        <div className="flex items-center gap-2 mt-2">
          <Radio testId="settings-cache-auto" checked={draft.cacheAutoDelete} onChange={() => set("cacheAutoDelete", true)}>
            {t("settings.cache.autoDelete")}
          </Radio>
          <Choice testId="settings-cache-age" width={70} value={draft.cacheMaxAgeDays} options={CACHE_AGES.map((d) => ({ value: d, label: String(d) }))} onChange={(v) => setDraft((d) => ({ ...d, cacheMaxAgeDays: v, cacheAutoDelete: true }))} />
          <span className="text-[12px] font-medium text-brand-lighter">{t("settings.cache.daysAgo")}</span>
        </div>
      </Row>
      <Row id="cacheSize" label={t("settings.cacheSize")}>
        <SizeClear
          testId="settings-cache-size"
          bytes={cacheBytes}
          title={t("settings.cacheSize.clear")}
          onClear={async () => {
            setCacheBytes(null);
            setCacheBytes(await clearCache());
          }}
        />
      </Row>
      <Divider />
      <Row id="presetPath" label={t("settings.presetPath")} disabled>
        <PathField value="" disabled />
        <NotYet>{t("settings.presetPath.note")}</NotYet>
      </Row>
    </div>
  );

  const editTab = (
    <div className={cn(well, "py-6")}>
      <Row id="stepMany" label={t("settings.stepMany")}>
        <div className="flex items-center gap-2.5">
          <Stepper testId="settings-step-frames" value={draft.stepFrames} min={1} max={300} onChange={(v) => set("stepFrames", v)} />
          <span className="text-[12px] font-medium text-brand-lighter">{t("settings.frames")}</span>
        </div>
      </Row>
      <Row id="adjustMany" label={t("settings.adjustMany")}>
        <div className="flex items-center gap-2.5">
          <Stepper testId="settings-adjust-units" value={draft.adjustUnits} min={1} max={100} onChange={(v) => set("adjustUnits", v)} />
          <span className="text-[12px] font-medium text-brand-lighter">{t("settings.units")}</span>
        </div>
      </Row>
      <Row id="imageDuration" label={t("settings.imageDuration")}>
        <div className="flex items-center gap-1">
          {draft.imageDurationUnit === "s" ? (
            <Stepper testId="settings-image-duration" value={draft.imageDuration} step={0.1} decimals={1} min={0.1} max={600} onChange={(v) => set("imageDuration", v)} />
          ) : (
            <Stepper testId="settings-image-duration" value={draft.imageDuration} step={1} min={1} max={36000} onChange={(v) => set("imageDuration", v)} />
          )}
          <Choice
            testId="settings-image-unit"
            width={78}
            value={draft.imageDurationUnit}
            options={[
              { value: "s", label: t("settings.unit.s") },
              { value: "frames", label: t("settings.unit.frames") },
            ]}
            onChange={switchImageUnit}
          />
        </div>
      </Row>
      <Row id="targetLoudness" label={t("settings.targetLoudness")}>
        <Choice testId="settings-loudness" value={draft.targetLoudness} options={TARGET_LOUDNESS.map((o) => ({ value: o.lufs, label: t(o.key) }))} onChange={(v) => set("targetLoudness", v)} />
      </Row>
      <Divider />
      <Row id="scrubAudio" label={t("settings.scrubAudio")} disabled>
        <Toggle on={false} disabled />
        <Help muted>{t("settings.scrubAudio.help")}</Help>
        <NotYet>{t("settings.notYet")}</NotYet>
      </Row>
      <Row id="linkage" label={t("settings.linkage")} disabled>
        <SmallButton disabled>{t("settings.linkage.button")}</SmallButton>
        <NotYet>{t("settings.linkage.note")}</NotYet>
      </Row>
      <Row id="arrangeLayers" label={t("settings.arrangeLayers")} disabled>
        <Check checked={false} disabled>
          {t("settings.arrangeLayers.check")}
        </Check>
        <NotYet>{t("settings.arrangeLayers.note")}</NotYet>
      </Row>
      <Row id="frameRate" label={t("settings.frameRate")}>
        <Choice testId="settings-frame-rate" value={draft.frameRate} options={fpsOptions} onChange={(v) => set("frameRate", v)} />
      </Row>
      <Row id="timeCode" label={t("settings.timeCode")}>
        <Choice
          testId="settings-time-code"
          value={draft.timeCode}
          options={[
            { value: "frame", label: t("settings.timeCode.frame") },
            { value: "ff", label: t("settings.timeCode.ff") },
          ]}
          onChange={(v) => set("timeCode", v)}
        />
      </Row>
      <Row id="exportSound" label={t("settings.exportSound")}>
        <Check testId="settings-export-sound" checked={draft.exportSound} onChange={(v) => set("exportSound", v)}>
          {t("settings.exportSound.check")}
        </Check>
      </Row>
    </div>
  );

  const performanceTab = (
    <div className={cn(well, "py-6")}>
      <Row id="encodeDecode" label={t("settings.encodeDecode")}>
        <Check testId="settings-hw-encode" checked disabled tip={t("settings.hwEncode.tip")}>
          {t("settings.hwEncode")}
        </Check>
        <Check testId="settings-hw-decode" checked={draft.hardwareDecoding} onChange={(v) => set("hardwareDecoding", v)} tip={t("settings.hwDecode.tip")}>
          {t("settings.hwDecode")}
        </Check>
      </Row>
      <Divider />
      <Row id="autoOptimization" label={t("settings.autoOpt")}>
        <div className="flex items-center gap-2">
          <Choice
            testId="settings-auto-opt"
            width={338}
            value={draft.autoOptimization}
            options={[
              { value: "none", label: t("settings.autoOpt.none") },
              { value: "smart", label: t("settings.autoOpt.smart") },
            ]}
            onChange={(v) => set("autoOptimization", v)}
          />
          <Tip text={t("settings.autoOpt.tip")} />
        </div>
      </Row>
      <Divider />
      <Row id="proxy" label={t("settings.proxy")} disabled>
        <Check checked={false} disabled>
          {t("settings.proxy.check")}
        </Check>
        <NotYet>{t("settings.proxy.note")}</NotYet>
      </Row>
      <Row id="proxyPath" label={t("settings.proxyPath")}>
        <PathField testId="settings-proxy-path" value={mediaDir} disabled title={t("settings.proxyPath.note")} />
        <Help muted>{t("settings.proxyPath.note")}</Help>
      </Row>
      <Row id="proxySize" label={t("settings.proxySize")}>
        <SizeClear testId="settings-proxy-size" bytes={proxyBytes} disabled title={t("settings.proxySize.clear")} />
      </Row>
      <Row id="renderCache" label={t("settings.renderCache")} disabled>
        <PathField value="" disabled />
      </Row>
      <Row id="renderCacheSize" label={t("settings.renderCacheSize")} disabled>
        <SizeClear bytes={0} disabled />
      </Row>
      <Row id="autoClear" label={t("settings.autoClear")} disabled>
        <div className="h-[22px] w-[92px] rounded-[4px] bg-brand-background-light flex items-center justify-center gap-3 text-[12px] font-medium text-[#626262]">
          <span>10</span>
          <span>GB</span>
        </div>
        <Help muted>{t("settings.autoClear.help", { n: 10 })}</Help>
      </Row>
      <Row id="autoRender" label={t("settings.autoRender")} disabled>
        <Toggle on={false} disabled />
        <Help muted>{t("settings.autoRender.help")}</Help>
        <NotYet>{t("settings.renderCache.note")}</NotYet>
      </Row>
      <Divider />
      <Row id="engine" label={t("settings.engine")}>
        <Check testId="settings-engine" checked={engineDraft} disabled={!engineInfo?.available} onChange={setEngineDraft}>
          {t("settings.engine.check")}
        </Check>
        <Help muted>{t("settings.engine.help")}</Help>
        <Help muted>
          {engineInfo == null
            ? t("settings.engine.checking")
            : engineInfo.available
              ? t("settings.engine.version", { version: engineInfo.version ?? "" })
              : t("settings.engine.missing", { error: engineInfo.error ?? "?" })}
        </Help>
      </Row>
    </div>
  );

  const heading = "text-[13px] font-semibold text-brand-lighter text-left mb-3";
  const generalTab = (
    <div className="flex flex-col">
      <div data-testid="settings-row-language">
        <h3 className={heading}>{t("settings.language")}</h3>
        <div className={cn(well, "py-4 px-0")}>
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              data-testid={`settings-language-${l.id}`}
              aria-pressed={draft.language === l.id}
              onClick={() => set("language", l.id)}
              className="w-full h-[42px] flex items-center gap-2 pl-10 text-[13px] font-medium text-brand-lighter hover:bg-white/[0.03] cursor-pointer"
            >
              <span className="w-4 flex justify-center text-brand-accent">{draft.language === l.id && "✓"}</span>
              {l.name}
            </button>
          ))}
          <p className="pl-[66px] pt-1 text-[11px] text-[#7a7a7a] text-left">{t("settings.language.more")}</p>
        </div>
      </div>
      <div data-testid="settings-row-notification" className="mt-6">
        <h3 className={heading}>{t("settings.notification")}</h3>
        <div className={cn(well, "py-6 flex flex-col items-start gap-1.5")}>
          <Check testId="settings-notifications" checked={draft.notifications} onChange={(v) => set("notifications", v)}>
            {t("settings.notification.check")}
          </Check>
          <p className="pl-[22px] text-[11px] text-[#cccccc]">{t("settings.notification.help")}</p>
        </div>
      </div>
      <div data-testid="settings-row-update" className="mt-6">
        <h3 className={heading}>{t("settings.update")}</h3>
        <div className={cn(well, "py-5 flex flex-col items-start gap-1")}>
          <Radio testId="settings-update-auto" checked={draft.autoUpdate} onChange={() => set("autoUpdate", true)} className="text-[13px]">
            {t("settings.update.auto")}
          </Radio>
          <p className="pl-[22px] text-[11px] text-[#cccccc]">{t("settings.update.auto.help")}</p>
          <Radio testId="settings-update-notify" checked={!draft.autoUpdate} onChange={() => set("autoUpdate", false)} className="text-[13px] mt-3">
            {t("settings.update.notify")}
          </Radio>
          <p className="pl-[22px] text-[11px] text-[#cccccc]">{t("settings.update.notify.help")}</p>
          <div className="flex items-center gap-2 mt-4">
            <SmallButton testId="settings-update-check" onClick={() => void checkForAppUpdates().catch((e) => toast.error(String(e?.message ?? e))).finally(() => void getAppUpdateState().then(setUpdate))}>
              {t("settings.update.check")}
            </SmallButton>
            {update?.status === "available" && <SmallButton onClick={() => void downloadAppUpdate().catch((e) => toast.error(String(e?.message ?? e)))}>{t("settings.update.download")}</SmallButton>}
            {update?.status === "downloaded" && <SmallButton onClick={() => void installAppUpdate()}>{t("settings.update.install")}</SmallButton>}
            <span data-testid="settings-update-status" className="text-[11px] text-[#7a7a7a]">
              {t("settings.update.status", { status: update?.status ?? "idle" })}
              {update?.lastCheckedAt ? ` · ${t("settings.update.lastChecked", { when: new Date(update.lastCheckedAt).toLocaleString() })}` : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <DialogPrimitive.Content
          data-testid="settings-window"
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[510px] max-h-[calc(100vh-24px)] flex flex-col rounded-[12px] border border-[#3c3c3c] bg-brand-background shadow-[0_16px_48px_rgba(0,0,0,0.55)] font-poppins outline-none select-none"
        >
          <DialogPrimitive.Title className="h-[34px] shrink-0 px-[10px] flex items-center text-[13px] font-semibold text-brand-lighter border-b border-brand-divider">
            {t("settings.title")}
          </DialogPrimitive.Title>
          <div className="px-[15px] pt-[14px] shrink-0">
            <div role="tablist" className="h-6 w-[480px] rounded-[4px] bg-brand grid grid-cols-4">
              {TABS.map((id) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  data-testid={`settings-tab-${id}`}
                  onClick={() => setTab(id)}
                  className={cn("h-6 rounded-[4px] text-[12px] font-semibold cursor-pointer", tab === id ? "bg-brand-background-light text-brand-lighter" : "text-brand-light hover:text-brand-lighter")}
                >
                  {t(`settings.tab.${id}`)}
                </button>
              ))}
            </div>
          </div>
          <div data-testid={`settings-panel-${tab}`} className="mx-[15px] mt-[14px] h-[602px] max-h-[calc(100vh-180px)] overflow-y-auto custom-scrollbar">
            {tab === "draft" ? draftTab : tab === "edit" ? editTab : tab === "performance" ? performanceTab : generalTab}
          </div>
          <div className="shrink-0 flex gap-2 px-[15px] pt-[14px] pb-[15px]">
            <button type="button" data-testid="settings-cancel" onClick={() => onOpenChange(false)} className="h-7 flex-1 rounded-[4px] bg-brand-button text-[13px] font-semibold text-brand-lighter hover:bg-[#5a5a5a] cursor-pointer">
              {t("settings.cancel")}
            </button>
            <button type="button" data-testid="settings-save" disabled={busy} onClick={() => void onSave()} className="h-7 flex-1 rounded-[4px] bg-brand-accent text-[13px] font-semibold text-white hover:bg-brand-accent-shade disabled:opacity-60 cursor-pointer">
              {t("settings.save")}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default SettingsWindow;
