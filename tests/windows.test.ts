// The cross-window protocol (client/windows/).
//
// The rule that matters is the LEASE tie-break, and what makes it a protocol
// rather than a coordinator is that both windows compute it independently and
// have to reach the same answer. So this is a test about agreement: for every
// pair of windows, exactly one of them believes it holds the pen.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { winsAgainst } from "../client/windows/identity.ts";
import { pick, rng } from "./helpers/vault.ts";

describe("the write lease", () => {
  it("gives the pen to the window that has been open longest", () => {
    const older = { at: 1000, id: "ffff" };
    const newer = { at: 2000, id: "0000" };
    assert.equal(winsAgainst(older, newer), true);
    assert.equal(winsAgainst(newer, older), false);
  });

  it("breaks a same-millisecond tie on the id, not on luck", () => {
    // Two windows opened in one millisecond is not exotic: a scripted pop-out
    // does it every time. The id is arbitrary and, crucially, AGREED.
    const a = { at: 5, id: "aaaa" };
    const b = { at: 5, id: "bbbb" };
    assert.equal(winsAgainst(a, b), true);
    assert.equal(winsAgainst(b, a), false);
  });

  it("is ANTISYMMETRIC for every pair — exactly one window ever holds it", () => {
    // The property the whole design rests on. If both sides could believe they
    // held the pen, two windows would autosave into one file and the write
    // precondition would be catching a conflict the app manufactured itself.
    const next = rng(7);
    const times = [1, 2, 3, 1000, 1000, 1000];
    const ids = ["0000", "00ff", "a1b2", "ffff", "0a0a"];
    for (let i = 0; i < 5000; i++) {
      const a = { at: pick(next, times), id: pick(next, ids) };
      const b = { at: pick(next, times), id: pick(next, ids) };
      if (a.at === b.at && a.id === b.id) continue; // the same window
      assert.notEqual(
        winsAgainst(a, b),
        winsAgainst(b, a),
        `both or neither held the lease: ${JSON.stringify([a, b])}`,
      );
    }
  });

  it("is TRANSITIVE, so three windows cannot form a cycle", () => {
    // Without this, three windows could each believe a different one of them
    // was the writer and the note would never settle.
    const next = rng(11);
    const times = [1, 2, 2, 3];
    const ids = ["a", "b", "c", "d"];
    const mk = () => ({ at: pick(next, times), id: pick(next, ids) });
    for (let i = 0; i < 5000; i++) {
      const [a, b, c] = [mk(), mk(), mk()];
      if (winsAgainst(a, b) && winsAgainst(b, c)) {
        assert.equal(winsAgainst(a, c), true, `cycle: ${JSON.stringify([a, b, c])}`);
      }
    }
  });

  it("a window that reloads does not steal the pen back", () => {
    // `windowBornAt` is in sessionStorage precisely so a refresh keeps the
    // window's original age. If a reload minted a new "now", the refreshed
    // window would look YOUNGER and lose — which is the correct outcome, and
    // the reason the value is persisted rather than recomputed is the opposite
    // case: it must not look older than it is and take the note from whoever
    // legitimately holds it.
    const original = { at: 1000, id: "aaaa" };
    const peerWhoTookOver = { at: 900, id: "bbbb" };
    assert.equal(winsAgainst(original, peerWhoTookOver), false);
  });
});
