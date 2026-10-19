import React from "react";
import { LuCheck, LuChevronDown } from "react-icons/lu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox, Toggle } from "@/components/properties/controls";
import {
  LANGUAGES,
  cancelAutoCaptions,
  deleteModel,
  downloadModel,
  generateCaptions,
  modelInUse,
  refreshSpeechStatus,
  setAutoCaptions,
  sourceClip,
  useAutoCaptions,
  useAutoCaptionsFocus,
  type AutoKind,
} from "@/lib/autocaptions";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { cn } from "@/lib/utils";

/**
 * Auto captions and Auto lyrics, in CapCut's layout (docs/plan/capcut-ui-spec.md §6.11,
 * `11-left-captions/001`–`004`): the spoken language (a menu, Auto detect first), the keyword and
 * filler-word switches, and at the foot "Delete current captions" and Generate (which becomes a
 * progress bar and Cancel while it works). The captions' style is chosen under Templates, as in
 * CapCut, whose footer generates too. The recognition is local: the Whisper model it uses is
 * listed here, and downloaded the first time (lib/autocaptions.ts).
 */

const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode; testId?: string }> = ({ label, hint, children, testId }) => (
  <div className="flex flex-row items-center justify-between gap-3 min-h-[28px]" data-testid={testId}>
    <div className="flex flex-col text-left min-w-0">
      <span className="text-[13px] font-semibold text-brand-lighter">{label}</span>
      {hint && <span className="text-[11px] leading-snug text-[#949494]">{hint}</span>}
    </div>
    {children}
  </div>
);

