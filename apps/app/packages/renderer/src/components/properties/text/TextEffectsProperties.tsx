import React, { useState } from "react";
import { LuBan, LuSearch } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { TEXT_STYLES, isCapCutStyle, textEffectOf, textStyleCss, type BuiltinTextStyle } from "@/lib/text-styles";
import type { TextClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Text ▸ Effects, as CapCut's (docs/plan/capcut-ui-spec.md §6.20): a search field, category
 * chips and a grid of tiles, None first, the chosen one outlined in the accent. The tiles are
 * OpenRip's own styles (lib/text-styles.ts), previewed by the app with CSS; the engine draws
 * the real thing. A style goes on the text as its `textEffect`, in place of its colour and
 * stroke (styles that follow the text's colour keep Basic's). A converted CapCut text's
 * library style shows first, by name, until it's replaced.
 */

const CATEGORIES = ["All", "Outline", "Glow", "Shadow", "Gradient"] as const;
type Category = (typeof CATEGORIES)[number];

/** A 60×60-ish tile on `bg.raised`; chosen, a 1.5 px accent outline. */
const Tile: React.FC<{ title: string; active: boolean; onClick: () => void; testId: string; children: React.ReactNode }> = ({ title, active, onClick, testId, children }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    data-testid={testId}
    onClick={onClick}
    className={cn(
      "aspect-square w-full rounded-[6px] bg-brand-background-light flex items-center justify-center overflow-hidden transition-colors",
      active ? "outline outline-[1.5px] outline-brand-accent" : "hover:bg-brand-button",
    )}
  >
    {children}
  </button>
);

const TextEffectsProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as TextClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("All");
  if (!clip) return null;

  const current = clip.textEffect ?? null;
  const draftStyle = isCapCutStyle(current) ? current : null;
  const q = query.trim().toLowerCase();
  const styles = TEXT_STYLES.filter((s) => (category === "All" || s.category === category) && (!q || s.name.toLowerCase().includes(q)));
  const font = clip.fontFamily ?? "Arial";
  const preview = (s: BuiltinTextStyle) => (
    <span className="text-[24px] font-bold leading-none whitespace-nowrap" style={{ fontFamily: `"${font}"`, ...(textStyleCss(s.style, clip.color ?? "#ffffff", 24) as React.CSSProperties) }}>
      Aa
    </span>
  );

  return (
    <div className="px-3 pt-3 pb-6 flex flex-col gap-3 min-w-0" data-testid="text-effects">
      <label className="h-[26px] flex flex-row items-center gap-1.5 px-2.5 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
        <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
        <input
          data-testid="text-effects-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search text styles"
          className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none"
        />
      </label>
      <div className="flex flex-row flex-wrap gap-2" role="tablist" aria-label="Categories">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={cn("h-6 px-3 rounded-full text-[12px] font-semibold", category === c ? "bg-brand-button text-brand-light" : "bg-brand-background-light text-[#949494] hover:text-brand-light")}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-3">
        <Tile title="None" testId="text-effect-none" active={!current} onClick={() => updateClip(clipId, { textEffect: null })}>
          <LuBan className="w-6 h-6 text-brand-light/80" />
        </Tile>
        {draftStyle && (
          <Tile title={`From the draft: ${draftStyle.name ?? "CapCut style"}`} testId="text-effect-draft" active onClick={() => {}}>
            <span className="px-1 text-[10px] leading-tight text-brand-light text-center line-clamp-3">{draftStyle.name ?? "Draft style"}</span>
          </Tile>
        )}
        {styles.map((s) => (
          <Tile key={s.id} title={s.name} testId={`text-effect-${s.id}`} active={current?.id === s.id} onClick={() => updateClip(clipId, { textEffect: textEffectOf(s.id) })}>
            {preview(s)}
          </Tile>
        ))}
      </div>
      {!styles.length && <p className="text-[12px] text-[#6c6c6c] text-center py-4">No styles match “{query}”</p>}
      {draftStyle && <p className="text-[12px] leading-snug text-[#949494]">The draft's style is drawn from CapCut's own files and stays until you pick another style or None.</p>}
    </div>
  );
};

export default TextEffectsProperties;
