// PRESETS — the fifty finished designs this product ships, and the one rule
// that keeps them from becoming a maintenance liability:
//
//   A PRESET IS A DESIGN DOCUMENT THAT HAPPENS TO LIVE IN THE REPO.
//
// Not a template language, not a partial, not a set of "starter options" the
// designer interprets. The same `sections`, the same `chrome`, the same
// `article`, the same validator — so a preset that renders wrong is a design
// that renders wrong, findable with the tools that already exist, and a
// section kind added to shared/design.ts is available to every preset without
// a second vocabulary to teach it.
//
// THREE CONSEQUENCES, and each of them is why this shape beat the alternatives:
//
//  1. APPLYING A PRESET IS AN IMPORT. `presetExport()` below produces exactly
//     the `vellum.design` envelope `POST /api/design/docs/import` already
//     takes. That route validates strictly, assigns a FREE id, stamps fresh
//     createdMs/updatedMs, carries custom themes along under fresh slugs, and
//     never overwrites anything the instance already has. Every property the
//     word "fork" is supposed to buy — a new document, no shared structure, no
//     link back — falls out of a route that shipped before presets existed.
//     There is NO new server code and NO new route for presets, and that is
//     the design, not an economy.
//  2. A PRESET AND AN EXPORTED DESIGN ARE THE SAME FILE. A `.json` a stranger
//     wrote, dropped on the panel, behaves identically to a shipped preset;
//     a design the author built can be handed back as one. The gallery and the
//     import button are two doors into one mechanism.
//  3. THE FORKED DOCUMENT REMEMBERS NOTHING. There is deliberately no
//     `presetId` on `DesignDoc`, and there must not be one: a provenance field
//     is a `DOC_KEYS` change (a schema bump) bought for a breadcrumb nobody
//     can act on, and the first person to add it will be the person who then
//     writes "reapply the preset", which is the live link this whole file
//     exists to refuse. Once forked, the design is the author's, wholly.
//
// LOCALIZATION. A preset's NAME and BLURB are DATA, not chrome: they travel in
// the preset beside the sections as `{ en, ar }` pairs rather than as
// dictionary keys. Fifty presets would otherwise be a hundred dictionary
// entries that `check-i18n` can only see as dead keys, and a contributor
// adding a preset would have to edit three files to add one. The chrome AROUND
// the gallery — the family names, the buttons, the empty state — goes through
// t() like everything else.
//
// This module is PURE: no fs, no fetch, no React, no DOM. The catalog itself is
// shared/presetCatalog.ts, so the gallery can `import()` it lazily and a
// visitor never pays for fifty layouts they will never see.

import {
  DESIGN_SCHEMA,
  designExport,
  slugifyDesignName,
  stockArticle,
  stockSite,
  type DesignArticle,
  type DesignDoc,
  type DesignExport,
  type DesignSite,
  type Section,
} from "./design.ts";
import { stockChrome, type DesignChrome } from "./designChrome.ts";
import { catalogEntry } from "./fontCatalog.ts";

// ── The type ────────────────────────────────────────────────────────────────

/** Copy that travels IN the data. Both languages are required — a preset with
 *  an English name and an empty Arabic one is the failure `check-i18n`
 *  prevents in the chrome, and `assertPreset()` prevents it here. */
export interface PresetText {
  en: string;
  ar: string;
}

/**
 * What a preset is FOR — the axis the gallery groups on.
 *
 * Nine, closed, and chosen so that a blogger can find their own site in the
 * list on the first read rather than learning a taxonomy. They describe the
 * JOB, never the decoration: "editorial" is a masthead and columns whatever
 * palette it is wearing, and a preset that could plausibly be filed under two
 * belongs under the one its OWNER would have searched for.
 *
 * `signature` IS THE ONE THAT BREAKS THAT RULE, and it breaks it on purpose.
 * The other eight name a job; this one names a BAR. A signature design is one
 * composed after the engine grew mastheads, grounds, list shapes, card shapes
 * and real typefaces — held to the standard that applying it feels like moving
 * into a different house rather than adjusting the one you are in. They are
 * filed together because that is how somebody browses them ("show me the ones
 * that are actually something") and because a newspaper, a console, a journal
 * and a poster scattered across four job-shelves would each read as the odd
 * one out on theirs. It leads the vocabulary for the same reason it leads the
 * gallery: it is the first row anybody should see.
 */
