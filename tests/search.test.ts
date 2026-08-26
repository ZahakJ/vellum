// THE SEARCH SUITE (v1.8, section J): folding, operators, and the vault-wide
// replace built on both.
//
// The three are one feature to the reader — they all live in the same box — so
// they are tested together, and the tests that matter most are the ones about
// what did NOT happen: a fold that never reaches the write path, a preview that
// is the operation, a frontmatter fence the replace cannot see.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { findAnyMatches, findMatches, foldKeep, foldTerm } from "../shared/fold.ts";
import { parseSearchQuery, SEARCH_OPERATORS } from "../shared/searchQuery.ts";
import { applyBulk, clearUndoBundles, undoBulk } from "../server/bulkRewrite.ts";
import {
  initIndexer,
  replaceCandidates,
  search,
  searchMatches,
  searchTerms,
} from "../server/indexer.ts";
import {
  makeBodyTest,
  previewReplace,
  replaceTransform,
  screenTargets,
} from "../server/searchReplace.ts";
import { initSite } from "../server/site.ts";
import { initVault } from "../server/vault.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

// ================================================================ the fold

describe("fold: what counts as the same letter", () => {
  it("strips harakat so the plain spelling is the pointed one", () => {
    assert.equal(foldTerm("الْمُقَدِّمَة"), foldTerm("المقدمة"));
  });

  it("folds the alef family, ى/ي, ة/ه and the Persian letters", () => {
    for (const [a, b] of [
      ["أحمد", "احمد"],
      ["إسلام", "اسلام"],
      ["آخر", "اخر"],
      ["علی", "علي"], // Persian yeh
      ["مصطفى", "مصطفي"],
      ["مدينة", "مدينه"],
      ["کتاب", "كتاب"], // Persian keheh
    ]) {
      assert.equal(foldTerm(a), foldTerm(b), `${a} should fold onto ${b}`);
    }
  });

  it("folds Latin accents — résumé is resume, composed OR decomposed", () => {
    // BOTH normalisations, and the composed one is the case that actually
    // reaches this code: a filename typed on a Mac, a sentence pasted out of a
    // browser, anything that has been through NFC carries `é` as ONE code
    // point, and a fold that only knew the combining block sailed past it.
    for (const [a, b] of [["résumé", "resume"], ["naïve", "naive"], ["café", "cafe"], ["señor", "senor"]]) {
      for (const form of ["NFC", "NFD"] as const) {
        assert.equal(foldTerm(a.normalize(form)), b, `${a} (${form})`);
        assert.equal(foldTerm(a.normalize(form).toUpperCase()), b, `${a} upper (${form})`);
      }
    }
  });

  it("does NOT fold a Hangul syllable onto its initial consonant", () => {
    // Hangul decomposes under NFD too, into jamo that are letters in their own
    // right — taking the first one would make every syllable starting with ᄀ
    // the same word.
    assert.notEqual(foldTerm("\uac00"), foldTerm("\uac01"));
    assert.equal(foldKeep("\uac00").length, 1);
  });

  it("finds a composed accent in running text, at the right offset", () => {
    const line = "a café in Lyon";
    const [hit] = findMatches(line, "cafe");
    assert.ok(hit);
    assert.equal(line.slice(hit.start, hit.end), "café");
  });

  it("drops tatweel, which is a stretch and not a letter", () => {
    assert.equal(foldTerm("كــــتاب"), foldTerm("كتاب"));
  });

  it("returns nothing for a term that is nothing but marks", () => {
    // An empty term in the index is a term every query matches, which is why
    // the caller drops it rather than filing it.
    assert.equal(foldTerm("ًـ‍"), "");
  });

  it("foldKeep preserves length, because its caller reports indices", () => {
    for (const text of ["الْمُقَدِّمَة", "résumé".normalize("NFD"), "Plain ASCII", "مصطفى"]) {
      assert.equal(foldKeep(text).length, text.length, text);
    }
  });

  it("foldKeep still folds the letter families it can do in place", () => {
    assert.equal(foldKeep("مدينة"), foldKeep("مدينه"));
  });

  it("findMatches reports offsets into the UNTOUCHED string", () => {
    const line = "باب الْمُقَدِّمَة في الكتاب";
    const [hit] = findMatches(line, "المقدمة");
    assert.ok(hit, "the plain spelling must find the pointed word");
    assert.equal(line.slice(hit.start, hit.end), "الْمُقَدِّمَة");
  });

  it("findAnyMatches merges overlapping needles rather than nesting them", () => {
    const hits = findAnyMatches("the note and the notebook", ["note", "notebook"]);
    // Both needles hit at 17. The longer one wins and the scan resumes past
    // it, so the word is not marked twice with one span inside the other.
    assert.deepEqual(hits.map((h) => [h.start, h.end]), [[4, 8], [17, 25]]);
  });
});

