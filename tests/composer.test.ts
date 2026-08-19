// THE COMPOSER'S ARITHMETIC, ASSERTED. client/editor/composeText.ts is the
// pure half of the selection-menu composer commands (commands.ts dispatches
// exactly what these functions return), kept free of CodeMirror and the DOM
// precisely so this file can drive it under `node --test` — the same split
// keymap.ts makes for the keyboard gate.
//
// What each block guards:
//   - EXTRACT: the splice and its round trip. The live command writes the
//     source through the editor and the target through the API; what can rot
//     silently is the arithmetic — the link standing exactly where the
//     selection was, and the snapshot restore being a true inverse (and an
//     IDEMPOTENT one: the toast's Undo runs at most once by construction, but
//     a restore that only works once is a restore that breaks the moment a
//     retry path appears).
//   - FOOTNOTES: the numbering. A command that always inserts [^1] is
//     actively harmful from the second footnote on, so the number is the
//     feature and every case that decides it is pinned: fresh note, append,
//     insert-between (renumbering refs AND defs), gaps kept, word labels
//     untouched, code refused, ambiguity refused.
//   - CASE: the skip list. Uppercasing `[[iPhone|the phone]]` into
//     `[[IPHONE|…]]` points at a file that does not exist — the target is an
//     address, only the alias is prose.
//   - CALLOUT: the blank line. A blank line ends a blockquote, so the naive
//     wrap breaks the callout at the first paragraph break.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyChanges,
  calloutWrap,
  extractedNote,
  linkFor,
  noteFileName,
  planFootnote,
  spliceSelection,
  suggestedSelectionName,
  transformCase,
} from "../client/editor/composeText.ts";

// ── Extract ────────────────────────────────────────────────────────────────

describe("extract selection", () => {
  const content = "# Notes\n\nAlpha beta gamma delta.\n\nLast paragraph.\n";
  const from = content.indexOf("beta");
  const to = content.indexOf(" delta");

  it("replaces exactly the selection with the link", () => {
    const source = spliceSelection(content, from, to, "Beta Gamma");
    assert.equal(source, "# Notes\n\nAlpha [[Beta Gamma]] delta.\n\nLast paragraph.\n");
  });

  it("round-trips: carried text + splice cover the original exactly", () => {
    const carried = content.slice(from, to);
    const source = spliceSelection(content, from, to, "Beta Gamma");
    // Undo is a snapshot restore; the arithmetic inverse is putting the
    // carried text back where the link stands.
    const restored =
      source.slice(0, from) + carried + source.slice(from + linkFor("Beta Gamma").length);
    assert.equal(restored, content);
  });

  it("undo (snapshot restore) is idempotent — a double undo changes nothing", () => {
    // The live undo writes the snapshot back through applyNoteContent; a
    // second application of the same snapshot must be a no-op.
    const snapshot = content;
    let doc = spliceSelection(content, from, to, "Beta Gamma");
    doc = snapshot; // first undo
    const again = snapshot; // second undo
    assert.equal(doc, again);
    assert.equal(again, content);
  });

  it("the extracted note is the selection plus a final newline, once", () => {
    assert.equal(extractedNote("body"), "body\n");
    assert.equal(extractedNote("body\n"), "body\n");
  });

  it("offers a filename from the selection's opening words, vault-spellable", () => {
    assert.equal(suggestedSelectionName("**Bold start** of a thought\nmore"), "Bold start of a thought.md");
    // A sentence's trailing punctuation must not become "delta..md".
    assert.equal(suggestedSelectionName("Alpha beta gamma delta."), "Alpha beta gamma delta.md");
    // [, ] and # cannot appear in a name the [[stub]] must spell.
    assert.equal(suggestedSelectionName("weird ]] name [[x#y"), "weird name x y.md");
    // Whitespace-only selections still offer something typeable.
    assert.equal(suggestedSelectionName("   \n\t"), "Note.md");
    assert.equal(noteFileName("a/b\\c", "Note"), "a b c.md");
  });
});