export type PresetFamily =
  | "signature" // a complete house — composed to the collection's own bar
  | "editorial" // a masthead, columns, a front page that ranks things
  | "minimal" // one column, no furniture, type doing all the work
  | "journal" // dated, personal, a river of entries
  | "portfolio" // image-forward, grids, the work before the words
  | "reference" // dense, nav-heavy, built to be searched not browsed
  | "landing" // one hero, one argument, one button
  | "gallery" // banners at full width, captions second
  | "letter"; // a newsletter shape — an invitation above the fold

export const PRESET_FAMILIES: readonly PresetFamily[] = [
  "signature",
  "editorial",
  "minimal",
  "journal",
  "portfolio",
  "reference",
  "landing",
  "gallery",
  "letter",
];

/** The half of a `DesignDoc` a preset carries. Everything a document gets
 *  when it is CREATED — id, name, schema, timestamps — is stamped at fork
 *  time and is therefore not a preset's business. */
export interface PresetDesign {
  /** A BUILT-IN theme id, or null to leave the reader's theme alone.
   *
   *  Shipped presets name built-ins only. A `custom:<slug>` here is legal (an
   *  imported preset file may carry one in `themes`), but the gallery's live
   *  canvas cannot paint it: custom themes are keyed at `:root[data-custom-
   *  theme]` and the canvas is not the root. It applies on FORK, which is when
   *  it matters. */
  theme: string | null;
  site: DesignSite;
  chrome: DesignChrome;
  sections: Section[];
  article: DesignArticle;
}

export interface Preset {
  /** Stable, unique, kebab-case, and NEVER reused for a different look. It is
   *  three things at once: the gallery's React key, the seed the miniature's
   *  generated artwork is hashed from (so a preset's picture is the same
   *  picture on every machine and different from its neighbour's), and the
   *  base of the forked document's id. Renaming a preset is free; renumbering
   *  its id changes a picture somebody chose by. */
  id: string;
  name: PresetText;
  /** One line, under ~90 characters. Says what the design is FOR and who
   *  should pick it — never what it looks like, because the picture beside it
   *  is already saying that. */
  blurb: PresetText;
  family: PresetFamily;
  /** Filter tokens. Lowercase ASCII, English-only, and deliberately NOT copy:
   *  they are never rendered, they are matched. The localized name and blurb
   *  are searched beside them, so an Arabic instance still finds a preset by
   *  its Arabic name and an English one by "serif" or "wide". */
  tags: string[];
  design: PresetDesign;
  /** Custom themes this preset needs, in the shape an export carries them.
   *  Empty for every preset built on the built-ins — which is all seventy-six
   *  shipped ones. Present only so a preset file authored elsewhere arrives
   *  complete. */
  themes?: unknown[];
}

// ── Authoring helpers (what a catalog file is written with) ─────────────────

/**
 * Chrome, written as a DIFF against the stock defaults.
 *
 * Four levels deep is four `...spread`s at every call site otherwise, and
 * fifty of those is where a typo hides. It lives here rather than in one
 * catalog file because the catalog is split by FAMILY — one file per shelf of
 * the gallery — and a second copy of this helper in each of them is a second
 * place for the defaults to drift.
 */
export function presetChrome(patch: {
  typography?: Partial<DesignChrome["typography"]>;
  header?: Partial<DesignChrome["header"]>;
  footer?: Partial<DesignChrome["footer"]>;
  nav?: Partial<DesignChrome["nav"]>;
  /** Scalars, so they merge by REPLACEMENT rather than by spread — the three
   *  chrome keys that are not a group of their own. */
  surface?: DesignChrome["surface"];
  scenery?: DesignChrome["scenery"];
  ornament?: DesignChrome["ornament"];
}): DesignChrome {
  const base = stockChrome();
  return {
    nav: { ...base.nav, ...patch.nav },
    typography: { ...base.typography, ...patch.typography },
    header: { ...base.header, ...patch.header },
    footer: { ...base.footer, ...patch.footer },
    surface: patch.surface ?? base.surface,
    scenery: patch.scenery ?? base.scenery,
    ornament: patch.ornament ?? base.ornament,
  };
}

