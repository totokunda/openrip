import React from "react";

/**
 * Where menus, popovers, tooltips and dialogs open: the body of the window their panel is in.
 * A panel pulled out into its own window (lib/panel-windows.ts) provides that window's body;
 * elsewhere it's undefined, which Radix takes as this window's body.
 */
export const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export const usePortalContainer = (): HTMLElement | undefined => React.useContext(PortalContainerContext) ?? undefined;
