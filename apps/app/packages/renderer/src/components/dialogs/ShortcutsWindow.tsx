// The Shortcuts window, as CapCut's (docs/plan/capcut-ui-spec.md §4.14, the Shortcuts row): a
// 34 px title bar, the tabs Timeline / Player / Basic / Other with the preset menu (Shortcut
// 1–5) beside them, two columns of 40 px rows (the action and its keys), and Reset, Save and
// Cancel. Clicking a row edits its keys: the field waits for a press ("×" removes the key), and a
// press another action uses is refused and named. Save keeps the bindings in the preferences
// (lib/keymap.ts reads them), so the keys change what they do; Save stays off until something
// changed.
import React, { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LuChevronDown, LuCheck, LuX } from "react-icons/lu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { usePreferencesStore } from "@/lib/preferences";
import {
  ACTIONS,
  NAMED_KEYS,
  PRESETS,
  actionLabels,
  actionUsing,
  bindingsFor,
  chordOf,
  normalizeChord,
  presetChanges,
  type ShortcutAction,
  type ShortcutCategory,
} from "@/lib/keymap";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";

const TABS: ShortcutCategory[] = ["timeline", "player", "basic", "other"];

/** An action's keys as CapCut draws them: glyphs bare, named keys on a light badge. */
export const KeyBadges: React.FC<{ labels: string[]; dim?: boolean }> = ({ labels, dim }) => (
  <span className={cn("flex items-center gap-[10px]", dim && "opacity-40")}>
    {labels.map((k, i) =>
      NAMED_KEYS.has(k) || k.length > 2 ? (
        <span key={i} className="h-[15px] px-[4px] rounded-[3px] bg-brand-lighter text-[#141414] text-[10px] font-semibold leading-[15px]">
          {k}
        </span>
      ) : (
        <span key={i} className="min-w-[12px] text-center text-[15px] font-semibold text-brand-lighter leading-none">
          {k}
        </span>
      ),
    )}
  </span>
);

const sameBindings = (a: Record<string, string[]>, b: Record<string, string[]>) => JSON.stringify(presetChanges(a)) === JSON.stringify(presetChanges(b));