/** A preset's design, with the half nobody varies filled in. A preset that
 *  has no opinion about the article page says so by not mentioning it — and,
 *  since the article page grew a sixth switch, by not mentioning THAT rather
 *  than by restating the five it already agreed with. The article block is
 *  merged over the stock one for the same reason `presetChrome` merges: the
 *  alternative is that every new article field is a mechanical edit to fifty-
 *  nine files, and fifty-nine mechanical edits is where a typo hides. */
export function presetDesignPart(
  d: Omit<PresetDesign, "article"> & { article?: Partial<DesignArticle> },
): PresetDesign {
  const { article, ...rest } = d;
  return { ...rest, article: { ...stockArticle(), ...article } };
}

// ── Building a document out of one ──────────────────────────────────────────

/** Every preset id, prefixed, so a forked design lands next to its siblings in
 *  the store's id space and a second fork of the same preset collides
 *  predictably (the server appends `-2`) rather than by accident. */
export function presetDesignId(preset: Preset): string {
  return slugifyDesignName(`preset ${preset.id}`);
}

/**
 * A preset as a complete, valid `DesignDoc` — what the gallery's live canvas
 * renders and what the fork is built from.
 *
 * DEEP-COPIED, always. The catalog is module-level constant data that the
 * designer will happily mutate the moment an author drags a section, and a
 * shipped preset quietly rewritten in memory is a bug that only reproduces on
 * the second use.
 *
 * Anything a preset leaves out falls back to the stock defaults rather than to
 * `undefined`: a preset is allowed to be a partial statement ("this is a
 * masthead and a list, I have no opinion about the article page"), and the
 * document that comes out of it never is.
 */
export function presetDesignDoc(
  preset: Preset,
  lang: "en" | "ar",
  now = Date.now(),
): DesignDoc {
  const source = structuredClone(preset.design) as Partial<PresetDesign>;
  return {
    id: presetDesignId(preset),
    name: preset.name[lang] || preset.name.en,
    schema: DESIGN_SCHEMA,
    theme: source.theme ?? null,
    site: source.site ?? stockSite(),
    chrome: source.chrome ?? stockChrome(),
    sections: source.sections ?? [],
    article: source.article ?? stockArticle(),
    createdMs: now,
    updatedMs: now,
  };
}

/**
 * The body `POST /api/design/docs/import` takes. THIS IS THE APPLY FLOW, whole:
 *
 *     importDesignDoc(presetExport(preset, lang))
 *
 * and the panel opens the document that comes back. The server does the rest —
 * a free id, fresh stamps, strict validation, themes under fresh slugs, and
 * nothing the instance already has touched.
 */
export function presetExport(
  preset: Preset,
  lang: "en" | "ar",
  now = Date.now(),
): DesignExport {
  return designExport(
    presetDesignDoc(preset, lang, now),
    preset.themes ? structuredClone(preset.themes) : [],
  );
}

// ── Filtering (one implementation, so the count and the grid agree) ─────────

export interface PresetQuery {
  /** A family, or null for every family. */
  family: PresetFamily | null;
  /** Free text. Empty matches everything. */
  text: string;
}

/** Fold to something two languages can be compared in: lowercased, Arabic
 *  diacritics and tatweel dropped, alef forms unified. Not a search engine —
 *  it is the difference between "أثر" finding "الأثر" and not. */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u034f\u0640\u064b-\u0652]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u0649\u064a]/g, "\u064a")
    .trim();
}

/** Does this preset answer the query? Name and blurb are matched in BOTH
 *  languages, always: an operator running an Arabic instance who read about
 *  "Broadsheet" somewhere must still be able to type it. */
export function presetMatches(preset: Preset, query: PresetQuery): boolean {
  if (query.family !== null && preset.family !== query.family) return false;
  const needle = fold(query.text);
  if (needle === "") return true;
  const hay = fold(
    [
      preset.id,
      preset.family,
      preset.tags.join(" "),
      preset.name.en,
      preset.name.ar,
      preset.blurb.en,
      preset.blurb.ar,
    ].join(" "),
  );
  return needle.split(/\s+/).every((word) => hay.includes(word));
}

export function filterPresets(presets: readonly Preset[], query: PresetQuery): Preset[] {
  return presets.filter((preset) => presetMatches(preset, query));
}

