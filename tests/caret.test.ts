// Where the caret lands when a note is opened (client/editor/caretHome.ts).
//
// THE FINDING (v1.8 UX audit, F9): every note opened with the caret on the
// phantom blank line between the properties card and the H1. It is a gap —
// nothing to read there, nothing to continue — and it draws as an empty
// paragraph at the top of the document, on every note in the vault, forever.
//
// The rule it became is small and total, and it has to stay both: the ONE
// thing it must never do is land inside the frontmatter, because that is the
// raw-YAML bug (livePreview.ts::interactedField) arriving through the other
// door.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { afterFrontmatter, caretHome } from "../client/editor/caretHome.ts";

const fm = (body: string): string => `---\ntitle: A note\ntags: [x]\n---\n${body}`;

describe("caret home", () => {
  it("parks at the END of the H1, not on the blank line above it", () => {
    const doc = fm("\n# The title\n\nProse.\n");
    const at = caretHome("Note.md", doc);
    assert.equal(doc.slice(0, at).endsWith("# The title"), true);
    assert.equal(doc[at], "\n");
  });

  it("skips any number of blank lines under the fence", () => {
    const doc = fm("\n\n\n# Title\n");
    assert.equal(doc.slice(0, caretHome("Note.md", doc)).endsWith("# Title"), true);
  });

  it("takes the heading at any level, and only a real ATX heading", () => {
    const h3 = fm("\n### Deep\n");
    assert.equal(h3.slice(0, caretHome("Note.md", h3)).endsWith("### Deep"), true);
    // "#tag" is not a heading: no space after the hashes.
    const tagged = fm("\n#daily and some prose\n");
    assert.equal(caretHome("Note.md", tagged), tagged.indexOf("#daily"));
  });

  it("a headingless note opens at the START of its prose, never at the end", () => {
    const doc = fm("\nFirst line.\n\nSecond paragraph.\n");
    assert.equal(caretHome("Note.md", doc), doc.indexOf("First line."));
  });

  it("a note that is only frontmatter opens at the document end — it is waiting to be written", () => {
    const doc = fm("\n\n");
    assert.equal(caretHome("Note.md", doc), doc.length);
    assert.equal(caretHome("Note.md", "---\ntitle: A\n---\n"), 4 + 9 + 4);
  });

  it("NEVER lands inside the frontmatter — the raw-YAML bug's other door", () => {
    for (const body of ["", "\n", "\n\n\n", "\n# H\n", "\nprose\n", "\n- a list\n"]) {
      const doc = fm(body);
      assert.ok(
        caretHome("Note.md", doc) >= afterFrontmatter("Note.md", doc),
        `caret inside the fence for body ${JSON.stringify(body)}`,
      );
    }
  });

  it("a note with no frontmatter answers 0 — nothing to step over", () => {
    assert.equal(caretHome("Note.md", "# Title\n\nProse.\n"), 0);
    assert.equal(caretHome("Note.md", ""), 0);
  });

  it("reads a .tex note's comment-block frontmatter, not a YAML fence", () => {
    const tex = "%---%\n% title: Paper\n%---%\n\n\\section{One}\n";
    const at = caretHome("Paper.tex", tex);
    assert.ok(at >= tex.indexOf("\\section"), "landed before the LaTeX body");
    // The `\section` line is not an ATX heading, so it is the line's START.
    assert.equal(at, tex.indexOf("\\section"));
  });

  it("is total: no input throws, and the answer is always inside the document", () => {
    for (const doc of ["", "---", "---\n", "---\nnot closed", "---\n---", "\n\n\n", "---\na: 1\n---"]) {
      const at = caretHome("Note.md", doc);
      assert.ok(at >= 0 && at <= doc.length, `out of range for ${JSON.stringify(doc)}`);
    }
  });
});
