// The design store: VELLUM_DATA/designs.json.
//
// WHY A SECOND FILE, AND NOT MORE KEYS IN settings.json. The question was
// asked and the answer is not "tidiness":
//
//  1. settings.json is read on the hot path. `getSettings()` is consulted by
//     site.ts on essentially every request (site name, language, layout,
//     locale, excluded tags), and it is mtime-cached as one parsed object. A
//     design document is one to two orders of magnitude larger than the whole
//     of settings.json, and a dozen custom themes larger again — carrying that
//     through the same cache means every `siteName()` call holds a homepage
//     layout in memory behind it.
//  2. `patchSettings()` rewrites the ENTIRE raw object on every save, by
//     design (it preserves unknown keys verbatim). Nesting designs inside it
//     means a one-character change to the site tagline rewrites every design
//     on disk — and any crash, quota error or interrupted rename during that
//     write puts them both at risk together. Two files fail independently.
//  3. Corruption has to be survivable INDEPENDENTLY. CONTRACTS already
//     promises that a corrupt settings.json degrades to "env defaults in
//     effect"; the requirement here is that a corrupt DESIGN file degrades to
//     the stock blog. If they are one file, a stray byte in a section's
//     markdown takes the site name, the language and the publish
//     configuration down with the layout — the exact opposite of a pristine
//     always-working base.
//  4. Versioning and migration are file-level concerns. `settings.json` has
//     no schema version and does not need one (its keys are flat and
//     independently validated); a design is a document tree, it WILL change
//     shape, and it needs a version, a migration table and a quarantine state
//     that a flat settings file would have to grow just for this.
//  5. Export/import is a whole-file operation on a design and a nonsense one
//     on settings (which holds a git remote and a favicon path).
//
// What stays in settings.json is the one thing that IS a setting:
// `publicLayout: "designed"`. Which design is active lives here, beside the
// designs, so a lost or renamed design cannot leave settings.json naming
// something that is not there.
//
// The file is 0600, written write-then-rename, and read through an
// mtime-checked cache — the same three properties settings.ts documents next
// door, for the same reasons.

import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DESIGN_SCHEMA,
  DesignError,
  MAX_DESIGNS,
  QuarantineError,
  designExport,
  readDesignExport,
  slugifyDesignName,
  stockDesign,
  validateDesign,
  type DesignDoc,
  type DesignExport,
  type DesignSummary,
} from "../shared/design.ts";
import {
  MAX_CUSTOM_THEMES,
  ThemeError,
  customThemesCss,
  customThemesSignature,
  isThemeChoice,
  slugifyThemeName,
  validateCustomTheme,
  type CustomTheme,
} from "../shared/customTheme.ts";
// THE SECOND `DesignError`, imported UNDER ITS OWN NAME.
//
// There are two rejection classes in shared/, and they are not the same class:
// `shared/design.ts` throws for the document tree (sections, site, article),
// `shared/designChrome.ts` throws for the chrome (nav, typography, header,
// footer) and carries a stable `code` alongside the path. `validateDesign()`
// calls `validateChrome()`, so BOTH escape from a single write — and a `bad()`
// that only knew the first turned every chrome rejection into a rethrow past
// the 400 and out of the generic handler as a 500 with no message. One file
// then rejected two different ways depending on which half was malformed,
// which is the opposite of what CONTRACTS promises ("a hand-edited nav item
// pointing at `javascript:` is refused here exactly as a malformed section
// is"). Same import, same fix, for the quarantine reason a step below: a bad
// nav item now lists as its own sentence instead of as "unreadable design (…)".
import { DesignError as ChromeError } from "../shared/designChrome.ts";
import { isTheme } from "../shared/themes.ts";
import { dataDir } from "./site.ts";
import { VaultError } from "./vault.ts";

const DESIGNS_FILE = "designs.json";

/** What sits on disk. `designs` and `themes` are stored as RAW rows: a
 *  document this build cannot understand is kept byte-for-byte and marked
 *  inert, never dropped and never half-repaired. */
interface DesignFileShape {
  activeId: string | null;
  designs: unknown[];
  themes: unknown[];
  /** Keys this build does not own, written back verbatim. */
  [key: string]: unknown;
}

/** A row after the store has looked at it: either a document, or the reason
 *  it is inert. Both carry the raw bytes, because a write has to put back
 *  what it did not touch. */
interface DesignRow {
  raw: unknown;
  doc: DesignDoc | null;
  /** Present iff `doc` is null: the sentence the admin panel prints. */
  quarantine?: string;
  /** Best-effort identity for a quarantined row, so it can still be named,
   *  listed and deleted. */
  id: string;
  name: string;
  schema: number;
}

