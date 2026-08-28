// THE ARRANGEMENT FIELDS — a list's layout, a card's anatomy, a hero's
// treatment, a divider's ornament.
//
// Four fields on three section kinds, and every one of them is a place the
// two halves of the schema could drift. What is pinned here:
//
//   1. ABSENT IS THE OLD BEHAVIOUR. A `designs.json` written before these
//      fields existed — which is every design on every instance that upgrades
//      — must validate, and must come back drawing exactly what it drew
//      yesterday. That is the whole reason they are enum-with-default rather
//      than a schema bump.
//   2. A VALUE THIS BUILD DOES NOT KNOW IS A NAMED 400. The path in the error
//      is what the admin notice prints and what makes a hand-edited file
//      fixable without a debugger, so the test reads the path, not just the
//      throw.
//   3. THE ALLOWLIST LET THEM THROUGH. `KIND_KEYS` is the other half of strict
//      validation: a key the list does not carry is refused by name, so a
//      field added to the interface and forgotten there validates as an error
//      on every save. It has happened; it is one line to forget.
//   4. THE FLOOR IS UNCHANGED. `stockSections()` is what "reset to stock"
//      means, and it is a river with boxed cards forever — the new layouts are
//      choices, not a new default.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DesignError,
  newSection,
  stockSections,
  validateDesign,
  validateSection,
  type DividerSection,
  type HeroSection,
  type PostGridSection,
  type PostListSection,
} from "../shared/design.ts";

/** The shape a stored document has, with `sections` swapped in. */
function doc(sections: unknown[]): Record<string, unknown> {
  return {
    id: "d1",
    name: "A design",
    schema: 1,
    theme: null,
    site: { width: 720, density: "regular" },
    chrome: {},
    sections,
    article: {},
    createdMs: 1,
    updatedMs: 1,
  };
}

describe("design structures: the arrangement fields", () => {
  it("a section written before the field existed keeps the shape it had", () => {
    const list = validateSection(
      { id: "writings", kind: "postList", heading: "", limit: 20, tag: "", showExcerpt: true, showDate: true },
      "sections",
      0,
    ) as PostListSection;
    assert.equal(list.layout, "river");

    const grid = validateSection(
      { id: "leads", kind: "postGrid", heading: "", limit: 3, columns: 3, tag: "" },
      "sections",
      1,
    ) as PostGridSection;
    assert.equal(grid.card, "boxed");

    const hero = validateSection({ id: "top", kind: "hero" }, "sections", 2) as HeroSection;
    assert.equal(hero.treatment, "panel");
  });

  it("takes every layout, card, treatment and divider style this build draws", () => {
    for (const layout of ["river", "ledger", "index", "numbered", "dateline"]) {
      const out = validateSection(
        { id: "l", kind: "postList", layout },
        "sections",
        0,
      ) as PostListSection;
      assert.equal(out.layout, layout);
    }
    for (const card of ["boxed", "bare", "overlay", "ledger", "masonry"]) {
      const out = validateSection({ id: "g", kind: "postGrid", card }, "sections", 0) as PostGridSection;
      assert.equal(out.card, card);
    }
    for (const treatment of ["panel", "band", "split"]) {
      const out = validateSection({ id: "h", kind: "hero", treatment }, "sections", 0) as HeroSection;
      assert.equal(out.treatment, treatment);
    }
    for (const style of ["rule", "dots", "ornament", "blank"]) {
      const out = validateSection({ id: "d", kind: "divider", style }, "sections", 0) as DividerSection;
      assert.equal(out.style, style);
    }
  });

  it("refuses a value it cannot draw, and NAMES the offending path", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ id: "l", kind: "postList", layout: "spiral" }, "sections[0].layout"],
      [{ id: "g", kind: "postGrid", card: "hexagon" }, "sections[0].card"],
      [{ id: "h", kind: "hero", treatment: "diorama" }, "sections[0].treatment"],
      [{ id: "d", kind: "divider", style: "filigree" }, "sections[0].style"],
    ];
    for (const [raw, path] of cases) {
      assert.throws(
        () => validateSection(raw, "sections", 0),
        (err: unknown) => err instanceof DesignError && err.message.startsWith(`${path}:`),
        `expected a named rejection at ${path}`,
      );
    }
  });

  it("the key allowlist carries them, so a whole document round-trips", () => {
    const design = validateDesign(
      doc([
        { id: "top", kind: "hero", treatment: "split", height: "tall" },
        { id: "leads", kind: "postGrid", columns: 3, card: "overlay" },
        { id: "orn", kind: "divider", style: "ornament", space: 48 },
        { id: "run", kind: "postList", limit: 30, layout: "dateline" },
      ]),
    );
    assert.deepEqual(
      design.sections.map((s) =>
        s.kind === "postList"
          ? s.layout
          : s.kind === "postGrid"
            ? s.card
            : s.kind === "hero"
              ? s.treatment
              : s.kind === "divider"
                ? s.style
                : s.kind,
      ),
      ["split", "overlay", "ornament", "dateline"],
    );
  });

  it("a new section is born at the default, and the stock floor is a river", () => {
    assert.equal((newSection("postList", "s1") as PostListSection).layout, "river");
    assert.equal((newSection("postGrid", "s2") as PostGridSection).card, "boxed");
    assert.equal((newSection("hero", "s3") as HeroSection).treatment, "panel");
    const floor = stockSections();
    assert.equal(floor.length, 1);
    assert.equal((floor[0] as PostListSection).layout, "river");
  });
});
