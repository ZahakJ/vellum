// The composer's text arithmetic — footnote numbering, case transforms, the
// callout wrap, and the extract-selection splice — with NO CodeMirror and no
// DOM, so `tests/composer.test.ts` can drive exactly the code the commands
// run. Same split keymap.ts makes for the keyboard gate: commands.ts owns the
// dispatch, this module owns the answer, and a suite that passes and an
// editor that works can never be talking about two implementations.

/** One text edit in ORIGINAL document coordinates. The shape CodeMirror's
 *  ChangeSpec accepts directly, and small enough to apply to a plain string
 *  in the tests (`applyChanges`). */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** Apply `changes` to a string. Ranges must not overlap (footnote tokens and
 *  the caret insertion never do). Applied back-to-front so earlier offsets
 *  stay valid. */
export function applyChanges(doc: string, changes: readonly TextChange[]): string {
  const sorted = [...changes].sort((a, b) => b.from - a.from || b.to - a.to);
  let out = doc;
  for (const c of sorted) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

// ── Code regions ────────────────────────────────────────────────────────────
// Footnote tokens and case transforms both have to refuse to read code as
// prose: a `[^1]` inside a fenced block is an array slice in some language,
// not a reference, and renumbering it edits a program nobody asked us to
// touch. One scanner, used by both.

/** [from, to) ranges of fenced blocks and inline code spans. An unclosed
 *  fence runs to EOF — that is what the reader sees while typing one. */
function codeRanges(doc: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let fenceFrom = -1;
  let fenceMark = "";
  let pos = 0;
  for (const line of doc.split("\n")) {
    const m = /^\s{0,3}(```+|~~~+)/.exec(line);
    if (m) {
      if (fenceFrom === -1) {
        fenceFrom = pos;
        fenceMark = m[1][0];
      } else if (m[1][0] === fenceMark) {
        ranges.push([fenceFrom, pos + line.length]);
        fenceFrom = -1;
      }
    } else if (fenceFrom === -1) {
      for (const c of line.matchAll(/`[^`\n]*`/g)) {
        ranges.push([pos + c.index, pos + c.index + c[0].length]);
      }
    }
    pos += line.length + 1;
  }
  if (fenceFrom !== -1) ranges.push([fenceFrom, doc.length]);
  return ranges;
}

// ── Footnotes ───────────────────────────────────────────────────────────────

export interface FootnotePlan {
  /** Every edit: renumbered tokens, the `[^n]` at the caret, the stub at the
   *  end. Original coordinates. */
  changes: TextChange[];
  /** The number the new footnote wears. */
  id: number;
  /** Caret position AFTER the changes land — the end of the definition stub,
   *  which is always the new end of the document, so the writer lands where
   *  the footnote's text goes. */
  caret: number;
}

/** A footnote token, ref or definition: `[^id]` / `[^id]:` at line start. */
const FOOTNOTE_TOKEN = /\[\^([^\]\s]+)\]/g;

/**
 * Plan inserting a footnote reference at `at` plus its definition stub at the
 * document's end, choosing the number so EXISTING footnotes stay ordered.
 *
 * A command that always writes `[^1]` is actively harmful from the second
 * footnote on, so the number is earned, not assumed:
 *
 *   - n = 1 + the highest numeric id whose first appearance is before the
 *     caret (1 in a note with none). Numbers are only ever raised to make
 *     room, never "tidied": a note that jumps 1 → 5 keeps its 5, because
 *     rewriting it is an edit nobody asked for.
 *   - Every numeric footnote that first appears AFTER the caret and would now
 *     be out of order is renumbered upward — references and its definition in
 *     the same plan, so the two can never disagree.
 *   - Word-labelled footnotes (`[^note]`) are prose, not arithmetic: they are
 *     never renamed and never counted.
 *
 * Returns null — refuses cleanly, changing nothing — when the caret sits in
 * code, or when an id has TWO definitions: renumbering an ambiguous note
 * silently picks a winner, and that is a corruption wearing a feature's name.
 */