interface StoreState {
  rows: DesignRow[];
  themes: CustomTheme[];
  activeId: string | null;
  /** Everything in the file this build does not own, kept verbatim so a write
   *  by an older build cannot delete a newer one's key — the same courtesy
   *  settings.ts extends to unknown settings, and the same reason: this file
   *  is shared with future versions of ourselves. */
  extra: Record<string, unknown>;
  /** The file exists and could NOT be parsed. Distinct from "no designs yet":
   *  an empty store is a new instance, a corrupt store is an accident, and an
   *  admin who is told the wrong one of those goes looking in the wrong place.
   *  Never fatal — a corrupt designs.json is survivable exactly as a corrupt
   *  settings.json is, which is why read() returns a store rather than throws. */
  corrupt: boolean;
}

let cache: (StoreState & { mtimeMs: number }) | null = null;

function designsPath(): string {
  return path.join(dataDir(), DESIGNS_FILE);
}

/** A theme choice this instance actually has: one of the fifteen, or a custom
 *  theme that is currently on disk. Passed into `validateDesign` so a design
 *  naming a deleted custom theme is a NAMED error rather than a silent
 *  fallback to the built-in default. */
function themeChoiceGuard(themes: CustomTheme[]): (value: string) => boolean {
  const slugs = new Set(themes.map((theme) => theme.id));
  return (value) => {
    if (isTheme(value)) return true;
    if (!isThemeChoice(value)) return false;
    return slugs.has(value.slice("custom:".length));
  };
}

/** Look at one stored row. Never throws: a bad row becomes a quarantined row
 *  with a sentence, because the alternative is one malformed design taking
 *  the panel — and the site — down with it. */
function readRow(raw: unknown, guard: (value: string) => boolean): DesignRow {
  const asRecord = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const fallbackName = typeof asRecord.name === "string" ? asRecord.name : "";
  const fallbackId =
    typeof asRecord.id === "string" && asRecord.id !== ""
      ? asRecord.id
      : slugifyDesignName(fallbackName);
  const schema =
    typeof asRecord.schema === "number" && Number.isFinite(asRecord.schema)
      ? Math.floor(asRecord.schema)
      : 0;
  try {
    const doc = validateDesign(raw, { isThemeChoice: guard });
    return { raw, doc, id: doc.id, name: doc.name, schema: doc.schema };
  } catch (err) {
    const quarantine =
      err instanceof QuarantineError || err instanceof DesignError
        ? err.message
        : `unreadable design (${err instanceof Error ? err.message : String(err)})`;
    return {
      raw,
      doc: null,
      quarantine,
      id: fallbackId,
      name: fallbackName || fallbackId,
      schema,
    };
  }
}

/** Parse the file. A corrupt or missing file is an EMPTY store, warned about
 *  once per mtime — exactly what settings.ts does one directory up, and the
 *  reason `publicLayout: "designed"` degrades to the stock blog rather than to
 *  a stack trace. */
function read(): StoreState {
  const file = designsPath();
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    cache = { rows: [], themes: [], activeId: null, extra: {}, corrupt: false, mtimeMs };
    return cache;
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache;

  let parsed: unknown = null;
  let corrupt = false;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    corrupt = true;
    console.warn(
      "vellum: designs.json unreadable — ignoring it (the stock blog is in effect):",
      err,
    );
  }
  const raw =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  if (parsed !== null && raw !== parsed) {
    corrupt = true;
    console.warn("vellum: designs.json is not a JSON object — ignoring it (stock blog in effect)");
  }

  // Themes first: a design may name one, and the guard needs the list.
  const themes: CustomTheme[] = [];
  if (Array.isArray(raw.themes)) {
    const seen = new Set<string>();
    for (const entry of raw.themes) {
      try {
        const theme = validateCustomTheme(entry);
        if (seen.has(theme.id)) continue;
        seen.add(theme.id);
        themes.push(theme);
      } catch (err) {
        // A malformed theme drops on READ (never throws) exactly as a
        // malformed settings value does: the rest of the file still works,
        // and the write path is where a bad theme is refused with a message.
        console.warn(`vellum: dropping a malformed custom theme from designs.json: ${
          err instanceof Error ? err.message : String(err)
        }`);
      }
    }
  }

  const guard = themeChoiceGuard(themes);
  // NOT truncated to MAX_DESIGNS here. The cap is a rule about CREATING one;
  // enforcing it on the read path would mean a hand-written file holding
  // thirty designs quietly lost six of them on the next save, which is the
  // one thing a store may never do to a document it did not write.
  const rows: DesignRow[] = Array.isArray(raw.designs)
    ? raw.designs.map((entry) => readRow(entry, guard))
    : [];

  const activeId = typeof raw.activeId === "string" && raw.activeId !== "" ? raw.activeId : null;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "schema" && key !== "activeId" && key !== "designs" && key !== "themes") {
      extra[key] = value;
    }
  }
  cache = { rows, themes, activeId, extra, corrupt, mtimeMs };
  return cache;
}

