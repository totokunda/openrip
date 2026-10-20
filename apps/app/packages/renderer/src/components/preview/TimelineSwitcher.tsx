import React, { useEffect, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useClipStore } from "@/lib/clip";
import { deleteTimeline, duplicateTimeline, newTimelineFromMenu, renameTimeline, switchTimeline } from "@/lib/timelines";
import { ChevronGlyph, MENU_CHECK_ROW, MENU_PANEL, MENU_ROW, MENU_SEPARATOR, TickGlyph, useOwnerDocument } from "./player-ui";

/**
 * The player's title, as CapCut's ("Player-Timeline 01"), is where the project's timelines
 * are: it opens a menu to switch between them, make a new one, and rename, duplicate or delete
 * the one being edited (File ▸ New timeline does the same from the menu bar). The player, the
 * inspector, the timeline and undo follow the timeline picked (lib/timelines.ts).
 */
const TimelineSwitcher: React.FC = () => {
  const [ref, doc] = useOwnerDocument<HTMLButtonElement>();
  const timelines = useClipStore((s) => s.projectTimelines);
  const activeId = useClipStore((s) => s.activeTimelineId);
  const active = timelines.find((t) => t.id === activeId);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  const startRename = () => {
    setDraft(active?.name ?? "");
    setRenaming(true);
  };
  const finishRename = (keep: boolean) => {
    setRenaming(false);
    if (keep && active) renameTimeline(active.id, draft);
  };

  if (renaming) {
    return (
      <span className="flex-1 min-w-0 flex items-center text-[13px] text-white">
        Player<span className="text-brand-light/45">-</span>
        <input
          ref={input}
          autoFocus
          data-testid="timeline-rename-input"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finishRename(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") finishRename(true);
            else if (e.key === "Escape") finishRename(false);
          }}
          className="h-[22px] min-w-0 w-[160px] rounded-[4px] bg-[#343337] px-1.5 text-[13px] text-white outline-none focus:ring-1 focus:ring-brand-accent/60"
        />
      </span>
    );
  }

  const name = active?.name ?? "Timeline 01";
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        ref={ref}
        title="Timelines"
        data-testid="timeline-switcher"
        className="flex-1 min-w-0 flex items-center gap-1 text-left text-[13px] text-white outline-none cursor-pointer"
      >
        <span className="truncate" data-testid="player-title">
          Player<span className="text-brand-light/45">-{name}</span>
        </span>
        <ChevronGlyph className="shrink-0 w-[6px] h-[9px] text-brand-light/45 rotate-90" />
      </Menu.Trigger>
      <Menu.Portal container={doc?.body}>
        <Menu.Content data-testid="timeline-menu" align="start" sideOffset={2} className={`${MENU_PANEL} min-w-[220px] max-w-[320px]`} onCloseAutoFocus={(e) => e.preventDefault()}>
          {timelines.map((t) => (
            <Menu.Item key={t.id} data-testid={`timeline-item-${t.name}`} data-active={t.id === activeId ? "true" : "false"} onSelect={() => switchTimeline(t.id)} className={MENU_CHECK_ROW}>
              {t.id === activeId && <TickGlyph className="absolute left-3 w-3 h-3 text-brand-accent" />}
              <span className="truncate">{t.name}</span>
            </Menu.Item>
          ))}
          <Menu.Separator className={MENU_SEPARATOR} />
          <Menu.Item data-testid="timeline-new" onSelect={() => newTimelineFromMenu()} className={MENU_ROW}>
            New timeline
          </Menu.Item>
          <Menu.Item data-testid="timeline-rename" onSelect={() => setTimeout(startRename, 0)} className={MENU_ROW}>
            Rename timeline
          </Menu.Item>
          <Menu.Item data-testid="timeline-duplicate" onSelect={() => duplicateTimeline()} className={MENU_ROW}>
            Duplicate timeline
          </Menu.Item>
          <Menu.Item data-testid="timeline-delete" disabled={timelines.length < 2} onSelect={() => deleteTimeline(activeId)} className={MENU_ROW}>
            Delete timeline
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
};

export default TimelineSwitcher;
