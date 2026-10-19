import { ipcRenderer } from "electron";

/**
 * The Stickers tab's downloads and cache (the main process's StickerLibraryModule): the files
 * kept in `<userData>/stickers/`, a sticker fetched from its source, and a starter sticker the
 * app ships copied into the cache.
 */
export type StickerFile = { ok: true; path: string } | { ok: false; error: string };

/** The stickers already on disk: id to file path. */
export function stickersCached(): Promise<Record<string, string>> {
  return ipcRenderer.invoke("stickers:cached");
}

/** Download a sticker from its source into the cache (once at a time per sticker). */
export function stickerDownload(req: { id: string; ext: string; url: string }): Promise<StickerFile> {
  return ipcRenderer.invoke("stickers:download", req);
}

/** Put a sticker's bytes in the cache (a starter sticker, which the app ships). */
export function stickerStore(req: { id: string; ext: string; bytes: Uint8Array }): Promise<StickerFile> {
  return ipcRenderer.invoke("stickers:store", req);
}
