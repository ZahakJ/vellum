// The spellcheck language of a line (shared/script.ts).
//
// The rule is what lets an Arabic paragraph inside an English note be checked
// against an Arabic dictionary instead of arriving as one unbroken red
// underline, so the cases that matter are the MIXED ones — a line is rarely
// purely one script in a bilingual vault.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spellcheckLang } from "../shared/script.ts";

describe("spellcheckLang", () => {
  it("returns null for Latin, so the document's own language stands", () => {
    assert.equal(spellcheckLang("The quick brown fox"), null);
    assert.equal(spellcheckLang(""), null);
    // Digits, punctuation and markdown syntax narrow nothing.
    assert.equal(spellcheckLang("## Heading 2 — [[a link]] `code`"), null);
  });

  it("names Arabic", () => {
    assert.equal(spellcheckLang("الحمد لله رب العالمين"), "ar");
  });

  it("names Hebrew", () => {
    assert.equal(spellcheckLang("בראשית ברא אלהים"), "he");
  });

  it("separates Persian from Arabic on the letters Arabic does not have", () => {
    // پ and گ are Persian's; neither exists in Arabic.
    assert.equal(spellcheckLang("پرسش بزرگ"), "fa");
    // …and a Persian sentence built only from shared letters reads as Arabic.
    // Stated as a test rather than left as a surprise: this is the accepted
    // limit of a SCRIPT test, and the cost of being wrong is one dictionary.
    assert.equal(spellcheckLang("است"), "ar");
  });

  it("takes the RTL script out of a line that is mostly English", () => {
    // The whole point. A citation dropped into an English sentence decides the
    // line, because the English half is what the document's lang already
    // covers and the Arabic half is what it does not.
    assert.equal(spellcheckLang('Ghazali opens with الحمد لله and never returns'), "ar");
  });

  it("prefers Hebrew over Arabic when both are present", () => {
    // Not a real sentence — a deterministic answer for a line that has both,
    // asserted so the precedence cannot drift silently.
    assert.equal(spellcheckLang("שלום و سلام"), "he");
  });
});
