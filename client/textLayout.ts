// Note direction and alignment, client side: resolve the pair for one note and
// apply it identically to the three surfaces that render prose — the editor,
// the reading view and the blog article.
//
// One module because "identically" is the whole requirement. Three components
// each setting their own `dir` and `text-align` is three chances to disagree,
// and the disagreement is invisible until a reader opens the same note in the
// editor and on the public site and finds two different documents.
//
// The site default is pushed in from state.ts (loadMe), like the language and
// the calendar; the per-note override is read out of the note's own
// frontmatter by `shared/textLayout.ts`, which both this file and the server's
// validator share so a `dir: rtl` that the panel accepts is a `dir: rtl` the
// editor honours.

import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_DIRECTION,
  frontmatterText,
  isTextAlign,
  isTextDirection,
  layoutDiffers,
  parseNoteLayout,
  resolveNoteLayout,
  type NoteLayout,
  type TextAlign,
  type TextDirection,
} from "../shared/textLayout.ts";
import { t, type I18nKey } from "./i18n.ts";
import "./styles/textlayout.css";
import "./styles/localization.css";

let siteDir: TextDirection = DEFAULT_TEXT_DIRECTION;
let siteAlign: TextAlign = DEFAULT_TEXT_ALIGN;

/** state.ts owns this call (loadMe), beside setLang and setDateCalendar. */
export function setSiteTextLayout(dir: unknown, align: unknown): void {
  siteDir = isTextDirection(dir) ? dir : DEFAULT_TEXT_DIRECTION;
  siteAlign = isTextAlign(align) ? align : DEFAULT_TEXT_ALIGN;
}

/** The site default in force — the settings panel and the status bar's
 *  "differs from the site default" test both need to name it. */
export function siteTextLayout(): { dir: TextDirection; align: TextAlign } {
  return { dir: siteDir, align: siteAlign };
}

/** The pair in force for one note's RAW CONTENT, and where each half came
 *  from. Cheap enough to call per render: it is one regex over the frontmatter
 *  block, not a YAML parse. */
export function noteLayout(content: string): NoteLayout {
  return resolveNoteLayout({ dir: siteDir, align: siteAlign }, parseNoteLayout(frontmatterText(content)));
}

// ── Hard-wrapped prose ──────────────────────────────────────────────────────
//
// JUSTIFICATION NEEDS A PARAGRAPH, AND A HARD-WRAPPED NOTE DOES NOT HAVE ONE.
//
// Most vaults that have been through a plain-text editor are wrapped at a fill
// column, and every one of those source newlines becomes a forced break here
// (the editor draws a `.cm-line`, the reading view and the blog draw a `<br>`).
// A forced break ends a line, but it does not end a BLOCK — so a source line
// wider than the measure is broken by the browser, its first half is stretched
// to the far margin as if it were the middle of a paragraph, and its remainder
// stands beside it as a two-word stub. The result alternates pried-apart lines
// with orphans down the whole note. Soft-wrapped prose, where one source line
// is one paragraph, justifies beautifully and must keep doing so.
//
// So the note's SOURCE decides, once, and all three surfaces read the same
// answer off the same attribute — which is the entire point of this module.
// Frontmatter, fenced code, headings, lists, quotes and table rows are not
// prose and never count; what counts is prose lines that sit in a RUN of two
// or more, because that run is a paragraph somebody wrapped by hand.

/** Enough of a note to know how its author writes. A vault is hard-wrapped or
 *  it is not; the answer does not change three hundred lines in, and the
 *  editor asks this on every document change. */
const HARDWRAP_SCAN = 400;

