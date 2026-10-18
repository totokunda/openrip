import React, { useEffect } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { usePlayerStore, SCOPE_KINDS, type ScopeKind } from "@/lib/player";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { addGuide, clearGuides } from "@/lib/guides";
import { zoomFit, zoomIn, zoomOut } from "@/lib/player-zoom";
import { exportStillFrame } from "@/lib/still";
import { ChevronGlyph, Keys, MENU_CHECK_ROW, MENU_PANEL, MENU_ROW, MENU_SEPARATOR, MenuGlyph, TickGlyph, useOwnerDocument } from "./player-ui";

const SCOPE_NAMES: Record<ScopeKind, string> = { parade: "RGB parade", waveform: "Waveform", vectorscope: "Vectorscope" };

const editable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/**
 * The player's keys, CapCut's (Shortcuts ▸ Player): ⌘⌥R rulers, ⌘; guides, ⌘⇧F full screen,
 * ⌥⇧+ / ⌥⇧− zoom, ⌥⇧Z zoom to fit. Listened for in the player's window and the editor's.
 */
export function usePlayerShortcuts(doc: Document | null) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || editable(e.target)) return;
      const p = usePlayerStore.getState();
      let done = true;
      if (e.metaKey && e.altKey && !e.shiftKey && e.code === "KeyR") p.setRulers(!p.rulers);
      else if (e.metaKey && !e.altKey && !e.shiftKey && e.code === "Semicolon") p.setShowGuides(!p.showGuides);
      else if (e.metaKey && e.shiftKey && !e.altKey && e.code === "KeyF") {
        const c = useControlsStore.getState();
        c.setIsFullscreen(!c.isFullscreen);
      } else if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === "Equal") zoomIn();
      else if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === "Minus") zoomOut();
      else if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === "KeyZ") zoomFit();
      else done = false;
      if (done) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const wins = new Set<Window>([window]);
    if (doc?.defaultView) wins.add(doc.defaultView);
    wins.forEach((w) => w.addEventListener("keydown", onKey, true));
    return () => wins.forEach((w) => w.removeEventListener("keydown", onKey, true));
  }, [doc]);
}

const Check: React.FC<{ on: boolean }> = ({ on }) => (on ? <TickGlyph className="absolute left-3 w-3 h-3 text-brand-accent" /> : null);

/** A submenu row with CapCut's › at its right. */
const SubRow: React.FC<{ testId: string; children: React.ReactNode }> = ({ testId, children }) => (
  <Menu.SubTrigger data-testid={testId} className={MENU_ROW}>
    {children}
    <ChevronGlyph className="ml-auto w-[7px] h-[11px] text-brand-light/80" />
  </Menu.SubTrigger>
);

/**
 * The player's header menu (☰ at its right), as CapCut's: Color oscilloscope ›, Guides and
 * rulers ›, Export still frames. 200 wide, 32 px rows.
 */
const PlayerMenu: React.FC = () => {
  const [ref, doc] = useOwnerDocument<HTMLButtonElement>();
  usePlayerShortcuts(doc);
  const scopes = usePlayerStore((s) => s.scopes);
  const setScopes = usePlayerStore((s) => s.setScopes);
  const kinds = usePlayerStore((s) => s.scopeKinds);
  const toggleKind = usePlayerStore((s) => s.toggleScopeKind);
  const rulers = usePlayerStore((s) => s.rulers);
  const setRulers = usePlayerStore((s) => s.setRulers);
  const showGuides = usePlayerStore((s) => s.showGuides);
  const setShowGuides = usePlayerStore((s) => s.setShowGuides);
  const guideCount = useClipStore((s) => (s.guides ?? []).length);
  const hasClips = useClipStore((s) => s.clips.length > 0);
  const container = doc?.body;
  const sub = `${MENU_PANEL} min-w-[200px]`;

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        ref={ref}
        title="Player menu"
        data-testid="player-menu"
        className="h-6 w-6 flex items-center justify-center rounded-[4px] text-[#67676f] hover:text-brand-light hover:bg-brand-light/[0.08] data-[state=open]:text-brand-light transition-colors cursor-pointer outline-none"
      >
        <MenuGlyph className="w-[13px] h-[11px]" />
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Content data-testid="player-menu-content" align="end" sideOffset={6} className={`${MENU_PANEL} w-[200px]`}>
          <Menu.Sub>
            <SubRow testId="menu-oscilloscope">Color oscilloscope</SubRow>
            <Menu.Portal container={container}>
              <Menu.SubContent data-testid="oscilloscope-menu" sideOffset={6} alignOffset={-4} className={sub}>
                <Menu.CheckboxItem data-testid="scopes-show" checked={scopes} onCheckedChange={(on) => setScopes(on === true)} className={MENU_CHECK_ROW}>
                  <Check on={scopes} />
                  Show
                </Menu.CheckboxItem>
                <Menu.Separator className={MENU_SEPARATOR} />
                {SCOPE_KINDS.map((k) => (
                  <Menu.CheckboxItem
                    key={k}
                    data-testid={`scope-kind-${k}`}
                    checked={kinds.includes(k)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => {
                      toggleKind(k);
                      if (!scopes) setScopes(true);
                    }}
                    className={MENU_CHECK_ROW}
                  >
                    <Check on={kinds.includes(k)} />
                    {SCOPE_NAMES[k]}
                  </Menu.CheckboxItem>
                ))}
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Sub>
            <SubRow testId="menu-guides">Guides and rulers</SubRow>
            <Menu.Portal container={container}>
              <Menu.SubContent data-testid="guides-menu" sideOffset={6} alignOffset={-4} className={`${sub} min-w-[232px]`}>
                <Menu.CheckboxItem data-testid="rulers-show" checked={rulers} onCheckedChange={(on) => setRulers(on === true)} className={MENU_CHECK_ROW}>
                  <Check on={rulers} />
                  Show rulers
                  <Keys>⌘⌥R</Keys>
                </Menu.CheckboxItem>
                <Menu.CheckboxItem data-testid="guides-show" checked={showGuides} onCheckedChange={(on) => setShowGuides(on === true)} className={MENU_CHECK_ROW}>
                  <Check on={showGuides} />
                  Show guides
                  <Keys>⌘;</Keys>
                </Menu.CheckboxItem>
                <Menu.Separator className={MENU_SEPARATOR} />
                <Menu.Item data-testid="guide-add-horizontal" onSelect={() => addGuide("y")} className={MENU_CHECK_ROW}>
                  Add horizontal guide
                </Menu.Item>
                <Menu.Item data-testid="guide-add-vertical" onSelect={() => addGuide("x")} className={MENU_CHECK_ROW}>
                  Add vertical guide
                </Menu.Item>
                <Menu.Item data-testid="guides-clear" disabled={guideCount === 0} onSelect={() => clearGuides()} className={MENU_CHECK_ROW}>
                  Clear guides
                </Menu.Item>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Item data-testid="export-still" disabled={!hasClips} onSelect={() => void exportStillFrame()} className={MENU_ROW}>
            Export still frames
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
};

export default PlayerMenu;
