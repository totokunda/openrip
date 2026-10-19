import React, { useEffect, useMemo, useRef, useState } from "react";
import { LuPlus, LuSearch } from "react-icons/lu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TEMPLATE_CATEGORIES, TEXT_TEMPLATES, templateMatches, templatesIn, textTemplate, type TextTemplate } from "@/lib/text-templates";
import { LOOP_FPS, addTemplate, templateLoop, templateStill, useTemplateLibrary, type PreviewFrame } from "@/lib/text-template-actions";
import { PREVIEW_SIZE } from "@/lib/effects/catalog";
import { cn } from "@/lib/utils";

/** The Text tab's column of templates: Favorites, then All and the categories under Text templates. */
export const TEMPLATE_SECTIONS = [
  { id: "templates:Favorites", label: "Favorites", under: "Text template" },
  { id: "templates:All", label: "All", under: "Text template" },
  ...TEMPLATE_CATEGORIES.map((c) => ({ id: `templates:${c}`, label: c, under: "Text template" })),
];

/** What a template tile carries when dragged. */
const DRAG_TYPE = "application/x-openrip-text-template";

/** Where a dragged template can be let go: the timeline or the player. */
const dropZone = (target: EventTarget | null) => (target as Element | null)?.closest?.("[data-testid=timeline], [data-testid=player]") ?? null;

/** A template let go over the timeline or the player is added at the playhead, as "+" adds it. */
const useTemplateDrop = () =>
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(DRAG_TYPE) && dropZone(e.target)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const drop = (e: DragEvent) => {
      const template = e.dataTransfer?.types.includes(DRAG_TYPE) ? textTemplate(e.dataTransfer.getData(DRAG_TYPE)) : undefined;
      if (!template || !dropZone(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      useTemplateLibrary.getState().setPreview(null);
      void addTemplate(template);
    };
    document.addEventListener("dragover", over, true);
    document.addEventListener("drop", drop, true);
    return () => {
      document.removeEventListener("dragover", over, true);
      document.removeEventListener("drop", drop, true);
    };
  }, []);

const Star: React.FC<{ on: boolean }> = ({ on }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
    <path d="M6 1.2 7.5 4.4l3.5.5-2.5 2.4.6 3.5L6 9.1 2.9 10.8l.6-3.5L1 4.9l3.5-.5z" />
  </svg>
);

/** Draw a frame, letterboxed, on a tile's canvas. */
const draw = (canvas: HTMLCanvasElement | null, frame: PreviewFrame | null | undefined, backdrop: string) => {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || !frame) return;
  const data = new Uint8ClampedArray(frame.rgba.buffer, frame.rgba.byteOffset, frame.width * frame.height * 4);
  const img = new ImageData(data, frame.width, frame.height);
  const k = Math.min(canvas.width / frame.width, canvas.height / frame.height);
  const [w, h] = [frame.width * k, frame.height * k];
  const scratch = document.createElement("canvas");
  scratch.width = frame.width;
  scratch.height = frame.height;
  scratch.getContext("2d")!.putImageData(img, 0, 0);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(scratch, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
};