export function planFootnote(doc: string, at: number): FootnotePlan | null {
  const code = codeRanges(doc);
  // Strictly inside: a caret AT a fence boundary is on prose's side of it.
  if (code.some(([a, b]) => at > a && at < b)) return null;
  const inCode = (p: number) => code.some(([a, b]) => p >= a && p < b);

  interface Token {
    id: string;
    from: number;
    to: number;
    def: boolean;
  }
  const tokens: Token[] = [];
  FOOTNOTE_TOKEN.lastIndex = 0;
  for (let m = FOOTNOTE_TOKEN.exec(doc); m; m = FOOTNOTE_TOKEN.exec(doc)) {
    if (inCode(m.index)) continue;
    const def =
      (m.index === 0 || doc[m.index - 1] === "\n") &&
      doc[m.index + m[0].length] === ":";
    tokens.push({ id: m[1], from: m.index, to: m.index + m[0].length, def });
  }

  const defCount = new Map<string, number>();
  for (const tok of tokens) {
    if (tok.def) defCount.set(tok.id, (defCount.get(tok.id) ?? 0) + 1);
  }
  if ([...defCount.values()].some((count) => count > 1)) return null;

  // Distinct ids by FIRST appearance — a second reference to one footnote is
  // legal markdown and stays with its first.
  const first = new Map<string, number>();
  for (const tok of tokens) if (!first.has(tok.id)) first.set(tok.id, tok.from);

  let beforeMax = 0;
  const after: { id: string; num: number; pos: number }[] = [];
  for (const [id, pos] of first) {
    if (!/^\d+$/.test(id)) continue;
    const num = parseInt(id, 10);
    if (pos < at) beforeMax = Math.max(beforeMax, num);
    else after.push({ id, num, pos });
  }
  const id = beforeMax + 1;

  after.sort((a, b) => a.pos - b.pos);
  const renames = new Map<string, number>();
  let prev = id;
  for (const f of after) {
    if (f.num > prev) {
      prev = f.num; // already ordered past the newcomer — leave it its number
      continue;
    }
    prev += 1;
    renames.set(f.id, prev);
  }

  const changes: TextChange[] = [];
  for (const tok of tokens) {
    const renamed = renames.get(tok.id);
    if (renamed !== undefined) {
      // The token only — a definition's `:` sits outside the brackets and
      // stays where it is.
      changes.push({ from: tok.from, to: tok.to, insert: `[^${renamed}]` });
    }
  }

  const ref = `[^${id}]`;
  // The stub joins an existing definition block without a blank line, and
  // opens one (blank line first) when it is the note's first footnote.
  const trailing = doc.length === 0 || doc.endsWith("\n") ? "" : "\n";
  let lastLine = "";
  const lines = doc.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== "") {
      lastLine = lines[i];
      break;
    }
  }
  const sep =
    doc.trim() === "" ? "" : /^\[\^[^\]\s]+\]:/.test(lastLine) ? "" : "\n";
  const stub = `${trailing}${sep}[^${id}]: `;
  if (at === doc.length) {
    // One change, not two inserts racing for the same position.
    changes.push({ from: at, to: at, insert: ref + stub });
  } else {
    changes.push({ from: at, to: at, insert: ref });
    changes.push({ from: doc.length, to: doc.length, insert: stub });
  }

  const caret =
    doc.length +
    changes.reduce((sum, c) => sum + c.insert.length - (c.to - c.from), 0);
  return { changes, id, caret };
}

// ── Case transforms ─────────────────────────────────────────────────────────

export type CaseMode = "upper" | "lower" | "title";

/** Title Case's exempt words. Copied from client/templates.ts's `titleCase`
 *  rather than imported: that function is module-private and templates.ts is
 *  another engineer's file this round — the copy names its source so the two
 *  can be reunified when it opens up. */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on",
  "or", "per", "the", "to", "vs", "via",
]);

interface Segment {
  text: string;
  /** False for the stretches a transform must not touch. */
  live: boolean;
}

/** Inline code (whole span, backticks included) and wikilinks. In a link the
 *  TARGET half is an address, case-sensitive on disk — `[[iPhone|the phone]]`
 *  uppercased into `[[IPHONE|…]]` points at a file that does not exist — so
 *  only the alias half is prose. A link with NO alias is all address. */
