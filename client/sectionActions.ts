// The section commands, one implementation for three surfaces.
//
// A heading is acted on from the editor (its ⋯ affordance, its context menu,
// its keystrokes), from the outline panel (right-click a row, or drag it) and
// from the reading view (right-click a rendered heading). Those are three
// different DOMs asking for the same five things, and a menu that did its own
// clipboard write would drift from the keystroke the first time either
// changed — the argument commands.ts makes for text formatting, one level up.
//
// TWO RULES HOLD THE SURFACES TOGETHER.
//
// 1. THE OPEN EDITOR IS THE SOURCE OF TRUTH, NOT THE FILE. Autosave is 600ms
//    behind the keyboard and the outline deliberately stops recounting while a
//    note is dirty, so `getNote()` can be a version of the note that is one
//    paragraph old. Extracting a section from THAT would silently revert
//    whatever was typed in the last half second. Every read and every write
//    here is offered to the live editor first (a CustomEvent the editor's own
//    extension answers) and only falls through to the API when no editor holds
//    the path — which is exactly the reading-view and blog case.
// 2. A WRITE THROUGH THE EDITOR IS A TRANSACTION, so Ctrl+Z takes it back and
//    the existing autosave carries it to disk. The toast's Undo is the second
//    door, for the reader whose hands are on the mouse and whose focus is in
//    the outline rather than in the note.

import { createNote, deleteNote, getNote, putNote } from "./api.ts";
import { promptModal } from "./components/Confirm.tsx";
import { t, tf } from "./i18n.ts";
import {
  moveSection,
  replaceSection,
  sectionAtHeading,
  sectionMarkdown,
  sectionsOf,
  type DropTarget,
  type Section,
} from "./sections.ts";
import { noteFileName } from "./noteName.ts";
import { markSelfWrite, useStore } from "./state.ts";
import { toast } from "./toast.ts";
import { actionToast } from "./undoToast.ts";
import { noteTitleOf } from "../shared/noteFormat.ts";

/** Ask the live editor for a path's current text; null when none holds it. */
export function liveContent(path: string): string | null {
  const detail: { path: string; content: string | null } = { path, content: null };
  window.dispatchEvent(new CustomEvent("vellum:section-read", { detail }));
  return detail.content;
}

/** The note as it is RIGHT NOW — the editor's buffer when one is open. */
export async function noteContent(path: string): Promise<string> {
  const live = liveContent(path);
  if (live !== null) return live;
  return (await getNote(path)).content;
}

/** Write a whole note back. Through the open editor when there is one (one
 *  transaction: undoable, and the existing autosave takes it to disk), through
 *  the API otherwise. */
export async function applyNoteContent(path: string, content: string): Promise<void> {
  const detail: { path: string; content: string; handled: boolean } = {
    path,
    content,
    handled: false,
  };
  window.dispatchEvent(new CustomEvent("vellum:section-apply", { detail }));
  if (detail.handled) return;
  // No editor holds this path (the outline over a reading pane, the blog):
  // we are the writer, so we claim the echo — the same rule the editor's own
  // autosave follows (state.ts::markSelfWrite).
  markSelfWrite(path);
  await putNote(path, content);
  const store = useStore.getState();
  if (store.openPath === path) store.bumpReload();
}

// ── Copying ─────────────────────────────────────────────────────────────────

async function copy(
  text: string,
  okKey: "sectionLinkCopied" | "sectionCopied" | "noteLinkCopied",
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(t(okKey));
  } catch (err) {
    console.error("vellum: copying a section failed", err);
    toast(t("sectionCopyFailed"), "error");
  }
}

/** `[[Note#Heading]]` — the address of this section, in the vault's own link
 *  syntax, ready to paste into another note. The heading's DISPLAY text is
 *  what goes in: `shared/anchors.ts` resolves an anchor by id and then by
 *  human title, so the readable spelling is the one that survives an edit to
 *  the heading's inline markup. */
export function copySectionLink(path: string, section: Section): void {
  void copy(`[[${noteTitleOf(path)}#${anchorFor(section)}]]`, "sectionLinkCopied");
}

