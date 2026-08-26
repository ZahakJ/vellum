// PRINT, AND EXPORT TO PDF — the app's half. (v1.8, parity #3.)
//
// `client/reading/print.css` is the other half and carries the long why. This
// module answers the one question CSS cannot: WHICH DOCUMENT.
//
// THE APP SHELL IS NOT PRINTABLE IN PLACE, and no stylesheet can make it so.
// It is a grid of up to N panes locked to the viewport, its centre column is
// its own scrollport, and — the part that decides the argument — CodeMirror
// renders only the lines near the caret. Printing the editor's DOM prints
// whatever fragment happened to be on screen, which is not a formatting
// problem, it is a silently truncated document. So the app prints a COPY:
// `.s-print`, built here, appended to <body> outside `#root`, and `#root`
// hidden for the duration. The published blog article, whose DOM is complete
// and whose reader may have no JavaScript path to us at all, prints itself in
// place — reading/print.css does that with no help from this file.
//
// WHERE THE COPY COMES FROM, in order:
//
//   1. The rendered document already on screen in the FOCUSED pane, cloned.
//      Hydrated math, drawn tracker cards, decoded images: all of it is
//      already right, and a clone cannot disagree with what the reader is
//      looking at.
//   2. The editor's live buffer, rendered through `renderNoteContent` — the
//      one renderer, so a printed note and a read note cannot drift.
//   3. The note on disk, fetched. Only reachable from the command (a fetch is
//      not something `beforeprint` can wait for), and only as a backstop.
//
// AND WHY IT IS LOADED FROM THE TWO SURFACE MODULES. `beforeprint` fires
// synchronously and Chrome paginates without waiting for a promise, so a
// module imported on demand at print time arrives after the pages are cut.
// Importing this from Editor.tsx and ReadingView.tsx puts it in the chunks
// that are already loaded whenever there is a document to print, and in the
// entry chunk of no one at all — including the anonymous blog reader, who
// needs none of it. That is the same bargain client/desktop/index.ts strikes,
// for the same budget.

import { getNote } from "./api.ts";
import { liveNoteText } from "./editor/bufferBridge.ts";
import { autoDir, t, tf } from "./i18n.ts";
import { loadKatex } from "./katex.ts";
import { numberRendered } from "./reading/headingNumbers.ts";
import { renderNoteContent } from "./reading/renderNote.ts";
import { useStore } from "./state.ts";
import { applyNoteLayoutTo } from "./textLayout.ts";
import { toast } from "./toast.ts";
import { noteTitleOf } from "../shared/noteFormat.ts";

/** The rendered-document element both reading surfaces build (ReadingView and
 *  BlogArticle add this class to the renderer's own `.s-rv` root), which is
 *  what makes one clone work for either. */
const DOC = ".s-reading__content";

let host: HTMLElement | null = null;

function teardown(): void {
  host?.remove();
  host = null;
  delete document.body.dataset.print;
}

/** The document on screen in the pane that has focus. Not "the first one in
 *  the DOM": with two panes open, printing has to mean the one being read,
 *  and the workspace already knows which that is. */
function onScreenDoc(): HTMLElement | null {
  const focus = useStore.getState().workspace.focus;
  const pane = document.querySelector<HTMLElement>(`[data-pane="${CSS.escape(focus)}"]`);
  return (pane ?? document).querySelector<HTMLElement>(`.s-reading__body ${DOC}`);
}

/** Render `content` the way the reading view renders it — same renderer, same
 *  layout call, same heading numbering, so the paper and the screen cannot
 *  disagree about what the note says. */
function renderFor(path: string, content: string): HTMLElement {
  const el = renderNoteContent(content, { notePath: path, tree: useStore.getState().tree });
  el.classList.add("s-reading__content");
  applyNoteLayoutTo(el, content);
  numberRendered(el, content);
  return el;
}

/** THE NOTE'S NAME, AND ONLY WHEN THE NOTE DID NOT ALREADY GIVE IT. A sheet of
 *  paper with no title is anonymous the moment it leaves the printer; two
 *  titles is worse, and "# Title" as the first line is how most of this vault
 *  is written. So: prepend one exactly when the document does not open with a
 *  level-1 heading of its own. */
function titleFor(doc: HTMLElement, path: string): HTMLElement | null {
  if (doc.querySelector(".s-rv-h1") !== null) return null;
  const h1 = document.createElement("h1");
  h1.className = "s-print__title";
  h1.dir = "auto";
  h1.textContent = noteTitleOf(path);
  return h1;
}

/** THE FURNITURE IS NOT THE DOCUMENT, and it is removed rather than hidden.
 *
 *  Two things ride inside a rendered note that belong to the app and not to
 *  the page: the frontmatter properties card (`id`, `publish`, `dg-*` — the
 *  note's filing card, which the published blog has always hidden for the same
 *  reason) and the "this banner names nothing" card, which is an admin repair
 *  affordance with a BUTTON in it that paper cannot press.
 *
 *  `display: none` would have been enough to keep them off the sheet, and it
 *  is not enough for the second thing they do: both are CHROME, translated,
 *  and both sit at the TOP of the document — so whichever is present is the
 *  first text in the host, and the direction below is read from the first
 *  strong character. Measured, on an Arabic instance: a Latin note printed as
 *  a right-to-left page because the first words in its DOM were
 *  «لم يُعثر على صورة الغلاف»; on an English one, an Arabic note printed
 *  left-to-right because they were "Properties". Removing them is the fix that
 *  cannot come apart. (print.css hides both as well, for the surfaces that
 *  build no host of their own.) */
