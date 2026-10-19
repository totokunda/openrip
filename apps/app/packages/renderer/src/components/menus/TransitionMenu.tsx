import React, { useRef, useState } from "react";
import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { LuPlus } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TransitionPreview } from "@/components/motion/Previews";
import type { BuiltinTransition } from "@/lib/animations";
import { useControlsStore } from "@/lib/control";
import { useClipStore } from "@/lib/clip";
import { applyTransition, cutForSelection, offeredTransitions, projectBlink, takesTransition } from "@/lib/transitions";
import type { VideoClipProps } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTransitionFavourites } from "@/lib/transition-favourites";

/** What a transition card carries when dragged onto a cut (TimelineEditor drops it). */
export type TransitionDrag = { type: "transition"; transition: string };

/**
 * One card, as CapCut's library tiles: an 86 px square showing the transition between two
 * shots (played while hovered), its name under it; hovered, a round "+" at its bottom-right
 * gives it to the selected clip's cut. The card itself drags onto a cut on the timeline.
 */
const TransitionCard: React.FC<{ t: BuiltinTransition; active: boolean; canAdd: boolean; onAdd: () => void }> = ({ t, active, canAdd, onAdd }) => {
  const [hover, setHover] = useState(false);
  const favourite = useTransitionFavourites((s) => s.favourites.includes(t.type));
  const toggleFavourite = useTransitionFavourites((s) => s.toggle);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `transition:${t.type}`,
    data: { type: "transition", transition: t.type } satisfies TransitionDrag,
  });
  return (
    <div className="flex flex-col gap-1.5 w-[86px]" data-testid={`transition-card-${t.type}`}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        role="button"
        tabIndex={0}
        title={t.name}
        data-testid={`transition-${t.type}`}
        aria-pressed={active}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn(
          "relative w-[86px] h-[86px] rounded-[6px] bg-brand-background-light overflow-hidden cursor-pointer outline-none",
          active && "ring-[1.5px] ring-brand-accent",
          isDragging && "opacity-50",
        )}
      >
        <TransitionPreview kind={t.type} playing={hover} />
        {hover && (
          <div className="absolute right-1 bottom-1 flex items-center gap-1">
          <button
            type="button"
            title={favourite ? "Remove from Favorites" : "Add to Favorites"}
            aria-label={favourite ? "Remove from Favorites" : "Add to Favorites"}
            aria-pressed={favourite}
            data-testid={`transition-favourite-${t.type}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleFavourite(t.type);
            }}
            className={cn("w-[18px] h-[18px] rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80", favourite ? "text-brand-accent" : "text-white")}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill={favourite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
              <path d="M6 1.2 7.5 4.4l3.5.5-2.5 2.4.6 3.5L6 9.1 2.9 10.8l.6-3.5L1 4.9l3.5-.5z" />
            </svg>
          </button>
          <button
            type="button"
            title={canAdd ? `Add ${t.name}` : "Select a clip first"}
            data-testid={`transition-add-${t.type}`}
            disabled={!canAdd}
            // The card's drag starts on a press: the button keeps its own.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (canAdd) onAdd();
            }}
            className="w-[18px] h-[18px] rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <LuPlus className="w-3 h-3" />
          </button>
          </div>
        )}
        {!hover && favourite && (
          <span className="absolute right-1 bottom-1 w-[18px] h-[18px] rounded-full bg-black/60 text-brand-accent flex items-center justify-center pointer-events-none" data-testid="transition-favourite-mark">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
              <path d="M6 1.2 7.5 4.4l3.5.5-2.5 2.4.6 3.5L6 9.1 2.9 10.8l.6-3.5L1 4.9l3.5-.5z" />
            </svg>
          </span>
        )}
      </div>
      <span className={cn("text-[12px] leading-none truncate text-left", active ? "text-brand-light" : "text-[#949494]")}>{t.name}</span>
    </div>
  );
};

/**
 * The Transitions tab: the transitions the engine draws, in CapCut's grid, one category at a
 * time (picked in the tab's column). A card dragged onto a cut, or its "+" with a clip
 * selected, puts the transition on that cut (the selected clip's end, or the cut before it when
 * nothing follows it); the transition is then selected and its inspector shows.
 */
const TransitionMenu: React.FC<{ category?: string }> = ({ category }) => {
  const lastSelected = useControlsStore((s) => s.selectedClipIds[s.selectedClipIds.length - 1]);
  const selectedTransition = useControlsStore((s) => s.selectedTransitionId);
  // The cut "+" would fill: the selected clip's, or the selected transition's own.
  const target = useClipStore((s) => (lastSelected ? cutForSelection(s.clips, lastSelected) : selectedTransition));
  const current = useClipStore((s) => {
    const c = target ? s.getClipById(target) : undefined;
    return takesTransition(c) ? ((c as VideoClipProps).transitionOut?.type ?? null) : null;
  });
  const blink = useClipStore((s) => projectBlink(s.clips));
  // The app's drags start on a press (no distance to move first) and swallow the click that
  // ends them: a card pressed and let go where it was is a click, giving its transition to the
  // cut "+" would.
  const targetRef = useRef(target);
  targetRef.current = target;
  useDndMonitor({
    onDragEnd: (e) => {
      const data = e.active?.data?.current as TransitionDrag | undefined;
      if (data?.type !== "transition" || Math.hypot(e.delta.x, e.delta.y) > 3 || !targetRef.current) return;
      applyTransition(targetRef.current, data.transition);
    },
  });
  const offered = offeredTransitions(blink);
  const favourites = useTransitionFavourites((s) => s.favourites);
  const isFavourites = category === "favorites";
  const shown = isFavourites ? offered.filter((t) => favourites.includes(t.type)) : category ? offered.filter((t) => t.category === category) : offered;
  const heading = isFavourites ? "Favorites" : (category ?? "Transitions");

  const note = target
    ? null
    : lastSelected
      ? "A transition goes between two clips that meet on a track."
      : "Drag a transition onto a cut, or select a clip and click +.";

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col pl-3.5 pr-3 pt-[13px] pb-8 text-left">
        <h3 className="text-[12.5px] text-brand-light leading-none mb-3">{heading}</h3>
        {note && <p className="text-[11.5px] text-[#6c6c6c] leading-snug mb-3">{note}</p>}
        {isFavourites && shown.length === 0 && (
          <p className="text-[12px] text-[#6c6c6c] leading-snug py-6" data-testid="transitions-empty">
            No favorites yet. Hover a transition and click its star to keep it here.
          </p>
        )}
        <div className="grid gap-x-4 gap-y-[18px]" style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
          {shown.map((t) => (
            <TransitionCard key={t.type} t={t} active={current === t.type} canAdd={!!target} onAdd={() => target && applyTransition(target, t.type)} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
};

/** The card's picture while it's dragged (the app's drag overlay). */
export const TransitionDragTile: React.FC<{ type: string }> = ({ type }) => (
  <div className="relative w-[86px] h-[86px] rounded-[6px] overflow-hidden ring-[1.5px] ring-brand-accent shadow-lg">
    <TransitionPreview kind={type} playing />
  </div>
);

export default TransitionMenu;
