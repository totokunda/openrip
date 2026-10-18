import React from "react";
import { IoRefreshOutline } from "react-icons/io5";
import { LuX } from "react-icons/lu";
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import { DraftAdjustment, ImageClipProps, VideoClipProps } from "@/lib/types";
import PropertiesSlider from "./PropertiesSlider";

/**
 * A CapCut clip's own adjustments (`draftAdjustments`, from the engine's conversion): the
 * Adjust sliders, colour wheels and HSL ranges the engine draws, on CapCut's scale, curves
 * by name, and the rest (filters and effects on the clip) marked as not drawn. Each can be
 * taken off the clip; the header puts back the draft's own. The Adjust panel's sliders go on
 * top.
 */
const DraftAdjustProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as VideoClipProps | ImageClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const { isPlaying, pause } = useControlsStore();
  const list = clip?.draftAdjustments;
  // The draft's own list, as converted (what the importer compares against).
  const draft = ((clip as any)?.engine?.base?.draftAdjustments ?? []) as DraftAdjustment[];
  if (!clip || !list || draft.length === 0) return null;

  const set = (next: DraftAdjustment[]) => {
    if (isPlaying) pause();
    updateClip(clipId, { draftAdjustments: next });
  };
  const setValue = (id: string, value: number) => {
    if (!Number.isFinite(value)) return;
    set(list.map((e) => (e.id === id ? { ...e, value: Math.max(e.min ?? -Infinity, Math.min(e.max ?? Infinity, value)) } : e)));
  };
  // One of an adjustment's several sliders (`values`).
  const setPart = (id: string, key: string, value: number) => {
    if (!Number.isFinite(value)) return;
    set(
      list.map((e) =>
        e.id === id ? { ...e, values: e.values?.map((v) => (v.key === key ? { ...v, value: Math.max(v.min, Math.min(v.max, value)) } : v)) } : e,
      ),
    );
  };
  const remove = (id: string) => set(list.filter((e) => e.id !== id));
  const sameParts = (a?: DraftAdjustment["values"], b?: DraftAdjustment["values"]) =>
    (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((v, i) => v.value === b?.[i]?.value);
  const changed =
    list.length !== draft.length || list.some((e, i) => e.id !== draft[i]?.id || e.value !== draft[i]?.value || !sameParts(e.values, draft[i]?.values));
  const notDrawn = list.some((e) => !e.drawn);

  return (
    <div className="px-3 pb-4 min-w-0 text-left">
      {/* A header as the tab's other sections have (Section.tsx). */}
      <div className="flex flex-row items-center justify-between h-[55px]">
        <h4 className="text-brand-light text-[12px] font-semibold text-start">From the CapCut draft</h4>
        {changed && (
          <span title="Put back the draft's adjustments" onClick={() => set(draft)} className="text-brand-light text-sm cursor-pointer">
            <IoRefreshOutline />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-y-2">
        {list.map((e) => {
          const was = draft.find((d) => d.id === e.id);
          const removeButton = (
            <button
              title={`Remove ${e.name}`}
              aria-label={`Remove ${e.name}`}
              onClick={() => remove(e.id)}
              className="text-brand-light/60 hover:text-brand-light shrink-0 p-1 rounded hover:bg-brand-light/10"
            >
              <LuX className="w-3 h-3" />
            </button>
          );
          if (e.drawn && typeof e.value === "number") {
            return (
              <div key={e.id} className="flex flex-row items-end gap-x-1 min-w-0" data-draft-adjustment={e.kind}>
                <PropertiesSlider
                  label={e.name}
                  value={e.value}
                  onChange={(v) => setValue(e.id, v)}
                  min={e.min}
                  max={e.max}
                  step={1}
                  toFixed={0}
                  suffix={e.kind === "color_wheels" ? "%" : undefined}
                />
                {was && was.value !== e.value && (
                  <button
                    title={`Back to the draft's ${Math.round(was.value ?? 0)}`}
                    onClick={() => setValue(e.id, was.value ?? 0)}
                    className="text-brand-light/60 hover:text-brand-light shrink-0 p-1 rounded hover:bg-brand-light/10"
                  >
                    <IoRefreshOutline className="w-3 h-3" />
                  </button>
                )}
                {removeButton}
              </div>
            );
          }
          if (e.drawn && e.values?.length) {
            return (
              <div key={e.id} className="flex flex-col gap-y-1 min-w-0" data-draft-adjustment={e.kind}>
                <div className="flex flex-row items-center gap-x-2 min-w-0 h-6">
                  <span className="text-brand-light text-[10.5px] font-medium truncate">{e.name}</span>
                  <div className="flex flex-row ml-auto shrink-0">
                    {was && !sameParts(was.values, e.values) && (
                      <button
                        title="Back to the draft's values"
                        onClick={() => set(list.map((x) => (x.id === e.id ? { ...x, values: was.values } : x)))}
                        className="text-brand-light/60 hover:text-brand-light shrink-0 p-1 rounded hover:bg-brand-light/10"
                      >
                        <IoRefreshOutline className="w-3 h-3" />
                      </button>
                    )}
                    {removeButton}
                  </div>
                </div>
                {e.values.map((v) => (
                  <div key={v.key} data-draft-adjustment-part={v.key}>
                    <PropertiesSlider
                      label={v.name}
                      value={v.value}
                      onChange={(n) => setPart(e.id, v.key, n)}
                      min={v.min}
                      max={v.max}
                      step={1}
                      toFixed={0}
                    />
                  </div>
                ))}
              </div>
            );
          }
          return (
            <div key={e.id} className="flex flex-row items-center gap-x-2 min-w-0 h-7" data-draft-adjustment={e.kind}>
              <span className="text-brand-light text-[10.5px] font-medium truncate">{e.name}</span>
              {typeof e.value === "number" && <span className="text-brand-light/60 text-[10.5px]">{Math.round(e.value)}</span>}
              {!e.drawn && <span className="text-brand-light/40 text-[10px] ml-auto shrink-0">not drawn yet</span>}
              <span className={e.drawn ? "ml-auto" : ""}>{removeButton}</span>
            </div>
          );
        })}
        {list.length === 0 && <p className="text-brand-light/50 text-[10px] text-start">All removed from this clip.</p>}
      </div>
      <p className="text-brand-light/50 text-[10px] text-start mt-3">
        On CapCut&apos;s scale; the sliders below go on top.
        {notDrawn && " The engine doesn't draw the ones marked yet; CapCut's export has them."}
      </p>
    </div>
  );
};

export default DraftAdjustProperties;
