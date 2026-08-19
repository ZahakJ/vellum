// The frecency ledger (client/recents.ts).
//
// The module is split the way workspace.ts is: a pure core (record / rank /
// prune / parse) proven here under bare node, and a thin storage-and-store
// skin the browser demo exercises. The properties pinned below are the ones
// the palette's behaviour actually rests on: decay halves on schedule, the
// cap evicts by score rather than by age, ranking is a total stable order,
// and a path the live tree does not carry is never returned — the "deleted or
// hidden notes never leak titles" promise, as an assertion.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HALF_LIFE_MS,
  RECENTS_MAX,
  decayedWeight,
  parseRecents,
  rankRecents,
  recordVisit,
  type RecentEntry,
} from "../client/recents.ts";

const T0 = 1_700_000_000_000; // an arbitrary fixed "now" — no wall clock in here

function entry(path: string, weight: number, at: number): RecentEntry {
  return { path, weight, at };
}

const liveAll = (entries: readonly RecentEntry[]): Set<string> =>
  new Set(entries.map((e) => e.path));

describe("decay", () => {
  it("a fresh entry scores its full weight", () => {
    assert.equal(decayedWeight(entry("a.md", 3, T0), T0), 3);
  });

  it("halves per half-life, exactly", () => {
    const e = entry("a.md", 4, T0);
    assert.equal(decayedWeight(e, T0 + HALF_LIFE_MS), 2);
    assert.equal(decayedWeight(e, T0 + 2 * HALF_LIFE_MS), 1);
  });

  it("an entry FROM THE FUTURE (clock reset) reads as just-visited, not as huge", () => {
    const e = entry("a.md", 2, T0 + HALF_LIFE_MS);
    assert.equal(decayedWeight(e, T0), 2);
  });
});

describe("recordVisit", () => {
  it("a first visit weighs 1", () => {
    const out = recordVisit([], "a.md", T0);
    assert.deepEqual(out, [entry("a.md", 1, T0)]);
  });

  it("a revisit decays the old weight, then adds one", () => {
    const first = recordVisit([], "a.md", T0);
    const again = recordVisit(first, "a.md", T0 + HALF_LIFE_MS);
    assert.equal(again.length, 1);
    assert.equal(again[0].weight, 1.5); // 1 halved, +1
    assert.equal(again[0].at, T0 + HALF_LIFE_MS);
  });

  it("frequency accumulates: five visits today beat one visit today", () => {
    let a: RecentEntry[] = [];
    for (let i = 0; i < 5; i++) a = recordVisit(a, "often.md", T0 + i);
    const b = recordVisit(a, "once.md", T0 + 10);
    const ranked = rankRecents(b, liveAll(b), T0 + 10);
    assert.deepEqual(ranked, ["often.md", "once.md"]);
  });

  it("recency wins between equals: the later single visit ranks first", () => {
    let led = recordVisit([], "old.md", T0);
    led = recordVisit(led, "new.md", T0 + HALF_LIFE_MS);
    const ranked = rankRecents(led, liveAll(led), T0 + HALF_LIFE_MS);
    assert.deepEqual(ranked, ["new.md", "old.md"]);
  });

  it("a heavy habit from last week still beats one tap from this morning", () => {
    let led: RecentEntry[] = [];
    for (let i = 0; i < 10; i++) led = recordVisit(led, "habit.md", T0 + i);
    led = recordVisit(led, "tap.md", T0 + HALF_LIFE_MS);
    const ranked = rankRecents(led, liveAll(led), T0 + HALF_LIFE_MS);
    // habit decayed to ~5, tap is 1 — the decayed COUNT is the point of
    // frecency over plain recency.
    assert.deepEqual(ranked, ["habit.md", "tap.md"]);
  });

  it("caps at RECENTS_MAX, evicting by SCORE, not by age", () => {
    // A well-visited old note, then a full cap's worth of one-off visits.
    let led: RecentEntry[] = [];
    for (let i = 0; i < 6; i++) led = recordVisit(led, "keeper.md", T0 + i);
    for (let i = 0; i < RECENTS_MAX; i++) {
      led = recordVisit(led, `noise-${i}.md`, T0 + 1000 + i);
    }
    assert.equal(led.length, RECENTS_MAX);
    // The keeper survives even though it is the OLDEST entry…
    assert.ok(led.some((e) => e.path === "keeper.md"), "high-weight entry evicted by age");
    // …and what fell out was a one-off.
    assert.ok(!led.some((e) => e.path === "noise-0.md"));
  });
});

