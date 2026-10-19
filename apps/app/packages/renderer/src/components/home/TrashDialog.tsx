import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LuCheck, LuChevronDown, LuLayoutGrid, LuList, LuTrash2 } from "react-icons/lu";
import { toast } from "sonner";
import { deleteFromTrash, emptyTrash, listTrash, type TrashEntry } from "@app/preload";
import { restoreProjects } from "@/lib/project-actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fileUrl, sizeText, useContextMenu } from "./shared";

/**
 * The Trash, as CapCut's (01-home/020-trash-view.png to 024): a window titled "Trash" listing
 * what was deleted ("Recently moved (n)") with the days each has left, as a grid or a list, an
 * empty-trash button, a right-click menu with Delete and Restore, and a circle to select.
 * Deleted projects stay 30 days; what's restored comes back whole.
 */

const VIEW_KEY = "openrip:trash-view";
const menuRow = "dark h-8 px-2.5 gap-2.5 rounded-[4px] text-[13px] cursor-pointer focus:bg-brand-hover";

const daysText = (e: TrashEntry) => (e.daysLeft === 1 ? "1 day" : `${e.daysLeft} days`);
const movedText = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

const Circle: React.FC<{ on: boolean; className?: string; onClick: (e: React.MouseEvent) => void; label: string }> = ({ on, className, onClick, label }) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={on}
    data-testid="trash-select"
    onClick={onClick}
    className={cn("h-3.5 w-3.5 rounded-full border border-white/80 flex items-center justify-center cursor-pointer", on ? "bg-brand-accent border-brand-accent text-black" : "bg-black/30", className)}
  >
    {on && <LuCheck className="w-2.5 h-2.5 stroke-[3]" />}
  </button>
);

const TrashCover: React.FC<{ entry: TrashEntry; className?: string }> = ({ entry, className }) =>
  entry.coverPath ? (
    <img src={fileUrl(entry.coverPath, entry.deletedAt)} alt="" draggable={false} className={cn("object-cover", className)} />
  ) : (
    <div className={cn("bg-black", className)} />
  );

