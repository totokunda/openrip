// OpenRip's own video effects: the catalog the engine holds (engine/crates/model/src/fx.rs:
// names, categories, each effect's own parameters), and frames of any effect drawn by the
// engine's renderer on a sample picture for the Effects tab's tiles. Values run 0–100.
import { useQuery } from "@tanstack/react-query";
import { engineEffectCatalog, engineEffectPreviews, type EngineEffect } from "@app/preload";

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

/** What a tile's preview shows: a square, drawn at twice its 86 px for sharp screens. */
export const PREVIEW_SIZE = 172;
/** An effect's run in a preview, and the moment its still shows. */
export const PREVIEW_SECONDS = 2;
const STILL_AT = 0.7;
const FRAMES = 24;

export type PreviewFrame = { width: number; height: number; rgba: Uint8Array };

const stills = new Map<string, Promise<PreviewFrame | null>>();
const loops = new Map<string, Promise<PreviewFrame[]>>();
// The engine draws one effect preview at a time; the tiles ask in turn.
let queue: Promise<unknown> = Promise.resolve();
const turn = <T>(run: () => Promise<T>): Promise<T> => {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
};

const frames = (def: EffectDef, times: number[]) => turn(() => engineEffectPreviews(def.id, null, [], times, PREVIEW_SECONDS, PREVIEW_SIZE, PREVIEW_SIZE));

/** The still of a tile, drawn by the engine at the effect's defaults (cached). */
export const effectStill = (def: EffectDef): Promise<PreviewFrame | null> => {
  let p = stills.get(def.id);
  if (!p) {
    p = frames(def, [STILL_AT]).then((f) => f[0] ?? null).catch(() => null);
    stills.set(def.id, p);
  }
  return p;
};

/** The frames a hovered tile plays: the effect's first seconds, looped (cached). */
export const effectLoop = (def: EffectDef): Promise<PreviewFrame[]> => {
  let p = loops.get(def.id);
  if (!p) {
    const times = Array.from({ length: FRAMES }, (_, i) => (i / FRAMES) * PREVIEW_SECONDS);
    p = frames(def, times).catch(() => []);
    loops.set(def.id, p);
  }
  return p;
};

/** Frames per second of a tile's loop. */
export const LOOP_FPS = FRAMES / PREVIEW_SECONDS;
