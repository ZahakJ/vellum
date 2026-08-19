// The tab being dragged, if any — one value for the whole window.
//
// NOT store state on purpose. A drag is transient pointer chrome: it exists
// between dragstart and dragend, it must never be persisted or mirrored to
// other windows, and routing it through the zustand store would re-render
// every subscriber on pickup just to say "a ghost is moving". The pieces that
// care — the tab that is being lifted (client/components/Tabs.tsx) and the
// drop zones every pane raises while a drag is live
// (client/components/PaneDropZones.tsx) — subscribe here instead.
//
// The payload also rides the native DataTransfer under TAB_MIME, but this
// module is the one the UI reads: `dataTransfer.getData()` is empty during
// dragover by spec (protected mode), so zones could not know what is hovering
// them from the event alone. A drag arriving from ANOTHER window has the MIME
// and no module state — the zones simply do not raise, which is the honest
// answer until cross-window adoption exists.

import { useSyncExternalStore } from "react";

export interface TabDrag {
  /** The pane the tab was lifted from — null for a note or book dragged
   *  straight off the TREE, which has no tab anywhere yet. */
  pane: string | null;
  path: string;
}

export const TAB_MIME = "application/x-vellum-tab";

let current: TabDrag | null = null;
const subs = new Set<() => void>();

export function beginTabDrag(drag: TabDrag): void {
  current = drag;
  for (const f of subs) f();
}

export function endTabDrag(): void {
  if (current === null) return;
  current = null;
  for (const f of subs) f();
}

/** The live value, for event handlers that fire outside React's render. */
export function tabDrag(): TabDrag | null {
  return current;
}

export function useTabDrag(): TabDrag | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
  );
}