export const ShortcutsWindow: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void }> = ({ open, onOpenChange }) => {
  const t = useT();
  const prefs = usePreferencesStore((s) => s.prefs);
  const save = usePreferencesStore((s) => s.save);
  const [tab, setTab] = useState<ShortcutCategory>("timeline");
  const [preset, setPreset] = useState(prefs.shortcutPreset);
  // Each preset's keys as edited here.
  const [drafts, setDrafts] = useState<Record<number, Record<string, string[]>>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ id: string; with: string } | null>(null);

  const saved = (p: number) => bindingsFor(prefs, p);

  // Each opening starts from what's saved.
  useEffect(() => {
    if (!open) return;
    const p = usePreferencesStore.getState().prefs;
    setPreset(p.shortcutPreset);
    setDrafts(Object.fromEntries(PRESETS.map((n) => [n, bindingsFor(p, n)])));
    setEditing(null);
    setConflict(null);
  }, [open]);

  const bindings = drafts[preset] ?? saved(preset);
  const setBindings = (next: Record<string, string[]>) => setDrafts((d) => ({ ...d, [preset]: next }));

  const dirty = useMemo(
    () => preset !== prefs.shortcutPreset || PRESETS.some((n) => drafts[n] && !sameBindings(drafts[n], saved(n))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, preset, prefs],
  );

  // The field being edited takes the next press (Escape lets it go).
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setEditing(null);
        setConflict(null);
        return;
      }
      const chord = chordOf(e);
      if (!chord) return;
      const c = normalizeChord(chord);
      const other = actionUsing(bindings, c, editing);
      if (other) {
        setConflict({ id: editing, with: other.id });
        return;
      }
      setConflict(null);
      setBindings({ ...bindings, [editing]: [c] });
      setEditing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, bindings]);

  const rows = ACTIONS.filter((x) => x.category === tab);
  const half = Math.ceil(rows.length / 2);
  const columns = [rows.slice(0, half), rows.slice(half)];
  const labelOf = (id: string) => t(ACTIONS.find((x) => x.id === id)!.label);

  const Row = (x: ShortcutAction) => {
    const editable = !x.missing && !x.fixed;
    const isEditing = editing === x.id;
    const labels = actionLabels(x, bindings);
    return (
      <div
        key={x.id}
        data-testid={`shortcut-row-${x.id}`}
        data-keys={(bindings[x.id] ?? []).join(" ")}
        data-missing={x.missing ? "true" : undefined}
        title={x.missing ? t("shortcuts.notYet") : x.fixed ? t("shortcuts.fixed") : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!editable) return;
          setConflict(null);
          setEditing(x.id);
        }}
        className={cn("relative h-10 flex items-center justify-between gap-3 px-6", editable ? "cursor-pointer hover:bg-white/[0.03]" : "cursor-default")}
      >
        <span className={cn("text-[13px] text-left leading-[14px] max-w-[190px]", x.missing ? "text-[#626262]" : "text-brand-light")}>{t(x.label)}</span>
        {isEditing ? (
          <span className="flex items-center gap-1.5">
            <span
              data-testid="shortcut-field"
              title={t("shortcuts.modify")}
              className="h-[29px] min-w-[110px] px-3 rounded-[4px] border border-[#5a5a5a] bg-brand flex items-center justify-end"
            >
              {labels.length ? <KeyBadges labels={labels} /> : <span className="text-[11px] text-[#7a7a7a]">{t("shortcuts.press")}</span>}
            </span>
            <button
              type="button"
              data-testid="shortcut-clear"
              title={t("shortcuts.clear")}
              onClick={(e) => {
                e.stopPropagation();
                setBindings({ ...bindings, [x.id]: [] });
                setConflict(null);
                setEditing(null);
              }}
              className="text-[#7a7a7a] hover:text-brand-lighter cursor-pointer"
            >
              <LuX className="w-3.5 h-3.5" />
            </button>
          </span>
        ) : (
          <span className="pr-[18px]">
            <KeyBadges labels={labels} dim={x.missing} />
          </span>
        )}
        {conflict?.id === x.id && (
          <span data-testid="shortcut-conflict" className="absolute right-6 -bottom-[13px] z-10 rounded-[4px] bg-[#1c1c1c] border border-[#eb4646]/60 px-2 py-[1px] text-[11px] text-[#ff6b6b] whitespace-nowrap">
            {t("shortcuts.conflict", { action: labelOf(conflict.with) })}
          </span>
        )}
      </div>
    );
  };

  const close = () => onOpenChange(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <DialogPrimitive.Content
          data-testid="shortcuts-window"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            // Escape lets go of the field being edited, not the window.
            if (editing) e.preventDefault();
          }}
          onClick={() => {
            setEditing(null);
            setConflict(null);
          }}
          className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[718px] max-h-[calc(100vh-24px)] flex flex-col rounded-[12px] border border-[#3c3c3c] bg-brand-background shadow-[0_16px_48px_rgba(0,0,0,0.55)] font-poppins outline-none select-none overflow-hidden"
        >
          <div className="relative h-[34px] shrink-0 bg-brand-header flex items-center justify-center border-b border-black/60">
            <button type="button" aria-label="Close" data-testid="shortcuts-close" onClick={close} className="absolute left-3 h-3 w-3 rounded-full bg-[#ff5f57] hover:brightness-110 cursor-pointer" />
            <DialogPrimitive.Title className="text-[13px] font-semibold text-brand-lighter">{t("shortcuts.title")}</DialogPrimitive.Title>
          </div>
          <div className="shrink-0 flex items-center justify-between px-[15px] pt-[14px]">
            <div role="tablist" className="h-6 rounded-[4px] bg-brand-background-dark/60 flex">
              {TABS.map((id) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  data-testid={`shortcuts-tab-${id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTab(id);
                    setEditing(null);
                    setConflict(null);
                  }}
                  className={cn("h-6 w-[70px] rounded-[4px] text-[12px] font-semibold cursor-pointer", tab === id ? "bg-brand-background-light text-brand-lighter" : "text-brand-light hover:text-brand-lighter")}
                >
                  {t(`shortcuts.tab.${id}`)}
                </button>
              ))}
            </div>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                data-testid="shortcuts-preset"
                onClick={(e) => e.stopPropagation()}
                className="h-6 w-[146px] rounded-[4px] bg-brand-background-light px-2 flex items-center justify-between text-[12px] font-medium text-brand-lighter outline-none cursor-pointer"
              >
                {t("shortcuts.preset", { n: preset })}
                <LuChevronDown className="w-3.5 h-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="dark z-[130] w-[146px] bg-brand-header border-[0.5px] border-black shadow-[0_0_0_0.5px_#494949,0_8px_24px_rgba(0,0,0,0.5)] rounded-[8px] p-1">
                {PRESETS.map((n) => (
                  <DropdownMenuItem
                    key={n}
                    data-testid="shortcuts-preset-option"
                    onSelect={() => {
                      setPreset(n);
                      setEditing(null);
                      setConflict(null);
                    }}
                    className="dark h-8 text-[13px] text-brand-light gap-2 px-2 rounded-[4px] cursor-pointer focus:bg-brand-hover"
                  >
                    <span className="w-4 flex justify-center text-brand-accent">{n === preset && <LuCheck className="w-3.5 h-3.5" />}</span>
                    {t("shortcuts.preset", { n })}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div data-testid={`shortcuts-list-${tab}`} className="mx-[15px] mt-[14px] max-h-[500px] overflow-y-auto custom-scrollbar rounded-[6px] bg-brand-background-dark py-4">
            <div className="grid grid-cols-2">
              {columns.map((col, i) => (
                <div key={i} className={cn("flex flex-col", i === 0 && "border-r border-brand-header")}>
                  {col.map(Row)}
                </div>
              ))}
            </div>
          </div>
          <div className="h-[53px] shrink-0 flex items-center justify-between px-[15px]">
            <button
              type="button"
              data-testid="shortcuts-reset"
              onClick={(e) => {
                e.stopPropagation();
                setBindings(bindingsFor(DEFAULT_PREFERENCES, preset));
                setEditing(null);
                setConflict(null);
              }}
              className="h-7 px-5 rounded-[4px] bg-brand-button text-[12px] font-semibold text-brand-lighter hover:bg-[#5a5a5a] cursor-pointer"
            >
              {t("shortcuts.reset")}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="shortcuts-save"
                disabled={!dirty}
                onClick={async (e) => {
                  e.stopPropagation();
                  const presets: Record<string, Record<string, string[]>> = { ...prefs.shortcutPresets };
                  for (const n of PRESETS) if (drafts[n]) presets[String(n)] = presetChanges(drafts[n]);
                  for (const k of Object.keys(presets)) if (!Object.keys(presets[k]).length) delete presets[k];
                  await save({ shortcutPreset: preset, shortcutPresets: presets });
                  close();
                }}
                className="h-7 w-[64px] rounded-[4px] bg-brand-accent text-[12px] font-semibold text-white hover:bg-brand-accent-shade disabled:bg-[#3a2e45] disabled:text-white/40 disabled:cursor-not-allowed cursor-pointer"
              >
                {t("shortcuts.save")}
              </button>
              <button type="button" data-testid="shortcuts-cancel" onClick={close} className="h-7 w-[64px] rounded-[4px] bg-brand-button text-[12px] font-semibold text-brand-lighter hover:bg-[#5a5a5a] cursor-pointer">
                {t("shortcuts.cancel")}
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default ShortcutsWindow;
