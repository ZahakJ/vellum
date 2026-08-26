// The workspace model (client/workspace.ts).
//
// This is the spine of panes, windows and the buffer registry, and it is pure —
// so it can be proven here, before any of it is wired to a component. The
// property tests follow check-sections.mjs's shape: throw thousands of mutated
// inputs at the model and assert the invariants hold, because the bugs in a
// layout model are never in the edit itself, they are in the fifth thing the
// edit invalidated.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_COLUMNS,
  MAX_PANES,
  MAX_ROWS,
  activeTabOf,
  allPaths,
  closeAfterIn,
  closeAllIn,
  closeAllPanes,
  closeOthersIn,
  closePane,
  closePathsUnder,
  closeTabIn,
  stepTab,
  emptyWorkspace,
  fromStoredTabs,
  holdersOf,
  moveTab,
  dropTabSplit,
  openInPane,
  setBookTarget,
  paneAt,
  paneInDirection,
  panesInOrder,
  parseWorkspace,
  pruneWorkspace,
  remapWorkspace,
  serializeWorkspace,
  setPinned,
  soloWorkspace,
  splitPane,
  surfaceOf,
  type Workspace,
} from "../client/workspace.ts";
import { pick, rng } from "./helpers/vault.ts";

function tabs(...paths: string[]) {
  return paths.map((path) => ({ path, pinned: false, ephemeral: false }));
}

/** Every invariant parseWorkspace promises, asserted against a live value. */
function assertInvariants(ws: Workspace, why: string): void {
  const flat = ws.layout.columns.flat();
  assert.ok(ws.layout.columns.length >= 1, `${why}: at least one column`);
  assert.ok(ws.layout.columns.length <= MAX_COLUMNS, `${why}: column cap`);
  assert.ok(flat.length <= MAX_PANES, `${why}: pane cap`);
  for (const col of ws.layout.columns) {
    assert.ok(col.length >= 1 && col.length <= MAX_ROWS, `${why}: rows per column`);
  }
  assert.equal(new Set(flat).size, flat.length, `${why}: no pane placed twice`);
  assert.deepEqual(new Set(flat), new Set(Object.keys(ws.panes)), `${why}: layout and panes agree`);
  for (const id of flat) {
    const pane = ws.panes[id];
    if (pane.tabs.length === 0) assert.equal(pane.active, -1, `${why}: empty pane has active -1`);
    else assert.ok(pane.active >= 0 && pane.active < pane.tabs.length, `${why}: active in range`);
    assert.equal(
      new Set(pane.tabs.map((t) => t.path)).size,
      pane.tabs.length,
      `${why}: no path twice in one pane`,
    );
    for (const t of pane.tabs) {
      assert.ok(!(t.pinned && t.ephemeral), `${why}: pinned and ephemeral are opposites`);
    }
    if (pane.follow !== null) assert.equal(pane.tabs.length, 0, `${why}: a follower holds no tabs`);
  }
  assert.ok(flat.includes(ws.focus), `${why}: focus names a live pane`);
  assert.equal(ws.panes[ws.focus].follow, null, `${why}: focus is never a follower`);
  assert.ok(flat.includes(ws.noteFocus), `${why}: noteFocus names a live pane`);
  const cw = ws.layout.colWeights;
  assert.equal(cw.length, ws.layout.columns.length, `${why}: one weight per column`);
  assert.ok(cw.every((w) => w > 0), `${why}: weights positive`);
  assert.ok(Math.abs(cw.reduce((a, b) => a + b, 0) - 1) < 1e-9, `${why}: weights normalized`);
}

