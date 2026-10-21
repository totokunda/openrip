import { toast } from "sonner";
import { findMediaByName, findMovedMedia, pickFolder, pickMediaPaths, relinkMediaItem, restoreMediaLink } from "@app/preload";
import { useClipStore } from "./clip";
import { recordEffect } from "./history";
import { useProjectsStore } from "./projects";
import { bumpMediaLibraryVersion } from "./media/library";
import { refreshMissingMedia } from "./media/missing";
import { VIDEO_EXTS, IMAGE_EXTS, AUDIO_EXTS } from "./settings";

/**
 * Link to media, as CapCut's relink: a file the project uses has moved or gone. The library
 * keeps each import as a link to its file and the project's assets name the links, so pointing
 * a link at the file's new place brings back every asset and clip that used it, and one undo
 * puts the old targets back (the step is in the history as an effect, lib/history.ts).
 */

/** A library card that's missing, as Link to media needs it: its link's name and where it pointed. */
export type MissingLink = { name: string; target: string };

const base = (p: string) => p.split(/[/\\]/g).pop() ?? p;

const folderOf = () => useProjectsStore.getState().getActiveProject()?.folderUuid;

/**
 * Point the links at their files, as one undo step (or outside the history, `undoable` false).
 * Resolves how many were linked.
 */
async function applyLinks(links: { name: string; to: string; from: string | null }[], undoable = true): Promise<number> {
  const folder = folderOf();
  const done: { name: string; to: string; from: string }[] = [];
  for (const l of links) {
    try {
      const { previous } = await relinkMediaItem(l.name, l.to, folder);
      done.push({ name: l.name, to: l.to, from: previous ?? l.from ?? l.to });
    } catch (e) {
      console.warn(`Couldn't link ${l.name} to ${l.to}:`, e);
    }
  }
  if (done.length === 0) return 0;
  // The engine reads the project again (its files may have failed to decode while they were gone).
  const refresh = async () => {
    bumpMediaLibraryVersion();
    useClipStore.setState((s) => ({ assets: { ...s.assets } }));
    await refreshMissingMedia();
  };
  if (undoable) recordEffect({
    undo: async () => {
      for (const d of done) await restoreMediaLink(d.name, d.from, folder);
      await refresh();
    },
    redo: async () => {
      for (const d of done) await restoreMediaLink(d.name, d.to, folder);
      await refresh();
    },
  });
  await refresh();
  return done.length;
}

const FILTERS = [{ name: "All Supported Files", extensions: VIDEO_EXTS.concat(IMAGE_EXTS).concat(AUDIO_EXTS) }];

/** The card's Link to media: pick the file it should show. */
export async function linkToMedia(item: MissingLink): Promise<boolean> {
  const picked = (await pickMediaPaths({ title: `Locate ${base(item.target)}`, filters: FILTERS }))[0];
  if (!picked) return false;
  const n = await applyLinks([{ name: item.name, to: picked, from: item.target }]);
  if (n === 0) toast.error(`${item.name} couldn't be linked to that file`, { position: "bottom-right", duration: 5000 });
  else toast.success(`${item.name} linked`, { position: "bottom-right", duration: 3000 });
  return n > 0;
}

/**
 * Pick a folder and search it (and the folders in it) for each missing file by its name; the
 * ones found are linked. Says how many were.
 */
export async function linkMissingInFolder(missing: MissingLink[]): Promise<number> {
  if (missing.length === 0) return 0;
  const folder = await pickFolder({ title: "Choose a folder to search for the missing media" });
  if (!folder) return 0;
  const found = await findMediaByName(folder, missing.map((m) => base(m.target)));
  const n = await applyLinks(missing.filter((m) => found[base(m.target)]).map((m) => ({ name: m.name, to: found[base(m.target)], from: m.target })));
  const rest = missing.length - n;
  if (n > 0) toast.success(`${n} file${n > 1 ? "s" : ""} linked${rest > 0 ? `, ${rest} not found in that folder` : ""}`, { position: "bottom-right", duration: 5000 });
  else toast.error("None of the missing files are in that folder", { position: "bottom-right", duration: 5000 });
  return n;
}

/**
 * Missing files that a backup or offload tool moved to another drive under the same path are
 * linked again by themselves (outside the history: nothing the user did), and a toast says so.
 */
export async function linkMovedMedia(missing: MissingLink[]): Promise<number> {
  if (missing.length === 0) return 0;
  const found = await findMovedMedia(missing.map((m) => m.target));
  const links = missing.filter((m) => found[m.target]).map((m) => ({ name: m.name, to: found[m.target], from: m.target }));
  if (links.length === 0) return 0;
  const n = await applyLinks(links, false);
  const drive = links[0].to.split("/")[2];
  if (n > 0) toast.success(`Found ${n > 1 ? `${n} missing files` : links[0].name} on ${drive} and linked ${n > 1 ? "them" : "it"}`, { position: "bottom-right", duration: 6000 });
  return n;
}
