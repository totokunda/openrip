// The libraries' favourites and recent searches live in the user data folder (the main
// process's UserStoreModule), not the browser's storage, so they outlast a cleared cache and
// are the same in every window. Entries an older version kept in localStorage are moved over
// the first time they're read. localStorage stays for per-viewer conveniences (a remembered tab).
import { useEffect, useState } from "react";
import { userStoreRead, userStoreSet } from "@app/preload";

let all: Promise<Record<string, unknown>> | null = null;

const readAll = (): Promise<Record<string, unknown>> => {
  if (!all) all = userStoreRead().then((v) => v ?? {}).catch(() => ({}));
  return all;
};

/** Keep `value` under `key` (writes are applied in order). */
export const saveStored = (key: string, value: unknown): void => {
  void readAll().then((o) => {
    if (value == null) delete o[key];
    else o[key] = value;
    return userStoreSet(key, value).catch(() => false);
  });
};

/**
 * What's kept under `key`, passed through `parse` (which returns undefined for a value it
 * doesn't recognise). With nothing there yet, the old localStorage entry `legacyKey` is
 * parsed, saved to the store and removed.
 */
export const loadStored = async <T>(key: string, legacyKey: string | null, parse: (v: unknown) => T | undefined): Promise<T | undefined> => {
  const o = await readAll();
  const have = parse(o[key]);
  if (have !== undefined) return have;
  if (!legacyKey) return undefined;
  try {
    const raw = window.localStorage.getItem(legacyKey);
    if (raw == null) return undefined;
    const old = parse(JSON.parse(raw));
    if (old !== undefined) {
      o[key] = old;
      await userStoreSet(key, old).catch(() => false);
    }
    window.localStorage.removeItem(legacyKey);
    return old;
  } catch {
    return undefined;
  }
};

/** A list kept in the store: `get` the current one on start, `set` it when it changes. */
export const parseStrings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
export const parseList = <T>(ok: (x: any) => boolean) => (v: unknown): T[] | undefined => (Array.isArray(v) ? (v.filter(ok) as T[]) : undefined);

/** A list kept in the store, as component state: empty until it's read, saved when set. */
export const useStoredList = <T>(key: string, legacyKey: string | null, parse: (v: unknown) => T[] | undefined): [T[], (next: T[]) => void] => {
  const [list, setList] = useState<T[]>([]);
  useEffect(() => {
    let live = true;
    void loadStored(key, legacyKey, parse).then((v) => live && v && setList(v));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [
    list,
    (next) => {
      setList(next);
      saveStored(key, next);
    },
  ];
};
