import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LuCheck, LuChevronDown, LuLayoutTemplate, LuLoader, LuSearch } from "react-icons/lu";
import { toast } from "sonner";
import { deleteTemplate, listTemplates, renameTemplate, type TemplateEntry } from "@app/preload";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useShellStore } from "@/lib/shell";
import { startFromTemplate } from "@/lib/project-actions";
import { cn } from "@/lib/utils";
import { clockText, fileUrl, useContextMenu } from "./shared";

/**
 * Templates, laid out as CapCut's page (01-home/028-templates-page.png): a search field, the
 * Orientation and Duration filters, and tall cards with the clip count and length under the
 * picture and the name below. OpenRip has no template store: these are the projects you saved
 * as templates (a project's menu on Home ▸ Save as template), each a copy of its clips, text,
 * effects and media links, and a card starts a new project from it.
 */

type Orientation = "all" | "landscape" | "portrait" | "square";
type Length = "all" | "short" | "medium" | "long";
const menu = "dark z-[200] p-1 bg-[#2b2b2d] border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] text-brand-light";
const menuRow = "dark h-8 px-2.5 gap-2.5 rounded-[4px] text-[13px] cursor-pointer focus:bg-brand-hover";

const orientationOf = (t: TemplateEntry): Orientation => {
  const a = t.aspectRatio;
  if (!a || a.width === a.height) return a ? "square" : "landscape";
  return a.width > a.height ? "landscape" : "portrait";
};
const lengthOf = (t: TemplateEntry): Length => {
  const s = t.durationUs / 1e6;
  return s < 15 ? "short" : s <= 60 ? "medium" : "long";
};

