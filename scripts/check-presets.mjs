// THE CATALOG GATE — the script `shared/presets.ts` already names.
//
// `assertCatalog(PRESETS)` runs at the bottom of `presetCatalog.ts`, which
// means it runs when the MODULE LOADS — and the module is a dynamic import()
// fetched the first time an admin opens the designer. So a duplicate id or an
// un-Arabic blurb did not fail a build; it threw inside the gallery's chunk, in
// front of the one person who was about to browse fifty designs. A catalog is
// data in the repo: it has no author present when it breaks and no user who can
// report it usefully. It needs a gate that runs with the other gates.
//
// This is that gate, and it checks three tiers:
//
//   1. WHAT assertCatalog ALREADY KNOWS — unique slug ids, bilingual name and
//      blurb, a real Arabic blurb, a known family, no section or nav item that
//      names a note. Imported, never re-implemented: a second copy of the rule
//      is how the gate and the product come to disagree.
//   2. WHAT ONLY A GATE CAN SEE — the invariants that are true of the CATALOG
//      rather than of any one preset, and the ones a silent normalizer would
//      otherwise swallow:
//        · every family in the closed vocabulary has at least one preset, so
//          the gallery never draws a chip that is disabled on every instance
//          (the `landing` bug: a filter nothing can ever switch on);
//        · every typography number survives `normChrome()` UNCHANGED. The
//          normalizer SNAPS out-of-range values to the nearest legal step
//          instead of throwing, so a preset written with `scale: 1.5` (the cap
//          is 1.414) renders as something its author never chose and nothing
//          says a word. Silent correction is the failure mode a catalog of
//          sixty hand-written records is most likely to accumulate;
//        · every named theme is one of the built-ins — a preset naming a theme
//          this build does not have paints as the reader's own and the shape
//          argument is lost;
//        · the site width is inside MIN_WIDTH…MAX_WIDTH, same reason.
//   3. RULE 1, MECHANICALLY — a preset is PURE FORM. Every copy field it could
//      set is empty, because `Section.heading` is a plain string with nowhere
//      to put a second language: one typed word ships English into an Arabic
//      instance and a stranger's voice into everybody's. This is the rule most
//      likely to be broken by somebody being helpful.
//
// It also PRINTS the shelf, because the second half of a catalog's health is
// editorial and a person has to read it: a shape+width collision is not an
// error (two designs may legitimately share a skeleton and differ in palette,
// columns and type) but it is the thing worth a human glance, so it is reported
// as a note rather than a failure.
//
//   node scripts/check-presets.mjs
//
// No server, no browser — it is a pure data gate and runs in milliseconds.

import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { PRESETS } = await load("shared/presetCatalog.ts");
const { assertCatalog, PRESET_FAMILIES, presetDesignDoc, presetExport } = await load(
  "shared/presets.ts",
);
const { normalizeChrome, TYPO_BOUNDS } = await load("shared/designChrome.ts");
const { MIN_WIDTH, MAX_WIDTH, validateDesign } = await load("shared/design.ts");
const { THEMES, isTheme } = await load("shared/themes.ts");
const { catalogEntry, FONT_CATALOG } = await load("shared/fontCatalog.ts");