/** A drop-down list as CapCut's: the value and a chevron, the options under it with a tick on the current one. */
const Menu: React.FC<{ value: string; options: { value: string; label: string; note?: string }[]; onChange: (v: string) => void; testId: string }> = ({ value, options, onChange, testId }) => {
  const [open, setOpen] = React.useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          className="w-full h-[28px] rounded-[4px] bg-brand-background-light hover:bg-brand-button px-2.5 flex flex-row items-center justify-between text-[13px] text-brand-lighter"
        >
          <span className="truncate">{current?.label ?? value}</span>
          <LuChevronDown className={cn("w-3.5 h-3.5 text-brand-light transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        data-testid={`${testId}-list`}
        className="p-1 w-[var(--radix-popover-trigger-width)] max-h-[260px] overflow-y-auto custom-scrollbar bg-[#2b2b2b] border border-[#3a3a3a] rounded-[6px]"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            data-testid={`${testId}-${o.value}`}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
            className="w-full h-[30px] rounded-[4px] px-2 flex flex-row items-center gap-2 text-[13px] text-brand-lighter hover:bg-brand-button text-left"
          >
            <span className="w-4 shrink-0">{o.value === value && <LuCheck className="w-3.5 h-3.5 text-brand-accent" />}</span>
            <span className="truncate flex-1">{o.label}</span>
            {o.note && <span className="text-[11px] text-[#949494] shrink-0">{o.note}</span>}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

/**
 * The panel's foot, shared with the Templates page: "Delete current captions" and Generate,
 * which becomes the progress and Cancel while the model downloads or listens.
 */
export const GenerateFooter: React.FC<{ kind: AutoKind; label?: string }> = ({ kind, label: buttonLabel = "Generate" }) => {
  const s = useAutoCaptions();
  const busy = s.phase !== "idle";
  const noEngine = !!s.status && !s.status.available;
  const pct = Math.round(s.progress * 100);
  const label = s.phase === "downloading" ? `Downloading the model ${pct}%` : `Generating ${pct}%`;
  return (
    <div className="shrink-0 h-[52px] px-3 border-t border-brand-divider flex flex-row items-center justify-between gap-3">
      {busy ? (
        <>
          <div className="flex flex-col gap-1 flex-1 min-w-0" data-testid="auto-progress" data-phase={s.phase} data-progress={s.progress.toFixed(3)}>
            <span className="text-[12px] text-brand-lighter">{label}</span>
            <div className="h-1.5 rounded-full bg-[#3a3a3a] overflow-hidden">
              <div className="h-full bg-brand-accent" style={{ width: `${Math.max(3, pct)}%` }} />
            </div>
          </div>
          <button
            type="button"
            data-testid="auto-cancel"
            onClick={cancelAutoCaptions}
            className="h-7 px-4 rounded-[4px] bg-brand-button hover:bg-[#5a5a5a] text-[13px] font-semibold text-brand-lighter"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <label className="flex flex-row items-center gap-2 text-[13px] font-semibold text-brand-lighter cursor-pointer">
            <Checkbox checked={s.deleteCurrent} onChange={(v) => setAutoCaptions({ deleteCurrent: v })} label="Delete current captions" />
            Delete current captions
          </label>
          <button
            type="button"
            data-testid="auto-generate"
            disabled={noEngine}
            onClick={() => void generateCaptions(kind)}
            className="h-7 px-5 rounded-[4px] bg-brand-accent hover:brightness-110 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {buttonLabel}
          </button>
        </>
      )}
    </div>
  );
};

const AutoCaptionsMenu: React.FC<{ kind: AutoKind }> = ({ kind }) => {
  const s = useAutoCaptions();
  const focus = useAutoCaptionsFocus((f) => f.tick);
  // The selected clip decides what's listened to (re-read when the selection or the clips change).
  useControlsStore((c) => c.selectedClipIds);
  useClipStore((c) => c.clips);
  const clip = sourceClip();
  React.useEffect(() => {
    void refreshSpeechStatus();
  }, [focus]);

  const status = s.status;
  const modelId = modelInUse(s);
  const model = status?.models.find((m) => m.id === modelId);
  const busy = s.phase !== "idle";
  const noEngine = !!status && !status.available;

  return (
    <div className="h-full flex flex-col" data-testid={kind === "lyrics" ? "auto-lyrics" : "auto-captions"}>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
        <div className="flex flex-col gap-5 p-3 pb-4 text-left">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-brand-lighter">Spoken language</span>
            <Menu
              testId="auto-language"
              value={s.language}
              options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
              onChange={(language) => setAutoCaptions({ language })}
            />
          </div>

          <Row label="Auto highlight keywords" testId="auto-keywords-row">
            <Toggle on={s.highlightKeywords} onChange={(v) => setAutoCaptions({ highlightKeywords: v })} label="Auto highlight keywords" />
          </Row>
          <Row label="Identify filler words" hint="Leaves out um, uh and a like set off by commas" testId="auto-fillers-row">
            <Toggle on={s.fillerWords} onChange={(v) => setAutoCaptions({ fillerWords: v })} label="Identify filler words" />
          </Row>

          <div className="flex flex-col gap-2" data-testid="auto-model">
            <span className="text-[13px] font-semibold text-brand-lighter">Speech model</span>
            <Menu
              testId="auto-model-menu"
              value={modelId}
              options={(status?.models ?? []).map((m) => ({ value: m.id, label: m.label, note: `${mb(m.size)}${m.installed ? " · ready" : ""}` }))}
              onChange={(id) => setAutoCaptions({ modelId: id })}
            />
            <p className="text-[11px] leading-snug text-[#949494]">
              {model ? `${model.note}. ` : ""}Runs on this computer: nothing is uploaded.
              {model && !model.installed ? ` It's downloaded once (${mb(model.size)}) the first time you generate.` : ""}
            </p>
            {model && (
              <div className="flex flex-row items-center gap-2">
                {model.installed ? (
                  <button
                    type="button"
                    data-testid="auto-model-delete"
                    disabled={busy}
                    onClick={() => void deleteModel(model.id)}
                    className="h-6 px-2 rounded-[4px] bg-brand-background-light hover:bg-brand-button text-[12px] text-brand-light disabled:opacity-50"
                  >
                    Delete model
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="auto-model-download"
                    disabled={busy || model.downloading}
                    onClick={() => void downloadModel(model.id)}
                    className="h-6 px-2 rounded-[4px] bg-brand-background-light hover:bg-brand-button text-[12px] text-brand-light disabled:opacity-50"
                  >
                    Download {mb(model.size)}
                  </button>
                )}
                {model.downloading && (
                  <div className="flex-1 h-1.5 rounded-full bg-[#3a3a3a] overflow-hidden" data-testid="auto-model-progress" data-progress={model.progress.toFixed(3)}>
                    <div className="h-full bg-brand-accent" style={{ width: `${Math.round(model.progress * 100)}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>

          <p className="text-[12px] leading-snug text-[#949494]" data-testid="auto-source">
            {clip ? "Listens to the selected clip's sound." : "Listens to the timeline's sound. Select a clip to caption just that."}
          </p>
          {noEngine && <p className="text-[12px] leading-snug text-[#c9a227]">This build of the engine can't recognize speech.</p>}
          {s.message && (
            <p data-testid="auto-message" className="text-[12px] leading-snug text-[#949494]">
              {s.message}
            </p>
          )}
        </div>
      </div>

      <GenerateFooter kind={kind} />
    </div>
  );
};

export default AutoCaptionsMenu;
