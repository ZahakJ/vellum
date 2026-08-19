// THE LEDGER, ASSERTED. `GROUPS` in client/components/ShortcutsHelp.tsx is the
// one place a keyboard binding exists; this file is the arithmetic on it that
// does not need a browser, and it is the same arithmetic `npm run check-keymap`
// runs — one implementation in client/keymap.ts, driven from two doors, so a
// gate that passes and a suite that passes can never disagree.
//
// What it is guarding against is a bug with no symptom at the crash site: two
// rows claiming one keystroke. One handler answers, the other never sees the
// event, and neither knows the other exists — so it surfaces weeks later as
// "Ctrl+B does nothing", on one platform, from one reader. There is nothing to
// grep for, because nothing is wrong with either binding.
//
// The grammar half matters as much as the collision half. A row's `keys` array
// is PRINTED as <kbd> chips and READ here as a chord, and those two only stay
// the same thing while every row spells a chord the same way: modifiers in one
// canonical order, one key token, `↑ / ↓` for a pair. A row that spells itself
// differently still renders — it just stops being comparable, which is how a
// collision hides from the gate that exists to find it.
//
// tests/shortcuts.test.ts is the other half of the keyboard story: this file
// asks whether a binding is UNIQUE, that one asks whether it can be REACHED
// from a keyboard that types no Latin letters. A new binding needs both.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  RESOLVED,
  parseGroups,
  parseKeymapDoc,
  parseKeys,
  scopeOverlap,
} from "../client/keymap.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const ledger = parseGroups(read("../client/components/ShortcutsHelp.tsx"));
const doc = parseKeymapDoc(read("../docs/keymap.md"));

describe("the keymap ledger parses", () => {
  it("reads GROUPS out of the source with no complaints", () => {
    assert.deepEqual(ledger.errors, []);
    // A parser that quietly matches nothing reports a table with no
    // collisions, which is exactly what a broken parser and a healthy table
    // look like from the outside.
    assert.ok(ledger.rows.length > 30, `only ${ledger.rows.length} rows parsed`);
    assert.ok(new Set(ledger.rows.map((r) => r.group)).size > 3);
  });

  it("gives every row an answer — a key, or the surface that carries it", () => {
    for (const row of ledger.rows) {
      assert.ok(
        row.keys !== null || row.via !== null,
        `${row.label} (ShortcutsHelp.tsx:${row.line}) prints a label and an empty key column`,
      );
    }
  });

  it("spells every row's keys in the shape the gate expects", () => {
    for (const row of ledger.rows) {
      if (row.keys === null) continue;
      const { chords, error } = parseKeys(row.keys);
      assert.equal(error, null, `${row.label} (ShortcutsHelp.tsx:${row.line}): ${error}`);
      assert.ok(chords.length > 0, `${row.label} parsed to no chord at all`);
      for (const chord of chords) {
        assert.equal(chord.id, [...chord.mods, chord.key].join("+"));
      }
    }
  });
});