const NOT_PROSE =
  /^(?:#{1,6}\s|>|\||<|:{3}|\[\^|-{3,}$|\*{3,}$|_{3,}$|[-*+]\s|\d+[.)]\s|\s*\[[^\]]+\]:)/;

/** True when the note's paragraphs are wrapped by hand rather than by the
 *  measure — the one shape `text-align: justify` cannot set. */
export function isHardWrapped(content: string): boolean {
  const lines = content.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    for (let j = 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "---" || t === "...") {
        i = j + 1;
        break;
      }
    }
  }
  let fence: string | null = null;
  let prose = 0;
  let wrapped = 0;
  let run = 0;
  const flush = (): void => {
    if (run >= 2) wrapped += run;
    run = 0;
  };
  const end = Math.min(lines.length, i + HARDWRAP_SCAN);
  for (; i < end; i++) {
    const t = lines[i].trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (fence !== null) {
      if (f && t.startsWith(fence)) fence = null;
      flush();
      continue;
    }
    if (f) {
      fence = f[1];
      flush();
      continue;
    }
    if (t === "" || NOT_PROSE.test(t)) {
      flush();
      continue;
    }
    prose++;
    run++;
  }
  flush();
  // Four lines is two paragraphs' worth of evidence; the ratio keeps one
  // wrapped block inside an otherwise soft-wrapped essay from deciding.
  return wrapped >= 4 && wrapped >= prose * 0.6;
}

/** Paint one rendered-prose container. `dir` goes on the ATTRIBUTE (so the
 *  browser's own bidi algorithm runs, and `auto` keeps meaning "each block
 *  decides for itself" — it is not a CSS value), and the alignment goes on a
 *  data attribute rather than an inline style so `textlayout.css` can carve
 *  out the blocks that must never be centred or justified: code, tables, math.
 *  An inline `text-align` on the container would be inherited by every one of
 *  them with nothing able to override it short of `!important`. */
export function applyNoteLayout(
  el: HTMLElement,
  layout: NoteLayout,
  hardWrapped = false,
): void {
  // `auto` is the DOM's own default for these surfaces (each block already
  // carries dir="auto"); writing it explicitly would be a no-op that the next
  // reader has to verify, so only a real direction is stamped.
  if (layout.dir === "auto") {
    el.removeAttribute("dir");
    delete el.dataset.noteDir;
  } else {
    el.dir = layout.dir;
    // A second, redundant-looking attribute, and it earns its place: the
    // stylesheet has to carve CODE back out of a PINNED direction, and it must
    // not do that under `dir="auto"` — where each block already decides for
    // itself and a blanket `direction: ltr` would be a regression. `[dir]`
    // alone cannot tell the two apart.
    el.dataset.noteDir = layout.dir;
  }
  if (layout.align === "start") delete el.dataset.noteAlign;
  else el.dataset.noteAlign = layout.align;
  // Only ever stamped for the alignment it changes: a hard-wrapped note that
  // is centred, or flush, is a hard-wrapped note nothing is wrong with.
  if (hardWrapped && layout.align === "justify") el.dataset.noteHardwrap = "";
  else delete el.dataset.noteHardwrap;
  pinBlocks(el, layout.dir);
}

/** Blocks that are SOURCE and keep deciding for themselves: code, and typeset
 *  maths. Everything else in a note is a sentence. */
const KEEPS_OWN_DIRECTION = "pre, code, kbd, samp, .s-rv-pre, .s-rv-code, .s-rv-math--display, .s-rv-mathblock, .katex, .katex-display";

/** A PINNED DIRECTION HAS TO REACH THE BLOCKS, or it reaches nothing.
 *
 *  Every rendered note block carries `dir="auto"` — that is the rule that lets
 *  an Arabic callout sit beside an English one, each barred on its own side,
 *  and it is right whenever the direction is `auto`. But an attribute on a
 *  block OUTRANKS one on its container, so a note that pins `rtl` was pinning
 *  a value every paragraph then overrode: the editor obeyed it (its per-line
 *  attribute IS the block attribute) and the reading view did not. Same note,
 *  two documents — exactly the drift `client/textLayout.ts` exists to prevent.
 *
 *  So the pin is pushed down to the blocks that already carry `auto`, and only
 *  to those: a block whose direction was authored some other way is left
 *  alone, and code and maths keep their own (`;const x = 1` is what a pinned
 *  RTL code fence renders as). Undone on the way back to `auto`. */
