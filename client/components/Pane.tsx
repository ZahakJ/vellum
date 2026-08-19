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

const Editor = lazy(() => import("./Editor.tsx"));
const ReadingView = lazy(() => import("../reading/ReadingView.tsx"));

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
    tab !== null && !reading && surface === "edit" ? (
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
    </section>
  );
}
