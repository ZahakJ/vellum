// The designer's DOOR, kept apart from the designer.
//
// `openDesigner()` lives here rather than beside `DesignerPanel` for one
// measured reason. The panel is the heaviest admin surface in the product —
// 125 kB of its own, plus the design engine, the live preview and the markdown
// renderer it composes with, ~310 kB before it draws anything. Its three doors
// (the status bar's glyph, the command palette, the settings panel's row) are
// all in surfaces the admin shell mounts on FIRST PAINT, and a plain
// `import { openDesigner } from "./DesignerPanel.tsx"` in any of them is a
// STATIC edge: rollup then has to put the whole designer in the chunk that
// door lives in, and every admin downloaded the design engine in order to
// render a button that might open it. `scripts/check-bundle.mjs` measured it
// at 1197 kB on an admin's first request.
//
// So the door is a function that imports the room, not a re-export of it. The
// three call sites are unchanged — they still call `openDesigner()` — and the
// panel is fetched on the click that asks for it.

/** Open the site designer, loading it on demand.
 *
 *  Fire-and-forget by design: it returns void so the call sites stay plain
 *  event handlers. A failed chunk fetch (offline, a deploy mid-session) is
 *  logged rather than thrown into an event handler nobody is awaiting — the
 *  panel simply does not open, which is the same thing a failed click already
 *  looked like. */
export function openDesigner(): void {
  void import("./DesignerPanel.tsx")
    .then((mod) => mod.openDesigner())
    .catch((err: unknown) => {
      console.error("vellum: loading the designer failed", err);
    });
}
