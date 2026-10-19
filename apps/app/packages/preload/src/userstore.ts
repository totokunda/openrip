import { ipcRenderer } from "electron";

/**
 * The user's favourites and recent searches (the main process's UserStoreModule): one JSON
 * object in `<userData>/user-store/`. The renderer's lib/user-store.ts owns what the values are.
 */

/** Every key saved so far. */
export function userStoreRead(): Promise<Record<string, unknown>> {
  return ipcRenderer.invoke("userstore:read");
}

/** Save one key's value (null removes it); false when it couldn't be written. */
export function userStoreSet(key: string, value: unknown): Promise<boolean> {
  return ipcRenderer.invoke("userstore:set", key, value ?? null);
}
