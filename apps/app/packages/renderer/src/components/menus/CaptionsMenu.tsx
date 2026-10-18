import React from "react";
import { LuPlus } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { CAPTION_STYLES, applyCaptionStyle, captionStyle, exportCaptions, importCaptionFile, pickAndImportCaptions, useCaptionsStore } from "@/lib/caption-actions";
import { cn } from "@/lib/utils";
import TextLook from "./TextLook";

/**
 * The Captions tab, in CapCut's layout (docs/plan/capcut-ui-spec.md §6.11): "add" is Add
 * captions (a subtitle file, .srt or .vtt, read onto its own captions track in the chosen
 * style; the files brought in so far; the timeline's texts written out as .srt), "templates"
 * the caption styles (OpenRip's own looks). Captions come from files only: no speech
 * recognition.
 */

/** The accent "+" in a circle, as CapCut's import buttons have it. */
const PlusDot: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <span className="rounded-full bg-brand-accent text-white flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
    <LuPlus style={{ width: size * 0.65, height: size * 0.65 }} />
  </span>
);

/** "abc…xyz.srt": a name shortened in the middle, as CapCut's cards show them. */
const middle = (name: string, max = 16) => (name.length <= max ? name : `${name.slice(0, Math.ceil(max / 2) - 1)}…${name.slice(-Math.floor(max / 2))}`);

const CaptionsMenu: React.FC<{ part?: string }> = ({ part = "add" }) => {
  const files = useCaptionsStore((s) => s.files);
  const message = useCaptionsStore((s) => s.message);
  const styleId = useCaptionsStore((s) => s.styleId);
  const setStyle = useCaptionsStore((s) => s.setStyle);
  const lastSelected = useControlsStore((s) => s.selectedClipIds[s.selectedClipIds.length - 1]);
  const selected = useClipStore((s) => s.getClipById(lastSelected));
  const selectedText = selected?.type === "text" ? selected : null;
  const [busy, setBusy] = React.useState(false);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  const status = message && (
    <p data-testid="captions-message" className="text-[12px] leading-snug text-[#949494]">
      {message}
    </p>
  );

  if (part === "templates") {
    return (
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-3 p-3 pb-8" data-testid="caption-templates">
          <p className="text-[12px] leading-snug text-[#949494] text-left">
            {selectedText ? "Applies to every caption on the selected caption's track, and to captions you import next." : "Captions you import get this style. Select a caption to restyle its whole track."}
          </p>
          <div className="grid gap-x-4 gap-y-[24px]" style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
            {CAPTION_STYLES.map((s) => (
              <div key={s.id} className="flex flex-col gap-1.5 w-[86px] min-w-0">
                <button
                  type="button"
                  data-testid={`caption-style-${s.id}`}
                  aria-pressed={styleId === s.id}
                  title={s.name}
                  onClick={() => {
                    setStyle(s.id);
                    if (selectedText?.timelineId) applyCaptionStyle(selectedText.timelineId, s.id);
                  }}
                  className={cn(
                    "w-[86px] h-[86px] rounded-[6px] bg-brand-background-light flex items-center justify-center overflow-hidden px-1.5 transition-colors",
                    styleId === s.id ? "outline outline-[1.5px] outline-brand-accent" : "hover:bg-brand-button",
                  )}
                >
                  <TextLook look={s.props} text="Caption" size={17} />
                </button>
                <span className="text-[12px] leading-none text-[#949494] truncate text-left">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-3 pb-8 text-left" data-testid="captions-add">
        <div className="flex flex-row items-center min-h-[22px]">
          <label htmlFor="caption-style" className="w-[60px] shrink-0 text-[12px] text-brand-light">
            Style
          </label>
          <select
            id="caption-style"
            data-testid="caption-style"
            value={styleId}
            onChange={(e) => setStyle(e.target.value)}
            className="flex-1 min-w-0 h-[22px] rounded-[4px] bg-brand-background-light px-2 text-[12px] text-brand-lighter outline-none"
          >
            {CAPTION_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {files.length === 0 ? (
          // The empty state: one big dashed zone.
          <button
            type="button"
            data-testid="captions-import"
            disabled={busy}
            onClick={() => run(pickAndImportCaptions)}
            className="w-full h-[132px] rounded-[6px] border border-dashed border-[#525252] bg-[#2f2f2f] hover:bg-brand-background-light flex flex-col items-center justify-center gap-[10px] transition-colors disabled:opacity-60"
          >
            <span className="flex flex-row items-center gap-2">
              <PlusDot />
              <span className="text-[13px] font-semibold text-brand-light">Import file</span>
            </span>
            <span className="text-[12px] text-[#949494]">Supported file formats: SRT and VTT</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              data-testid="captions-import"
              disabled={busy}
              onClick={() => run(pickAndImportCaptions)}
              className="self-start h-6 px-2 rounded-[4px] border border-dashed border-[#4f4f4f] bg-brand-background-light hover:bg-brand-button flex flex-row items-center gap-1.5 text-[12px] font-medium text-brand-light disabled:opacity-60"
            >
              <PlusDot size={14} /> Import file
            </button>
            <div className="flex flex-row flex-wrap gap-4">
              {files.map((f) => (
                <div key={f.path} className="flex flex-col gap-1.5 w-[78px]">
                  <button
                    type="button"
                    data-testid="captions-file"
                    title={`${f.name}: ${f.cues} captions. Click to add them again.`}
                    onClick={() => run(() => importCaptionFile(f.path))}
                    className="group relative w-[78px] h-[78px] rounded-[6px] bg-brand-background-light hover:bg-brand-button flex items-center justify-center"
                  >
                    {/* A subtitle file's glyph: a page with a T and the file's type. */}
                    <span className="relative w-[34px] h-[42px] rounded-[4px] border-2 border-[#3c6b70] bg-[#2d4b4f] flex items-center justify-center text-[18px] font-bold text-[#7fb6bc]">
                      T
                      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1 rounded-[3px] bg-[#7fb6bc] text-[9px] font-bold leading-[12px] text-[#1f3a3d]">
                        .{f.name.split(".").pop()?.toUpperCase()}
                      </span>
                    </span>
                    <span className="absolute right-1 bottom-1 w-[18px] h-[18px] rounded-full bg-black/55 text-white items-center justify-center hidden group-hover:flex">
                      <LuPlus className="w-3 h-3" />
                    </span>
                  </button>
                  <span className="text-[12px] leading-none text-[#949494] truncate">{middle(f.name)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="text-[12px] leading-snug text-[#949494]">
          Each file goes on its own captions track in the {captionStyle(styleId).name.toLowerCase()} style, the captions at their own times.
        </p>
        {status}
        <div className="h-px bg-brand-divider" />
        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold text-brand-light">Export captions</h3>
          <p className="text-[12px] leading-snug text-[#949494]">Every text on the timeline, as an SRT subtitle file.</p>
          <button
            type="button"
            data-testid="captions-export"
            disabled={busy}
            onClick={() => run(() => exportCaptions())}
            className="self-start h-7 px-3 rounded-[4px] bg-brand-button hover:bg-[#5a5a5a] text-[12px] font-semibold text-brand-lighter disabled:opacity-60"
          >
            Export as SRT…
          </button>
        </div>
      </div>
    </ScrollArea>
  );
};

export default CaptionsMenu;
