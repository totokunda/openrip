// The Media tab's folders (CapCut's bins): named groups of cards, flat (a folder holds cards, not
// folders). A card is in at most one folder; one in none shows at the top level. The folders
// of each project are kept in the user data folder beside the media library's other durable
// lists (lib/user-store.ts), under the project's media folder id, so they outlast the window.
// A name that no longer matches a media file is ignored when drawing (the file was deleted
// elsewhere), and a rename or delete of a card here updates the folders.
import { create } from "zustand";
import { loadStored, saveStored } from "../user-store";

export type MediaFolder = { id: string; name: string; items: string[] };

// ---- pure helpers ------------------------------------------------------------------------------

/** A folder name nobody has yet: "New folder", "New folder 2", … */
export const freeFolderName = (folders: MediaFolder[], base = "New folder"): string => {
  const used = new Set(folders.map((f) => f.name.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  let n = 2;
  while (used.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
};

/** Put `names` into folder `to` (taking them out of any other); `to` null takes them out of every folder. */
export const moveItems = (folders: MediaFolder[], names: string[], to: string | null): MediaFolder[] => {
  const set = new Set(names);
  return folders.map((f) => {
    const kept = f.items.filter((n) => !set.has(n));
    return f.id === to ? { ...f, items: [...new Set([...kept, ...names])] } : { ...f, items: kept };
  });
};

/** The folder a card is in, if any. */
export const folderOf = (folders: MediaFolder[], name: string): MediaFolder | undefined => folders.find((f) => f.items.includes(name));

export const parseFolders = (v: unknown): MediaFolder[] | undefined =>
  Array.isArray(v)
    ? v
        .filter((f) => f && typeof f.id === "string" && typeof f.name === "string" && Array.isArray(f.items))
        .map((f) => ({ id: f.id, name: f.name, items: f.items.filter((n: unknown) => typeof n === "string") }))
    : undefined;

// ---- the store ---------------------------------------------------------------------------------

type State = {
  /** The project whose folders these are (its media folder id). */
  project: string | null | undefined;
  folders: MediaFolder[];
  /** The folder shown, or null for the top level. */
  open: string | null;
  setOpen: (id: string | null) => void;
  load: (project: string | null) => Promise<void>;
  /** A new folder holding `names`; its id. */
  create: (names: string[], name?: string) => string;
  rename: (id: string, name: string) => void;
  /** Delete the folder; its cards go back to the top level. */
  remove: (id: string) => void;
  move: (names: string[], to: string | null) => void;
  renameItem: (from: string, to: string) => void;
  removeItem: (name: string) => void;
};

const keyOf = (project: string | null | undefined) => `media-folders.${project ?? "_"}`;

export const useMediaFolders = create<State>((set, get) => {
  const apply = (folders: MediaFolder[]) => {
    set({ folders });
    saveStored(keyOf(get().project), folders.length ? folders : null);
  };
  return {
    project: undefined,
    folders: [],
    open: null,
    setOpen: (open) => set({ open }),
    load: async (project) => {
      if (get().project === project) return;
      set({ project, folders: [], open: null });
      const v = await loadStored(keyOf(project), null, parseFolders);
      if (get().project === project) set({ folders: v ?? [] });
    },
    create: (names, name) => {
      const id = `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const folders = moveItems(get().folders, names, null);
      apply([...folders, { id, name: name?.trim() || freeFolderName(folders), items: [...new Set(names)] }]);
      return id;
    },
    rename: (id, name) => {
      const t = name.trim();
      if (!t) return;
      apply(get().folders.map((f) => (f.id === id ? { ...f, name: t } : f)));
    },
    remove: (id) => {
      apply(get().folders.filter((f) => f.id !== id));
      if (get().open === id) set({ open: null });
    },
    move: (names, to) => apply(moveItems(get().folders, names, to)),
    renameItem: (from, to) => {
      if (!get().folders.some((f) => f.items.includes(from))) return;
      apply(get().folders.map((f) => ({ ...f, items: f.items.map((n) => (n === from ? to : n)) })));
    },
    removeItem: (name) => {
      if (!get().folders.some((f) => f.items.includes(name))) return;
      apply(get().folders.map((f) => ({ ...f, items: f.items.filter((n) => n !== name) })));
    },
  };
});
