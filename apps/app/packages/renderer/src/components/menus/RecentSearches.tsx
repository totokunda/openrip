import React from "react";
import { LuX } from "react-icons/lu";
import { parseStrings, useStoredList } from "@/lib/user-store";

const MAX = 10;

/** A tab's recent searches, newest first, kept in the user data folder. */
export const useRecentSearches = (scope: string) => {
  const [list, setList] = useStoredList<string>(`recent-searches.${scope}`, null, parseStrings);
  return {
    list,
    /** Note a search that was made (not an empty one). */
    add: (q: string) => {
      const t = q.trim();
      if (t) setList([t, ...list.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX));
    },
    remove: (q: string) => setList(list.filter((x) => x !== q)),
    clear: () => setList([]),
  };
};

/** The list under a focused, empty search field: pick one, remove one (x), or Clear all. */
export const RecentSearches: React.FC<{ list: string[]; onPick: (q: string) => void; onRemove: (q: string) => void; onClear: () => void }> = ({ list, onPick, onRemove, onClear }) => (
  <div data-testid="recent-searches" className="flex flex-col text-left">
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[12.5px] text-brand-light leading-none">Recent searches</h3>
      <button
        type="button"
        data-testid="recent-clear"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClear}
        className="text-[11px] text-[#949494] hover:text-brand-light cursor-pointer"
      >
        Clear all
      </button>
    </div>
    {list.map((q) => (
      <div key={q} data-testid="recent-search" className="group h-7 flex items-center rounded-[4px] hover:bg-brand-light/5">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(q)}
          className="flex-1 min-w-0 truncate text-left px-2 text-[12px] text-brand-lighter cursor-pointer"
        >
          {q}
        </button>
        <button
          type="button"
          aria-label={`Remove ${q}`}
          data-testid="recent-remove"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onRemove(q)}
          className="w-5 h-5 mr-1 rounded-[3px] text-[#949494] opacity-0 group-hover:opacity-100 hover:text-brand-light flex items-center justify-center cursor-pointer"
        >
          <LuX className="w-3 h-3" />
        </button>
      </div>
    ))}
  </div>
);