describe("workspace: tabs", () => {
  it("an ephemeral tab is replaced by the next ephemeral open, not stacked", () => {
    let ws = soloWorkspace(tabs("Kept.md"), "Kept.md");
    const p = ws.focus;
    ws = openInPane(ws, p, "First.md", { ephemeral: true });
    ws = openInPane(ws, p, "Second.md", { ephemeral: true });
    assert.deepEqual(allPaths(ws).sort(), ["Kept.md", "Second.md"]);
    assert.equal(activeTabOf(paneAt(ws, p)!)!.path, "Second.md");
  });

  it("returning to an ephemeral tab commits it — a second visit is intent", () => {
    let ws = soloWorkspace([], null);
    const p = ws.focus;
    ws = openInPane(ws, p, "A.md", { ephemeral: true });
    ws = openInPane(ws, p, "B.md", { ephemeral: true }); // replaces A
    ws = openInPane(ws, p, "B.md", { ephemeral: true }); // revisit: commits
    ws = openInPane(ws, p, "C.md", { ephemeral: true }); // so C does not replace B
    assert.deepEqual(allPaths(ws).sort(), ["B.md", "C.md"]);
  });

  it("newTab forces a real tab past a standing preview", () => {
    let ws = soloWorkspace([], null);
    const p = ws.focus;
    ws = openInPane(ws, p, "A.md", { ephemeral: true });
    ws = openInPane(ws, p, "B.md", { ephemeral: true, newTab: true });
    assert.deepEqual(allPaths(ws).sort(), ["A.md", "B.md"]);
  });

  it("no bulk close takes a pinned tab, and that rule is the same in every row", () => {
    const start = () => setPinned(soloWorkspace(tabs("A.md", "B.md", "C.md"), "B.md"), "p", "A.md", true);
    let ws = soloWorkspace(tabs("A.md", "B.md", "C.md"), "B.md");
    const p = ws.focus;
    ws = setPinned(ws, p, "A.md", true);
    assert.deepEqual(allPaths(closeOthersIn(ws, p, "C.md")).sort(), ["A.md", "C.md"]);
    assert.deepEqual(allPaths(closeAllIn(ws, p)), ["A.md"]);
    assert.deepEqual(allPaths(closeAllPanes(ws)), ["A.md"]);
    void start;
  });

  it("close-after takes only what follows, in tab order", () => {
    let ws = soloWorkspace(tabs("A.md", "B.md", "C.md", "D.md"), "A.md");
    const p = ws.focus;
    assert.deepEqual(allPaths(closeAfterIn(ws, p, "B.md")).sort(), ["A.md", "B.md"]);
  });

  it("pinning sorts to the head and commits the tab", () => {
    let ws = soloWorkspace([], null);
    const p = ws.focus;
    ws = openInPane(ws, p, "A.md");
    ws = openInPane(ws, p, "B.md", { ephemeral: true });
    ws = setPinned(ws, p, "B.md", true);
    const pane = paneAt(ws, p)!;
    assert.equal(pane.tabs[0].path, "B.md");
    assert.equal(pane.tabs[0].ephemeral, false);
    // The active tab follows its identity through the reorder, not its index.
    assert.equal(activeTabOf(pane)!.path, "B.md");
  });

  it("closing the active tab lands on the one after it", () => {
    let ws = soloWorkspace(tabs("A.md", "B.md", "C.md"), "B.md");
    const p = ws.focus;
    ws = closeTabIn(ws, p, "B.md");
    assert.equal(activeTabOf(paneAt(ws, p)!)!.path, "C.md");
  });

  it("the tab chords walk the strip and wrap at both ends (F12)", () => {
    let ws = soloWorkspace(tabs("A.md", "B.md", "C.md"), "A.md");
    const p = ws.focus;
    ws = stepTab(ws, p, 1);
    assert.equal(activeTabOf(paneAt(ws, p)!)!.path, "B.md");
    ws = stepTab(ws, p, -1);
    assert.equal(activeTabOf(paneAt(ws, p)!)!.path, "A.md");
    // Backwards off the first tab lands on the last, not on nothing.
    ws = stepTab(ws, p, -1);
    assert.equal(activeTabOf(paneAt(ws, p)!)!.path, "C.md");
    ws = stepTab(ws, p, 1);
    assert.equal(activeTabOf(paneAt(ws, p)!)!.path, "A.md");
  });

  it("stepping a pane with one tab (or none) is a no-op, not a throw", () => {
    const one = soloWorkspace(tabs("A.md"), "A.md");
    assert.equal(stepTab(one, one.focus, 1), one);
    const none = soloWorkspace([], null);
    assert.equal(stepTab(none, none.focus, -1), none);
    assert.equal(stepTab(one, "no-such-pane", 1), one);
  });

  it("stepping past a preview tab does NOT commit it — a glance is not intent", () => {
    let ws = soloWorkspace(tabs("A.md"), "A.md");
    const p = ws.focus;
    ws = openInPane(ws, p, "Preview.md", { ephemeral: true });
    ws = stepTab(ws, p, 1);
    ws = stepTab(ws, p, -1);
    assert.equal(paneAt(ws, p)!.tabs.find((t) => t.path === "Preview.md")!.ephemeral, true);
  });

  it("only notes and books may be tabs", () => {
    const ws = fromStoredTabs({ tabs: ["A.md", "img.png", "Paper.tex", "Book.pdf"], open: "A.md" });
    assert.deepEqual(allPaths(ws).sort(), ["A.md", "Book.pdf", "Paper.tex"]);
  });
});

