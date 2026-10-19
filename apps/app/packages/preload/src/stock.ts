import { ipcRenderer } from "electron";
import type { StockItem, StockKind } from "../../renderer/src/lib/stock/sources.js";

/**
 * The Media tab's stock Library (the main process's StockLibraryModule): searches of the
 * openly licensed sources, and the files kept in `<userData>/stock/`.
 */
export type StockSearchRes =
  | { ok: true; items: StockItem[]; more: boolean; missing: string[]; fromCache: boolean }
  | { ok: false; error: "offline" | "limited" | "failed"; message: string };
export type StockFile = { ok: true; path: string } | { ok: false; error: string };

/** One page of results for a search (the sources are asked politely; answers are kept for a day). */
export function stockSearch(req: { kind: StockKind; query: string; page: number }): Promise<StockSearchRes> {
  return ipcRenderer.invoke("stock:search", req);
}

/** Open an https address (a credit's licence, author or source) in the browser. */
export function openCreditUrl(url: string): Promise<void> {
  return ipcRenderer.invoke("stock:open-url", url);
}

/** The files already downloaded: item id to path. */
export function stockCached(): Promise<Record<string, string>> {
  return ipcRenderer.invoke("stock:cached");
}

/** Download an item's file into the cache (once at a time per item). */
export function stockDownload(req: { id: string; kind: StockKind; url: string }): Promise<StockFile> {
  return ipcRenderer.invoke("stock:download", req);
}
