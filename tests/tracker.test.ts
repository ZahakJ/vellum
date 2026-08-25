// Trackers: the parser, the stepper's text transform, and the shelf's scope.
//
// Two halves, one file, because they are two halves of one promise:
//
//   1. shared/tracker.ts — the pure model. It loads under `node --test`
//      precisely because it drags no CSS and no CodeMirror behind it (the
//      constraint tests/tables.test.ts states for tableModel.ts), and the
//      arithmetic in it is where a tracker can lie quietly: a bar at the wrong
//      percentage looks exactly like a bar at the right one.
//   2. server/indexer.ts's `trackers()` — the SCOPE. Publishing a reading
//      shelf is the point of the feature, so "a visitor sees published
//      trackers and no others" is a security-shaped claim and is tested
//      through the public API against a fixture vault, the way
//      tests/excerpt.test.ts tests excerpts.
//
// The invariant with the sharpest teeth is `setTrackerProgress` byte
// discipline: it runs on a button press, in the author's own file, and
// anything it rewrites beyond the one number is a diff nobody asked for.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  foldKind,
  parseBoard,
  parseTracker,
  scanTrackers,
  setTrackerProgress,
  trackerAssets,
  trackerFenceKind,
  trackerIcon,
} from "../shared/tracker.ts";
import { initIndexer, trackers as trackersRaw } from "../server/indexer.ts";
import { initSite } from "../server/site.ts";
import { initVault } from "../server/vault.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

// ── The parser ──────────────────────────────────────────────────────────────

describe("parseTracker: progress", () => {
  it("reads a done/total fraction and derives the percentage", () => {
    const tr = parseTracker("title: Elden Ring\nprogress: 62/130\n");
    assert.ok(tr);
    assert.equal(tr.done, 62);
    assert.equal(tr.total, 130);
    assert.ok(Math.abs((tr.percent ?? 0) - 47.6923) < 0.001);
  });

  it("reads a bare percentage, with or without the sign", () => {
    assert.equal(parseTracker("title: A\nprogress: 45%")?.percent, 45);
    assert.equal(parseTracker("title: A\nprogress: 45")?.percent, 45);
  });

  it("tolerates spacing, the word 'of', and Eastern Arabic digits", () => {
    assert.equal(parseTracker("title: A\nprogress: 62 / 130")?.done, 62);
    assert.equal(parseTracker("title: A\nprogress: 62 of 130")?.total, 130);
    const arabic = parseTracker("title: كتاب\nprogress: ٦٢/١٣٠");
    assert.equal(arabic?.done, 62);
    assert.equal(arabic?.total, 130);
  });

  it("clamps a percentage that overshoots and one that goes negative", () => {
    assert.equal(parseTracker("title: A\nprogress: 140%")?.percent, 100);
    assert.equal(parseTracker("title: A\nprogress: -20%")?.percent, 0);
    assert.equal(parseTracker("title: A\nprogress: 200/100")?.percent, 100);
  });

  it("gives a finished thing 100% even when it names no numbers", () => {
    const tr = parseTracker("title: Dune\nstatus: finished");
    assert.equal(tr?.status, "done");
    assert.equal(tr?.percent, 100);
  });

  it("derives the status from the progress when none is given", () => {
    assert.equal(parseTracker("title: A\nprogress: 0%")?.status, "planned");
    assert.equal(parseTracker("title: A\nprogress: 40%")?.status, "active");
    assert.equal(parseTracker("title: A\nprogress: 100%")?.status, "done");
  });
});