/** What a tile shows: the template drawn by the engine, still until the pointer is over it, then playing. */
const TemplatePicture: React.FC<{ template: TextTemplate; hover: boolean }> = ({ template, hover }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const still = useRef<PreviewFrame | null>(null);
  const [ready, setReady] = useState(false);
  const back = template.backdrop ?? "#1d1b22";
  useEffect(() => {
    let live = true;
    void templateStill(template).then((f) => {
      if (!live || !f) return;
      still.current = f;
      draw(ref.current, f, back);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [template]);
  useEffect(() => {
    if (!hover) {
      draw(ref.current, still.current, back);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    void templateLoop(template).then((frames) => {
      if (!live || frames.length === 0) return;
      let i = 0;
      draw(ref.current, frames[0], back);
      timer = setInterval(() => {
        i = (i + 1) % frames.length;
        draw(ref.current, frames[i], back);
      }, 1000 / LOOP_FPS);
    });
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [template, hover]);
  return <canvas ref={ref} width={PREVIEW_SIZE} height={PREVIEW_SIZE} data-ready={ready ? "1" : "0"} data-testid="text-template-picture" className="w-full h-full pointer-events-none" />;
};

/**
 * One tile, as CapCut's library tiles: an 86 px rounded square showing the template, its name
 * under it. Hovered, it plays and a star (favourite) and a round "+" (add at the playhead) sit at
 * the bottom-right. Clicked, it's previewed in the player and nothing is added. Dragged onto the
 * timeline or the player it's added at the playhead.
 */
const TemplateTile: React.FC<{ template: TextTemplate; active: boolean; favourite: boolean }> = ({ template, active, favourite }) => {
  const [hover, setHover] = useState(false);
  const toggleFavourite = useTemplateLibrary((s) => s.toggleFavourite);
  const setPreview = useTemplateLibrary((s) => s.setPreview);
  const circle = "w-[18px] h-[18px] rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center";
  return (
    <div className="flex flex-col gap-1.5 w-[86px]" data-testid={`text-template-card-${template.id}`}>
      <div
        role="button"
        tabIndex={0}
        draggable
        title={template.name}
        data-testid="text-template-tile"
        data-template={template.id}
        data-category={template.category}
        aria-pressed={active}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => setPreview(active ? null : template)}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, template.id);
          e.dataTransfer.effectAllowed = "copy";
          setHover(false);
        }}
        className={cn("relative w-[86px] h-[86px] rounded-[6px] bg-brand-background-light overflow-hidden cursor-pointer outline-none", active && "ring-[1.5px] ring-brand-accent")}
      >
        <TemplatePicture template={template} hover={hover} />
        {hover && (
          <div className="absolute right-1 bottom-1 flex items-center gap-1">
            <button
              type="button"
              title={favourite ? "Remove from Favorites" : "Add to Favorites"}
              aria-label={favourite ? "Remove from Favorites" : "Add to Favorites"}
              aria-pressed={favourite}
              data-testid="text-template-favourite"
              onClick={(e) => {
                e.stopPropagation();
                toggleFavourite(template.id);
              }}
              className={cn(circle, favourite ? "text-brand-accent" : "text-white")}
            >
              <Star on={favourite} />
            </button>
            <button
              type="button"
              title={`Add ${template.name}`}
              aria-label={`Add ${template.name}`}
              data-testid="text-template-add"
              onClick={(e) => {
                e.stopPropagation();
                setPreview(null);
                void addTemplate(template);
              }}
              className={cn(circle, "text-white")}
            >
              <LuPlus className="w-3 h-3" />
            </button>
          </div>
        )}
        {!hover && favourite && (
          <span className={cn(circle, "absolute right-1 bottom-1 text-brand-accent pointer-events-none")} data-testid="text-template-favourite-mark">
            <Star on />
          </span>
        )}
      </div>
      <span className={cn("text-[12px] leading-none truncate text-left", active ? "text-brand-light" : "text-[#949494]")}>{template.name}</span>
    </div>
  );
};

/**
 * The Text tab's templates, in CapCut's layout: a search field, then the picked part of the column
 * (Favorites, All, or a category) as 86 px tiles under its name. The search looks through every
 * template (its name, category and words).
 */
const TextTemplatesMenu: React.FC<{ part?: string }> = ({ part = "templates:All" }) => {
  const [query, setQuery] = useState("");
  const favourites = useTemplateLibrary((s) => s.favourites);
  const preview = useTemplateLibrary((s) => s.preview);
  useTemplateDrop();
  // A preview lasts while the tab shows.
  useEffect(() => () => useTemplateLibrary.getState().setPreview(null), []);

  const category = part.startsWith("templates:") ? part.slice("templates:".length) : "All";
  const q = query.trim();
  const shown = useMemo(() => {
    if (q) return TEXT_TEMPLATES.filter((t) => templateMatches(t, q));
    if (category === "Favorites") return TEXT_TEMPLATES.filter((t) => favourites.includes(t.id));
    return templatesIn(category as (typeof TEMPLATE_CATEGORIES)[number] | "All");
  }, [q, category, favourites]);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-3 pb-8" data-testid="text-templates">
        <label className="h-[26px] flex flex-row items-center gap-1.5 px-2.5 rounded-[4px] bg-brand border border-transparent focus-within:border-[#515151]">
          <LuSearch className="w-3.5 h-3.5 text-[#949494] shrink-0" />
          <input
            data-testid="text-templates-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search text templates"
            className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-lighter placeholder:text-[#6c6c6c] outline-none"
          />
        </label>
        {!q && <h3 className="text-[12px] text-brand-light text-left">{category}</h3>}
        <div className="grid gap-x-4 gap-y-[24px]" style={{ gridTemplateColumns: "repeat(auto-fill, 86px)" }}>
          {shown.map((t) => (
            <TemplateTile key={t.id} template={t} active={preview?.id === t.id} favourite={favourites.includes(t.id)} />
          ))}
        </div>
        {!shown.length && (
          <p className="text-[12px] text-[#6c6c6c] py-6">{q ? `No templates match “${query}”` : "Star a template to keep it here."}</p>
        )}
      </div>
    </ScrollArea>
  );
};

export default TextTemplatesMenu;
