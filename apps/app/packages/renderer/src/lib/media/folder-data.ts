// The Media tab's folders, purely: the folder list and moving cards between folders (lib/media/folders.ts keeps them).

export type MediaFolder = { id: string; name: string; items: string[] };

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