function pinBlocks(root: HTMLElement, dir: TextDirection): void {
  for (const block of root.querySelectorAll<HTMLElement>('[dir="auto"], [data-pinned-dir]')) {
    if (block.closest(KEEPS_OWN_DIRECTION)) continue;
    if (dir === "auto") {
      if (block.dataset.pinnedDir !== undefined) {
        block.dir = "auto";
        delete block.dataset.pinnedDir;
      }
      continue;
    }
    block.dataset.pinnedDir = "";
    block.dir = dir;
  }
}

/** Resolve and apply in one step — what the reading view and the blog article
 *  each call on the element the renderer just handed them. */
export function applyNoteLayoutTo(el: HTMLElement, content: string): NoteLayout {
  const layout = noteLayout(content);
  applyNoteLayout(el, layout, layout.align === "justify" && isHardWrapped(content));
  return layout;
}

// ── The broadcast ──────────────────────────────────────────────────────────
// A note that disagrees with the site default must SAY SO. This is the same
// argument the mode pills make one file over: a setting that silently changes
// how the text under the caret behaves, with nothing on screen naming it, is
// the invisible-state trap — and here it is worse than a mode, because the
// reader did not switch it on, a line of frontmatter they may not have written
// did. Two surfaces carry it (the properties card, where the frontmatter is,
// and a quiet status-bar segment), and both print the same words from here so
// they cannot drift.

const DIR_KEY: Record<TextDirection, I18nKey> = {
  auto: "layoutDirAuto",
  ltr: "layoutDirLtr",
  rtl: "layoutDirRtl",
};

const ALIGN_KEY: Record<TextAlign, I18nKey> = {
  start: "layoutAlignStart",
  left: "layoutAlignLeft",
  right: "layoutAlignRight",
  center: "layoutAlignCenter",
  justify: "layoutAlignJustify",
};

export function directionWord(dir: TextDirection): string {
  return t(DIR_KEY[dir]);
}

export function alignWord(align: TextAlign): string {
  return t(ALIGN_KEY[align]);
}

/** The chip a disagreeing note earns, or null when it agrees with the site.
 *
 *  `text` names only the halves that DIFFER (a note that pins the direction
 *  and inherits the alignment says one word, not two). `title` names BOTH,
 *  each with its source, because "why is this note centred" is the question
 *  the chip exists to answer and half an answer sends the reader to the file. */
export function layoutBadge(
  layout: NoteLayout,
  hardWrapped = false,
): { text: string; title: string } | null {
  if (!layoutDiffers(layout)) return null;
  const parts: string[] = [];
  if (layout.dirFromNote) parts.push(directionWord(layout.dir));
  if (layout.alignFromNote) parts.push(alignWord(layout.align));
  const source = (fromNote: boolean): string => t(fromNote ? "layoutSourceNote" : "layoutSourceSite");
  const lines = [
    `${t("layoutDirection")}: ${directionWord(layout.dir)} — ${source(layout.dirFromNote)}`,
    `${t("layoutAlignment")}: ${alignWord(layout.align)} — ${source(layout.alignFromNote)}`,
  ];
  // A justified note that is set flush because its paragraphs are wrapped by
  // hand still SAYS "justified" — that is what its frontmatter says, and the
  // chip names the frontmatter. What the chip must not do is leave the reader
  // asking why the page does not look justified, so the tooltip answers.
  if (hardWrapped && layout.align === "justify") lines.push(t("layoutHardWrapped"));
  const title = lines.join(" · ");
  return { text: parts.join(" · "), title };
}

export { layoutDiffers };
export type { NoteLayout, TextAlign, TextDirection };