const Filter: React.FC<{ label: string; value: string; options: [string, string][]; onChange: (v: string) => void; testId: string }> = ({ label, value, options, onChange, testId }) => (
  <DropdownMenu>
    <DropdownMenuTrigger data-testid={testId} className="h-7 px-2 flex items-center gap-1 rounded-[4px] text-[13px] text-brand-light/60 hover:bg-white/[0.06] cursor-pointer outline-none">
      {label}: <span className="text-brand-light">{options.find(([v]) => v === value)?.[1]}</span>
      <LuChevronDown className="w-3.5 h-3.5 opacity-70" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className={cn(menu, "w-44")}>
      {options.map(([v, text]) => (
        <DropdownMenuItem key={v} data-testid={`${testId}-${v}`} className={menuRow} onClick={() => onChange(v)}>
          <span className="w-4 flex items-center text-brand-accent">{value === v && <LuCheck className="w-3.5 h-3.5" />}</span>
          {text}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

export const TemplatesPage: React.FC = () => {
  const setSection = useShellStore((s) => s.setHomeSection);
  const [items, setItems] = useState<TemplateEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("all");
  const [length, setLength] = useState<Length>("all");
  const [using, setUsing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [toDelete, setToDelete] = useState<TemplateEntry | null>(null);

  const load = useCallback(async () => {
    const res = await listTemplates();
    setItems(res?.success ? (res.data ?? []) : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? []).filter((t) => (!q || t.name.toLowerCase().includes(q)) && (orientation === "all" || orientationOf(t) === orientation) && (length === "all" || lengthOf(t) === length));
  }, [items, search, orientation, length]);

  const use = async (t: TemplateEntry) => {
    if (using) return;
    setUsing(t.id);
    try {
      await startFromTemplate(t.id, "");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't start the project");
    } finally {
      setUsing(null);
    }
  };
  const commitRename = async (t: TemplateEntry) => {
    setEditing(null);
    const name = draft.trim();
    if (!name || name === t.name) return;
    await renameTemplate(t.id, name);
    await load();
  };
  const remove = async () => {
    if (!toDelete) return;
    const res = await deleteTemplate(toDelete.id);
    if (!res?.success) toast.error(res?.error || "Couldn't delete the template");
    setToDelete(null);
    await load();
  };

  const { open: openMenu, menu: contextMenu } = useContextMenu((id) => {
    const t = items?.find((x) => x.id === id);
    if (!t) return [];
    return [
      { label: "Use template", testId: "template-menu-use", onSelect: () => void use(t) },
      { label: "Rename", testId: "template-menu-rename", onSelect: () => { setDraft(t.name); setEditing(t.id); } },
      "separator",
      { label: "Delete", danger: true, testId: "template-menu-delete", onSelect: () => setToDelete(t) },
    ];
  });

  return (
    <section data-testid="home-templates" className="flex flex-col text-left pt-5">
      <div className="relative">
        <LuSearch className="absolute left-3 top-[13px] w-4 h-4 text-brand-light/45" />
        <input
          data-testid="templates-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your templates"
          className="w-full h-[42px] rounded-[8px] pl-10 pr-3 text-[14px] bg-white/[0.05] border-0 text-brand-light placeholder:text-brand-light/40 focus:outline-none focus:ring-1 focus:ring-brand-accent/60"
        />
      </div>
      <div className="mt-3 flex items-center gap-1">
        <Filter
          label="Orientation"
          testId="templates-orientation"
          value={orientation}
          onChange={(v) => setOrientation(v as Orientation)}
          options={[["all", "All"], ["landscape", "Landscape"], ["portrait", "Portrait"], ["square", "Square"]]}
        />
        <span className="h-3 w-px bg-white/15" />
        <Filter
          label="Duration"
          testId="templates-duration"
          value={length}
          onChange={(v) => setLength(v as Length)}
          options={[["all", "No limit"], ["short", "Under 15 s"], ["medium", "15 s to 1 min"], ["long", "Over 1 min"]]}
        />
      </div>

      {items == null ? null : items.length === 0 ? (
        <div data-testid="templates-empty" className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <LuLayoutTemplate className="w-14 h-14 text-[#3a3a3e]" />
          <p className="text-[15px] font-semibold text-brand-light/90">No templates yet</p>
          <p className="text-[13px] leading-[19px] text-brand-light/55 max-w-[440px]">
            OpenRip has no template store: templates are your own projects. Open a project's menu on Home and choose Save as template; it is kept here with its clips, text, effects and media,
            and a click starts a new project from it.
          </p>
          <button type="button" data-testid="templates-home" onClick={() => setSection("home")} className="mt-1 h-9 px-4 rounded-[4px] text-[13px] font-medium bg-brand-accent text-black hover:brightness-110 cursor-pointer">
            Go to your projects
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p data-testid="templates-none" className="py-24 text-center text-[13px] text-brand-light/55">No template matches.</p>
      ) : (
        <div className="mt-5 grid gap-x-5 gap-y-5" style={{ gridTemplateColumns: "repeat(auto-fill, 160px)" }}>
          {shown.map((t) => (
            <div key={t.id} data-testid="template-card" data-template-id={t.id} data-name={t.name} onContextMenu={openMenu(t.id)} className="group w-[160px]">
              <button
                type="button"
                data-testid="template-use"
                onClick={() => void use(t)}
                disabled={!!using}
                title={`Start a project from ${t.name}`}
                className="relative block w-[160px] h-[270px] rounded-[6px] overflow-hidden bg-[#0d0d0f] cursor-pointer disabled:cursor-wait"
              >
                {t.coverPath ? <img src={fileUrl(t.coverPath, t.savedAt)} alt="" draggable={false} className="w-full h-full object-contain" /> : <LuLayoutTemplate className="w-8 h-8 m-auto text-[#3a3a3e]" />}
                <span className="absolute left-2 right-2 bottom-2 flex items-center gap-2 text-[12px] text-white tabular-nums drop-shadow">
                  {t.clipCount} clip{t.clipCount === 1 ? "" : "s"} | {clockText(t.durationUs / 1e6)}
                </span>
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="h-8 px-4 rounded-[4px] bg-brand-accent text-black text-[13px] font-medium flex items-center gap-1.5">
                    {using === t.id && <LuLoader className="w-3.5 h-3.5 animate-spin" />} Use template
                  </span>
                </span>
              </button>
              {editing === t.id ? (
                <input
                  autoFocus
                  value={draft}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void commitRename(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="mt-2 h-6 w-full text-[13px] text-brand-light bg-brand border border-brand-light/20 rounded-[4px] px-1"
                />
              ) : (
                <div className="mt-2 text-[13px] text-[#dddddd] truncate" title={t.name}>
                  {t.name}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {contextMenu}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="dark bg-[#2b2b2f] border-0 rounded-[12px] max-w-[400px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-brand-light text-[15px]">Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-brand-light/70 text-[13px]">The template and its copy of the media links are deleted. Projects made from it stay. Your media files stay where they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark border-0 bg-[#3a3a3d] text-brand-light hover:bg-[#444448] text-[12px] px-5">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="template-delete-confirm"
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
    </section>
  );
};
