// Right-click a heading in the READING view.
//
// The editor answers a right-click on a heading line from its own extension
// (editor/sectioning.ts); reading view has no CodeMirror to hang a handler on,
// so this is one delegated listener on the document, installed once by the
// outline panel — the component that is mounted for exactly as long as the app
// shell is, and the one whose subject is headings.
//
// TWO THINGS IT DELIBERATELY DOES NOT DO.
//   · It offers no fold, select or focus rows: those act on an editor that is
//     not on screen, and a menu row that does nothing when pressed is worse
//     than one that is not there (the rule the LaTeX formatting menu follows).
//   · It stands down entirely for a session that cannot write, which on a
//     blog-mode instance is every visitor. `[[Note#Heading]]` is vault syntax
//     that means nothing outside the vault, "extract" is an edit, and taking
//     the browser's own context menu away from a reader to offer them two
//     commands they cannot use would be theft.

import { noteContent } from "../sectionActions.ts";
import { openSectionMenu } from "../sectionMenu.ts";
import { sectionsOf } from "../sections.ts";
import { useStore } from "../state.ts";
import { isTexPath } from "../../shared/noteFormat.ts";

let installed = false;

/** Install the reading view's section handlers (idempotent — the panel that
 *  calls this may remount). Two of them: the heading menu below, and the
 *  jump-to-heading keys, which belong to the shell here because reading mode
 *  has no editor to hold a CodeMirror keymap. */
export function installReadingSections(): void {
  if (installed) return;
  installed = true;
  installJumpKeys();
  document.addEventListener(
    "contextmenu",
    (event) => {
      const store = useStore.getState();
      if (!store.admin || store.previewVisitor) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Only inside the reading view: the blog's article body uses the same
      // renderer and the same classes, and a visitor's right-click is theirs.
      const heading = target.closest<HTMLElement>(".s-reading .s-rv-h[id]");
      if (!heading) return;
      const path = store.openPath;
      if (!path || isTexPath(path)) return; // \section{…} is not this model
      // Nothing is selected under a right-click on a heading unless the reader
      // dragged across it — in which case copying the selection is what they
      // meant, and the browser's menu does that better than we would.
      if ((window.getSelection()?.toString() ?? "").trim() !== "") return;
      event.preventDefault();
      const { clientX: x, clientY: y } = event;
      void (async () => {
        const content = await noteContent(path);
        const section = sectionsOf(content).find((s) => s.slug === heading.id);
        if (!section) return;
        openSectionMenu({ path, content, headingLine: section.headingLine, x, y });
      })();
    },
    true,
  );
}

/**
 * Ctrl/Cmd+Alt+↑ / ↓ in the READING view.
 *
 * The editor answers the same two keys from its own keymap, where "the next
 * heading" means a caret position. Reading mode has no caret, so here it means
 * a SCROLL — and the target is read off the same active-heading signal the
 * outline highlights with, so the key, the highlight and the panel all agree
 * about which section the reader is in.
 */
function installJumpKeys(): void {
  let active: string | null = null;
  window.addEventListener("vellum:active-heading", (ev) => {
    active = (ev as CustomEvent<string | null>).detail;
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
      if (event.getModifierState("AltGraph")) return; // Right-Alt on EU layouts
      const dir = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (dir === 0) return;
      const store = useStore.getState();
      // The editor's own keymap owns these keys whenever an editor is up.
      if (!store.readingMode || !store.openPath) return;
      const heads = [...document.querySelectorAll<HTMLElement>(".s-reading .s-rv-h[id]")];
      if (heads.length === 0) return;
      event.preventDefault();
      const at = heads.findIndex((h) => h.id === active);
      const next = heads[Math.max(0, Math.min(heads.length - 1, (at === -1 ? 0 : at) + dir))];
      if (next) {
        window.dispatchEvent(
          new CustomEvent("vellum:goto-heading", { detail: { slug: next.id } }),
        );
      }
    },
    true,
  );
}
