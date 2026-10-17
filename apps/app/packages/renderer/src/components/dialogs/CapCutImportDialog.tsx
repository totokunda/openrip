import React, { useEffect, useMemo, useState } from "react";
import { LuFolderOpen, LuLoader, LuSearch } from "react-icons/lu";
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

/**
 * Open a CapCut draft as a new project: CapCut's drafts on this Mac with their covers, or a
 * draft folder picked by hand. The draft itself is only read.
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
      <DialogContent className="w-full max-w-2xl dark p-0 h-[560px] gap-0 flex flex-col font-poppins">
        <DialogTitle className="text-brand-light text-xs font-medium px-5 pt-4">Open a CapCut project</DialogTitle>
        <p className="px-5 pt-1 text-[10px] text-brand-light/60">
          Makes a new OpenRip project from a CapCut draft. Clips can be moved, trimmed and retyped; captions, effects and animations are drawn as CapCut draws them. The draft isn't changed.
        </p>
        <div className="relative mx-5 mt-3">
          <LuSearch className="w-3.5 h-3.5 text-brand-light/60 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search drafts..."
            className="w-full h-8 rounded-[6px] pl-7 px-2 text-[11px] bg-brand-light/5 border border-brand-light/10 text-brand-light/90 placeholder:text-brand-light/40 focus:outline-none focus:border-brand-light/30"
          />
        </div>
        <ScrollArea className="flex-1 min-h-0 mt-3">
          <div className="grid grid-cols-4 gap-3 px-5 pb-4">
            {drafts === null && <div className="col-span-4 text-[11px] text-brand-light/60 flex items-center gap-2"><LuLoader className="w-3.5 h-3.5 animate-spin" /> Looking for CapCut drafts…</div>}
            {drafts !== null && shown.length === 0 && (
              <div className="col-span-4 text-[11px] text-brand-light/60">{drafts.length === 0 ? "No CapCut drafts found on this Mac. Choose a draft folder instead." : "No matching drafts."}</div>
            )}
            {shown.map((d) => (
              <button
                key={d.folder}
                type="button"
                disabled={!!busy}
                onClick={() => void importFrom(d.folder)}
                title={d.folder}
                className={cn(
                  "group flex flex-col text-left rounded-[8px] border border-brand-light/10 bg-brand-light/5 overflow-hidden transition-colors",
                  busy ? "cursor-wait" : "hover:border-brand-light/30 hover:bg-brand-light/10 cursor-pointer",
                  busy && busy !== d.folder && "opacity-50",
                )}
              >
                <div className="relative w-full aspect-[9/12] bg-black/40 flex items-center justify-center overflow-hidden">
                  {d.cover ? <img src={`app://user-data${encodeURI(d.cover)}`} alt="" className="w-full h-full object-contain" loading="lazy" /> : null}
                  {busy === d.folder && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <LuLoader className="w-5 h-5 text-brand-light animate-spin" />
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5">
                  <div className="text-[11px] text-brand-light truncate">{d.name}</div>
                  <div className="text-[10px] text-brand-light/50">
                    {formatDuration(d.durationUs)} · {d.modifiedMs ? new Date(d.modifiedMs).toLocaleDateString() : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
        <div className="border-t border-brand-light/10 px-5 py-3 flex items-center">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void pick()}
            className="flex items-center gap-2 text-[11px] text-brand-light/80 hover:text-brand-light disabled:opacity-50"
          >
            <LuFolderOpen className="w-3.5 h-3.5" />
            Choose a draft folder…
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CapCutImportDialog;