describe("parseTracker: the rest of the fence", () => {
  it("folds the status synonyms a person actually types", () => {
    const status = (word: string): string | undefined =>
      parseTracker(`title: A\nstatus: ${word}`)?.status;
    assert.equal(status("reading"), "active");
    assert.equal(status("playing"), "active");
    assert.equal(status("watching"), "active");
    assert.equal(status("in-progress"), "active");
    assert.equal(status("finished"), "done");
    assert.equal(status("on hold"), "paused");
    assert.equal(status("dnf"), "dropped");
    assert.equal(status("backlog"), "planned");
    // A word we do not know is not a status: the card derives one from the
    // progress rather than inventing a chip.
    assert.equal(status("marinating"), "planned");
  });

  it("reads every rating form", () => {
    assert.deepEqual(parseTracker("title: A\nrating: 8/10")?.rating, { value: 8, max: 10 });
    assert.deepEqual(parseTracker("title: A\nrating: 4/5")?.rating, { value: 4, max: 5 });
    assert.deepEqual(parseTracker("title: A\nrating: ★★★★")?.rating, { value: 4, max: 5 });
    assert.deepEqual(parseTracker("title: A\nrating: ★★★★☆")?.rating, { value: 4, max: 5 });
    assert.deepEqual(parseTracker("title: A\nrating: 4")?.rating, { value: 4, max: 5 });
    assert.deepEqual(parseTracker("title: A\nrating: 8")?.rating, { value: 8, max: 10 });
    assert.equal(parseTracker("title: A\nrating: ")?.rating, null);
  });

  it("accepts a cover as a bare name or as an embed", () => {
    assert.equal(parseTracker("title: A\ncover: art.jpg")?.cover, "art.jpg");
    assert.equal(parseTracker("title: A\ncover: ![[art.jpg]]")?.cover, "art.jpg");
    assert.equal(parseTracker("title: A\ncover: [[art.jpg]]")?.cover, "art.jpg");
    assert.equal(parseTracker("title: A\ncover: ![[art.jpg|200]]")?.cover, "art.jpg");
  });

  it("maps the kind to a glyph and keeps the author's own word", () => {
    const tr = parseTracker("title: A\nkind: movie");
    assert.equal(tr?.kind, "movie");
    assert.equal(tr?.kindKey, "film");
    assert.equal(tr?.icon, "film");
    assert.equal(trackerIcon("boardgame"), "sparkle");
    assert.equal(foldKind("Series"), "show");
    assert.equal(foldKind("boardgame"), null);
  });

  it("swallows a block scalar's indented lines as the notes", () => {
    const tr = parseTracker(
      ["title: Elden Ring", "notes: |", "  Margit took 14 tries.", "  Then he did not.", "rating: 9/10"].join("\n"),
    );
    assert.equal(tr?.notes, "Margit took 14 tries.\nThen he did not.");
    assert.deepEqual(tr?.rating, { value: 9, max: 10 });
  });

  it("ignores unknown keys and takes a bare first line as the title", () => {
    const tr = parseTracker("Elden Ring\nfavourite-boss: Radahn\nprogress: 10%");
    assert.equal(tr?.title, "Elden Ring");
    assert.equal(tr?.percent, 10);
  });

  it("returns null for a body with neither a title nor progress", () => {
    // The $$-math rule: unparseable content must read as its own source, so
    // the renderer needs a null to fall back on rather than an empty card.
    assert.equal(parseTracker(""), null);
    assert.equal(parseTracker("kind: game\nunit: hours"), null);
  });
});

describe("parseBoard", () => {
  it("reads the three filters and ignores the rest", () => {
    const filter = parseBoard("kind: game\nstatus: playing\nlimit: 12\nnonsense: yes");
    assert.deepEqual(filter, { kind: "game", status: "active", limit: 12 });
  });

  it("is an empty filter for an empty body", () => {
    assert.deepEqual(parseBoard(""), {});
    assert.deepEqual(parseBoard("status: marinating"), {});
  });
});

describe("scanning a note", () => {
  const NOTE = [
    "# Shelf",
    "",
    "```tracker",
    "title: Dune",
    "cover: dune.jpg",
    "progress: 100%",
    "```",
    "",
    "```js",
    "// not a tracker",
    "```",
    "",
    "````markdown",
    "```tracker",
    "title: Documentation, not a tracker",
    "cover: nope.jpg",
    "```",
    "````",
    "",
    "```tracker",
    "title: Elden Ring",
    "cover: elden.jpg",
    "progress: 62/130",
    "```",
  ].join("\n");

  it("finds every tracker in the note, in order", () => {
    const found = scanTrackers(NOTE);
    assert.deepEqual(
      found.map((tr) => tr.title),
      ["Dune", "Elden Ring"],
    );
  });

  it("does not read a tracker shown INSIDE a longer fence", () => {
    // The nested-fence trap shared/fences.ts exists for: a closer must be at
    // least as long as the run that opened it, so the ```tracker inside the
    // ````markdown block is documentation and nothing else.
    assert.ok(!scanTrackers(NOTE).some((tr) => tr.cover === "nope.jpg"));
  });

  it("collects the covers — the names the visitor allowlist is built from", () => {
    assert.deepEqual(trackerAssets(NOTE), ["dune.jpg", "elden.jpg"]);
  });

  it("recognises a tracker fence's opening line and nothing else", () => {
    assert.equal(trackerFenceKind("```tracker"), "tracker");
    assert.equal(trackerFenceKind("```tracker-board"), "tracker-board");
    assert.equal(trackerFenceKind("~~~tracker"), "tracker");
    assert.equal(trackerFenceKind("```trackers"), null);
    assert.equal(trackerFenceKind("```js"), null);
  });
});

// ── The stepper ─────────────────────────────────────────────────────────────