describe("workspace: panes", () => {
  it("splits along both axes and refuses past the caps", () => {
    let ws = soloWorkspace(tabs("A.md"), "A.md");
    for (let i = 0; i < MAX_COLUMNS - 1; i++) {
      const next = splitPane(ws, ws.focus, "inline", null);
      assert.ok(next, "inline split within the cap");
      ws = next;
      assertInvariants(ws, "after inline split");
    }
    assert.equal(splitPane(ws, ws.focus, "inline", null), null, "column cap refuses by name");
    const stacked = splitPane(ws, ws.focus, "block", null);
    assert.ok(stacked, "block split still allowed");
    assert.equal(splitPane(stacked, stacked.focus, "block", null), null, "row cap");
  });

  it("closing a pane adopts its tabs rather than closing the reader's notes", () => {
    let ws = soloWorkspace(tabs("A.md"), "A.md");
    const first = ws.focus;
    ws = splitPane(ws, first, "inline", null)!;
    ws = openInPane(ws, ws.focus, "B.md");
    ws = openInPane(ws, ws.focus, "C.md");
    const second = ws.focus;
    ws = closePane(ws, second);
    assert.deepEqual(allPaths(ws).sort(), ["A.md", "B.md", "C.md"]);
    assertInvariants(ws, "after closePane");
  });

  it("the last pane never closes — there is always somewhere to type", () => {
    const ws = soloWorkspace(tabs("A.md"), "A.md");
    assert.deepEqual(closePane(ws, ws.focus), ws);
  });

  it("noteFocus stays on a note while a book pane holds the keyboard", () => {
    let ws = soloWorkspace(tabs("Note.md"), "Note.md");
    const noteP = ws.focus;
    ws = splitPane(ws, noteP, "inline", null)!;
    ws = openInPane(ws, ws.focus, "Ihya.pdf");
    assert.equal(ws.focus, paneAt(ws, ws.focus)!.id, "the book pane has the keyboard");
    assert.equal(surfaceOf(paneAt(ws, ws.focus)!), "book");
    assert.equal(ws.noteFocus, noteP, "…and noteFocus still names the note beside it");
  });

  it("OpenHow.book lands on the pane, for a fresh open and for a re-open", () => {
    const aim = { page: 212, rect: null, id: null };
    let ws = soloWorkspace(tabs("Note.md"), "Note.md");
    ws = openInPane(ws, ws.focus, "Ihya.pdf", { book: aim });
    let pane = paneAt(ws, ws.focus)!;
    assert.equal(surfaceOf(pane), "book");
    assert.deepEqual(pane.bookTarget, aim, "a citation rides the open itself");

    // Consumed by the reader…
    ws = setBookTarget(ws, ws.focus, null);
    // …and a LATER citation into the already-open book must still jump: the
    // re-open path sets the target too, or only the first citation ever lands.
    const again = { page: 7, rect: null, id: null };
    ws = openInPane(ws, ws.focus, "Ihya.pdf", { book: again });
    pane = paneAt(ws, ws.focus)!;
    assert.deepEqual(pane.bookTarget, again, "a re-open aims the pane again");

    // A plain open leaves a pending target alone rather than wiping it.
    ws = openInPane(ws, ws.focus, "Ihya.pdf");
    assert.deepEqual(paneAt(ws, ws.focus)!.bookTarget, again);
  });

  it("dropTabSplit: the drag-to-edge gesture moves the tab into a new pane", () => {
    let ws = soloWorkspace(tabs("A.md", "B.md"), "A.md");
    const solo = ws.focus;
    ws = dropTabSplit(ws, solo, "B.md", solo, "end-inline");
    assert.equal(panesInOrder(ws).length, 2, "the drop split the solo pane");
    const [first, second] = panesInOrder(ws);
    assert.deepEqual(first.tabs.map((t) => t.path), ["A.md"]);
    assert.deepEqual(second.tabs.map((t) => t.path), ["B.md"], "the tab travelled");
    assert.equal(ws.focus, second.id, "…and took the keyboard with it");

    // start-inline lands the new pane BEFORE the target in reading order.
    let ws2 = soloWorkspace(tabs("A.md", "B.md"), "A.md");
    ws2 = dropTabSplit(ws2, ws2.focus, "B.md", ws2.focus, "start-inline");
    assert.deepEqual(panesInOrder(ws2)[0].tabs.map((t) => t.path), ["B.md"]);
  });

  it("dropTabSplit: refuses whole rather than half-applying at a cap", () => {
    // Fill the columns, then try to drop across — the close must not happen
    // when the split cannot.
    let ws = soloWorkspace(tabs("A.md", "B.md"), "A.md");
    const p0 = ws.focus;
    ws = splitPane(ws, p0, "inline", null)!;
    ws = splitPane(ws, ws.focus, "inline", null)!; // MAX_COLUMNS reached
    const before = ws;
    ws = dropTabSplit(ws, p0, "B.md", ws.focus, "end-inline");
    assert.deepEqual(allPaths(ws).sort(), allPaths(before).sort(), "no tab eaten");
    assert.deepEqual(paneAt(ws, p0)!.tabs.map((t) => t.path), ["A.md", "B.md"]);
  });

  it("dropTabSplit: an emptied source pane closes behind the drag", () => {
    let ws = soloWorkspace(tabs("A.md"), "A.md");
    const p0 = ws.focus;
    ws = splitPane(ws, p0, "inline", null)!;
    const p1 = ws.focus;
    ws = openInPane(ws, p1, "B.md");
    // Drag B — p1's only tab — onto p0's block edge: p1 must vanish.
    ws = dropTabSplit(ws, p1, "B.md", p0, "end-block");
    assert.equal(paneAt(ws, p1), null, "the emptied pane closed behind it");
    assert.deepEqual(allPaths(ws).sort(), ["A.md", "B.md"]);
    assert.equal(panesInOrder(ws).length, 2);
  });

  it("closing a split pane's last tab closes the pane, and the tab is NOT adopted", () => {
    let ws = soloWorkspace(tabs("A.md"), "A.md");
    const p0 = ws.focus;
    ws = splitPane(ws, p0, "inline", null)!;
    const p1 = ws.focus;
    ws = openInPane(ws, p1, "B.md");
    ws = closeTabIn(ws, p1, "B.md");
    assert.equal(paneAt(ws, p1), null, "the emptied split pane folded");
    assert.deepEqual(allPaths(ws), ["A.md"], "the closed tab did not reappear next door");
    // The LAST pane may be empty — the solo empty state is a real state.
    let solo = soloWorkspace(tabs("A.md"), "A.md");
    solo = closeTabIn(solo, solo.focus, "A.md");
    assert.equal(panesInOrder(solo).length, 1);
    assert.deepEqual(allPaths(solo), []);
  });

  it("dropTabSplit from the TREE (no source pane) splits without removing anything", () => {
    let ws = soloWorkspace(tabs("A.md"), "A.md");
    ws = dropTabSplit(ws, null, "Ihya.pdf", ws.focus, "end-inline");
    const [first, second] = panesInOrder(ws);
    assert.deepEqual(first.tabs.map((t) => t.path), ["A.md"]);
    assert.deepEqual(second.tabs.map((t) => t.path), ["Ihya.pdf"]);
    assert.equal(surfaceOf(second), "book");
  });

  it("dropTabSplit: a solo pane's only tab dropped on its own edge is a no-op", () => {
    const ws = soloWorkspace(tabs("A.md"), "A.md");
    const out = dropTabSplit(ws, ws.focus, "A.md", ws.focus, "end-inline");
    assert.deepEqual(out, ws);
  });
});

