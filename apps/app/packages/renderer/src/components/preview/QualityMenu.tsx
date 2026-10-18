import React from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { usePlayerStore, type PreviewQuality } from "@/lib/player";
import Boxed from "./Boxed";
import { MENU_PANEL, TickGlyph, useOwnerDocument } from "./player-ui";

/** CapCut's four, in its words. The button shows the first word. */
const QUALITIES: { value: PreviewQuality; label: string; title: string; note: string }[] = [
  { value: "full", label: "Full", title: "Full quality", note: "Original video resolution" },
  { value: "high", label: "High", title: "High quality", note: "Smooth playback, no impact on exported video" },
  { value: "medium", label: "Medium", title: "Medium quality", note: "Smoother playback, no impact on exported video" },
  { value: "low", label: "Low", title: "Low quality", note: "Smoothest playback, no impact on exported video" },
];

/**
 * The preview's quality while playing, as CapCut's menu under the bottom bar's boxed "Full":
 * 329 wide, two-line rows (the name, then what it does in grey), the accent tick at the left.
 * Playback renders at a fraction of the canvas's size on screen (lib/player.ts `QUALITY_SCALE`);
 * paused frames and exports aren't affected.
 */
const QualityMenu: React.FC = () => {
  const quality = usePlayerStore((s) => s.quality);
  const setQuality = usePlayerStore((s) => s.setQuality);
  const [ref, doc] = useOwnerDocument<HTMLButtonElement>();
  const current = QUALITIES.find((q) => q.value === quality) ?? QUALITIES[0];
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        ref={ref}
        title={current.title}
        data-testid="preview-quality"
        data-quality={quality}
        className="h-6 px-1 flex items-center rounded-[4px] text-[#cecece] hover:text-brand-lighter hover:bg-brand-light/[0.08] transition-colors cursor-pointer outline-none"
      >
        <Boxed>{current.label}</Boxed>
      </Menu.Trigger>
      <Menu.Portal container={doc?.body}>
        <Menu.Content data-testid="quality-menu" align="start" side="bottom" sideOffset={6} className={`${MENU_PANEL} w-[329px]`}>
          {QUALITIES.map((q) => (
            <Menu.Item
              key={q.value}
              data-testid={`quality-${q.value}`}
              onSelect={() => setQuality(q.value)}
              className="relative h-[46px] my-0.5 flex flex-col justify-center gap-[4px] rounded-[4px] pl-[38px] pr-2 outline-none cursor-pointer select-none data-[highlighted]:bg-brand-hover"
            >
              {quality === q.value && <TickGlyph className="absolute left-[14px] top-[9px] w-3 h-3 text-brand-accent" />}
              <span className="text-[13px] leading-none font-semibold text-brand-lighter">{q.title}</span>
              <span className="text-[11.5px] leading-none whitespace-nowrap text-[#7a7a7a]">{q.note}</span>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
};

export default QualityMenu;
