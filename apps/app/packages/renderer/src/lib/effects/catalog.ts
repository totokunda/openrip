// OpenRip's own video effects: the catalog the engine holds (engine/crates/model/src/fx.rs:
// names, categories, each effect's own parameters), and frames of any effect drawn by the
// engine's renderer on a sample picture. Values run 0–100. (The Effects tab's tile pictures are
// made by lib/tile-previews.ts.)
import { useQuery } from "@tanstack/react-query";
import { engineEffectCatalog, type EngineEffect } from "@app/preload";

export type EffectDef = EngineEffect;
export type EffectCatalog = { categories: string[]; effects: EffectDef[] };

const EMPTY: EffectCatalog = { categories: [], effects: [] };
let loaded: EffectCatalog = EMPTY;
let loading: Promise<EffectCatalog> | null = null;

/** The catalog, read once from the engine (empty without it). */
export const loadEffectCatalog = (): Promise<EffectCatalog> => {
  loading ??= engineEffectCatalog()
    .then((c) => {
      loaded = c ?? EMPTY;
      // Without the engine there's nothing to cache: try again next time.
      if (!c) loading = null;
      return loaded;
    })
    .catch(() => {
      loading = null;
      return EMPTY;
    });
  return loading;
};

/** The effect with this id, once the catalog has loaded. */
export const effectDef = (id: string | undefined): EffectDef | undefined => (id ? loaded.effects.find((e) => e.id === id) : undefined);

export const useEffectCatalog = (): EffectCatalog => {
  const { data } = useQuery({
    queryKey: ["effect-catalog"],
    queryFn: loadEffectCatalog,
    placeholderData: (prev) => prev ?? EMPTY,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  return data ?? EMPTY;
};

/** An effect's parameters at their defaults (0–100), by id. */
export const defaultEffectParams = (def: EffectDef): Record<string, number> => Object.fromEntries(def.params.map((p) => [p.id, p.default]));

// ---- preview frames -------------------------------------------------------------------------

/** What a library tile's preview is drawn at: a square, twice its 86 px for sharp screens. */
export const PREVIEW_SIZE = 172;