/** `[[Note]]` — the whole note's address, for the palette's "Copy link to
 *  note" (v1.8 audit, F19). The section version above has existed since the
 *  outline learned to copy, and the note it belongs to had no equivalent: a
 *  reader could copy the address of a heading and not of the page.
 *
 *  The TITLE, not the path: that is what the vault's own resolver takes
 *  (shared/noteFormat::noteCandidates), so the link keeps working when the
 *  note moves between folders — which is the difference between a link and a
 *  path, and the reason "Copy path" on the tab menu is a different row. */
export function copyNoteLink(path: string): void {
  void copy(`[[${noteTitleOf(path)}]]`, "noteLinkCopied");
}

/** Characters a wikilink cannot carry inside `[[…#here]]`: `]` ends the link,
 *  `|` starts an alias, `[` and `#` re-open the two halves the parser already
 *  split on. */
const UNSPELLABLE_IN_LINK = /[[\]|#]/;

/** The anchor to address this section by.
 *
 *  The DISPLAY text, as the comment above says — but a heading is prose, and
 *  prose contains brackets. `## Weird ]] | [[Other#x` produced
 *  `[[Note#Weird ]] | [[Other#x]]`, which is not a broken link so much as a
 *  DIFFERENT link: the parser stops at the first `]]` and the reader pastes
 *  something that silently points somewhere else. The section's SLUG is the
 *  same id `shared/anchors.ts` resolves by first and is spellable by
 *  construction (letters, digits and hyphens), so the rare heading that cannot
 *  be spelled falls back to it rather than to a link that lies. */
function anchorFor(section: Section): string {
  return UNSPELLABLE_IN_LINK.test(section.text) ? section.slug : section.text;
}

/** The section's own markdown, heading line included. */
export function copySectionMarkdown(content: string, section: Section): void {
  void copy(sectionMarkdown(content, section), "sectionCopied");
}

// ── Extraction ──────────────────────────────────────────────────────────────

/** A heading's text as a filename: the reader can still edit it in the dialog,
 *  but the offered name should be the one they would have typed.
 *
 *  The stripping rule (the filesystem's forbidden set, plus the three the
 *  VAULT forbids — the stub this extraction leaves behind is `[[<this name>]]`,
 *  and a name carrying `[`, `]` or `#` is a name no wikilink can spell) moved
 *  to composeText.ts's `noteFileName` so the selection-shaped extraction
 *  offers names by the same law rather than by a second copy of the regex. */
function suggestedName(section: Section): string {
  return noteFileName(section.text, "Section");
}

/** The extraction dialog, shared by BOTH extractions — the section-shaped one
 *  below and the selection-shaped one in composerActions.ts. One dialog, one
 *  naming rule: the destination is named in the body, `..`/dotfiles/link-
 *  breaking characters are refused before anything is created, and whatever
 *  the field's text becomes ("ideas/Untitled.md" from a typed "Untitled") is
 *  printed under it. Returns the checked path, or null on cancel. */
export function promptExtractPath(
  title: string,
  dir: string,
  suggested: string,
): Promise<string | null> {
  return promptModal({
    title,
    body: dir ? tf("promptInFolder", { folder: dir }) : t("promptAtRoot"),
    value: suggested,
    placeholder: suggested,
    check: (raw) => {
      const typed = raw.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!typed) return { value: "" };
      if (typed.split("/").includes("..")) return { value: "", error: t("promptNoTraversal") };
      if (typed.split("/").some((s) => s.startsWith(".")))
        return { value: "", error: t("promptNoDotName") };
      // Same reason `suggestedName` strips them: the stub left behind is
      // `[[<this name>]]`, and these three characters end or re-open a
      // wikilink. A name the vault cannot address is not a name.
      if (/[[\]#|]/.test(typed)) return { value: "", error: t("promptNoLinkChars") };
      const named = /\.(md|markdown|tex|latex)$/i.test(typed) ? typed : `${typed}.md`;
      const value = dir ? `${dir}/${named}` : named;
      return { value, note: value === typed ? undefined : tf("promptCreates", { path: value }) };
    },
  });
}

/**
 * EXTRACT: the section leaves this note and becomes its own, with a
 * `[[link]]` standing where it was.
 *
 * The link is left at the section's own depth as a heading plus a link line,
 * not as a bare link: a reader scrolling the note has to see that a section
 * used to be here, and the outline has to keep the entry — extraction is a
 * reorganization, and a reorganization that makes a heading vanish from the
 * table of contents reads as data loss.
 *
 * Ordering is deliberate: create the new note FIRST, and only rewrite the
 * source once it exists. The reverse order can leave a note whose section was
 * cut and whose replacement was never written.
 */
export async function extractSection(path: string, content: string, section: Section): Promise<void> {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const toPath = await promptExtractPath(t("extractSection"), dir, suggestedName(section));
  if (!toPath) return;

  const carried = sectionMarkdown(content, section);
  const title = noteTitleOf(toPath);
  const stub = [`${"#".repeat(section.level)} ${section.text}`, "", `[[${title}]]`, ""];
  const rest = replaceSection(content, section, stub);

  try {
    await createNote(toPath);
    await putNote(toPath, `${carried}\n`);
    await applyNoteContent(path, rest);
    await useStore.getState().loadTree();
    actionToast(tf("sectionExtracted", { title: section.text, path: toPath }), t("undo"), () => {
      void (async () => {
        try {
          await applyNoteContent(path, content);
          // THE ONE PERMANENT DELETE IN THE PRODUCT, and the exception is
          // narrow enough to write down rather than leave as a surprise:
          // api.ts's own comment on this function is "a note is not a cheaper
          // thing to lose than a folder", and every other delete in the app
          // moves to `.trash/`. What is erased here is a note this same toast
          // created seconds ago, whose entire content has just been written
          // BACK into the source note on the line above — so `.trash` would
          // hold a second copy of text the vault already has, under a name the
          // reader chose once and then took back. Undo means "as you were",
          // and a tombstone is not that. The ordering is the safety: the
          // restore lands first, and a failure of either half leaves the toast
          // reporting an error with the new note still on disk.
          await deleteNote(toPath, true);
          await useStore.getState().loadTree();
          toast(t("sectionExtractUndone"));
        } catch (err) {
          console.error("vellum: undoing a section extraction failed", err);
          toast(t("sectionExtractFailed"), "error");
        }
      })();
    });
  } catch (err) {
    console.error("vellum: extracting a section failed", err);
    // A NAME THAT IS ALREADY TAKEN IS NOT "extracting failed". `createNote`
    // 409s before a single byte of the source note is rewritten (verified: the
    // source is untouched), so the reader's next move is to type another name
    // — which the generic message does not tell them. templateActions.ts makes
    // exactly this distinction on exactly this 409.
    const taken = err instanceof Error && /exists/i.test(err.message);
    toast(t(taken ? "couldNotCreateNote" : "sectionExtractFailed"), "error");
  }
}

// ── Reordering (the outline's drag) ─────────────────────────────────────────

/** Apply a drag from the outline. Returns the rewritten note (so the panel can
 *  redraw in the same frame instead of waiting 600ms for the autosave to land
 *  and the outline to recount), or null when nothing moved. The toast carries
 *  the way back, exactly as a tree move does: a drag is the one gesture in
 *  this product the hand can make by accident. */
export async function applySectionMove(
  path: string,
  content: string,
  headingLine: number,
  target: DropTarget,
): Promise<string | null> {
  const section = sectionAtHeading(sectionsOf(content), headingLine);
  if (!section) return null;
  const next = moveSection(content, headingLine, target);
  if (next === null) return null;
  try {
    await applyNoteContent(path, next);
    actionToast(tf("sectionMoved", { title: section.text }), t("undo"), () => {
      void applyNoteContent(path, content)
        .then(() => toast(t("sectionMoveUndone")))
        .catch((err: unknown) => {
          console.error("vellum: undoing a section move failed", err);
          toast(t("sectionMoveFailed"), "error");
        });
    });
    return next;
  } catch (err) {
    console.error("vellum: moving a section failed", err);
    toast(t("sectionMoveFailed"), "error");
    return null;
  }
}
