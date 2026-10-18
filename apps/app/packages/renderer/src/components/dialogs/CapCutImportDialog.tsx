import React, { useEffect, useMemo, useState } from "react";
import { LuClapperboard, LuFolderOpen, LuLoader, LuSearch } from "react-icons/lu";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { capcutImport, capcutListDrafts, capcutPickDraft, type CapCutDraft } from "@app/preload";
import type { ProjectSettings } from "@/lib/projects";
import { cn } from "@/lib/utils";

const formatDuration = (us: number) => {
  const s = Math.round(us / 1e6);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A long name cut in the middle, as the home screen's project cards show it. */
const middle = (name: string, max: number) => {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(name.length - (max - 1 - head))}`;
};

/**
 * Open a CapCut draft as a new project: CapCut's drafts on this Mac with their covers, laid
 * out like the home screen's project grid, or a draft folder picked by hand. The draft itself
 * is only read.
 */
export const CapCutImportDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (project: ProjectSettings) => void;
}> = ({ open, onOpenChange, onImported }) => {
  const [drafts, setDrafts] = useState<CapCutDraft[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDrafts(null);
    void capcutListDrafts().then(setDrafts, () => setDrafts([]));
  }, [open]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (drafts ?? []).filter((d) => !q || d.name.toLowerCase().includes(q));
  }, [drafts, search]);

  const importFrom = async (folder: string) => {
    if (busy) return;
    setBusy(folder);
    try {
      const r = await capcutImport(folder);
      if (!r.success) {
        toast.error(`Couldn't open the draft: ${r.error}`, { position: "bottom-right" });
        return;
      }
      onImported({ ...r.data, createdAt: Date.now(), lastModified: Date.now() } as ProjectSettings);
      onOpenChange(false);
      if (r.missingMedia.length > 0) {
        toast.warning(`${r.missingMedia.length} media file${r.missingMedia.length > 1 ? "s" : ""} the draft uses ${r.missingMedia.length > 1 ? "aren't" : "isn't"} on this Mac`, { position: "bottom-right", duration: 6000 });
      } else {
        toast.success(`Opened “${r.data.name}” from CapCut`, { position: "bottom-right" });
      }
    } finally {
      setBusy(null);
    }
  };

  const pick = async () => {
    const folder = await capcutPickDraft();
    if (folder) await importFrom(folder);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        data-testid="capcut-dialog"
        className="w-full max-w-[728px] dark p-0 h-[580px] gap-0 flex flex-col bg-[#262626] border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_16px_48px_rgba(0,0,0,0.55)] sm:rounded-[12px] overflow-hidden"
      >
        <div className="px-6 pt-5 pr-12">
          <DialogTitle className="text-[15px] font-semibold text-[#e0e0e0]">Open a CapCut project</DialogTitle>
          <p className="pt-1.5 text-[12px] leading-[18px] text-[#8a8a8a]">
            Makes a new OpenRip project from a CapCut draft. Clips can be moved, trimmed and retyped; captions, effects and animations are drawn as CapCut draws them. The draft isn't changed.
          </p>
        </div>
        <div className="px-6 pt-4 pb-3 flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold text-[#e0e0e0]">
            Drafts{drafts && drafts.length > 0 ? <span className="ml-1.5 font-normal text-[#7a7a7a] tabular-nums">{drafts.length}</span> : null}
          </span>
          <div className="relative">
            <LuSearch className="w-3.5 h-3.5 text-[#7a7a7a] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search drafts"
              data-testid="capcut-search"
              className="w-[220px] h-[26px] rounded-[4px] pl-7 pr-2 text-[12px] bg-[#141414] border-[0.5px] border-[#3a3a3a] text-brand-light placeholder:text-brand-light/35 focus:outline-none focus:border-[#5a5a5a]"
            />
          </div>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="grid grid-cols-[repeat(auto-fill,124px)] justify-between gap-x-4 gap-y-5 px-6 pb-5">
            {drafts === null && (
              <div className="col-span-full h-40 text-[12px] text-[#8a8a8a] flex items-center justify-center gap-2">
                <LuLoader className="w-3.5 h-3.5 animate-spin" /> Looking for CapCut drafts…
              </div>
            )}
            {drafts !== null && shown.length === 0 && (
              <div className="col-span-full h-40 text-[12px] text-[#8a8a8a] flex items-center justify-center text-center">
                {drafts.length === 0 ? "No CapCut drafts found on this Mac. Choose a draft folder instead." : "No matching drafts."}
              </div>
            )}
            {shown.map((d) => (
              <button
                key={d.folder}
                type="button"
                data-testid="capcut-draft"
                data-name={d.name}
                disabled={!!busy}
                onClick={() => void importFrom(d.folder)}
                title={d.folder}
                className={cn(
                  "group w-[124px] flex flex-col gap-1.5 text-left min-w-0 focus-visible:outline-none",
                  busy ? "cursor-wait" : "cursor-pointer",
                  busy && busy !== d.folder && "opacity-50",
                )}
              >
                <div className="relative w-[124px] h-[123px] rounded-[6px] overflow-hidden bg-[#1a1a1a] flex items-center justify-center text-brand-light/25 transition-[filter] group-hover:brightness-125 group-focus-visible:ring-2 group-focus-visible:ring-brand-accent">
                  {d.cover ? <img src={`app://user-data${encodeURI(d.cover)}`} alt="" className="w-full h-full object-cover" loading="lazy" draggable={false} /> : <LuClapperboard className="w-6 h-6" />}
                  {busy === d.folder && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <LuLoader className="w-5 h-5 text-brand-light animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col min-w-0 gap-0.5">
                  <span className="text-[13px] text-[#cccccc] whitespace-nowrap" title={d.name}>
                    {middle(d.name, 19)}
                  </span>
                  <span className="text-[11.5px] text-[#7a7a7a] tabular-nums whitespace-nowrap">
                    {formatDuration(d.durationUs)}
                    {d.modifiedMs ? ` | ${new Date(d.modifiedMs).toLocaleDateString()}` : ""}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
        <div className="border-t-[0.5px] border-[#3a3a3a] px-6 h-[60px] flex items-center justify-between">
          <span className="text-[11.5px] text-[#7a7a7a]">Drafts are read from CapCut's projects folder.</span>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void pick()}
            data-testid="capcut-pick"
            className="h-8 px-3.5 flex items-center gap-2 rounded-[6px] text-[13px] font-medium text-[#e0e0e0] bg-[#3a3a3a] hover:bg-[#444444] disabled:opacity-50 cursor-pointer"
          >
            <LuFolderOpen className="w-4 h-4" />
            Choose a draft folder…
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CapCutImportDialog;
