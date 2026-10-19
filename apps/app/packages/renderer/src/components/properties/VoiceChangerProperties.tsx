import React, { useMemo, useState } from "react";
import { LuSearch } from "react-icons/lu";
import PropertiesSlider from "./PropertiesSlider";
import { SmallCheckbox } from "./AudioProperties";
import { useClipStore } from "@/lib/clip";
import type { AnyClipProps, AudioClipProps, AudioEffect } from "@/lib/types";
import {
  AUDIO_EFFECT_GROUPS,
  AUDIO_EFFECT_KINDS,
  AUDIO_EFFECT_PRESETS,
  applyEffectsToAll,
  applyPreset,
  clearAudioEffects,
  paramValue,
  paramsOf,
  setEffectParam,
  type AudioEffectGroup,
  type AudioEffectPreset,
} from "@/lib/audio-effects";
import { cn } from "@/lib/utils";
import { parseStrings, useStoredList } from "@/lib/user-store";

/**
 * The Audio tab's Voice changer, as CapCut's Voice filters (docs/plan/capcut-ui-spec.md §6.19,
 * `20-inspector-audio/003`): Apply to all, a search field, the groups as chips, then the filters
 * as 60 px tiles on a 78 px pitch, None first and the one on the clip outlined in the accent.
 * The filters are OpenRip's own presets (lib/audio-effects.ts), classic DSP the engine plays;
 * picking one replaces what the clip had, as CapCut's does. The picked filter's sliders (its
 * own parameters, then Strength) sit above the tiles. A clip converted from a CapCut draft
 * shows the draft's own voice filter as a tile of its own, with no sliders: CapCut's bundle
 * plays as it is.
 */

/** Which preset an effect came from (its kind and name), if any. */
const presetOf = (e: AudioEffect | undefined): AudioEffectPreset | undefined =>
  e && e.type !== "draft" ? AUDIO_EFFECT_PRESETS.find((p) => p.effect.type === e.type && p.name === e.name) : undefined;