describe("no two bindings are the same keystroke", () => {
  /** chord id → the rows claiming it. */
  const claims = new Map<string, typeof ledger.rows>();
  for (const row of ledger.rows) {
    if (row.keys === null) continue;
    for (const chord of parseKeys(row.keys).chords) {
      const at = claims.get(chord.id) ?? [];
      at.push(row);
      claims.set(chord.id, at);
    }
  }

  const pairs: Array<{ id: string; a: string; b: string }> = [];
  for (const [id, rows] of claims) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (scopeOverlap(rows[i], rows[j]) !== null) {
          pairs.push({ id, a: rows[i].label, b: rows[j].label });
        }
      }
    }
  }

  it("has no undeclared collision", () => {
    const declared = new Set(RESOLVED.map((r) => `${r.chord} ${[...r.rows].sort().join(" ")}`));
    const undeclared = pairs
      .filter((p) => !declared.has(`${p.id} ${[p.a, p.b].sort().join(" ")}`))
      .map((p) => `${p.id}: ${p.a} ⊗ ${p.b}`);
    assert.deepEqual(undeclared, []);
  });

  it("declares no collision that has stopped happening", () => {
    // Dead exceptions are the reason check-i18n fails on a dead dictionary
    // key: an argued-out paragraph about two rows that no longer meet is a
    // claim the next reader will believe.
    const live = new Set(pairs.map((p) => `${p.id} ${[p.a, p.b].sort().join(" ")}`));
    for (const entry of RESOLVED) {
      const token = `${entry.chord} ${[...entry.rows].sort().join(" ")}`;
      assert.ok(live.has(token), `RESOLVED still names ${entry.rows.join(" ⊗ ")} on ${entry.chord}`);
    }
  });

  it("every declared collision says where the tie is broken", () => {
    for (const entry of RESOLVED) {
      assert.ok(entry.why.length > 80, `${entry.chord}: "${entry.why}" is a shrug, not a rule`);
    }
  });

  it("counts a shell and a runtime as scope, and admin as neither", () => {
    const app = { shell: "app" as const, desktop: false };
    const blog = { shell: "blog" as const, desktop: false };
    const both = { shell: null, desktop: false };
    const only = { shell: null, desktop: true };
    assert.equal(scopeOverlap(app, blog), null);
    assert.deepEqual(scopeOverlap(app, both)?.shells, ["app"]);
    assert.deepEqual(scopeOverlap(both, only)?.runtimes, ["desktop"]);
    // An admin session sees the visitor's rows AND its own, so `admin` can
    // never keep two bindings apart — the reader with the most keys is
    // exactly the reader a collision reaches.
    assert.notEqual(scopeOverlap({ ...both }, { ...both }), null);
  });
});

describe("docs/keymap.md is a rendering of the ledger", () => {
  it("parses, between its markers", () => {
    assert.deepEqual(doc.errors, []);
    assert.ok(doc.chords.length > 0);
  });

  it("claims exactly the chords GROUPS binds", () => {
    const bound = new Set(
      ledger.rows.flatMap((r) => (r.keys === null ? [] : parseKeys(r.keys).chords.map((c) => c.id))),
    );
    const written = new Set(doc.chords.map((d) => d.chord.id));
    assert.deepEqual([...bound].filter((id) => !written.has(id)), [], "bound, undocumented");
    assert.deepEqual([...written].filter((id) => !bound.has(id)), [], "documented, unbound");
  });
});

describe("the chord grammar", () => {
  it("reads a plain chord", () => {
    assert.deepEqual(parseKeys(["Ctrl/Cmd", "Alt", "Shift", "B"]).chords.map((c) => c.id), [
      "Mod+Alt+Shift+b",
    ]);
  });

  it("expands the alternatives a single row prints", () => {
    // `Ctrl/Cmd` `↑ / ↓` is ONE row because move-line-up and move-line-down
    // are one thing to learn, and two chords because they are two keystrokes.
    assert.deepEqual(parseKeys(["Ctrl/Cmd", "↑ / ↓"]).chords.map((c) => c.id), [
      "Mod+Up",
      "Mod+Down",
    ]);
    assert.deepEqual(parseKeys(["← / →"]).chords.map((c) => c.id), ["Left", "Right"]);
  });

  it("keeps the slash that is a KEY out of the slash that is a separator", () => {
    // Ctrl/Cmd+/ opens the sheet this whole ledger lives in. Splitting its
    // key token on a bare "/" made it two empty alternatives — the binding
    // most likely to be pressed first, parsed into nothing.
    assert.deepEqual(parseKeys(["Ctrl/Cmd", "/"]).chords.map((c) => c.id), ["Mod+/"]);
  });

  it("refuses a spelling that would hide a collision", () => {
    assert.match(parseKeys(["Ctrl/Cmd", "Shift", "Alt", "T"]).error ?? "", /out of order/);
    assert.match(parseKeys(["Cmd", "T"]).error ?? "", /not a modifier/);
    assert.match(parseKeys(["Ctrl/Cmd", "Shift"]).error ?? "", /is a modifier, not a key/);
    assert.match(parseKeys(["Ctrl/Cmd", "Meta"]).error ?? "", /not a key/);
    assert.match(parseKeys([]).error ?? "", /empty/);
  });
});
