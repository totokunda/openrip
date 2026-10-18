// Commands a shortcut or the menu bar starts and a component carries out (it holds what the
// command needs: the export dialog's state, the media panel's picker): "export",
// "import-media". A component listens with `onCommand` while it's mounted.
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function onCommand(name: string, fn: Listener): () => void {
  const set = listeners.get(name) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(name, set);
  return () => {
    set.delete(fn);
  };
}

/** Run a command; false when nothing is listening for it. */
export function runCommand(name: string): boolean {
  const set = listeners.get(name);
  if (!set || set.size === 0) return false;
  for (const fn of [...set]) fn();
  return true;
}