describe("setTrackerProgress", () => {
  const BODY = ["title: Elden Ring", "kind: game", "progress: 62 / 130", "notes: |", "  Margit."].join("\n");

  it("moves the number and changes nothing else, byte for byte", () => {
    const next = setTrackerProgress(BODY, 1);
    assert.equal(
      next,
      ["title: Elden Ring", "kind: game", "progress: 63 / 130", "notes: |", "  Margit."].join("\n"),
    );
    // Every line but the touched one survives identically — the promise a
    // button press in someone's own file has to keep.
    const before = BODY.split("\n");
    const after_ = next.split("\n");
    assert.equal(before.length, after_.length);
    for (const [i, line] of before.entries()) {
      if (i === 2) continue;
      assert.equal(after_[i], line);
    }
  });

  it("round-trips: up then down is the original body", () => {
    assert.equal(setTrackerProgress(setTrackerProgress(BODY, 1), -1), BODY);
  });

  it("clamps at the total and at zero", () => {
    const full = "title: A\nprogress: 130/130";
    assert.equal(setTrackerProgress(full, 1), full);
    const empty = "title: A\nprogress: 0/130";
    assert.equal(setTrackerProgress(empty, -1), empty);
  });

  it("clamps a percentage at 100", () => {
    assert.equal(setTrackerProgress("title: A\nprogress: 100%", 1), "title: A\nprogress: 100%");
    assert.equal(setTrackerProgress("title: A\nprogress: 99%", 1), "title: A\nprogress: 100%");
  });

  it("keeps CRLF endings and the author's spacing", () => {
    const crlf = "title: A\r\nprogress:   40%\r\nkind: book\r\n";
    assert.equal(setTrackerProgress(crlf, 1), "title: A\r\nprogress:   41%\r\nkind: book\r\n");
  });

  it("writes a progress line under the title when there is none", () => {
    assert.equal(
      setTrackerProgress("title: A\nkind: book", 1),
      "title: A\nprogress: 1%\nkind: book",
    );
    assert.equal(setTrackerProgress("", 1), "progress: 1%");
  });

  it("crossing into 100% is a state the parser then agrees with", () => {
    const body = setTrackerProgress("title: A\nprogress: 129/130", 1);
    const tr = parseTracker(body);
    assert.equal(tr?.percent, 100);
    assert.equal(tr?.status, "done");
  });
});

// ── The shelf's scope (server/indexer.ts) ───────────────────────────────────

const fence = (lines: string[]): string => ["```tracker", ...lines, "```"].join("\n");

const files: Record<string, string> = {
  "Public shelf.md": note(
    { publish: "true" },
    `# Shelf\n\n${fence(["title: Dune", "kind: book", "progress: 300/600", "cover: dune.jpg"])}\n`,
  ),
  "Private shelf.md": note(
    {},
    `# Mine\n\n${fence(["title: Disco Elysium", "kind: game", "progress: 40%"])}\n`,
  ),
  // A stencil carrying a tracker skeleton: it must not shelve itself as a
  // book nobody has started, in the admin's list any more than the public one.
  "Templates/Tracker.md": note(
    { publish: "true" },
    `${fence(["title: {{title}}", "kind: book", "progress: 0/100"])}\n`,
  ),
  "No trackers.md": note({ publish: "true" }, "Just prose.\n"),
};

const data = makeDir();
const root = makeVault(files);

before(async () => {
  initSite({ VELLUM_DATA: data });
  initVault(root);
  await initIndexer();
});

after(() => {
  removeVault(root);
  removeVault(data);
});

describe("trackers() — who may see which shelf", () => {
  it("gives a visitor the published trackers only", () => {
    const list = trackersRaw(true, null);
    assert.deepEqual(
      list.map((meta) => meta.title),
      ["Dune"],
    );
    assert.equal(list[0].path, "Public shelf.md");
    assert.equal(list[0].kind, "book");
    assert.equal(list[0].icon, "book");
    assert.equal(list[0].done, 300);
    assert.equal(list[0].total, 600);
    assert.equal(list[0].status, "active");
  });

  it("gives the admin the whole vault, published or not", () => {
    const titles = trackersRaw(false, null).map((meta) => meta.title);
    assert.ok(titles.includes("Dune"));
    assert.ok(titles.includes("Disco Elysium"));
  });

  it("keeps a template's tracker off BOTH shelves", () => {
    for (const visitor of [true, false]) {
      const titles = trackersRaw(visitor, null).map((meta) => meta.title);
      assert.ok(!titles.some((title) => title.includes("{{title}}")), `template leaked (visitor=${visitor})`);
    }
  });

  it("says nothing about notes that carry no tracker", () => {
    assert.ok(!trackersRaw(false, null).some((meta) => meta.path === "No trackers.md"));
  });
});
