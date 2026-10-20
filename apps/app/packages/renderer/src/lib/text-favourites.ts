// The Text tab's Yours › Favorites: the text presets (OpenRip's own, and the styles saved from a
// text) starred on hover, kept in the user data folder (lib/user-store.ts). A preset is kept by
// its id, so a starred style that is deleted just stops showing.
import { create } from "zustand";
import { loadStored, parseStrings, saveStored } from "./user-store";

const STORE_KEY = "favourites.text-presets";

export const useTextFavourites = create<{ favourites: string[]; toggle: (id: string) => void }>((set, get) => ({
  favourites: [],
  toggle: (id) => {
    const now = get().favourites;
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    saveStored(STORE_KEY, next);
    set({ favourites: next });
  },
}));

void loadStored(STORE_KEY, null, parseStrings).then((v) => v && useTextFavourites.setState((s) => ({ favourites: [...new Set([...v, ...s.favourites])] })));
