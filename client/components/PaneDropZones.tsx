// The five drop targets a pane raises while a tab is being dragged.
//
// Four edges and a centre. An edge means "split this pane and land me on that
// side" (client/workspace.ts::dropTabSplit); the centre means "join this
// pane's tab strip". The zones are an overlay that exists ONLY during a drag —
// pointer events over a pane cost nothing the rest of the time — and they are
// laid out with logical insets, so `start-inline` hugs the reading-order
// leading edge in Arabic exactly as in English and the model never hears the
// word "left".
//
// Edges the model would refuse are not rendered at all: a zone that lights up
// and then does nothing on drop is a broken promise, and the caps
// (MAX_COLUMNS, MAX_ROWS, MAX_PANES) are knowable right here.

import { useState } from "react";
import { useStore } from "../state.ts";
import { endTabDrag, useTabDrag } from "../dragTab.ts";
import {
  MAX_COLUMNS,
  MAX_PANES,
  MAX_ROWS,
  paneAt,
  panesInOrder,
  type DropEdge,
} from "../workspace.ts";

const EDGES: readonly DropEdge[] = ["start-inline", "end-inline", "start-block", "end-block"];

export default function PaneDropZones({ paneId }: { paneId: string }) {
  const workspace = useStore((s) => s.workspace);
  const dropTab = useStore((s) => s.dropTab);
  const drag = useTabDrag();
  /** The zone under the pointer. :hover is suppressed during native drags, so
   *  the wash is a class driven by dragenter/dragleave — the events that ARE
   *  live. */
  const [hot, setHot] = useState<string | null>(null);
  if (drag === null) return null;

  const pane = paneAt(workspace, paneId);
  if (pane === null || pane.follow !== null) return null;
  // A drag lifted off the TREE has no source pane — every pane accepts it.
  // For a tab drag, the source pane's only tab has nowhere meaningful to go
  // on its own pane: every drop would be a no-op, so no zones rise over it.
  if (drag.pane !== null) {
    const src = paneAt(workspace, drag.pane);
    if (src === null) return null;
    if (drag.pane === paneId && src.tabs.length === 1) return null;
  }

  const columns = workspace.layout.columns;
  const col = columns.findIndex((c) => c.includes(paneId));
  const room = panesInOrder(workspace).length < MAX_PANES;
  const allow = (edge: DropEdge): boolean => {
    if (!room) return false;
    if (edge === "start-inline" || edge === "end-inline") return columns.length < MAX_COLUMNS;
    return col >= 0 && columns[col].length < MAX_ROWS;
  };

  const accept = (e: React.DragEvent): void => {
    e.preventDefault(); // without this the browser refuses the drop outright
    e.dataTransfer.dropEffect = "move";
  };
  const land = (dest: Parameters<typeof dropTab>[3]) => (e: React.DragEvent) => {
    e.preventDefault();
    dropTab(drag.pane, drag.path, paneId, dest);
    endTabDrag();
  };

  return (
    <div className="s-dropzones" aria-hidden="true">
      <div
        className={`s-dropzone s-dropzone--center${hot === "center" ? " s-dropzone--hot" : ""}`}
        onDragOver={accept}
        onDragEnter={() => setHot("center")}
        onDragLeave={() => setHot((h) => (h === "center" ? null : h))}
        onDrop={land({ kind: "tabs", index: pane.tabs.length })}
      />
      {EDGES.filter(allow).map((edge) => (
        <div
          key={edge}
          className={`s-dropzone s-dropzone--${edge}${hot === edge ? " s-dropzone--hot" : ""}`}
          onDragOver={accept}
          onDragEnter={() => setHot(edge)}
          onDragLeave={() => setHot((h) => (h === edge ? null : h))}
          onDrop={land({ kind: "edge", edge })}
        />
      ))}
    </div>
  );
}
