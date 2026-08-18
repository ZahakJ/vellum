// WHOSE LANGUAGE IS THIS SESSION READING IN. One table, because the two
// per-browser preferences are easy to get wrong in each other's favour and
// the product shipped one of those wrongs: `loadMe()` applied the VISITOR's
// stored choice over `me.language` for every session, admin included. One tap
// on the public site's ع and the owner's editor, sidebar, tabs, status bar
// and command palette were Arabic too — and on an instance whose
// publicLayout is "app" the blog shell never renders, so the EN/ع control
// that set it does not exist anywhere in the product. There was no way back
// from inside the app.
//
// The rule under test is the fix, and it is deliberately a pure function
// (client/langPref.ts) rather than four lines inside loadMe: it is the only
// place either preference is allowed to be consulted, so a table like this
// one can hold it to the two invariants that matter —
//
//   1. A visitor's stored choice NEVER reaches an admin's chrome.
//   2. An admin's stored choice NEVER reaches a visitor's, and therefore
//      never touches what is published.
//
// `admin` here is the server's word (`/api/me`), which reports false for an
// admin previewing as a visitor — the row that keeps the preview honest.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chromeLang, otherLang } from "../client/langPref.ts";

type Lang = "en" | "ar";

interface Case {
  name: string;
  admin: boolean;
  languageToggle: boolean;
  siteLang: Lang;
  editor: Lang | null;
  visitor: Lang | null;
  want: Lang;
}

const CASES: Case[] = [
  // ── The regression this file exists for ─────────────────────────────────
  {
    name: "the owner's editor ignores a visitor choice made in the same browser",
    admin: true,
    languageToggle: true,
    siteLang: "en",
    editor: null,
    visitor: "ar",
    want: "en",
  },
  {
    name: "…and ignores it just as hard when the site itself is Arabic",
    admin: true,
    languageToggle: true,
    siteLang: "ar",
    editor: null,
    visitor: "en",
    want: "ar",
  },

  // ── The editor preference: the owner's own, and only theirs ─────────────
  {
    name: "an English editor over an Arabic site",
    admin: true,
    languageToggle: false,
    siteLang: "ar",
    editor: "en",
    visitor: null,
    want: "en",
  },
  {
    name: "an Arabic editor over an English site",
    admin: true,
    languageToggle: false,
    siteLang: "en",
    editor: "ar",
    visitor: null,
    want: "ar",
  },
  {
    name: "null is Follow site — the default, and the way back from a pin",
    admin: true,
    languageToggle: false,
    siteLang: "ar",
    editor: null,
    visitor: null,
    want: "ar",
  },
  {
    name: "a visitor never inherits the admin's editor language",
    admin: false,
    languageToggle: true,
    siteLang: "ar",
    editor: "en",
    visitor: null,
    want: "ar",
  },
  {
    name: "…not even when the visitor has stated the opposite of it",
    admin: false,
    languageToggle: true,
    siteLang: "en",
    editor: "en",
    visitor: "ar",
    want: "ar",
  },

  // ── The visitor switch, unchanged ───────────────────────────────────────
  {
    name: "a visitor's stored choice wins while the instance offers the switch",
    admin: false,
    languageToggle: true,
    siteLang: "en",
    editor: null,
    visitor: "ar",
    want: "ar",
  },
  {
    name: "turning the switch off restores the site language for everyone",
    admin: false,
    languageToggle: false,
    siteLang: "en",
    editor: null,
    visitor: "ar",
    want: "en",
  },
  {
    name: "a visitor who never chose reads the site language",
    admin: false,
    languageToggle: true,
    siteLang: "ar",
    editor: null,
    visitor: null,
    want: "ar",
  },

  // ── Visitor preview: the server says admin:false, and that is the point ──
  {
    name: "previewing as a visitor shows the VISITOR's language, not the editor's",
    admin: false, // an admin under X-Vellum-Preview
    languageToggle: true,
    siteLang: "en",
    editor: "en",
    visitor: "ar",
    want: "ar",
  },
  {
    name: "previewing with no visitor choice shows the site language",
    admin: false,
    languageToggle: true,
    siteLang: "ar",
    editor: "en",
    visitor: null,
    want: "ar",
  },
];

describe("chromeLang", () => {
  for (const c of CASES) {
    it(c.name, () => {
      assert.equal(
        chromeLang({
          admin: c.admin,
          languageToggle: c.languageToggle,
          siteLang: c.siteLang,
          editor: c.editor,
          visitor: c.visitor,
        }),
        c.want,
      );
    });
  }

  // The two invariants stated as invariants rather than as sampled rows: over
  // every combination of the five inputs, neither preference may be the thing
  // that decides the other's session. A future third preference (a per-device
  // default, a URL override) has to keep both true or this fails.
  it("no visitor preference can move an admin's chrome", () => {
    for (const languageToggle of [true, false]) {
      for (const siteLang of ["en", "ar"] as const) {
        for (const editor of ["en", "ar", null] as const) {
          const base = { admin: true, languageToggle, siteLang, editor };
          const withVisitor = (visitor: Lang | null) => chromeLang({ ...base, visitor });
          assert.equal(withVisitor("en"), withVisitor(null));
          assert.equal(withVisitor("ar"), withVisitor(null));
          assert.equal(withVisitor(null), editor ?? siteLang);
        }
      }
    }
  });

  it("no editor preference can move a visitor's chrome", () => {
    for (const languageToggle of [true, false]) {
      for (const siteLang of ["en", "ar"] as const) {
        for (const visitor of ["en", "ar", null] as const) {
          const base = { admin: false, languageToggle, siteLang, visitor };
          const withEditor = (editor: Lang | null) => chromeLang({ ...base, editor });
          assert.equal(withEditor("en"), withEditor(null));
          assert.equal(withEditor("ar"), withEditor(null));
          assert.equal(withEditor(null), (languageToggle ? visitor : null) ?? siteLang);
        }
      }
    }
  });
});

describe("otherLang", () => {
  it("is the pair the EN/ع switch offers, in both directions", () => {
    assert.equal(otherLang("en"), "ar");
    assert.equal(otherLang("ar"), "en");
  });
});
