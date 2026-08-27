// THE GATE ON COPY THAT TRAVELS IN THE DATA.
//
// The tour's fifteen names and thirty sentences are deliberately NOT in
// client/i18n.ts (the reason is written at the top of tourCards.ts: the DICT
// is entry-chunk code and a visitor reading one article downloads all of it).
// The cost of that decision is that `npm run check-i18n` — which parses the
// DICT and nothing else — cannot see them. An empty `ar` on a card would ship
// silently and an Arabic reader would meet an English folio.
//
// So this file is to that table what `assertPreset()` is to the fifty-nine
// presets: both halves present, both halves different, the Arabic actually
// Arabic, and every `{slot}` matched across the pair. Same checks
// check-i18n.mjs runs, on the strings it cannot reach.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  TOUR_CARDS,
  TOUR_PREREQ,
  TOUR_UI,
  type TourText,
} from "../client/components/tourCards.ts";

const ARABIC = /[؀-ۿ]/;
const LATIN_RUN = /[A-Za-z]{3}/;

/** Every localized pair in the module, labelled by where it lives. */
function everyText(): { where: string; text: TourText }[] {
  const all: { where: string; text: TourText }[] = [];
  for (const card of TOUR_CARDS) {
    all.push({ where: `${card.id}.name`, text: card.name });
    all.push({ where: `${card.id}.blurb`, text: card.blurb });
    if (card.verb) all.push({ where: `${card.id}.verb`, text: card.verb });
  }
  for (const [key, text] of Object.entries(TOUR_PREREQ)) {
    all.push({ where: `prereq.${key}`, text });
  }
  for (const [key, text] of Object.entries(TOUR_UI)) {
    all.push({ where: `ui.${key}`, text });
  }
  return all;
}

test("every tour string carries both languages", () => {
  for (const { where, text } of everyText()) {
    assert.ok(text.en.trim().length > 0, `${where}: empty en`);
    assert.ok(text.ar.trim().length > 0, `${where}: empty ar`);
  }
});

test("the Arabic is Arabic, and is not the English", () => {
  for (const { where, text } of everyText()) {
    if (LATIN_RUN.test(text.en)) {
      assert.notEqual(text.ar, text.en, `${where}: ar is a copy of en (untranslated?)`);
    }
    // A pair whose English is three or more Latin letters long must have real
    // Arabic script in the other half — the same rule check-i18n applies to
    // the DICT. Strings that are only an identifier or a symbol are exempt,
    // and there are none in this table today.
    if (LATIN_RUN.test(text.ar) && !ARABIC.test(text.ar)) {
      assert.fail(`${where}: ar has Latin words and no Arabic script`);
    }
    if (LATIN_RUN.test(text.en)) {
      assert.ok(ARABIC.test(text.ar), `${where}: ar carries no Arabic script`);
    }
  }
});

test("placeholders match across the pair", () => {
  const slots = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const { where, text } of everyText()) {
    assert.deepEqual(slots(text.en), slots(text.ar), `${where}: placeholder mismatch`);
  }
});

test("card ids are unique and stable-looking", () => {
  const seen = new Set<string>();
  for (const card of TOUR_CARDS) {
    assert.ok(!seen.has(card.id), `duplicate card id: ${card.id}`);
    seen.add(card.id);
    assert.match(card.id, /^[a-z][a-z0-9-]*$/, `card id is not kebab-case: ${card.id}`);
  }
});

test("a card that declares a prerequisite has a line for it", () => {
  for (const card of TOUR_CARDS) {
    if (!card.needs) continue;
    assert.ok(card.needs in TOUR_PREREQ, `${card.id}: no line for prerequisite ${card.needs}`);
  }
});

test("a visitor is left a deck worth flipping", () => {
  // The admin folios are dropped for a read-only session — a button that
  // cannot work is furniture that lies — so what is left has to still be a
  // tour rather than two cards and a dot.
  const visitor = TOUR_CARDS.filter((card) => !card.admin);
  assert.ok(visitor.length >= 6, `a visitor sees only ${visitor.length} folios`);
});