// ============================================================== the operators

describe("search operators: the grammar", () => {
  it("peels the operators off and leaves the words", () => {
    const parsed = parseSearchQuery("tag:recipes cumin -is:published");
    assert.equal(parsed.text, "cumin");
    assert.deepEqual(
      parsed.filters.map((f) => [f.kind, f.value, f.negated]),
      [["tag", "recipes", false], ["is", "published", true]],
    );
  });

  it("accepts a quoted value, because folders have spaces in them", () => {
    const parsed = parseSearchQuery('path:"Reading notes" salt');
    assert.equal(parsed.text, "salt");
    assert.equal(parsed.filters[0].value, "reading notes");
  });

  it("takes the # off a tag the reader copied from a pill", () => {
    assert.equal(parseSearchQuery("tag:#recipes").filters[0].value, "recipes");
  });

  it("parses the date operators to the start of the named period, in UTC", () => {
    const [before] = parseSearchQuery("before:2024").filters;
    assert.equal(before.ms, Date.UTC(2024, 0, 1));
    const [after] = parseSearchQuery("after:2024-06-15").filters;
    assert.equal(after.ms, Date.UTC(2024, 5, 15));
  });

  it("AN OPERATOR THAT DOES NOT PARSE IS A WORD — never a query matching nothing", () => {
    for (const raw of ["before:soon", "is:blue", "tag:", "2024-06-15", "http://x.test/a"]) {
      const parsed = parseSearchQuery(raw);
      assert.deepEqual(parsed.filters, [], raw);
      assert.equal(parsed.text, raw, raw);
    }
  });

  it("refuses a date that rolled forward into the next month", () => {
    assert.deepEqual(parseSearchQuery("before:2024-02-31").filters, []);
  });

  it("leaves a minus in front of a plain word alone", () => {
    assert.equal(parseSearchQuery("-draft").text, "-draft");
  });

  it("names every operator it parses, for the help popover", () => {
    for (const op of SEARCH_OPERATORS) {
      const value = op === "is" ? "page" : op === "before" || op === "after" ? "2024" : "x";
      assert.equal(parseSearchQuery(`${op}:${value}`).filters.length, 1, op);
    }
  });
});

// ================================================== the index, on a real vault

const data = makeDir();
const root = makeVault({
  "Books/Muqaddima.md": note(
    { title: "المقدمة", date: "2021-03-04" },
    "كتاب الْمُقَدِّمَة لابن خلدون، وفيه الْعُمْران.\n\nSee also [[Ledger]].\n",
  ),
  "Recipes/Dal.md": note(
    { tags: "[recipes, dinner]", date: "2024-05-01" },
    "A pot of dal with cumin and salt.\nMore cumin than you think.\n",
  ),
  "Recipes/Soup.md": note(
    { tags: "recipes", publish: "true", date: "2023-01-02" },
    "Soup with cumin.\n",
  ),
  "Ledger.md": note({ page: "true" }, "The ledger links to [[Dal]] and nothing else.\n"),
  "Resume.md": note({}, "My résumé, and a café in Lyon.\n"),
  "Notes/Quiet.md": "No frontmatter at all. Cumin is capitalised nowhere here.\n",
});

before(async () => {
  initSite({ VELLUM_DATA: data });
  initVault(root);
  await initIndexer();
});

after(() => {
  clearUndoBundles();
  removeVault(root);
  removeVault(data);
});

const paths = (hits: { path: string }[]): string[] => hits.map((h) => h.path).sort();

describe("search: the fold reaches the index", () => {
  it('"المقدمة" finds the note that spells it with every haraka', () => {
    assert.ok(paths(search("المقدمة", false, null)).includes("Books/Muqaddima.md"));
  });

  it("the pointed spelling finds the plain one too — the fold runs both ways", () => {
    assert.ok(paths(search("الْعُمْران", false, null)).includes("Books/Muqaddima.md"));
  });

  it("resume finds résumé, and cafe finds café", () => {
    assert.ok(paths(search("resume", false, null)).includes("Resume.md"));
    assert.ok(paths(search("cafe", false, null)).includes("Resume.md"));
  });

  it("marks the pointed word in the line it quotes back", () => {
    const [line] = searchMatches("Books/Muqaddima.md", "المقدمة", false, null);
    assert.ok(line, "the expansion under a hit must find the line too");
    assert.match(line.text, /<mark>الْمُقَدِّمَة<\/mark>/);
  });
});

