// Project settings › Performance: the project's Proxy switch and the resolution proxies are made
// at (720P or 540P). With the switch on, the engine plays a video's proxy (the low-resolution
// copy "Create file proxy" or an import made, lib/engine-preview.ts) while you edit, and video
// above 1080p gets one made when it is imported; exports always read the originals. A project
// without a choice of its own follows Settings › Performance › Proxy. The choice is kept per
// project in the user data folder (lib/user-store.ts), like Imported media's.
import { create } from "zustand";
import { preferences } from "../preferences";
import { loadStored, saveStored } from "../user-store";

const STORE_KEY = "project-proxy";

export type ProxyHeight = 720 | 540;
export type ProxyChoice = { on?: boolean; height?: ProxyHeight };

/** Video taller than this gets a proxy when it is imported (with the switch on). */
export const AUTO_PROXY_ABOVE = 1080;

const parse = (v: unknown): Record<string, ProxyChoice> | undefined => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, ProxyChoice> = {};
  for (const [k, x] of Object.entries(v as Record<string, any>)) {
    if (!x || typeof x !== "object") continue;
    out[k] = { ...(typeof x.on === "boolean" ? { on: x.on } : {}), ...(x.height === 540 || x.height === 720 ? { height: x.height } : {}) };
  }
  return out;
};

export const useProxyMode = create<{ byProject: Record<string, ProxyChoice> }>(() => ({ byProject: {} }));

void loadStored(STORE_KEY, null, parse).then((v) => v && useProxyMode.setState((s) => ({ byProject: { ...v, ...s.byProject } })));

const keyOf = (folderUuid: string | undefined | null) => folderUuid ?? "_";

/** Whether the project's Proxy switch is on (its own choice, else Settings › Performance › Proxy). */
export const proxyOnFor = (folderUuid: string | undefined | null): boolean => useProxyMode.getState().byProject[keyOf(folderUuid)]?.on ?? preferences().proxyDefault;

/** The height proxies of the project are made at. */
export const proxyHeightFor = (folderUuid: string | undefined | null): ProxyHeight => useProxyMode.getState().byProject[keyOf(folderUuid)]?.height ?? 720;

/** Set the project's switch and/or proxy resolution. */
export const setProxyMode = (folderUuid: string | undefined | null, patch: ProxyChoice): void => {
  const key = keyOf(folderUuid);
  const byProject = { ...useProxyMode.getState().byProject, [key]: { ...useProxyMode.getState().byProject[key], ...patch } };
  useProxyMode.setState({ byProject });
  saveStored(STORE_KEY, byProject);
};