describe("workspace: the vault changes underneath", () => {
  it("a rename follows every tab, and collapses onto a tab that already exists", () => {
    let ws = soloWorkspace(tabs("Old.md", "New.md"), "Old.md");
    ws = remapWorkspace(ws, "Old.md", "New.md");
    assert.deepEqual(allPaths(ws), ["New.md"]);
    assertInvariants(ws, "after a collapsing rename");
  });

  it("a delete and a sign-out ignore pins — a pin is about intent, not contents", () => {
    let ws = soloWorkspace(tabs("A.md", "folder/B.md"), "A.md");
    ws = setPinned(ws, ws.focus, "folder/B.md", true);
    assert.deepEqual(allPaths(closePathsUnder(ws, "folder")), ["A.md"]);
    assert.deepEqual(allPaths(pruneWorkspace(ws, new Set(["A.md"]))), ["A.md"]);
  });

  it("counts holders, because two panes on one note is one document", () => {
    let ws = soloWorkspace(tabs("A.md"), "A.md");
    ws = splitPane(ws, ws.focus, "inline", null)!;
    ws = openInPane(ws, ws.focus, "A.md");
    assert.equal(holdersOf(ws, "A.md"), 2);
    assert.equal(holdersOf(ws, "B.md"), 0);
  });
});