describe("search: the operators, against real notes", () => {
  it("a query of nothing but operators lists every note it narrows to", () => {
    assert.deepEqual(paths(search("tag:recipes", false, null)), [
      "Recipes/Dal.md",
      "Recipes/Soup.md",
    ]);
  });

  it("narrows a term search", () => {
    assert.deepEqual(paths(search("cumin path:Recipes", false, null)), [
      "Recipes/Dal.md",
      "Recipes/Soup.md",
    ]);
  });

  it("is:published and is:page read the frontmatter flags", () => {
    assert.deepEqual(paths(search("is:published", false, null)), ["Recipes/Soup.md"]);
    assert.deepEqual(paths(search("is:page", false, null)), ["Ledger.md"]);
  });

  it("negation removes rather than narrowing to nothing", () => {
    assert.deepEqual(paths(search("tag:recipes -is:published", false, null)), ["Recipes/Dal.md"]);
  });

  it("the date operators bracket a year", () => {
    assert.deepEqual(paths(search("tag:recipes after:2024", false, null)), ["Recipes/Dal.md"]);
    assert.deepEqual(paths(search("tag:recipes before:2024", false, null)), ["Recipes/Soup.md"]);
  });

  it("linkto: is the notes that point AT it; linkfrom: is what it points to", () => {
    assert.deepEqual(paths(search("linkto:Ledger", false, null)), ["Books/Muqaddima.md"]);
    assert.deepEqual(paths(search("linkfrom:Ledger", false, null)), ["Recipes/Dal.md"]);
  });

  it("a link operator naming nothing answers with nothing, not with everything", () => {
    assert.deepEqual(search("linkto:NoSuchNote", false, null), []);
  });

  it("AND, not OR: two filters both have to hold", () => {
    assert.deepEqual(search("tag:recipes is:page", false, null), []);
  });

  it("keeps the operators out of the line scanner's needles", () => {
    assert.deepEqual(searchTerms("tag:recipes cumin"), ["cumin"]);
  });

  it("a visitor's operator search is still a visitor's search", () => {
    // `is:page` matches Ledger, which is not published — an anonymous caller
    // must not be able to enumerate it through the operator layer.
    assert.deepEqual(search("is:page", true, null), []);
  });
});

// ================================================== the vault-wide replace

const spec = (find: string, replace: string, regex = false) => ({ find, replace, regex });

describe("replace: the transform", () => {
  it("rewrites the body and never the frontmatter", () => {
    const src = note({ title: "cumin study", tags: "[cumin]" }, "cumin here\n");
    const out = replaceTransform(spec("cumin", "coriander"), null)("N.md", src);
    assert.equal(out?.count, 1);
    assert.equal(out?.text, note({ title: "cumin study", tags: "[cumin]" }, "coriander here\n"));
  });

  it("is case-sensitive, because a replace is a write", () => {
    assert.equal(replaceTransform(spec("cumin", "x"), null)("N.md", "Cumin\n"), null);
  });

  it("does NOT fold — the one matcher in v1.8 that must not", () => {
    // Finding is a question and folding widens it kindly. Replacing would be
    // stripping harakat the reader never typed and never saw.
    assert.equal(replaceTransform(spec("المقدمة", "x"), null)("N.md", "الْمُقَدِّمَة\n"), null);
  });

  it("treats $ in a literal replacement as a dollar sign", () => {
    const out = replaceTransform(spec("PRICE", "$5"), null)("N.md", "PRICE\n");
    assert.equal(out?.text, "$5\n");
  });

  it("regex mode honours capture groups and per-line anchors", () => {
    const out = replaceTransform(spec("^(\\w+): (\\d+)", "$2 — $1", true), null)(
      "N.md",
      "alpha: 1\nbeta: 2\nnot a match\n",
    );
    assert.equal(out?.text, "1 — alpha\n2 — beta\nnot a match\n");
    assert.equal(out?.count, 2);
  });

  it("refuses a pattern that matches the empty string", () => {
    assert.throws(() => replaceTransform(spec("a*", "x", true), null)("N.md", "b"), /everywhere/);
  });

  it("refuses an invalid pattern, a newline, and an empty needle", () => {
    assert.throws(() => replaceTransform(spec("([", "x", true), null)("N.md", ""), /valid/);
    assert.throws(() => replaceTransform(spec("a\nb", "x"), null)("N.md", ""), /one line/);
    assert.throws(() => replaceTransform(spec("", "x"), null)("N.md", ""), /find/i);
  });

  it("touches only the lines the reader ticked", () => {
    const src = note({ a: "1" }, "cumin one\ncumin two\ncumin three\n");
    // The fence is three lines, so the body starts at line 4.
    const selection = new Map([["N.md", new Set([5])]]);
    const out = replaceTransform(spec("cumin", "salt"), selection)("N.md", src);
    assert.equal(out?.count, 1);
    assert.equal(out?.text, note({ a: "1" }, "cumin one\nsalt two\ncumin three\n"));
  });

  it("a file absent from the selection is not touched at all", () => {
    const selection = new Map<string, Set<number> | null>([["Other.md", null]]);
    assert.equal(replaceTransform(spec("cumin", "salt"), selection)("N.md", "cumin\n"), null);
  });
});