/** A filter tile: 60×60 on the raised fill, its name inside, the selected one outlined. */
const Tile: React.FC<{ label: string; selected: boolean; onClick: () => void; testId: string; tag?: string; favourite?: boolean; onFavourite?: () => void }> = ({
  label,
  selected,
  onClick,
  testId,
  tag,
  favourite,
  onFavourite,
}) => (
  <div className="group relative w-[60px] h-[60px] shrink-0">
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      title={label}
      onClick={onClick}
      className={cn(
        "relative w-full h-full rounded-[6px] bg-brand-background-light flex items-center justify-center px-[3px] text-center text-[11px] leading-[13px] text-brand-lighter hover:bg-brand-button transition-colors",
        selected && "outline outline-[1.5px] outline-brand-accent -outline-offset-[1.5px]",
      )}
    >
      {/* Names wrap between words only, as CapCut's ("PA Announcer"). */}
      <span className="line-clamp-3 [overflow-wrap:normal] [word-break:keep-all]">{label}</span>
      {tag && <span className="absolute top-1 left-1 px-1 rounded-[2px] bg-black/50 text-[9px] leading-[12px] text-brand-light">{tag}</span>}
    </button>
    {onFavourite && (
      <button
        type="button"
        data-testid={`${testId}-favourite`}
        aria-pressed={!!favourite}
        title={favourite ? "Remove from Favorites" : "Add to Favorites"}
        aria-label={favourite ? "Remove from Favorites" : "Add to Favorites"}
        onClick={onFavourite}
        className={cn(
          "absolute right-[3px] bottom-[3px] w-4 h-4 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80",
          favourite ? "text-brand-accent" : "text-white opacity-0 group-hover:opacity-100",
        )}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill={favourite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
          <path d="M6 1.2 7.5 4.4l3.5.5-2.5 2.4.6 3.5L6 9.1 2.9 10.8l.6-3.5L1 4.9l3.5-.5z" />
        </svg>
      </button>
    )}
  </div>
);

/** A chip: 24 px pill, raised; the selected one a step lighter with the primary text. */
const Chip: React.FC<{ label: string; selected: boolean; onClick: () => void }> = ({ label, selected, onClick }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={cn(
      "h-6 px-2.5 shrink-0 rounded-full text-[12px] transition-colors",
      selected ? "bg-brand-button text-brand-light" : "bg-brand-background-light text-[#949494] hover:text-brand-light",
    )}
  >
    {label}
  </button>
);

const VoiceChangerProperties: React.FC<{ clipId: string }> = ({ clipId }) => {
  const clip = useClipStore((s) => s.getClipById(clipId)) as AudioClipProps | undefined;
  const updateClip = useClipStore((s) => s.updateClip);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<AudioEffectGroup | "all" | "favorites">("all");
  const [favourites, setFavourites] = useStoredList<string>("favourites.voice-filters", null, parseStrings);
  const toggleFavourite = (id: string) => setFavourites(favourites.includes(id) ? favourites.filter((x) => x !== id) : [...favourites, id]);
  const [toAll, setToAll] = useState(false);

  const effects = clip?.audioEffects ?? [];
  const first = effects[0];
  const draft = first?.type === "draft" ? first : undefined;
  const picked = presetOf(first);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return AUDIO_EFFECT_PRESETS.filter((p) => (group === "all" || (group === "favorites" ? favourites.includes(p.id) : p.group === group)) && (!q || p.name.toLowerCase().includes(q)));
  }, [query, group, favourites]);

  if (!clip) return null;

  /**
   * Put a change on the clip, or with Apply to all on, the clip's resulting effects on every
   * clip with sound (CapCut's), all in one step.
   */
  const commit = (patch: Partial<AnyClipProps>) => {
    if (!toAll) {
      updateClip(clipId, patch);
      return;
    }
    const next = ((patch as AudioClipProps).audioEffects ?? []) as AudioEffect[];
    for (const [id, p] of applyEffectsToAll(useClipStore.getState().clips, next)) updateClip(id, p);
  };
  const now = () => useClipStore.getState().getClipById(clipId) ?? clip;

  return (
    <div data-testid="voice-changer" className="px-3 pt-3 pb-4 min-w-0 text-left flex flex-col">
      <label className="flex flex-row items-center gap-2 h-6 w-fit cursor-pointer">
        <SmallCheckbox
          checked={toAll}
          label="Apply to all"
          onChange={(on) => {
            setToAll(on);
            // Checked, every clip with sound takes this clip's filter now, as in CapCut.
            if (on) for (const [id, p] of applyEffectsToAll(useClipStore.getState().clips, (now() as AudioClipProps).audioEffects ?? [])) updateClip(id, p);
          }}
        />
        <span className="text-[12px] text-brand-light">Apply to all</span>
      </label>

      {picked && (
        <div data-testid="voice-params" className="mt-3 flex flex-col gap-y-[9px]">
          {paramsOf(first!.type).map((p) => (
            <div key={p.key} data-param={p.key}>
              <PropertiesSlider
                label={p.name}
                value={paramValue(first!, p.key)}
                onChange={(v) => commit(setEffectParam(now(), 0, p.key, v))}
                suffix={p.unit === "%" ? "%" : p.unit ? ` ${p.unit}` : ""}
                min={p.min}
                max={p.max}
                step={p.step}
                toFixed={p.step >= 1 ? 0 : p.step >= 0.1 ? 1 : 2}
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-row items-center gap-2 h-6 px-2 rounded-[4px] bg-brand">
        <LuSearch className="w-3.5 h-3.5 shrink-0 text-[#6c6c6c]" />
        <input
          data-testid="voice-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search voice filters"
          className="flex-1 min-w-0 bg-transparent text-[12px] text-brand-light placeholder:text-[#6c6c6c] outline-none"
        />
      </div>
      <div className="mt-3 h-px bg-brand-divider" />

      <div className="mt-3 flex flex-row flex-wrap gap-1.5">
        <Chip label="All" selected={group === "all"} onClick={() => setGroup("all")} />
        <Chip label="Favorites" selected={group === "favorites"} onClick={() => setGroup("favorites")} />
        {AUDIO_EFFECT_GROUPS.map((g) => (
          <Chip key={g.id} label={g.name} selected={group === g.id} onClick={() => setGroup(g.id)} />
        ))}
      </div>

      <div className="mt-4 text-[12px] text-brand-light">{group === "all" ? "All" : group === "favorites" ? "Favorites" : AUDIO_EFFECT_GROUPS.find((g) => g.id === group)?.name}</div>
      <div data-testid="voice-tiles" className="mt-2 grid grid-cols-[repeat(auto-fill,60px)] gap-x-[18px] gap-y-4">
        {group !== "favorites" && <Tile label="None" testId="voice-none" selected={effects.length === 0} onClick={() => commit(clearAudioEffects(now()))} />}
        {draft && group !== "favorites" && <Tile label={draft.name || "Voice filter"} tag="Draft" testId="voice-draft" selected onClick={() => {}} />}
        {shown.map((p) => (
          <Tile
            key={p.id}
            label={p.name}
            testId={`voice-${p.id}`}
            selected={picked?.id === p.id}
            onClick={() => commit(applyPreset(now(), p.id))}
            favourite={favourites.includes(p.id)}
            onFavourite={() => toggleFavourite(p.id)}
          />
        ))}
      </div>
      {shown.length === 0 && (
        <p data-testid="voice-empty" className="mt-6 text-center text-[12px] text-[#6c6c6c]">
          {group === "favorites" && !query.trim() ? "No favorites yet. Hover a voice filter and click its star to keep it here." : `No voice filter matches “${query}”.`}
        </p>
      )}
      {/* Several effects stacked (OpenRip's own, or a draft's): the first one is shown. */}
      {effects.length > 1 && (
        <p className="mt-4 text-[12px] text-[#949494]">
          {effects.length} effects on this clip: {effects.map((e) => e.name || AUDIO_EFFECT_KINDS[e.type as keyof typeof AUDIO_EFFECT_KINDS]?.name || "Voice filter").join(", ")}. Picking a filter replaces them.
        </p>
      )}
    </div>
  );
};

export default VoiceChangerProperties;
