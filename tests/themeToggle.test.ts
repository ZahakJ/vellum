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

  it("does not drag a reader's own choice into the design's pair", () => {
    // A reader who stored `void` on a phosphor design is shown void; the
    // button lights THAT room differently and never lands them on phosphor.
    assert.equal(toggleChoice("void", "phosphor"), counterpartChoice("void"));
    assert.equal(toggleChoice("linen", "phosphor"), "void");
  });

  it("names the walk that used to happen", () => {
    // The bug, kept as a fact about the map so a future retune that makes it
    // involutive will retire this line rather than silently keep the guard.
    assert.equal(counterpartChoice(counterpartChoice("phosphor")), "verdigris");
  });
});