describe("workspace: geometry", () => {
  const rect = (left: number, top: number): DOMRect =>
    ({ left, top, width: 100, height: 100 }) as DOMRect;

  it("resolves direction from the screen, so left is left in Arabic too", () => {
    const rects = { a: rect(0, 0), b: rect(200, 0), c: rect(0, 200) };
    assert.equal(paneInDirection(rects, "a", "right"), "b");
    assert.equal(paneInDirection(rects, "b", "left"), "a");
    assert.equal(paneInDirection(rects, "a", "down"), "c");
    assert.equal(paneInDirection(rects, "a", "up"), null);
  });

  it("prefers the pane straight across over a nearer diagonal one", () => {
    const rects = { a: rect(0, 0), straight: rect(300, 0), diagonal: rect(200, 400) };
    assert.equal(paneInDirection(rects, "a", "right"), "straight");
  });
});

describe("workspace: persistence", () => {
  it("round-trips through serialize/parse", () => {
    let ws = soloWorkspace(tabs("A.md", "B.md"), "B.md");
    ws = splitPane(ws, ws.focus, "inline", null)!;
    ws = openInPane(ws, ws.focus, "C.md");
    ws = setPinned(ws, ws.focus, "C.md", true);
    const back = parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(ws))));
    assert.ok(back);
    assert.deepEqual(allPaths(back).sort(), allPaths(ws).sort());
    assert.equal(back.layout.columns.length, ws.layout.columns.length);
    assertInvariants(back, "round-trip");
  });

  it("migrates vellum.tabs without losing an open note", () => {
    const ws = fromStoredTabs({ tabs: ["a.md", "b/c.md"], open: "b/c.md" });
    assert.deepEqual(allPaths(ws), ["a.md", "b/c.md"]);
    assert.equal(activeTabOf(paneAt(ws, ws.focus)!)!.path, "b/c.md");
    assertInvariants(ws, "migration");
  });

  it("recovers the reader's notes from a layout that is structurally broken", () => {
    // The layout is nonsense; the tabs are not. The rule is that a corrupt
    // layout must never cost anyone their open notes.
    const damaged = {
      v: 2,
      workspace: {
        panes: { p1: { id: "p1", tabs: [{ path: "Alive.md" }], active: 0, mode: "edit" } },
        layout: { columns: "not an array", colWeights: null, rowWeights: 7 },
        focus: "gone",
        noteFocus: null,
      },
    };
    const ws = parseWorkspace(damaged);
    assert.ok(ws, "recovered rather than discarded");
    assert.deepEqual(allPaths(ws), ["Alive.md"]);
    assertInvariants(ws, "recovery");
  });

  it("adopts the tabs of a pane the layout forgot to place", () => {
    const orphaned = {
      v: 2,
      workspace: {
        panes: {
          p1: { id: "p1", tabs: [{ path: "Placed.md" }], active: 0, mode: "edit" },
          p9: { id: "p9", tabs: [{ path: "Orphan.md" }], active: 0, mode: "edit" },
        },
        layout: { columns: [["p1"]], colWeights: [1], rowWeights: { p1: 1 } },
        focus: "p1",
        noteFocus: "p1",
      },
    };
    const ws = parseWorkspace(orphaned);
    assert.ok(ws);
    assert.deepEqual(allPaths(ws).sort(), ["Orphan.md", "Placed.md"]);
    assertInvariants(ws, "orphan adoption");
  });

  it("is TOTAL over garbage — it never throws", () => {
    const junk: unknown[] = [
      null, undefined, 0, "", [], {}, { v: 1 }, { v: 2 }, { v: 2, workspace: null },
      { v: 2, workspace: { panes: {}, layout: { columns: [] } } },
      { v: 2, workspace: { panes: { a: 1 }, layout: { columns: [["a", "a"]] } } },
    ];
    for (const raw of junk) {
      const ws = parseWorkspace(raw);
      if (ws !== null) assertInvariants(ws, `junk ${JSON.stringify(raw)}`);
    }
  });
});