const SKIP_RE = /(`[^`\n]*`)|\[\[([^\][|\n]+)(\|([^\][\n]*))?\]\]/g;

function segmentsOf(text: string): Segment[] {
  const parts: Segment[] = [];
  let last = 0;
  SKIP_RE.lastIndex = 0;
  for (let m = SKIP_RE.exec(text); m; m = SKIP_RE.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), live: true });
    if (m[1] !== undefined || m[3] === undefined) {
      // A code span, or an alias-less wikilink: opaque.
      parts.push({ text: m[0], live: false });
    } else {
      parts.push({ text: `[[${m[2]}|`, live: false });
      parts.push({ text: m[4] ?? "", live: true });
      parts.push({ text: "]]", live: false });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), live: true });
  return parts;
}

/** Transform the SELECTION's text. The word-position bookkeeping for Title
 *  Case runs across all live segments, so "the" straight after a code span is
 *  still an interior word — the rules themselves are `templates.ts`'s: first
 *  and last words always capitalize, interior small words fall, a word
 *  already carrying an inner capital ("iOS") is the author's and stays. */
export function transformCase(text: string, mode: CaseMode): string {
  const parts = segmentsOf(text);
  if (mode === "upper") {
    return parts.map((p) => (p.live ? p.text.toUpperCase() : p.text)).join("");
  }
  if (mode === "lower") {
    return parts.map((p) => (p.live ? p.text.toLowerCase() : p.text)).join("");
  }
  let total = 0;
  for (const p of parts) {
    if (p.live) total += p.text.split(/\s+/).filter((w) => w !== "").length;
  }
  let index = 0;
  return parts
    .map((p) => {
      if (!p.live) return p.text;
      return p.text
        .split(/(\s+)/)
        .map((word) => {
          if (word === "" || /^\s+$/.test(word)) return word;
          const position = index++;
          const lower = word.toLowerCase();
          if (position > 0 && position < total - 1 && SMALL_WORDS.has(lower)) return lower;
          if (/[A-Z]/.test(word.slice(1))) return word;
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join("");
    })
    .join("");
}

// ── Callouts ────────────────────────────────────────────────────────────────

/**
 * Wrap a block of WHOLE LINES in an Obsidian callout. Every line is prefixed,
 * and a blank line becomes a bare `>` — the naive wrap leaves it empty, and a
 * genuinely blank line ENDS a blockquote, so the callout silently stopped at
 * the first paragraph break and the second paragraph fell out as plain prose.
 */
export function calloutWrap(block: string, type: string): string {
  const body = block
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`));
  return [`> [!${type}]`, ...body].join("\n");
}

// ── Extract selection ───────────────────────────────────────────────────────

/** The `[[link]]` an extraction leaves standing where the selection was. */
export function linkFor(title: string): string {
  return `[[${title}]]`;
}

/** The source note after the extraction: selection out, link in. The live
 *  command dispatches this as ONE editor transaction; this splice is the same
 *  arithmetic on a string, which is what the round-trip test drives. */
export function spliceSelection(
  content: string,
  from: number,
  to: number,
  title: string,
): string {
  return content.slice(0, from) + linkFor(title) + content.slice(to);
}

/** The extracted note's body: the selection, exactly, plus the final newline
 *  a file ends with. */
export function extractedNote(selection: string): string {
  return selection.endsWith("\n") ? selection : `${selection}\n`;
}

// The naming rule lives in ../noteName.ts (a module of one function, so the
// first-paint sectionActions chunk shares it without swallowing this whole
// file — the measurement is written down there). Re-exported here so the
// composer's callers and tests have one door to the composer's arithmetic.
import { noteFileName } from "../noteName.ts";
export { noteFileName };

/** A selection's opening words as the offered filename — the dialog's field
 *  is editable, but the offer should be the name the reader would have typed.
 *  Markdown markers are stripped so `**Bold start**` offers "Bold start". */
export function suggestedSelectionName(selection: string): string {
  const firstLine =
    selection.split("\n").find((line) => line.trim() !== "") ?? "";
  const words = firstLine
    .replace(/[*_~`>#]+/g, " ")
    .split(/\s+/)
    .filter((w) => w !== "")
    .slice(0, 8)
    .join(" ")
    // A selection is usually a sentence, and a sentence ends in punctuation
    // the name should not carry — measured: "Alpha beta gamma delta." offered
    // the double-dotted "Alpha beta gamma delta..md".
    .replace(/[.,;:!?…،؛؟]+$/, "");
  return noteFileName(words.slice(0, 60), "Note");
}