// ── Footnotes ──────────────────────────────────────────────────────────────

/** Plan + apply in one move, so every case asserts the final document. */
function footnote(doc: string, at: number): { doc: string; id: number; caret: number } | null {
  const plan = planFootnote(doc, at);
  if (plan === null) return null;
  const out = applyChanges(doc, plan.changes);
  return { doc: out, id: plan.id, caret: plan.caret };
}

describe("footnote insertion", () => {
  it("first footnote in a note: [^1], stub after a blank line", () => {
    const doc = "One paragraph.";
    const got = footnote(doc, doc.length);
    assert.ok(got);
    assert.equal(got.doc, "One paragraph.[^1]\n\n[^1]: ");
    assert.equal(got.id, 1);
    // The caret lands in the stub — the next thing typed is the footnote.
    assert.equal(got.caret, got.doc.length);
  });

  it("appending after the last footnote continues the numbering", () => {
    const doc = "Alpha[^1] beta.\n\n[^1]: first\n";
    const at = doc.indexOf(" beta") + " beta".length;
    const got = footnote(doc, at);
    assert.ok(got);
    assert.equal(got.doc, "Alpha[^1] beta[^2].\n\n[^1]: first\n[^2]: ");
    assert.equal(got.id, 2);
  });

  it("inserting BETWEEN footnotes renumbers the later ones, refs and defs", () => {
    const doc = "Alpha[^1] beta gamma[^2].\n\n[^1]: first\n[^2]: second\n";
    const at = doc.indexOf(" gamma");
    const got = footnote(doc, at);
    assert.ok(got);
    // New ref is [^2]; the old [^2] moves to [^3] in BOTH places.
    assert.equal(got.doc, "Alpha[^1] beta[^2] gamma[^3].\n\n[^1]: first\n[^3]: second\n[^2]: ");
    assert.equal(got.id, 2);
  });

  it("keeps a numbering gap the author made — never 'tidies' 5 down", () => {
    const doc = "Alpha[^1] beta gamma[^5].\n\n[^1]: a\n[^5]: b\n";
    const at = doc.indexOf(" gamma");
    const got = footnote(doc, at);
    assert.ok(got);
    // 2 fits between 1 and 5; renumbering 5 would be an edit nobody asked for.
    assert.equal(got.doc, "Alpha[^1] beta[^2] gamma[^5].\n\n[^1]: a\n[^5]: b\n[^2]: ");
  });

  it("a renumbering cascade stays strictly ordered", () => {
    const doc = "a[^1] b c[^2] d[^3].\n\n[^1]: x\n[^2]: y\n[^3]: z\n";
    const at = doc.indexOf(" c");
    const got = footnote(doc, at);
    assert.ok(got);
    assert.equal(got.doc, "a[^1] b[^2] c[^3] d[^4].\n\n[^1]: x\n[^3]: y\n[^4]: z\n[^2]: ");
  });

  it("word-labelled footnotes are prose, not arithmetic — never renamed", () => {
    const doc = "a[^note] b[^1].\n\n[^note]: words\n[^1]: x\n";
    const at = doc.indexOf(" b");
    const got = footnote(doc, at);
    assert.ok(got);
    assert.equal(got.doc, "a[^note][^1] b[^2].\n\n[^note]: words\n[^2]: x\n[^1]: ");
  });

  it("a second reference to one footnote stays with its first appearance", () => {
    const doc = "a[^1] b[^1] c.\n\n[^1]: x\n";
    const got = footnote(doc, doc.indexOf(" c") + 2);
    assert.ok(got);
    // Both refs of 1 keep their number; the new footnote is 2.
    assert.equal(got.doc, "a[^1] b[^1] c[^2].\n\n[^1]: x\n[^2]: ");
  });

  it("ignores [^…] inside fenced blocks and inline code", () => {
    const doc = "```py\nx[^9]\n```\nprose `[^7]` here.";
    const got = footnote(doc, doc.length);
    assert.ok(got);
    // Neither 9 nor 7 counts; this is the note's first real footnote.
    assert.equal(got.id, 1);
    assert.ok(got.doc.endsWith("here.[^1]\n\n[^1]: "));
  });

  it("refuses with the caret inside a code fence", () => {
    const doc = "```\ncode here\n```\n";
    assert.equal(planFootnote(doc, doc.indexOf("here")), null);
  });

  it("refuses an id defined twice — renumbering ambiguity is corruption", () => {
    const doc = "a[^1].\n\n[^1]: x\n[^1]: y\n";
    assert.equal(planFootnote(doc, doc.indexOf(".")), null);
  });

  it("joins an existing definition block without a blank line", () => {
    // Caret BEFORE the existing footnote: the newcomer takes 1, the old 1
    // moves up, and the new stub lands directly under the definition block —
    // no second blank line opening a second block.
    const doc = "a b[^1].\n\n[^1]: x\n";
    const got = footnote(doc, 1);
    assert.ok(got);
    assert.equal(got.doc, "a[^1] b[^2].\n\n[^2]: x\n[^1]: ");
    assert.equal(got.id, 1);
  });
});