let failures = 0;
const fail = (label, detail = "") => {
  console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  failures++;
};
const pass = (label, detail = "") =>
  console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`);

console.log(`check-presets: ${PRESETS.length} designs\n`);

// ── 1. the rules the product already enforces ───────────────────────────────

try {
  assertCatalog(PRESETS);
  pass("assertCatalog: ids, bilingual copy, families, no note is named");
} catch (err) {
  fail("assertCatalog", err.message);
}

// ── 2. the invariants only a gate sees ──────────────────────────────────────

// Every family is served. A chip nothing can ever match is a dead word in a
// closed vocabulary.
const counts = new Map(PRESET_FAMILIES.map((f) => [f, 0]));
for (const p of PRESETS) counts.set(p.family, (counts.get(p.family) ?? 0) + 1);
const empty = [...counts].filter(([, n]) => n === 0).map(([f]) => f);
if (empty.length) {
  fail(
    "every family has at least one preset",
    `${empty.join(", ")} would draw a chip disabled on every instance`,
  );
} else {
  pass(
    "every family has at least one preset",
    [...counts].map(([f, n]) => `${f} ${n}`).join(" · "),
  );
}

// Nothing is CLAMPED. The normalizer corrects rather than throws, so a value
// outside its bounds renders as something nobody chose and nothing says a word.
// Rounding a value onto the control's own step is not that (17.5 and 1.33 are
// what an author means, and the slider has a grid), so the bar is HALF A STEP:
// inside it the author got what they wrote, outside it the engine overruled
// them — `scale: 1.5` arriving as 1.414 is a different design.
const clamped = [];
for (const preset of PRESETS) {
  const before = preset.design.chrome;
  const after = normalizeChrome(structuredClone(before));
  for (const [key, want] of Object.entries(before.typography)) {
    const got = after.typography[key];
    const step = TYPO_BOUNDS[key]?.step ?? 0;
    if (Math.abs(got - want) > step / 2 + 1e-9) {
      clamped.push(`${preset.id}.typography.${key}: ${want} → ${got}`);
    }
  }
  for (const group of ["header", "footer", "nav"]) {
    for (const [key, want] of Object.entries(before[group] ?? {})) {
      if (Array.isArray(want) || (want && typeof want === "object")) continue;
      if (after[group]?.[key] !== want) {
        clamped.push(`${preset.id}.${group}.${key}: ${want} → ${after[group]?.[key]}`);
      }
    }
  }
  // …AND THE SCALARS THAT ARE NOT IN A GROUP. `chrome.surface` is one key at
  // the top of the chrome rather than a field inside `header`/`footer`/`nav`,
  // so the three-group loop above walked straight past it: a preset written
  // with `surface: "linen"` would normalize to `flat`, apply cleanly, and ship
  // a plain page under a blurb that promised a textured one — the exact silent
  // correction this whole check exists to catch, one nesting level up.
  for (const [key, want] of Object.entries(before)) {
    if (want && typeof want === "object") continue;
    if (after[key] !== want) clamped.push(`${preset.id}.${key}: ${want} → ${after[key]}`);
  }
}
if (clamped.length) {
  fail("no preset value is overruled by the normalizer", `${clamped.length}`);
  for (const line of clamped.slice(0, 12)) console.log(`          ${line}`);
} else {
  pass("no preset value is overruled by the normalizer");
}

// Widths are inside the engine's own bounds.
const badWidth = PRESETS.filter(
  (p) => p.design.site.width < MIN_WIDTH || p.design.site.width > MAX_WIDTH,
).map((p) => `${p.id} ${p.design.site.width}`);
if (badWidth.length) fail(`site.width inside ${MIN_WIDTH}–${MAX_WIDTH}`, badWidth.join(", "));
else pass(`site.width inside ${MIN_WIDTH}–${MAX_WIDTH}`);

// Every named theme exists in this build. A preset naming a theme that is gone
// paints as the reader's own and the design's whole argument is lost.
const badTheme = PRESETS.filter((p) => p.design.theme && !isTheme(p.design.theme)).map(
  (p) => `${p.id} → ${p.design.theme}`,
);
if (badTheme.length) fail("every preset names a theme this build has", badTheme.join(", "));
else pass(`every preset names one of the ${THEMES.length} built-in themes`);

// EVERY FACE A PRESET NAMES IS ONE THIS BUILD CAN SERVE.
//
// A design may now name real typefaces, and this is the one place the catalog
// and the shelf can disagree without anybody noticing. `normalizeChrome` DROPS
// an unknown id instead of throwing — reads never fail — so a preset written
// with `headingFont: "eb-garamon"` applies cleanly, renders in the instance's
// default serif, and sells a typeface it never sets. The blurb promised a
// letterpress salon; the reader got the stock page with different margins.
//
// The same line catches a `custom:` id, which is a subtler mistake: it names a
// face that exists on the author's machine and on nobody else's, so the preset
// would look right in exactly one place — the place it was written.
//
// `assertCatalog` enforces this too (shared/presets.ts). It is repeated as its
// own line here because a gate that only says "assertCatalog passed" tells a
// reader nothing about which rules ran, and this is the rule most likely to be
// broken by somebody adding a template in a hurry.
const badFace = [];
for (const preset of PRESETS) {
  const typo = preset.design.chrome?.typography ?? {};
  for (const key of ["headingFont", "bodyFont", "monoFont"]) {
    const id = typo[key];
    if (id === undefined) continue;
    if (typeof id !== "string" || catalogEntry(id) === null) {
      badFace.push(`${preset.id}.${key} → ${JSON.stringify(id)}`);
      continue;
    }
    // …and it must survive the normalizer unchanged, for the reason the
    // numbers above must: a silently dropped face is a silently different
    // design.
    const after = normalizeChrome(structuredClone(preset.design.chrome));
    if (after.typography[key] !== id) badFace.push(`${preset.id}.${key}: ${id} → ${after.typography[key]}`);
  }
}
const facesUsed = new Set(
  PRESETS.flatMap((p) =>
    ["headingFont", "bodyFont", "monoFont"]
      .map((k) => p.design.chrome?.typography?.[k])
      .filter(Boolean),
  ),
);
if (badFace.length) {
  fail("every font a preset names is in FONT_CATALOG", badFace.join(", "));
} else {
  pass(
    `every font a preset names is one of the ${Object.keys(FONT_CATALOG).length} catalog families`,
    facesUsed.size === 0 ? "no preset names a face yet" : `${facesUsed.size} face(s) in use`,
  );
}

// The apply flow is an IMPORT: every preset must survive the exact validator
// the route runs, or its first click is an error toast.
const rejected = [];
for (const preset of PRESETS) {
  try {
    validateDesign(structuredClone(presetDesignDoc(preset, "en")));
    const env = presetExport(preset, "en");
    if (env.kind !== "vellum.design") rejected.push(`${preset.id}: envelope kind ${env.kind}`);
  } catch (err) {
    rejected.push(`${preset.id}: ${err.message}`);
  }
}
if (rejected.length) {
  fail("every preset survives the import validator", `${rejected.length}`);
  for (const line of rejected.slice(0, 8)) console.log(`          ${line}`);
} else {
  pass("every preset survives the import validator (the apply flow, exactly)");
}

// ── 3. a preset is PURE FORM ────────────────────────────────────────────────

const COPY_FIELDS = {
  hero: ["heading", "sub"],
  richText: ["markdown"],
  postGrid: ["heading"],
  postList: ["heading"],
  topics: ["heading"],
  cta: ["heading", "body", "label"],
};
const typed = [];
for (const preset of PRESETS) {
  for (const section of preset.design.sections) {
    for (const field of COPY_FIELDS[section.kind] ?? []) {
      if ((section[field] ?? "") !== "") {
        typed.push(`${preset.id}.${section.id}.${field} = ${JSON.stringify(section[field])}`);
      }
    }
  }
  if ((preset.design.chrome.footer?.copyright ?? "") !== "") {
    typed.push(`${preset.id}.footer.copyright`);
  }
  for (const item of preset.design.chrome.nav?.items ?? []) {
    if ((item.label ?? "") !== "") typed.push(`${preset.id}.nav "${item.label}"`);
  }
}
if (typed.length) {
  fail("a preset is pure form — no copy is typed into one", `${typed.length}`);
  for (const line of typed.slice(0, 10)) console.log(`          ${line}`);
} else {
  pass("a preset is pure form — every word on the page stays the owner's");
}

// A POST SECTION HAS NO OFFSET — `pick()` is `slice(0, limit)` from the top of
// the same feed, every time. So two post sections always OVERLAP, and the only
// question is whether the overlap reads as an archive or as a stutter.
//
// The catalog's own rule is "a FEATURE over a LONG INDEX", and the sentence
// after it says what that is for: "two grids of similar size stacked is the
// arrangement that reads as a bug". That is the line this checks, because it is
// the one a reader can see. An index must add at least as many posts as it
// repeats — index ≥ 2 × feature — so the second section is visibly a longer
// list that happens to begin with the piece above it, rather than the same run
// again with one row on the end.
//
// Measured against a real vault before this was written: `commissions` printed
// nine projects and then an "archive" of ten (one new post), `herbarium` stacked
// two grids of 9 and 8, and `showreel` carried THREE post sections, so its lead
// frame appeared three times on one page. A third post section cannot satisfy
// the rule at all — the third always repeats one of the first two — so it is
// refused outright.
const doubled = [];
for (const preset of PRESETS) {
  const posts = preset.design.sections.filter(
    (s) => s.kind === "postGrid" || s.kind === "postList",
  );
  if (posts.length < 2) continue;
  if (posts.length > 2) {
    doubled.push(`${preset.id}: ${posts.length} post sections — the third always repeats`);
    continue;
  }
  const feature = Math.min(posts[0].limit, posts[1].limit);
  const index = Math.max(posts[0].limit, posts[1].limit);
  if (index < 2 * feature) {
    doubled.push(
      `${preset.id}: feature ${feature} over index ${index} — the index adds only ${index - feature}`,
    );
  }
}
if (doubled.length) {
  fail("no preset stutters (index ≥ 2 × feature)", `${doubled.length}`);
  for (const line of doubled.slice(0, 10)) console.log(`          ${line}`);
} else {
  pass("no preset prints the same run twice (index ≥ 2 × feature)");
}

// ── the editorial note (never a failure) ────────────────────────────────────

// WHAT A 200px CARD CAN ACTUALLY RESOLVE, and nothing finer. The key used to
// be the section kinds plus the EXACT pixel width, which meant `casebook`
// (1160) and `vitrine` (1120) — visually the same card — slipped through on a
// 40px difference nobody can see. It printed one collision where a reader
// measured six. So the width is BUCKETED into the three bands a silhouette
// has (narrow reading column, mid, wide magazine), the grid's column count is
// folded in (a 2-across and a 4-across grid are two different pictures), and
// so is whether the pictures are there at all — a grid with banners and one
// without are not the same shelf even when the blocks line up.
//
// It stays a NOTE and never a failure: two designs may legitimately share a
// skeleton and differ in palette, columns and type, and that is a judgement
// for a person rather than a threshold.
//
// THE ARRANGEMENT FIELDS BELONG IN THE KEY, and leaving them out would have
// been the same mistake the exact pixel width was. A ledger list and a
// dateline list are not the same block; an overlay grid and a boxed one are
// not the same shelf; a band hero and a split hero are not the same opening.
// A key that cannot see them reports two designs as twins on the strength of
// the word "postList" appearing in both, which makes the note noise rather
// than a reading. Each field is folded in with its DEFAULT written out, so a
// preset authored before the field existed keys identically to one that names
// the default explicitly — the collision report must not move because a shelf
// file grew a line that changes nothing.
const widthBand = (px) => (px <= 780 ? "narrow" : px <= 1080 ? "mid" : "wide");
const silhouette = (section) => {
  if (section.kind === "postGrid") {
    const card = section.card ?? "boxed";
    return `postGrid${section.columns}:${card}${section.showBanner ? "+art" : ""}`;
  }
  if (section.kind === "postList") return `postList:${section.layout ?? "river"}`;
  if (section.kind === "hero") return `hero:${section.height}:${section.treatment ?? "panel"}`;
  // A DIVIDER'S STYLE IS DELIBERATELY NOT IN THE KEY, and it is the one new
  // enum left out. Folding it in was tried and measured: the report fell from
  // seven collisions to three, because four of the pairs a READER had already
  // called twins (`daybook`/`preprint`, `commissions`/`lyceum`,
  // `compendium`/`thicket`, `overture`/`envelope`) differ in nothing but a
  // hairline versus a gap. A key that hides four of the six twins a person
  // measured is not a finer key, it is a quieter one — and this note exists to
  // be read by that person. The rule the key is held to is what a 200px card
  // can RESOLVE, and a divider is the least of what it resolves.
  return section.kind;
};
// THE CHROME IS PART OF THE SILHOUETTE TOO, and leaving it out would have been
// the same mistake as leaving out a list's layout. Two designs with an identical
// run of sections are not twins when one wears a ruled newspaper plate on graph
// paper and ends in its own name at display size and the other wears a centred
// wordmark on a plain ground and ends in a meta line. Those three — the
// masthead's SHAPE, the page's GROUND, and the shape of the END of the page —
// are exactly the chrome a 200px card resolves, which is the bar this key is
// held to; `DesignThumb` draws all three and nothing else from the chrome.
//
// `nav.style` is deliberately out, for the reason `divider.style` is out. Pills,
// an accent rail and a pair of brackets on a 7px bar are the same 7px bar: the
// key would gain a term the reader cannot see, which makes the note quieter
// rather than finer — and this note exists to be read by that reader.
//
// Each field carries its DEFAULT written out, so a preset authored before the
// field existed keys identically to one that names the default explicitly and
// the collision report does not move because a shelf file grew a line that
// changes nothing.
const chromeShape = (chrome) =>
  [
    chrome?.header?.layout ?? "stacked",
    chrome?.surface ?? "flat",
    chrome?.footer?.form ?? "columns",
  ].join(":");
const shapes = new Map();
for (const p of PRESETS) {
  const key =
    `${p.design.sections.map(silhouette).join(">")}` +
    `|${widthBand(p.design.site.width)}|${chromeShape(p.design.chrome)}`;
  shapes.set(key, [...(shapes.get(key) ?? []), p.id]);
}
const twins = [...shapes.values()].filter((v) => v.length > 1);
console.log(
  `\n  note  ${PRESETS.length} designs · ${new Set(PRESETS.map((p) => p.design.theme)).size} themes · ` +
    `${twins.length} shape+width collision(s)${twins.length ? `: ${twins.map((v) => v.join("/")).join(", ")}` : ""}`,
);
console.log(`  note  ${[...counts].map(([f, n]) => `${f} ${n}`).join(" · ")}`);

console.log(`\ncheck-presets: ${failures === 0 ? "PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
