// EXTRACT SELECTION — the selection-shaped sibling of sectionActions.ts's
// extractSection, and deliberately built out of that file's own parts (the
// dialog, applyNoteContent, the undo-toast shape) rather than beside them:
// two extractions that name files by different rules or undo by different
// doors would be a bug with a UI.
//
// What is DIFFERENT from the section case, and why:
//
//   - The source is rewritten through the LIVE VIEW this command was invoked
//     from, as one transaction. The selection menu only exists over an open
//     editor, so there is no reading-view fallback to route through the
//     section-apply event — and one transaction means Ctrl+Z alone takes the
//     source side back, with the buffer's own autosave carrying it to disk
//     (buffers.ts::dispatchFrom mirrors it into any sibling pane).
//   - The stub is the bare `[[link]]`, not a heading plus a link: a selection
//     is prose mid-paragraph, and it owns no outline entry that could vanish.
//   - The toast's Undo restores BOTH files or neither side is touched
//     further: the source snapshot is written back FIRST (through the live
//     editor when one still holds the note, the API when not), and only after
//     that lands is the new note deleted. A cross-file undo that restores one
//     side is worse than no undo at all.

import type { EditorView } from "@codemirror/view";
import { createNote, deleteNote, putNote } from "./api.ts";
import { extractedNote, linkFor, suggestedSelectionName } from "./editor/composeText.ts";
import { t, tf } from "./i18n.ts";
import { applyNoteContent, promptExtractPath } from "./sectionActions.ts";
import { useStore } from "./state.ts";
import { toast } from "./toast.ts";
import { actionToast } from "./undoToast.ts";
import { noteTitleOf } from "../shared/noteFormat.ts";

/**
 * Move the selection into a new note and leave `[[New Note]]` standing where
 * it was. Ordering is the section extraction's, for the section extraction's
 * reason: the new note is created FIRST, and the source is rewritten only
 * once it exists — the reverse order can leave a note whose text was cut and
 * whose replacement was never written.
 */
export async function extractSelection(view: EditorView, path: string): Promise<void> {
  const sel = view.state.selection.main;
  if (sel.empty) return;
  const carried = view.state.sliceDoc(sel.from, sel.to);
  const before = view.state.doc.toString();

  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const toPath = await promptExtractPath(
    t("extractSelection"),
    dir,
    suggestedSelectionName(carried),
  );
  if (!toPath) return;
  const title = noteTitleOf(toPath);

  try {
    await createNote(toPath);
    await putNote(toPath, extractedNote(carried));
    // The dialog was open for as long as the reader thought about the name,
    // and this note can be open in a second pane or window: verify the
    // selection still holds the text we just copied out. If the document
    // moved, take the new note back and change NOTHING — replacing text
    // nobody selected is worse than asking again.
    if (view.state.sliceDoc(sel.from, sel.to) !== carried) {
      await deleteNote(toPath, true);
      toast(t("selectionExtractFailed"), "error");
      return;
    }
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: linkFor(title) },
      userEvent: "input.extract",
      scrollIntoView: true,
    });
    await useStore.getState().loadTree();
    actionToast(tf("selectionExtracted", { title, path: toPath }), t("undo"), () => {
      void (async () => {
        try {
          // Restore first, delete second — the same order, for the same
          // reason, as extractSection's own undo: a failure of either half
          // leaves the toast reporting an error with the new note still on
          // disk, never with text existing nowhere. The delete is permanent
          // for the reason written down there: what is erased is a note this
          // same toast created seconds ago, whose entire content has just
          // been written back into the source on the line above.
          await applyNoteContent(path, before);
          await deleteNote(toPath, true);
          await useStore.getState().loadTree();
          toast(t("selectionExtractUndone"));
        } catch (err) {
          console.error("vellum: undoing a selection extraction failed", err);
          toast(t("selectionExtractFailed"), "error");
        }
      })();
    });
  } catch (err) {
    console.error("vellum: extracting the selection failed", err);
    // A taken name 409s before a byte of the source is rewritten — the same
    // distinction, on the same 409, as extractSection and templateActions.
    const taken = err instanceof Error && /exists/i.test(err.message);
    toast(t(taken ? "couldNotCreateNote" : "selectionExtractFailed"), "error");
  }
}