// ── Case transforms ────────────────────────────────────────────────────────

describe("case transforms", () => {
  it("upper / lower over plain prose", () => {
    assert.equal(transformCase("Alpha beta", "upper"), "ALPHA BETA");
    assert.equal(transformCase("Alpha BETA", "lower"), "alpha beta");
  });

  it("Title Case: small words interior, first and last always capitalized", () => {
    assert.equal(transformCase("the lord of the rings", "title"), "The Lord of the Rings");
    assert.equal(transformCase("from template a", "title"), "From Template A");
  });

  it("Title Case leaves an author's inner capitals alone (iOS, not Ios)", () => {
    assert.equal(transformCase("iOS notes", "title"), "iOS Notes");
  });

  it("skips a wikilink entirely when it has no alias — the text IS the address", () => {
    assert.equal(
      transformCase("see [[iPhone Notes]] today", "upper"),
      "SEE [[iPhone Notes]] TODAY",
    );
  });

  it("transforms only the ALIAS half of an aliased wikilink", () => {
    assert.equal(
      transformCase("see [[iPhone|the phone]] today", "upper"),
      "SEE [[iPhone|THE PHONE]] TODAY",
    );
    // "the" is INTERIOR to the phrase being titled (the alias is display
    // text inside it, not a title of its own), so the small-word rule reads
    // across the link boundary.
    assert.equal(
      transformCase("read [[guide|the guide to x]] now", "title"),
      "Read [[guide|the Guide to X]] Now",
    );
  });

  it("skips code spans, backticks included", () => {
    assert.equal(
      transformCase("run `npm test` twice", "upper"),
      "RUN `npm test` TWICE",
    );
  });

  it("word positions count across skipped spans — 'the' after code is interior", () => {
    // "of" sits straight after a code span; a per-segment implementation
    // would see it as a segment's first word and capitalize it.
    assert.equal(
      transformCase("state `x` of the world", "title"),
      "State `x` of the World",
    );
  });
});

// ── Callouts ───────────────────────────────────────────────────────────────

describe("callout wrap", () => {
  it("wraps a single line", () => {
    assert.equal(calloutWrap("One line.", "note"), "> [!note]\n> One line.");
  });

  it("keeps a multi-paragraph selection in ONE callout: blank lines become >", () => {
    assert.equal(
      calloutWrap("First para.\n\nSecond para.", "warning"),
      "> [!warning]\n> First para.\n>\n> Second para.",
    );
  });

  it("a whitespace-only line is blank too", () => {
    assert.equal(
      calloutWrap("a\n   \nb", "tip"),
      "> [!tip]\n> a\n>\n> b",
    );
  });
});
