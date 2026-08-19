// The pane grid: columns along the inline axis, at most two panes stacked in
// each. `client/workspace.ts` is the model and is proven there; this file is
// only the shape it takes on screen.
//
// COLUMN ORDER IS READING ORDER, and nothing here says "left". `columns[0]` is
// the inline-START column and the grid lays them out with `grid-auto-flow:
// column`, so an Arabic instance mirrors for free — the same way the shell's
// own `"sidebar main panel"` areas already do. A layout saved in English opens
// correctly in Arabic with nothing about sides stored.
//
// FOCUS IS GEOMETRIC, though, and that is the one deliberate exception: the
// arrow that moves between panes is a fact about the SCREEN, not about reading
// order, so `paneInDirection()` resolves it from live rects. A reader pressing
// ← at a grid is pointing, not reading.

import { useEffect, useRef, type ReactNode } from "react";
import { useStore } from "../state.ts";
import { paneInDirection, type PaneId } from "../workspace.ts";
import Pane from "./Pane.tsx";

/** Live rects for every pane, read at the moment an arrow is pressed rather
 *  than tracked: a resize, a fold and a split all move them, and a cache would
 *  answer for a layout that is no longer on screen. */
function paneRects(root: HTMLElement | null): Record<PaneId, DOMRect> {
  const out: Record<PaneId, DOMRect> = {};
  if (root === null) return out;
  for (const el of root.querySelectorAll<HTMLElement>("[data-pane]")) {
    const id = el.dataset.pane;
    if (id !== undefined) out[id] = el.getBoundingClientRect();
  }
  return out;
}

export default function Workspace({ children }: { children?: ReactNode }) {
  const workspace = useStore((s) => s.workspace);
  const focusPane = useStore((s) => s.focusPane);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const columns = workspace.layout.columns;

  // Arrow between panes. Installed here rather than in App.tsx's global
  // listener because it needs the rects, and the rects are this element's.
  useEffect(() => {
    if (columns.length === 1 && columns[0].length === 1) return; // nothing to move to
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || !e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
      const dir =
        e.key === "ArrowLeft" ? "left"
        : e.key === "ArrowRight" ? "right"
        : e.key === "ArrowUp" ? "up"
        : e.key === "ArrowDown" ? "down"
        : null;
      if (dir === null) return;
      const next = paneInDirection(paneRects(rootRef.current), workspace.focus, dir);
      if (next === null) return;
      e.preventDefault();
      focusPane(next);
      // Put the caret where the eye just went, or the reader has focused a
      // pane they then have to click into.
      requestAnimationFrame(() => {
        rootRef.current
          ?.querySelector<HTMLElement>(`[data-pane="${next}"] .cm-content`)
          ?.focus();
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [columns, workspace.focus, focusPane]);

  // One pane: render exactly what the shell rendered before panes existed, with
  // no grid, no wrapper and no data attribute. A reader who never splits pays
  // nothing for the feature, and every `:has()` and zen rule that keys off
  // `.s-view > .s-editor` keeps matching.
  const solo = columns.length === 1 && columns[0].length === 1;
  if (solo) return <Pane id={columns[0][0]} solo>{children}</Pane>;

  return (
    <div
      ref={rootRef}
      className="s-panes"
      style={{ gridTemplateColumns: workspace.layout.colWeights.map((w) => `${w}fr`).join(" ") }}
    >
      {columns.map((col, i) => (
        <div
          key={col.join("+")}
          className="s-panecol"
          style={{
            gridTemplateRows: col.map((id) => `${workspace.layout.rowWeights[id] ?? 1}fr`).join(" "),
          }}
          data-col={i}
        >
          {col.map((id) => (
            <Pane key={id} id={id} />
          ))}
        </div>
      ))}
    </div>
  );
}