describe("replace: nomination and preview", () => {
  it("nominates only the notes whose BODY holds the needle, within the scope", () => {
    assert.deepEqual(replaceCandidates("tag:recipes", makeBodyTest(spec("cumin", "x"))), [
      "Recipes/Dal.md",
      "Recipes/Soup.md",
    ]);
  });

  it("without operators the scope is the whole vault", () => {
    assert.deepEqual(replaceCandidates("", makeBodyTest(spec("cumin", "x"))), [
      "Recipes/Dal.md",
      "Recipes/Soup.md",
    ]);
  });

  it("previews the exact lines, numbered as the editor counts them", async () => {
    const preview = await previewReplace(["Recipes/Dal.md"], spec("cumin", "coriander"));
    assert.equal(preview.notes, 1);
    assert.equal(preview.edits, 2);
    const [file] = preview.files;
    assert.equal(file.path, "Recipes/Dal.md");
    assert.ok(file.mtimeMs > 0, "every previewed file carries the mtime it was read at");
    assert.deepEqual(file.lines.map((l) => l.line), [5, 6]);
    assert.equal(file.lines[0].before, "A pot of dal with cumin and salt.");
    assert.equal(file.lines[0].after, "A pot of dal with coriander and salt.");
  });
});

describe("replace: apply, conflict, undo", () => {
  const dalAbs = path.join(root, "Recipes/Dal.md");

  it("applies what was previewed and takes it back", async () => {
    const before = readFileSync(dalAbs, "utf8");
    const preview = await previewReplace(["Recipes/Dal.md"], spec("cumin", "coriander"));
    const { paths: ok, selection, conflicts } = await screenTargets(
      preview.files.map((f) => ({ path: f.path, mtimeMs: f.mtimeMs, lines: null })),
    );
    assert.deepEqual(conflicts, []);
    const result = await applyBulk(ok, replaceTransform(spec("cumin", "coriander"), selection));
    assert.equal(result.notes, 1);
    assert.equal(result.edits, 2);
    assert.match(readFileSync(dalAbs, "utf8"), /coriander/);

    assert.ok(result.undoId, "a replace this size must be undoable");
    await undoBulk(result.undoId);
    assert.equal(readFileSync(dalAbs, "utf8"), before);
  });

  it("REFUSES A FILE THAT MOVED since the preview, and names it", async () => {
    const preview = await previewReplace(["Recipes/Dal.md"], spec("cumin", "coriander"));
    // Somebody else saves the note while the reader is reading the preview.
    const stale = readFileSync(dalAbs, "utf8");
    writeFileSync(dalAbs, `${stale}An extra line.\n`);
    const screened = await screenTargets(
      preview.files.map((f) => ({ path: f.path, mtimeMs: f.mtimeMs, lines: null })),
    );
    assert.deepEqual(screened.conflicts, ["Recipes/Dal.md"]);
    assert.deepEqual(screened.paths, []);
    writeFileSync(dalAbs, stale);
  });

  it("refuses a path that climbs out of the vault", async () => {
    await assert.rejects(
      screenTargets([{ path: "../../etc/passwd", mtimeMs: 1, lines: null }]),
      /outside|invalid|escape/i,
    );
  });
});
