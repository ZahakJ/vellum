// What the command palette calls a match, and in what order it puts the two
// kinds of row (client/paletteRank.ts).
//
// The regression this file holds the line on has a name and a query: v1.8's UX
// audit, finding F18. Typing "sort" put *Design your site* above every note in
// the vault, because the matcher rejected only a MISSING character and the
// command block was concatenated whole on top of the notes. Every case below is
// either that bug, one of the good matches the fix must not throw out with it,
// or the placement rule that decides which kind of row comes first.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BODY_ONLY_SCORE,
  COMMAND_FLOOR,
  MAX_COMMAND_ROWS,
  commandCut,
  fuzzyMatch,
  noteScore,
  normalize,
  rankCommands,
} from "../client/paletteRank.ts";

/** The normalized score of `query` against `text` — what the floor is compared
 *  to — or null when there is no subsequence at all. */
function q(query: string, text: string): number | null {
  const hit = fuzzyMatch(query, text);
  return hit === null ? null : normalize(hit.score, query.length);
}

interface Row {
  label: string;
  hint?: string;
}

const ROWS: Row[] = [
  { label: "New note", hint: "create" },
  { label: "New folder", hint: "create" },
  { label: "Open daily note", hint: "daily/2026-08-25.md" },
  { label: "Toggle graph", hint: "view" },
  { label: "Design your site", hint: "sections · presets · themes" },
  { label: "Moderate comments", hint: "marginalia" },
  { label: "Open trash", hint: "restore a deleted note" },
  { label: "Keyboard shortcuts", hint: "Ctrl/Cmd /" },
  { label: "Reveal note in sidebar", hint: "opens its folders" },
  { label: "Duplicate note", hint: "a copy beside it" },
];

describe("paletteRank: the floor", () => {
  it("F18: 'sort' does not match 'Design your site'", () => {
    // The subsequence IS there (de·S·ign y·O·u·R· si·T·e) — that was the bug.
    assert.notEqual(fuzzyMatch("sort", "Design your site"), null);
    const score = q("sort", "Design your site")!;
    assert.ok(score < COMMAND_FLOOR, `scored ${score}, floor is ${COMMAND_FLOOR}`);
  });

  it("keeps a contiguous run at a word start well above the floor", () => {
    for (const [query, text] of [
      ["trash", "Open trash"],
      ["graph", "Toggle graph"],
      ["note", "New note"],
      ["duplicate", "Duplicate note"],
    ] as const) {
      const score = q(query, text)!;
      assert.ok(score >= 7, `${query} → ${text} scored ${score}`);
    }
  });

  it("keeps an acronym over word starts above the floor", () => {
    for (const [query, text] of [
      ["tg", "Toggle graph"],
      ["dn", "Duplicate note"],
      ["ot", "Open trash"],
    ] as const) {
      const score = q(query, text)!;
      assert.ok(score >= COMMAND_FLOOR, `${query} → ${text} scored ${score}`);
    }
  });

  it("keeps a contiguous run that starts mid-word", () => {
    // "raph" is inside "graph": no word-start bonus on the first character,
    // three consecutive ones after it.
    assert.ok(q("raph", "Toggle graph")! >= COMMAND_FLOOR);
  });

  it("the floor sits in the measured gap, and these are the measurements", () => {
    // The numbers written into COMMAND_FLOOR's own comment. If a bonus is ever
    // retuned, this is the test that says which way the floor has to move.
    const cases: [string, string, number][] = [
      ["sort", "Design your site", -0.75], // the F18 trap
      ["note", "Design your site", 1.5],
      ["tg", "Toggle graph", 3.5], // the weakest match anyone MEANT
      ["pane", "Split pane", 7.75], // a contiguous run at a word start
    ];
    for (const [query, text, want] of cases) {
      assert.equal(q(query, text), want, `${query} → ${text}`);
    }
    assert.ok(1.5 < COMMAND_FLOOR && COMMAND_FLOOR < 3.5, "the floor is in the gap");
  });

  it("normalize is per character, so a floor means the same at any length", () => {
    assert.equal(normalize(31, 4), 7.75);
    assert.equal(normalize(0, 0), 0); // never divides by zero
  });
});