describe("workspace: property tests", () => {
  it("no sequence of edits can break an invariant (4000 random walks)", () => {
    const paths = ["A.md", "B.md", "c/D.md", "Paper.tex", "Book.pdf"];
    for (let seed = 0; seed < 4000; seed++) {
      const next = rng(seed);
      let ws = emptyWorkspace();
      for (let step = 0; step < 12; step++) {
        const ids = panesInOrder(ws).map((p) => p.id);
        const id = pick(next, ids);
        const path = pick(next, paths);
        switch (Math.floor(next() * 12)) {
          case 0: ws = splitPane(ws, id, "inline", null, next() < 0.5) ?? ws; break;
          case 1: ws = splitPane(ws, id, "block", null, next() < 0.5) ?? ws; break;
          case 2: ws = closePane(ws, id); break;
          case 3: ws = openInPane(ws, id, path, { ephemeral: next() < 0.5 }); break;
          case 4: ws = closeTabIn(ws, id, path); break;
          case 5: ws = closeOthersIn(ws, id, path); break;
          case 6: ws = setPinned(ws, id, path, next() < 0.5); break;
          case 7: ws = moveTab(ws, id, path, pick(next, ids), Math.floor(next() * 4)); break;
          case 8: ws = remapWorkspace(ws, path, pick(next, paths)); break;
          case 9:
            ws = dropTabSplit(
              ws, id, path, pick(next, ids),
              pick(next, ["start-inline", "end-inline", "start-block", "end-block"] as const),
            );
            break;
          case 10: ws = closeAllIn(ws, id); break;
          default: ws = closeAllIn(ws, id); break;
        }
        assertInvariants(ws, `seed ${seed} step ${step}`);
      }
      // …and whatever that walk produced still survives a save and a reload.
      const back = parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(ws))));
      assert.ok(back, `seed ${seed}: round-trip`);
      assertInvariants(back, `seed ${seed}: after round-trip`);
      assert.deepEqual(allPaths(back).sort(), allPaths(ws).sort(), `seed ${seed}: no tab lost`);
    }
  });
});