describe("rankRecents", () => {
  it("prunes against the live set: a deleted note's path is not returned", () => {
    let led = recordVisit([], "kept.md", T0);
    led = recordVisit(led, "deleted.md", T0 + 1);
    const ranked = rankRecents(led, new Set(["kept.md"]), T0 + 2);
    assert.deepEqual(ranked, ["kept.md"]);
  });

  it("a visitor-shaped live set hides an admin session's private trail", () => {
    // Same ledger, smaller tree — exactly what a visitor session sees. The
    // private path must simply not exist in the answer.
    let led = recordVisit([], "Public.md", T0);
    led = recordVisit(led, "Private/Secret.md", T0 + 1);
    assert.deepEqual(rankRecents(led, new Set(["Public.md"]), T0 + 2), ["Public.md"]);
  });

  it("is a total, stable order — same call twice, same answer", () => {
    let led: RecentEntry[] = [];
    for (const p of ["c.md", "a.md", "b.md"]) led = recordVisit(led, p, T0);
    const live = liveAll(led);
    const first = rankRecents(led, live, T0 + 5);
    const second = rankRecents(led, live, T0 + 5);
    assert.deepEqual(first, second);
    // Identical weight and time: alphabetical is the final tie-break.
    assert.deepEqual(first, ["a.md", "b.md", "c.md"]);
  });
});

describe("parseRecents — the ledger as found on disk", () => {
  it("round-trips what recordVisit wrote", () => {
    let led = recordVisit([], "a.md", T0);
    led = recordVisit(led, "b/c.md", T0 + 1);
    assert.deepEqual(parseRecents(JSON.stringify(led)), led);
  });

  it("null, garbage and non-arrays parse to an empty memory, never a throw", () => {
    assert.deepEqual(parseRecents(null), []);
    assert.deepEqual(parseRecents("{not json"), []);
    assert.deepEqual(parseRecents('{"a":1}'), []);
    assert.deepEqual(parseRecents('"vellum"'), []);
  });

  it("drops malformed entries and keeps the healthy ones", () => {
    const raw = JSON.stringify([
      { path: "ok.md", weight: 1, at: T0 },
      { path: 7, weight: 1, at: T0 }, // path not a string
      { path: "neg.md", weight: -2, at: T0 }, // weight must be positive
      { path: "nan.md", weight: Number.NaN, at: T0 },
      { path: "when.md", weight: 1, at: "yesterday" },
      { path: "attachment.png", weight: 1, at: T0 }, // not a note path
      null,
      "ok.md",
    ]);
    assert.deepEqual(parseRecents(raw), [{ path: "ok.md", weight: 1, at: T0 }]);
  });

  it("dedupes a corrupted ledger and enforces the cap", () => {
    const dupes = JSON.stringify([
      { path: "a.md", weight: 1, at: T0 },
      { path: "a.md", weight: 9, at: T0 }, // a second claim on the same path
    ]);
    assert.deepEqual(parseRecents(dupes), [{ path: "a.md", weight: 1, at: T0 }]);

    const over = JSON.stringify(
      Array.from({ length: RECENTS_MAX + 10 }, (_, i) => ({
        path: `n-${i}.md`,
        weight: 1,
        at: T0,
      })),
    );
    assert.equal(parseRecents(over).length, RECENTS_MAX);
  });
});