describe("paletteRank: fuzzyMatch anchors", () => {
  it("F18: tries every anchor, so 'note' finds the WORD in 'Design Notes'", () => {
    // The greedy single pass latched onto the `n` of "design" and scored 3.25;
    // the word two characters later is worth more than twice that.
    const hit = fuzzyMatch("note", "Design Notes")!;
    assert.deepEqual(hit.indices, [7, 8, 9, 10]);
    assert.ok(normalize(hit.score, 4) >= 7);
  });

  it("highlights the run the score was paid for", () => {
    const hit = fuzzyMatch("sort", "Keyboard shortcuts")!;
    // s-h-o-r-t: the `s` of "shortcuts", then ortc… — contiguous from index 9.
    assert.equal(hit.indices[0], 9);
  });

  it("returns null only when a character is genuinely absent", () => {
    assert.equal(fuzzyMatch("zebra", "Open trash"), null);
    assert.equal(fuzzyMatch("nnn", "New note"), null); // only two n's
  });

  it("is case-insensitive and total over the empty query", () => {
    assert.notEqual(fuzzyMatch("NOTE", "new note"), null);
    assert.deepEqual(fuzzyMatch("", "anything"), { score: 0, indices: [] });
  });

  it("folds nothing — Arabic labels match their own script", () => {
    const hit = fuzzyMatch("لوح", "طي لوحة الملاحظات");
    assert.notEqual(hit, null);
    assert.ok(normalize(hit!.score, 3) >= COMMAND_FLOOR);
  });
});

describe("paletteRank: rankCommands", () => {
  // The module's own ranking, exercised through the same shape the palette
  // hands it (label + optional hint thunks, already evaluated).
  const rank = (query: string) =>
    rankCommands(query, ROWS, (r) => ({ label: r.label, hint: r.hint }));

  it("F18: 'sort' returns no command row from a table that contains the trap", () => {
    const out = rank("sort");
    assert.deepEqual(out.map((r) => r.command.label), ["Keyboard shortcuts"]);
  });

  it("caps the list at five, keeping the best five", () => {
    const out = rank("note");
    assert.ok(out.length <= MAX_COMMAND_ROWS, `${out.length} rows`);
    // Sorted descending, and a sub-floor score can only belong to a demoted
    // HINT hit — which is the invariant the two-haystack rule rests on.
    for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].score >= out[i].score);
    assert.ok(out.every((r) => r.score >= COMMAND_FLOOR || r.indices.length === 0));
  });

  it("finds a row by its HINT, and ranks it below every label hit", () => {
    const out = rank("marginalia");
    const row = out.find((r) => r.command.label === "Moderate comments");
    assert.ok(row, "the hint is visible row text and must stay searchable");
    assert.deepEqual(row!.indices, [], "highlight indices index the LABEL, not the hint");
    assert.ok(row!.score < 0, "a hint hit is demoted below every label hit");
  });

  it("a label hit wins over the same row's hint hit", () => {
    // "create" is the hint of both New note and New folder; "new" is in both
    // labels. The label spelling must not be dragged down by the hint's.
    const out = rank("new");
    assert.ok(out.every((r) => r.score > 0));
  });

  it("returns nothing for a query nothing matches", () => {
    assert.deepEqual(rank("zzzz"), []);
  });
});

describe("paletteRank: where the command block lands", () => {
  it("a note whose TITLE is what was typed outranks the commands", () => {
    // "sort" against the vault: the note wins outright, so the cut is 1 and the
    // command block falls below it.
    const best = noteScore("sort", "Keyboard shortcuts") - 1; // any weaker command
    assert.equal(commandCut("sort", ["Sorting Algorithms", "Welcome"], best), 1);
  });

  it("a body-only hit never outranks a command that cleared the floor", () => {
    // "Welcome" does not contain the letters of "trash" in order → body-only.
    assert.equal(noteScore("trash", "Welcome"), BODY_ONLY_SCORE);
    assert.ok(BODY_ONLY_SCORE < COMMAND_FLOOR);
    assert.equal(commandCut("trash", ["Welcome"], COMMAND_FLOOR), 0);
  });

  it("an exact tie goes to the command", () => {
    const score = noteScore("note", "New note");
    assert.equal(commandCut("note", ["New note"], score), 0);
  });

  it("with no command rows at all, every note stays where the server put it", () => {
    const titles = ["A", "B", "C"];
    assert.equal(commandCut("a", titles, -Infinity), titles.length);
  });

  it("stops at the first note that loses, keeping each kind one run", () => {
    // Whatever the scores, the answer is a PREFIX length: the command block is
    // never split across the note list.
    const titles = ["Sorting Algorithms", "Welcome", "Sorting notes"];
    const cut = commandCut("sort", titles, COMMAND_FLOOR + 1);
    assert.ok(cut >= 0 && cut <= titles.length);
    assert.ok(
      titles.slice(0, cut).every((tt) => noteScore("sort", tt) > COMMAND_FLOOR + 1),
      "every note before the cut outranks the best command",
    );
  });
});
