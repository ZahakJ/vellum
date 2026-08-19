// One pane: a tab bar and the surface its active tab asks for.
//
// It draws exactly what `App.tsx`'s `.s-view` drew before panes existed —
// editor, reading view, graph, or an empty state — because the surfaces did not
// change; only how many of them can be on screen at once did. `surfaceOf()` in
// client/workspace.ts is what decides, and it is TOTAL over any pane state, so
// there is no invariant to police here: a `.pdf` tab renders the reader
// whatever the mode says, which is what makes Ctrl/Cmd+E a harmless no-op on a
// book rather than a mode the pane cannot honour.
//
// SOLO IS NOT A SPECIAL CASE OF THE GRID — it is the shell exactly as it was.
// A reader who never splits gets the same DOM they had before, so every
// `:has()` rule, every zen selector and every `.s-view > .s-editor` in the
// stylesheet keeps matching. The grid arrives only once there is something to
// arrange.

import { lazy, Suspense, type ReactNode } from "react";
import { useStore } from "../state.ts";
import { activeTabOf, paneAt, surfaceOf } from "../workspace.ts";
import Tabs from "./Tabs.tsx";
import { useTabDrag } from "../dragTab.ts";

// The drop zones exist only between dragstart and dragend, so their code has
// no business in first paint — the chunk loads when the first tab is LIFTED,
// and a drag is hundreds of ms long where the fetch is a handful. This is
// what kept the entry inside its check-bundle budget.
const PaneDropZones = lazy(() => import("./PaneDropZones.tsx"));

const Editor = lazy(() => import("./Editor.tsx"));
const ReadingView = lazy(() => import("../reading/ReadingView.tsx"));
// The books surface keeps its own chunk boundary (scripts/check-bundle.mjs
// pins it): a pane that never shows a book never downloads the shelf, the
// reader or — two boundaries further in — pdf.js.
const BooksSurface = lazy(() => import("../books/BooksSurface.tsx"));

export default function Pane({
  id,
  solo = false,
  children,
}: {
  id: string;
  solo?: boolean;
  children?: ReactNode;
}) {
  const workspace = useStore((s) => s.workspace);
  const admin = useStore((s) => s.admin);
  const reloadTicks = useStore((s) => s.reloadTick);
  const focusPane = useStore((s) => s.focusPane);
  const openBook = useStore((s) => s.openBook);
  const closeLibrary = useStore((s) => s.closeLibrary);
  const clearBookTarget = useStore((s) => s.clearBookTarget);
  const closeTab = useStore((s) => s.closeTab);
  const setPaneMode = useStore((s) => s.setPaneMode);
  const dragging = useTabDrag() !== null;
  const pane = paneAt(workspace, id);
  if (pane === null) return null;

  const tab = activeTabOf(pane);
  const surface = surfaceOf(pane);
  const focused = workspace.focus === id;

  // Solo keeps the shell's own element and classes, so nothing downstream can
  // tell the difference. Split panes get the wrapper, the focus ring and the
  // data attribute the arrow keys resolve rects from.
  // A VISITOR ALWAYS READS. The shell's old ternary was `readingMode || !admin`,
  // and dropping the second half here would have shown a signed-out reader the
  // empty state instead of the note: their pane's mode is "edit" (nothing sets
  // it otherwise) and only an admin may mount the editor, so both arms would
  // have missed.
  const reading = surface === "reading" || !admin;
  const body =
    surface === "book" || surface === "library" ? (
      // A BOOK IS A TAB (the owner: "prob should just treat it like a normal
      // tab?? so people can open the book while taking notes"). The reader
      // stopped being a full-screen layer over the app; it renders here, in a
      // pane, beside whatever else is open. BooksSurface still takes a route
      // and callbacks and owns no global state — exactly the move its header
      // promised — and `active` scopes its window-level zathura keys to the
      // FOCUSED pane, because `j` typed toward a different pane must not turn
      // a page here.
      <Suspense fallback={<div className="s-books" />}>
        <BooksSurface
          active={focused}
          route={
            surface === "library" || tab === null
              ? { kind: "library" }
              : { kind: "book", path: tab.path, anchor: pane.bookTarget }
          }
          onRoute={(next) => {
            if (next.kind === "library") setPaneMode(id, "library");
            else openBook(next.path, next.anchor ?? null);
          }}
          onExit={() => {
            // Leaving the shelf returns the pane to its tabs; closing a book
            // closes the book's TAB — the same thing closing any tab means.
            if (surface === "library") closeLibrary();
            else if (tab !== null) closeTab(tab.path);
          }}
          onLanded={() => clearBookTarget(id)}
        />
      </Suspense>
    ) : tab !== null && !reading && surface === "edit" ? (
      <Suspense fallback={<div className="s-editor" />}>
        <Editor key={`${tab.path}#${reloadTicks}`} path={tab.path} />
      </Suspense>
    ) : tab !== null && (surface === "reading" || surface === "edit") ? (
      <Suspense fallback={<div className="s-reading" />}>
        <ReadingView key={`${tab.path}#${reloadTicks}`} path={tab.path} />
      </Suspense>
    ) : (
      // The empty state, the graph and the locked vault are the shell's own and
      // stay there: they are about the WINDOW, not about a pane, and the solo
      // pane hands them straight through.
      (children ?? null)
    );

  if (solo) {
    return (
      <section className="s-view" data-pane={id}>
        {body}
        {/* The solo pane raises drop zones too: dragging one of two tabs to
            the edge is exactly how the FIRST split is made. */}
        {dragging && (
          <Suspense fallback={null}>
            <PaneDropZones paneId={id} />
          </Suspense>
        )}
      </section>
    );
  }

  return (
    <section
      className={`s-view s-pane${focused ? " s-pane--focused" : ""}`}
      data-pane={id}
      // Clicking anywhere in a pane focuses it — the same meaning a click on
      // its tab has. Capture, so it lands before the editor takes the caret.
      onMouseDownCapture={() => {
        if (!focused) focusPane(id);
      }}
    >
      <Tabs paneId={id} />
      {body}
      {dragging && (
        <Suspense fallback={null}>
          <PaneDropZones paneId={id} />
        </Suspense>
      )}
    </section>
  );
}