function stripChrome(doc: HTMLElement): void {
  for (const card of doc.querySelectorAll(".s-rv-props")) card.remove();
  for (const missing of doc.querySelectorAll(".s-rv-banner__missing")) {
    (missing.closest(".s-rv-banner") ?? missing).remove();
  }
}

/** The direction of the note's PROSE — its first heading, paragraph, list,
 *  quotation or table, whichever the renderer put first. Deliberately not the
 *  host's whole `textContent`: see `stripChrome` for the two ways that answer
 *  was wrong, and for why this one is read off an element that is the author's
 *  own words by construction. */
function proseDirection(doc: HTMLElement): "ltr" | "rtl" {
  const prose = doc.querySelector(
    ".s-rv-h, .s-rv-p, .s-rv-list, .s-rv-quote, .s-rv-callout, .s-rv-table",
  );
  return autoDir(prose?.textContent ?? doc.textContent ?? "");
}

/** Put a prepared document (or the nothing-to-print line) on <body>. */
function mount(doc: HTMLElement | null, path: string | null): void {
  teardown();
  const el = document.createElement("article");
  el.className = "s-print";
  if (doc !== null && path !== null) {
    stripChrome(doc);
    // The PAGE's direction, not the chrome's: an Arabic note printed from an
    // English instance has to mirror — margins, list markers, table column
    // order and all — and `dir="auto"` on each block cannot mirror the page it
    // sits on. Same rule the blog byline follows (DESIGN.md). A note that
    // PINS its direction in frontmatter has already had it stamped on the
    // element by `applyNoteLayoutTo`, and that answer outranks the guess.
    el.dir = doc.getAttribute("dir") || proseDirection(doc);
    const title = titleFor(doc, path);
    if (title !== null) el.appendChild(title);
    el.appendChild(doc);
  } else {
    const hint = document.createElement("p");
    hint.className = "s-print__hint";
    hint.textContent = t("printNothingOpen");
    el.appendChild(hint);
  }
  document.body.appendChild(el);
  document.body.dataset.print = doc === null ? "none" : "note";
  host = el;
}

/** Wait for the lazy halves of the renderer to land, bounded. KaTeX and the
 *  tracker card are dynamic imports (they are why an anonymous reader's blog
 *  page does not carry 280 kB of math), so a note printed the instant it was
 *  rendered would print `$\int$` as its own source. */
async function settle(el: HTMLElement): Promise<void> {
  const pending = () => el.querySelector(".s-rv-math-pending, .s-rv-tracker-pending") !== null;
  if (el.querySelector(".s-rv-math-pending") !== null) {
    await loadKatex().catch(() => undefined);
  }
  const deadline = Date.now() + 2000;
  while (pending() && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 40));
  }
  // A picture that has not decoded yet prints as a gap in the page — and
  // unlike a slow screen, paper gets no second chance to show it.
  const images = [...el.querySelectorAll("img")].filter((img) => !img.complete);
  if (images.length > 0) {
    await Promise.race([
      Promise.all(images.map((img) => img.decode().catch(() => undefined))),
      new Promise((done) => setTimeout(done, 2000)),
    ]);
  }
}

/** The browser's own print — from a menu, or a chord we do not hold. Whatever
 *  is on screen has to become paper synchronously, so this takes the best
 *  answer it can get without awaiting anything. */
function onBeforePrint(): void {
  // The command already built one; it is better than anything this can do.
  if (host !== null) return;
  // No app shell means the blog shell, which prints itself.
  if (document.querySelector(".s-app") === null) return;
  const path = useStore.getState().openPath;
  const onScreen = onScreenDoc();
  if (onScreen !== null && path !== null) {
    mount(onScreen.cloneNode(true) as HTMLElement, path);
    return;
  }
  const live = path === null ? null : liveNoteText(path);
  if (live !== null && path !== null) {
    mount(renderFor(path, live), path);
    return;
  }
  mount(null, null);
}

/** "Print / Export PDF…" — the palette row, the Ctrl/Cmd+Alt+P chord and the
 *  desktop File menu all land here. */
export async function printNote(): Promise<void> {
  const store = useStore.getState();
  const path = store.openPath;
  const onScreen = onScreenDoc();
  try {
    if (onScreen !== null && path !== null) {
      // Already hydrated on screen — nothing to settle.
      mount(onScreen.cloneNode(true) as HTMLElement, path);
    } else if (path !== null) {
      const content = liveNoteText(path) ?? (await getNote(path)).content;
      const doc = renderFor(path, content);
      mount(doc, path);
      await settle(doc);
    } else {
      toast(t("printNothingOpen"));
      return;
    }
  } catch (err: unknown) {
    console.error("vellum: could not prepare the page for printing", err);
    toast(tf("openFailed", { path: path ?? "" }), "error");
    teardown();
    return;
  }
  window.print();
  // Chrome fires `afterprint` when the dialog closes and Firefox after the
  // job; either way the teardown below is the one that runs. This second call
  // is the belt for a browser that fires neither — the host is display:none on
  // screen, so a survivor is invisible, but it would still be stale.
  setTimeout(teardown, 60_000);
}

window.addEventListener("beforeprint", onBeforePrint);
window.addEventListener("afterprint", teardown);