/** How many presets each family holds, for the filter chips. Counted over the
 *  TEXT-filtered set, so a chip reading "0" while the grid shows matches is not
 *  a state this can reach. */
export function familyCounts(presets: readonly Preset[]): Map<PresetFamily, number> {
  const counts = new Map<PresetFamily, number>();
  for (const family of PRESET_FAMILIES) counts.set(family, 0);
  for (const preset of presets) {
    counts.set(preset.family, (counts.get(preset.family) ?? 0) + 1);
  }
  return counts;
}

// ── The catalog's own gate ──────────────────────────────────────────────────

/**
 * What a shipped preset must satisfy, checked at module load in development
 * and by `scripts/check-presets.mjs` in CI.
 *
 * A preset is DATA IN THE REPO, which means it has no author present when it
 * breaks and no user to report it: sixty of them will accumulate a duplicate
 * id, an empty Arabic name and a section pointing at a note no fresh install
 * has, and every one of those is silent. So the catalog asserts what a
 * validator cannot: that the copy is bilingual, the ids are unique, and — the
 * one that matters most — that no preset names a NOTE.
 *
 * THE NO-NOTE RULE. A `note` section and a `note`/`page` nav item address the
 * OWNER'S VAULT by path. A shipped preset cannot know a path, so a preset
 * carrying one ships a design that is broken on every install but the machine
 * it was written on — a failure that renders as the stock blog for visitors
 * and a named card for the owner, which is the boundary working exactly as
 * designed and a terrible first five minutes. Presets compose from the seven
 * kinds that need nothing but the vault's own posts.
 */
export const PRESET_FORBIDDEN_KINDS = ["note"] as const;

export function assertPreset(preset: Preset, seen: Set<string>): void {
  const at = `preset "${preset.id}"`;
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(preset.id)) throw new Error(`${at}: id is not a slug`);
  if (seen.has(preset.id)) throw new Error(`${at}: duplicate id`);
  seen.add(preset.id);
  for (const [field, text] of [
    ["name", preset.name],
    ["blurb", preset.blurb],
  ] as const) {
    if (!text?.en?.trim()) throw new Error(`${at}: ${field}.en is empty`);
    if (!text?.ar?.trim()) throw new Error(`${at}: ${field}.ar is empty`);
    if (!/[\u0600-\u06ff]/.test(text.ar)) throw new Error(`${at}: ${field}.ar is not Arabic`);
  }
  if (!PRESET_FAMILIES.includes(preset.family)) throw new Error(`${at}: unknown family`);
  for (const section of preset.design.sections ?? []) {
    if ((PRESET_FORBIDDEN_KINDS as readonly string[]).includes(section.kind)) {
      throw new Error(`${at}: a preset may not carry a "${section.kind}" section — it would name a note no fresh install has`);
    }
  }
  const walk = (items: DesignChrome["nav"]["items"]): void => {
    for (const item of items) {
      if (item.kind === "note" || item.kind === "page") {
        throw new Error(`${at}: a nav item may not point at a note in a preset`);
      }
      if (item.children) walk(item.children);
    }
  };
  walk(preset.design.chrome?.nav?.items ?? []);
  // A FACE THIS BUILD DOES NOT HAVE IS THE SAME BUG AS A NOTE PATH IT DOES NOT
  // HAVE, one level quieter. `normalizeChrome` drops an unknown id rather than
  // throwing (reads never fail), so a preset written with a typo for a family
  // name would ship, apply, and render in the instance's default type while
  // its blurb promised a typeface — the silent-correction failure a catalog of
  // sixty hand-written records is most likely to accumulate. And an uploaded
  // `custom:` id is refused by the same check for a stronger reason: it names
  // a file on the author's machine and nothing at all on the reader's.
  const typo = preset.design.chrome?.typography;
  for (const key of ["headingFont", "bodyFont", "monoFont"] as const) {
    const id = typo?.[key];
    if (id === undefined) continue;
    if (typeof id !== "string" || catalogEntry(id) === null) {
      throw new Error(`${at}: typography.${key} = ${JSON.stringify(id)} is not a catalog font id`);
    }
  }
}

/** Run the gate over a whole catalog. Throws on the first offender, naming it. */
export function assertCatalog(presets: readonly Preset[]): void {
  const seen = new Set<string>();
  for (const preset of presets) assertPreset(preset, seen);
}
