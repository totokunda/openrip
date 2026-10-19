// The Transitions tab's favourites (a star on a tile), kept in the user data folder.
import { create } from "zustand";
import { loadStored, parseStrings, saveStored } from "./user-store";

const STORE_KEY = "favourites.transitions";

export const useTransitionFavourites = create<{ favourites: string[]; toggle: (type: string) => void }>((set, get) => ({
  favourites: [],
  toggle: (type) => {
    const now = get().favourites;
    const next = now.includes(type) ? now.filter((x) => x !== type) : [...now, type];
    saveStored(STORE_KEY, next);
    set({ favourites: next });
  },
}));

void loadStored(STORE_KEY, null, parseStrings).then((v) => v && useTransitionFavourites.setState((s) => ({ favourites: [...new Set([...v, ...s.favourites])] })));