function persist(state: StoreState): void {
  const file = designsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const shape: DesignFileShape & { schema: number } = {
    ...state.extra,
    // The FILE's version, beside each document's own. They are the same number
    // today and will not always be: a document travels (export/import) and a
    // file does not.
    schema: DESIGN_SCHEMA,
    activeId: state.activeId,
    // A quarantined row is written back exactly as it was read. Rewriting it
    // in this build's shape would be the silent misunderstanding quarantine
    // exists to prevent.
    designs: state.rows.map((row) => row.doc ?? row.raw),
    themes: state.themes,
  };
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(shape, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  cache = null; // the rename just changed mtime; next read restats
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function customThemes(): CustomTheme[] {
  return read().themes;
}

export function customThemesStylesheet(): string {
  return customThemesCss(read().themes);
}

/** The `?v=` on the custom-theme stylesheet link, or "" when there are none.
 *  Same contract as `fontsSignature()`: presence makes the client link the
 *  sheet at all, and the value makes a changed theme a changed URL. */
export function customThemesSig(): string {
  return customThemesSignature(read().themes);
}

/** Every design, renderable or not, for the admin list. */
export function designSummaries(): DesignSummary[] {
  return read().rows.map((row) => ({
    id: row.id,
    name: row.name,
    schema: row.schema,
    sections: row.doc?.sections.length ?? 0,
    updatedMs: row.doc?.updatedMs ?? 0,
    ...(row.quarantine ? { quarantine: row.quarantine } : {}),
  }));
}

export function activeDesignId(): string | null {
  return read().activeId;
}

/** One design by id, or null. Quarantined rows answer null — they exist, they
 *  are listed, and they are never rendered. */
export function getDesign(id: string): DesignDoc | null {
  return read().rows.find((row) => row.id === id)?.doc ?? null;
}

export function designRow(id: string): DesignRow | null {
  return read().rows.find((row) => row.id === id) ?? null;
}

/** Why the designed site cannot be served right now, or null when it can. The
 *  sentence is what an ADMIN is shown; a visitor is only ever shown the stock
 *  blog, which is the point. */
export interface DesignNotice {
  reason: "no-design" | "quarantined" | "empty" | "corrupt";
  /** The design's name when there is one to name. */
  design?: string;
  /** The store's own words (a migration refusal, a validation path). */
  detail?: string;
}

/** The design "designed" mode would render, plus why it cannot when it
 *  cannot. Never throws. */
export function activeDesign(): { design: DesignDoc | null; notice: DesignNotice | null } {
  const state = read();
  // "Your file could not be read" and "you have not made one yet" are two
  // different sentences and two different next actions. Saying the second when
  // the first is true sends an admin to build a design over the top of one
  // they still have — so the corrupt case is named before the empty one.
  if (state.corrupt) return { design: null, notice: { reason: "corrupt" } };
  if (state.rows.length === 0) return { design: null, notice: { reason: "no-design" } };
  const row =
    (state.activeId ? state.rows.find((r) => r.id === state.activeId) : undefined) ?? state.rows[0];
  if (!row) return { design: null, notice: { reason: "no-design" } };
  if (!row.doc) {
    return {
      design: null,
      notice: { reason: "quarantined", design: row.name, detail: row.quarantine },
    };
  }
  return { design: row.doc, notice: null };
}

// ── Writes ──────────────────────────────────────────────────────────────────

function fresh(): StoreState {
  const state = read();
  return {
    rows: [...state.rows],
    themes: [...state.themes],
    activeId: state.activeId,
    extra: state.extra,
    corrupt: state.corrupt,
  };
}

/** A slug free of collisions inside `taken`. */
function freeSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new VaultError(400, "Could not find a free id — rename some designs first");
}

/** Every rejection a validator is ALLOWED to make, in one predicate. Both
 *  `DesignError` classes are listed by name — see the import note; leaving the
 *  chrome's out is how a named 400 became an anonymous 500. */
function isRejection(err: unknown): err is Error {
  return (
    err instanceof DesignError ||
    err instanceof ChromeError ||
    err instanceof ThemeError ||
    err instanceof QuarantineError
  );
}

function bad(err: unknown): never {
  if (isRejection(err)) throw new VaultError(400, err.message);
  throw err;
}

/** Create a design: blank-but-stock, or a copy of an existing one. */
export function createDesign(name: string, from?: string): DesignDoc {
  const state = fresh();
  if (state.rows.length >= MAX_DESIGNS) {
    throw new VaultError(400, `This instance already holds ${MAX_DESIGNS} designs`);
  }
  const taken = new Set(state.rows.map((row) => row.id));
  const trimmed = name.trim();
  if (trimmed === "") throw new VaultError(400, "A design needs a name");
  const id = freeSlug(slugifyDesignName(trimmed), taken);
  const now = Date.now();
  let doc: DesignDoc;
  if (from) {
    const source = getDesign(from);
    if (!source) throw new VaultError(404, `No such design: ${from}`);
    doc = { ...source, id, name: trimmed, createdMs: now, updatedMs: now };
  } else {
    doc = stockDesign(id, trimmed, now);
  }
  state.rows.push({ raw: doc, doc, id, name: doc.name, schema: doc.schema });
  // The FIRST design an instance ever makes becomes the active one. Anything
  // else means creating a design and then wondering why the site did not
  // change — and there is nothing it could be competing with.
  if (state.activeId === null) state.activeId = id;
  persist(state);
  return doc;
}

/** Replace a design wholesale (the panel's save). The id in the path wins over
 *  anything in the body: renaming is `name`, not `id`. */
export function putDesign(id: string, body: unknown): DesignDoc {
  const state = fresh();
  const index = state.rows.findIndex((row) => row.id === id);
  if (index === -1) throw new VaultError(404, `No such design: ${id}`);
  let doc: DesignDoc;
  try {
    doc = validateDesign(body, { isThemeChoice: themeChoiceGuard(state.themes) });
  } catch (err) {
    bad(err);
  }
  doc = { ...doc, id, updatedMs: Date.now(), createdMs: state.rows[index].doc?.createdMs ?? doc.createdMs };
  state.rows[index] = { raw: doc, doc, id, name: doc.name, schema: doc.schema };
  persist(state);
  return doc;
}

/** Reset a design to the stock defaults, keeping its id and name. The rescue
 *  that is always available — and it is a reset of the DESIGN, not of the
 *  site: flipping publicLayout back to "blog" is the larger one, and it is
 *  what the error boundary offers. */
export function resetDesign(id: string): DesignDoc {
  const state = fresh();
  const index = state.rows.findIndex((row) => row.id === id);
  if (index === -1) throw new VaultError(404, `No such design: ${id}`);
  const previous = state.rows[index];
  const now = Date.now();
  const doc = stockDesign(id, previous.name || id, previous.doc?.createdMs ?? now);
  doc.updatedMs = now;
  state.rows[index] = { raw: doc, doc, id, name: doc.name, schema: doc.schema };
  persist(state);
  return doc;
}

export function duplicateDesign(id: string): DesignDoc {
  const source = getDesign(id);
  if (!source) throw new VaultError(404, `No such design: ${id}`);
  return createDesign(`${source.name} copy`, id);
}

export function deleteDesign(id: string): void {
  const state = fresh();
  const index = state.rows.findIndex((row) => row.id === id);
  if (index === -1) throw new VaultError(404, `No such design: ${id}`);
  state.rows.splice(index, 1);
  if (state.activeId === id) state.activeId = state.rows[0]?.id ?? null;
  persist(state);
}

/** Which design "designed" mode renders. `null` is legal and means "none
 *  chosen" — the store then falls back to the first row, so an instance whose
 *  active design was deleted still has a site. */
export function setActiveDesign(id: string | null): void {
  const state = fresh();
  if (id !== null && !state.rows.some((row) => row.id === id)) {
    throw new VaultError(404, `No such design: ${id}`);
  }
  state.activeId = id;
  persist(state);
}

/** Export a design as the file the panel downloads: the document plus every
 *  custom theme it names, so it arrives complete. */
export function exportDesign(id: string): DesignExport {
  const state = read();
  const doc = getDesign(id);
  if (!doc) throw new VaultError(404, `No such design: ${id}`);
  const named = doc.theme && doc.theme.startsWith("custom:") ? doc.theme.slice(7) : null;
  const themes = named ? state.themes.filter((theme) => theme.id === named) : [];
  return designExport(doc, themes);
}

/** Import an exported file (or a bare document). ADDITIVE: a colliding id
 *  gets a fresh one, a colliding custom theme is imported under a new slug and
 *  the design is repointed at it. Nothing the instance already has is ever
 *  overwritten by an import — an import that silently replaced the design
 *  somebody is running is not an import. */
export function importDesign(input: unknown): DesignDoc {
  const state = fresh();
  if (state.rows.length >= MAX_DESIGNS) {
    throw new VaultError(400, `This instance already holds ${MAX_DESIGNS} designs`);
  }
  let parsed: { design: unknown; themes: unknown[] };
  try {
    parsed = readDesignExport(input);
  } catch (err) {
    bad(err);
  }

  // Themes travel first, so the design's `theme` can be repointed at whatever
  // id they landed under before it is validated.
  const themeTaken = new Set(state.themes.map((theme) => theme.id));
  const remap = new Map<string, string>();
  for (const entry of parsed.themes) {
    if (state.themes.length >= MAX_CUSTOM_THEMES) break;
    let theme: CustomTheme;
    try {
      theme = validateCustomTheme(entry);
    } catch {
      continue; // a design's themes are a courtesy; a bad one must not sink the import
    }
    const id = freeSlug(theme.id, themeTaken);
    themeTaken.add(id);
    if (id !== theme.id) remap.set(theme.id, id);
    state.themes.push({ ...theme, id });
  }

  const record =
    typeof parsed.design === "object" && parsed.design !== null && !Array.isArray(parsed.design)
      ? { ...(parsed.design as Record<string, unknown>) }
      : parsed.design;
  if (record && typeof record === "object" && typeof (record as Record<string, unknown>).theme === "string") {
    const value = (record as Record<string, unknown>).theme as string;
    const slug = value.startsWith("custom:") ? value.slice(7) : null;
    if (slug && remap.has(slug)) {
      (record as Record<string, unknown>).theme = `custom:${remap.get(slug)!}`;
    }
  }

  let doc: DesignDoc;
  try {
    doc = validateDesign(record, { isThemeChoice: themeChoiceGuard(state.themes) });
  } catch (err) {
    bad(err);
  }
  const id = freeSlug(doc.id, new Set(state.rows.map((row) => row.id)));
  const now = Date.now();
  doc = { ...doc, id, createdMs: now, updatedMs: now };
  state.rows.push({ raw: doc, doc, id, name: doc.name, schema: doc.schema });
  if (state.activeId === null) state.activeId = id;
  persist(state);
  return doc;
}

// ── Custom themes ───────────────────────────────────────────────────────────

export function putCustomTheme(id: string | null, body: unknown): CustomTheme {
  const state = fresh();
  let theme: CustomTheme;
  try {
    theme = validateCustomTheme(body);
  } catch (err) {
    bad(err);
  }
  const index = id === null ? -1 : state.themes.findIndex((entry) => entry.id === id);
  if (id !== null && index === -1) throw new VaultError(404, `No such custom theme: ${id}`);
  if (index === -1) {
    if (state.themes.length >= MAX_CUSTOM_THEMES) {
      throw new VaultError(400, `This instance already holds ${MAX_CUSTOM_THEMES} custom themes`);
    }
    const taken = new Set(state.themes.map((entry) => entry.id));
    const slug = freeSlug(theme.id || slugifyThemeName(theme.name), taken);
    theme = { ...theme, id: slug };
    state.themes.push(theme);
  } else {
    // The id in the path wins: renaming a theme must not silently strand every
    // settings.defaultTheme and stored "vellum.theme" that names it.
    theme = {
      ...theme,
      id: id!,
      createdMs: state.themes[index].createdMs,
      updatedMs: Date.now(),
    };
    state.themes[index] = theme;
  }
  persist(state);
  return theme;
}

/** Delete a custom theme. Refused while a design names it — the same
 *  in-use guard the font routes apply, and for the same reason: a dangling
 *  reference is a site that renders in a theme nobody chose. */
export function deleteCustomTheme(id: string): void {
  const state = fresh();
  const index = state.themes.findIndex((theme) => theme.id === id);
  if (index === -1) throw new VaultError(404, `No such custom theme: ${id}`);
  const choice = `custom:${id}`;
  const user = state.rows.find((row) => row.doc?.theme === choice);
  if (user) {
    throw new VaultError(
      409,
      `Custom theme "${state.themes[index].name}" is in use by the design "${user.name}"`,
    );
  }
  state.themes.splice(index, 1);
  persist(state);
}

/** True when `choice` is a theme this instance actually has. Exported for
 *  `settings.defaultTheme` and `DEFAULT_THEME`, which must accept a custom id
 *  and must NOT accept one that does not exist. */
export function hasThemeChoice(choice: string): boolean {
  return themeChoiceGuard(read().themes)(choice);
}