export const TrashDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [view, setViewState] = useState<"grid" | "list">(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const [confirm, setConfirm] = useState<{ ids: number[]; all: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const setView = (v: "grid" | "list") => {
    setViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  const load = useCallback(async () => {
    const res = await listTrash();
    if (res?.success) {
      setItems(res.data ?? []);
      setSelected((s) => new Set([...s].filter((id) => (res.data ?? []).some((e) => e.id === id))));
    }
  }, []);
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      void load();
    }
  }, [open, load]);

  const byId = useMemo(() => new Map(items.map((e) => [e.id, e])), [items]);
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const restore = async (ids: number[]) => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    try {
      const names = ids.map((id) => byId.get(id)?.name).filter(Boolean);
      await restoreProjects(ids);
      toast(names.length === 1 ? `Restored “${names[0]}”` : `Restored ${ids.length} projects`);
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't restore");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = confirm.all ? await emptyTrash() : await deleteFromTrash(confirm.ids);
      if (!res?.success) throw new Error(res?.error || "Couldn't delete");
      setConfirm(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't delete");
    } finally {
      setBusy(false);
    }
  };

  /** What a menu or a key acts on: the selection when the item is in it, else the item alone. */
  const targets = (id: number) => (selected.has(id) ? [...selected] : [id]);
  const { open: openMenu, menu } = useContextMenu((key) => {
    const ids = targets(Number(key));
    return [
      { label: "Delete", shortcut: "⌫", danger: false, testId: "trash-menu-delete", onSelect: () => setConfirm({ ids, all: false }) },
      { label: "Restore", testId: "trash-menu-restore", onSelect: () => void restore(ids) },
    ];
  });

  const allOn = items.length > 0 && selected.size === items.length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-testid="trash"
          aria-describedby={undefined}
          onInteractOutside={(e) => {
            if ((e.target as HTMLElement)?.closest?.("[data-testid=context-menu], [data-testid=trash-confirm]")) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if ((e.key === "Backspace" || e.key === "Delete") && selected.size > 0 && !confirm) {
              e.preventDefault();
              setConfirm({ ids: [...selected], all: false });
            }
          }}
          className="dark w-[512px] max-w-none h-[471px] p-0 gap-0 flex flex-col rounded-[12px] bg-[#1b1b1c] border-[0.5px] border-[#454545] overflow-hidden text-brand-light [&>button:last-child]:top-[9px] [&>button:last-child]:right-3"
        >
          <DialogTitle className="h-[34px] shrink-0 flex items-center justify-center bg-[#303030] text-[12px] font-medium text-brand-light border-b border-black">Trash</DialogTitle>
          <DialogDescription className="sr-only">Deleted projects, kept for 30 days</DialogDescription>
          <div className="flex-1 min-h-0 flex flex-col px-[30px] pt-[22px]">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-brand-lighter" data-testid="trash-count">
                Recently moved ({items.length})
              </h3>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger data-testid="trash-view" title="View" className="h-6 px-1.5 flex items-center gap-1 rounded-[4px] bg-[#29292d] hover:bg-[#333338] text-brand-light/85 cursor-pointer outline-none">
                    {view === "grid" ? <LuLayoutGrid className="w-3.5 h-3.5" /> : <LuList className="w-3.5 h-3.5" />}
                    <LuChevronDown className="w-3 h-3 opacity-70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="dark z-[200] w-[120px] p-1 bg-[#2b2b2d] border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light">
                    {(["grid", "list"] as const).map((v) => (
                      <DropdownMenuItem key={v} data-testid={`trash-view-${v}`} className={menuRow} onClick={() => setView(v)}>
                        <span className="w-4 flex items-center text-brand-accent">{view === v && <LuCheck className="w-3.5 h-3.5" />}</span>
                        {v === "grid" ? "Grid" : "List"}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  type="button"
                  title="Empty trash"
                  aria-label="Empty trash"
                  data-testid="trash-empty"
                  disabled={items.length === 0}
                  onClick={() => setConfirm({ ids: items.map((e) => e.id), all: true })}
                  className="h-6 w-7 flex items-center justify-center rounded-[4px] bg-[#29292d] hover:bg-[#333338] text-brand-light/85 disabled:opacity-40 disabled:cursor-default cursor-pointer"
                >
                  <LuTrash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <p className="mt-3 text-[12px] leading-[17px] text-[#6f6f6f] text-left">
              Items show the days remaining before deletion. After that time, they will be permanently deleted. Items can be kept here for up to 30 days.
            </p>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar mt-3 pb-3" onClick={() => setSelected(new Set())}>
              {items.length === 0 ? (
                <div data-testid="trash-none" className="h-full flex flex-col items-center justify-center gap-2 text-[#6c6c6c]">
                  <LuTrash2 className="w-7 h-7" />
                  <span className="text-[12px]">Nothing in the Trash</span>
                </div>
              ) : view === "grid" ? (
                <div className="grid gap-x-[18px] gap-y-3" style={{ gridTemplateColumns: "repeat(auto-fill, 120px)" }}>
                  {items.map((e) => (
                    <div
                      key={e.id}
                      data-testid="trash-item"
                      data-project-id={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toggle(e.id);
                      }}
                      onContextMenu={openMenu(String(e.id))}
                      className="group w-[120px] text-left cursor-default"
                    >
                      <div className={cn("relative w-[120px] h-[120px] rounded-[4px] overflow-hidden bg-black ring-offset-0", selected.has(e.id) && "ring-2 ring-brand-accent")}>
                        <TrashCover entry={e} className="w-full h-full" />
                        <Circle
                          on={selected.has(e.id)}
                          label={`Select ${e.name}`}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            toggle(e.id);
                          }}
                          className={cn("absolute right-2 bottom-2", !selected.has(e.id) && "opacity-0 group-hover:opacity-100")}
                        />
                      </div>
                      <div className="mt-1.5 text-[13px] text-[#cccccc] truncate" title={e.name}>
                        {e.name}
                      </div>
                      <div className="text-[12px] text-[#6f6f6f] tabular-nums" data-testid="trash-days">
                        {daysText(e)} | {sizeText(e.sizeBytes)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px]" onClick={(ev) => ev.stopPropagation()}>
                  <div className="grid grid-cols-[20px_36px_minmax(0,1fr)_56px_64px_124px] items-center gap-2 h-8 border-y border-white/10 text-[#7a7a7a]">
                    <Circle on={allOn} label="Select all" onClick={() => setSelected(allOn ? new Set() : new Set(items.map((e) => e.id)))} className="rounded-[3px]" />
                    <span>All</span>
                    <span>Name</span>
                    <span>Size</span>
                    <span>Move time</span>
                    <span className="text-right">Days remaining ↓</span>
                  </div>
                  {items.map((e) => (
                    <div
                      key={e.id}
                      data-testid="trash-item"
                      data-project-id={e.id}
                      onClick={() => toggle(e.id)}
                      onContextMenu={openMenu(String(e.id))}
                      className={cn("grid grid-cols-[20px_36px_minmax(0,1fr)_56px_64px_124px] items-center gap-2 h-[50px] text-[#cccccc] cursor-default", selected.has(e.id) && "bg-white/[0.06]")}
                    >
                      <Circle on={selected.has(e.id)} label={`Select ${e.name}`} onClick={(ev) => { ev.stopPropagation(); toggle(e.id); }} className="rounded-[3px]" />
                      <TrashCover entry={e} className="w-9 h-9 rounded-[3px]" />
                      <span className="truncate" title={e.name}>{e.name}</span>
                      <span className="tabular-nums">{sizeText(e.sizeBytes)}</span>
                      <span className="tabular-nums">{movedText(e.deletedAt)}</span>
                      <span className="text-right tabular-nums" data-testid="trash-days">{daysText(e)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {selected.size > 0 && (
            <div data-testid="trash-bar" className="h-12 shrink-0 flex items-center justify-between px-[30px] bg-[#232325] border-t border-black">
              <span className="text-[12px] text-brand-light/70">{selected.size} selected</span>
              <div className="flex gap-2">
                <button type="button" data-testid="trash-restore" disabled={busy} onClick={() => void restore([...selected])} className="h-7 px-4 rounded-[4px] text-[12px] bg-brand-accent text-black font-medium hover:brightness-110 cursor-pointer disabled:opacity-60">
                  Restore
                </button>
                <button type="button" data-testid="trash-delete" disabled={busy} onClick={() => setConfirm({ ids: [...selected], all: false })} className="h-7 px-4 rounded-[4px] text-[12px] bg-[#3a3a3d] hover:bg-[#444448] text-brand-light cursor-pointer disabled:opacity-60">
                  Delete
                </button>
              </div>
            </div>
          )}
          {menu}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <AlertDialogContent data-testid="trash-confirm" className="dark bg-[#2b2b2f] border-0 rounded-[12px] max-w-[400px] z-[300]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-brand-light text-[15px]">
              {confirm?.all ? "Empty the Trash?" : confirm && confirm.ids.length > 1 ? `Delete ${confirm.ids.length} projects?` : "Delete permanently?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-brand-light/70 text-[13px]">
              {confirm?.all || (confirm && confirm.ids.length > 1) ? "These projects and their edits are deleted for good." : "This project and its edits are deleted for good."} Your media files stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} className="dark border-0 bg-[#3a3a3d] text-brand-light hover:bg-[#444448] text-[12px] px-5">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="trash-confirm-delete"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
              className="bg-[#e8453c] hover:bg-[#d83d34] text-white text-[12px] px-5"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
