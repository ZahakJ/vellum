import assert from "node:assert/strict";
import { it } from "node:test";
import { publicNavigation } from "../client/design/publicNavigation.ts";
import { stockChrome } from "../shared/designChrome.ts";
import type { PublicFolderCard } from "../shared/types.ts";

const folders: PublicFolderCard[] = [
  { id: "photos", slug: "photos", title: "الصور", icon: "camera", count: 3 },
  { id: "empty", slug: "empty", title: "Empty", icon: "camera", count: 0 },
];
it("collection navigation respects opt-out and keeps empty collections off the menu", () => {
  const nav = stockChrome().nav;
  assert.equal(publicNavigation(nav, ["essays"], folders, false), nav.items);
  const items = publicNavigation(nav, ["essays"], folders, true);
  assert.equal(items[0].kind, "topic");
  assert.equal(items[0].target, "essays");
  assert.equal(items[0].label, "essays");
  assert.equal(items[0].label, "essays");
  assert.equal(items[1].target, "/folder/photos");
  assert.equal(items[1].label, "الصور");
  assert.equal(items.length, 2);
  assert.deepEqual(nav.items, [], "generated links must never mutate the saved design");
});
it("preserves authored menus and avoids duplicating a collection in a submenu", () => {
  const nav = stockChrome().nav;
  nav.items = [{ id: "group", kind: "group", label: "Explore", children: [
    { id: "photos", kind: "url", label: "My photographs", target: "/folder/photos" },
  ] }];
  const items = publicNavigation(nav, ["essays"], folders, true);
  assert.deepEqual(items, nav.items);
});
