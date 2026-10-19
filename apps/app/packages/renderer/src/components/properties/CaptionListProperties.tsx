import React, { useMemo, useState } from "react";
import { LuReplace, LuSearch } from "react-icons/lu";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { captionRows, captionsOnTrack, countMatches, replaceMatches, rowTime } from "@/lib/caption-edit";
import { replaceAllCaptions } from "@/lib/caption-actions";
import type { TextClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * A caption's Captions tab (CapCut's list editor, docs/plan/capcut-ui-spec.md §6.24): a search
 * box and Find and replace over the track's captions, each as a numbered row with its start
 * time; the words are edited in place, and a click on a row selects that caption and moves the
 * playhead to its start.
 */
const CaptionListProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as TextClipProps | undefined;
  const clips = useClipStore((s) => s.clips);
  const updateClip = useClipStore((s) => s.updateClip);
  const fps = useControlsStore((s) => s.fps) || 24;
  const [query, setQuery] = useState("");
  const [replacing, setReplacing] = useState(false);
  const captions = useMemo(() => captionsOnTrack(clips, clip?.timelineId), [clips, clip?.timelineId]);
  const rows = useMemo(() => captionRows(captions, query), [captions, query]);
  if (!clip) return null;

  const jump = (c: { clipId: string; startFrame: number }) => {
    useControlsStore.getState().setSelectedClipIds([c.clipId]);
    useControlsStore.getState().setFocusFrame(c.startFrame);
  };

  return (
    <div className="flex flex-col min-h-0 flex-1" data-testid="caption-list">
      <div className="shrink-0 px-3 pt-3 pb-2 flex flex-row items-center gap-2">
        <label className="flex-1 min-w-0 h-[26px] flex flex-row items-center gap-1.5 px-2.5 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
          <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
          <input
            data-testid="caption-search"
            aria-label="Search captions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none"
          />
        </label>
        <button
          type="button"
          title="Find and replace"
          aria-label="Find and replace"
          data-testid="caption-find-replace"
          onClick={() => setReplacing(true)}
          className="w-[26px] h-[26px] rounded-[4px] flex items-center justify-center text-brand-light hover:text-brand-lighter hover:bg-brand-background-light"
        >
          <LuReplace className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-4">
        {rows.map((r) => {
          const selected = r.clipId === clipId;
          return (
            <div
              key={r.clipId}
              data-testid="caption-row"
              data-clip-id={r.clipId}
              data-selected={selected}
              onClick={() => jump(r)}
              className={cn("flex flex-row gap-3 py-2.5 border-b border-brand-divider cursor-pointer", selected && "bg-brand-background-light/60")}
            >
              <span className="w-4 shrink-0 text-[12px] text-[#6c6c6c] tabular-nums text-right pt-[3px]">{r.number}</span>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <textarea
                  data-testid="caption-row-text"
                  aria-label={`Caption ${r.number}`}
                  rows={Math.max(1, r.text.split("\n").length)}
                  value={r.text}
                  onFocus={() => !selected && jump(r)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateClip(r.clipId, { text: e.target.value } as Partial<TextClipProps>)}
                  className="w-full resize-none bg-transparent text-[13px] leading-[1.4] text-brand-lighter outline-none focus:bg-brand rounded-[3px] px-1 -mx-1"
                />
                <span className="text-[11px] text-[#6c6c6c] tabular-nums">{rowTime(r.startFrame, fps)}</span>
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <p data-testid="caption-list-empty" className="text-[12px] text-[#6c6c6c] py-6 text-center">
            {query ? `No captions match “${query}”` : "No captions on this track"}
          </p>
        )}
      </div>
      {replacing && <FindReplaceDialog timelineId={clip.timelineId ?? ""} onClose={() => setReplacing(false)} />}
    </div>
  );
};

/** CapCut's Find and replace dialog: Find, Replace with, Cancel and Replace all; Replace takes the next match from the playhead. */
const FindReplaceDialog: React.FC<{ timelineId: string; onClose: () => void }> = ({ timelineId, onClose }) => {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const clips = useClipStore((s) => s.clips);
  const captions = useMemo(() => captionsOnTrack(clips, timelineId), [clips, timelineId]);
  const hits = captions.filter((c) => countMatches(c.text ?? "", find) > 0);
  const total = captions.reduce((n, c) => n + countMatches(c.text ?? "", find), 0);

  const replaceNext = () => {
    const at = useControlsStore.getState().focusFrame;
    const next = hits.find((c) => c.endFrame > at) ?? hits[0];
    if (!next) return;
    useClipStore.getState().updateClip(next.clipId, { text: replaceMatches(next.text ?? "", find, replace) } as Partial<TextClipProps>);
  };
  const replaceAll = () => {
    const n = replaceAllCaptions(timelineId, find, replace);
    toast.success(n ? `Replaced in ${n} caption${n === 1 ? "" : "s"}` : "Nothing to replace");
    onClose();
  };

  const field = "w-full h-[34px] rounded-[6px] bg-brand px-3 text-[13px] text-brand-lighter outline-none focus:ring-1 focus:ring-[#515151]";
  const button = "h-[30px] px-4 rounded-[6px] text-[13px] font-medium disabled:opacity-40";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[300px] p-5 gap-3" data-testid="caption-replace-dialog" onKeyDown={(e) => e.stopPropagation()}>
        <DialogTitle className="sr-only">Find and replace</DialogTitle>
        <DialogDescription className="sr-only">Replace words in every caption of this track.</DialogDescription>
        <label className="flex flex-col gap-1.5 text-[13px] text-brand-light">
          Find
          <input data-testid="caption-find" autoFocus value={find} onChange={(e) => setFind(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-brand-light">
          Replace with
          <input data-testid="caption-replace" value={replace} onChange={(e) => setReplace(e.target.value)} className={field} />
        </label>
        <p data-testid="caption-replace-count" className="text-[12px] text-[#949494] h-4">
          {find ? `${total} match${total === 1 ? "" : "es"} in ${hits.length} caption${hits.length === 1 ? "" : "s"}` : ""}
        </p>
        <div className="flex flex-row justify-end gap-2">
          <button type="button" className={cn(button, "bg-brand-button text-brand-lighter")} onClick={onClose}>
            Cancel
          </button>
          <button type="button" data-testid="caption-replace-one" className={cn(button, "bg-brand-button text-brand-lighter")} disabled={!hits.length} onClick={replaceNext}>
            Replace
          </button>
          <button type="button" data-testid="caption-replace-all" className={cn(button, "bg-brand-accent text-white")} disabled={!hits.length} onClick={replaceAll}>
            Replace all
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CaptionListProperties;
