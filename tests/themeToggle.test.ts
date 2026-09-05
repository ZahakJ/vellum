// THE ☾/☀ BUTTON ON A DESIGNED SITE IS A ROUND TRIP. The counterpart map in
// client/themes.ts is deliberately not involutive (several dark rooms share
// one lit partner), so a toggle that only ever asked "what is the counterpart
// of what I am on" walked away from the design in two presses: phosphor →
// porcelain → verdigris. `toggleChoice` pins the trip to the DESIGN's pair and
// leaves a reader's own choice on the stock rule; this test is the promise
// stated as arithmetic, for every built-in room.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { THEMES, themeGroup } from "../shared/themes.ts";
import { counterpartChoice, toggleChoice } from "../client/themes.ts";

describe("toggleChoice", () => {
  it("returns to the design's theme exactly after two presses, for every room", () => {
    for (const theme of THEMES) {
      const away = toggleChoice(theme, theme);
      assert.notEqual(themeGroup(away as never), themeGroup(theme), `${theme}: lit differently`);
      assert.equal(toggleChoice(away, theme), theme, `${theme} → ${away} → back`);
    }
  });

  it("is the stock rule when the site has no theme of its own", () => {
    for (const theme of THEMES) {
      assert.equal(toggleChoice(theme, null), counterpartChoice(theme));
      assert.equal(toggleChoice(theme, ""), counterpartChoice(theme));
    }
  });

  it("reaches the design's room from anywhere in two presses", () => {
    // A reader stranded on a stored room the broken walk left behind —
    // verdigris on a phosphor site, the owner's "just shows black" — is one
    // press from the design's lit partner and two from the design itself.
    // The first cut kept their stored room out of the pair and lit verdigris
    // differently forever; phosphor was unreachable without clearing storage.
    for (const stranded of THEMES) {
      const one = toggleChoice(stranded, "phosphor");
      const two = toggleChoice(one, "phosphor");
      assert.ok(one === "porcelain" || one === "phosphor", `${stranded} → ${one}`);
      assert.ok(two === "phosphor" || two === "porcelain", `${stranded} → ${one} → ${two}`);
      assert.ok([one, two].includes("phosphor"), `${stranded}: phosphor reached`);
    }
  });

  it("names the walk that used to happen", () => {
    // The bug, kept as a fact about the map so a future retune that makes it
    // involutive will retire this line rather than silently keep the guard.
    assert.equal(counterpartChoice(counterpartChoice("phosphor")), "verdigris");
  });
});
