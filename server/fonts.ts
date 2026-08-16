// Typography: a curated webfont catalog, self-hosted.
//
// Vellum ships zero webfonts and visitors never touch an external host — but
// an instance may CHOOSE faces from the catalog below, and the server then
// fetches them ONCE (Google Fonts, admin-triggered, at PATCH /api/settings
// time) into VELLUM_DATA/fonts/catalog/<id>/ and serves them from there
// forever after. Nothing in a visitor's page ever points at fonts.googleapis
// .com or fonts.gstatic.com; those two hosts are the only ones this module is
// ever allowed to talk to, and only from the admin's save.
//
// The point of the catalog is ARABIC. A slot per script (`arabic` beside
// `prose`/`ui`/`mono`) plus per-face `unicode-range` is what makes a mixed
// paragraph pick the right face PER CHARACTER — the naskh face for the Arabic
// run, the Latin face for the Latin one — on an English instance as much as
// an Arabic one. See buildFontCss().
//
// This module is pure machinery: it knows the catalog, the cache and the CSS,
// and never reads settings.json (settings.ts calls in, not the other way).

import fsp from "node:fs/promises";
import path from "node:path";
import { optionFamily } from "../shared/fonts.ts";
import {
  cssFormat,
  customFileOf,
  customFontExists,
  isCustomId,
  listCustomFonts,
} from "./customFonts.ts";
import { fontsDir } from "./site.ts";
import { VaultError } from "./vault.ts";

// ---------------------------------------------------------------- catalog

export type FontCategory = "serif" | "sans" | "mono";
export type FontScript = "latin" | "arabic";

export interface CatalogEntry {
  /** The family name as Google Fonts (and the browser) knows it. */
  family: string;
  category: FontCategory;
  /** Scripts the family actually covers well — drives which slots take it. */
  scripts: FontScript[];
  /** OPTICAL SIZE COMPENSATION, in percent, applied as the `size-adjust`
   *  descriptor when this family is used as the ARABIC half of a composite
   *  (see composite()). Absent / 100 means "already matches".
   *
   *  Why it has to exist: the composite puts two faces at ONE font-size, and
   *  an Arabic naskh face carries a much smaller body ("x-height") inside the
   *  same em than a Latin text face does. Amiri's base letters stand at ~0.35
   *  em against Lora's 0.51 em x-height, so `العقل السليم` set beside Lora at
   *  the same px reads like a footnote. `size-adjust` is the only descriptor
   *  that fixes this at the FACE level, which is where it belongs: it scales
   *  the Arabic glyphs alone, so an English instance with an Arabic slot gets
   *  the compensation too — the whole-UI `--font-scale` multiplier under
   *  :root[lang="ar"] scales BOTH scripts and therefore never moves the ratio.
   *
   *  The numbers are measured, not guessed: the height of the round base
   *  letter ه (the closest analogue of a Latin x-height) at a 100px em,
   *  against Lora's x-height of 51, damped 15% toward 100% because Arabic
   *  copy carries no capitals and sits a touch above a pure x-height match.
   *  Anything within a few percent of 100 is left out entirely. */
  sizeAdjust?: number;
}

/** The "no webfont" choice, valid in every slot: the built-in system stacks. */
export const SYSTEM = "system";

/** Catalog ids are the stable wire values (settings.json, /api/settings, the
 *  cache directory name) — slugs, never the display family. */
export const FONT_CATALOG: Record<string, CatalogEntry> = {
  // ── Latin serif (prose) ────────────────────────────────────────────────
  "lora": { family: "Lora", category: "serif", scripts: ["latin"] },
  "eb-garamond": { family: "EB Garamond", category: "serif", scripts: ["latin"] },
  "crimson-pro": { family: "Crimson Pro", category: "serif", scripts: ["latin"] },
  "literata": { family: "Literata", category: "serif", scripts: ["latin"] },
  "source-serif-4": { family: "Source Serif 4", category: "serif", scripts: ["latin"] },
  "merriweather": { family: "Merriweather", category: "serif", scripts: ["latin"] },
  // ── Latin sans (interface) ─────────────────────────────────────────────
  "inter": { family: "Inter", category: "sans", scripts: ["latin"] },
  "source-sans-3": { family: "Source Sans 3", category: "sans", scripts: ["latin"] },
  "ibm-plex-sans": { family: "IBM Plex Sans", category: "sans", scripts: ["latin"] },
  "work-sans": { family: "Work Sans", category: "sans", scripts: ["latin"] },
  // ── Mono (code, raw markdown) ──────────────────────────────────────────
  "jetbrains-mono": { family: "JetBrains Mono", category: "mono", scripts: ["latin"] },
  "ibm-plex-mono": { family: "IBM Plex Mono", category: "mono", scripts: ["latin"] },
  "fira-code": { family: "Fira Code", category: "mono", scripts: ["latin"] },
  "source-code-pro": { family: "Source Code Pro", category: "mono", scripts: ["latin"] },
  // ── Arabic ─────────────────────────────────────────────────────────────
  // Naskh and classical faces first (what a reading column wants), then the
  // modern geometric/kufi ones (what chrome wants). All of them also carry a
  // Latin subset, which buildFontCss() deliberately drops: the Arabic slot
  // answers for Arabic codepoints only, so Latin inside Arabic copy keeps the
  // product's own type.
  // `sizeAdjust` is the measured optical-size compensation (see CatalogEntry):
  // ه-height at a 100px em → 35 for Amiri against Lora's 51, and the naskh
  // faces are the ones that need it most. Faces already sitting within a few
  // percent of the Latin body (Cairo, Almarai, Reem Kufi, Noto Sans Arabic)
  // carry no value at all rather than a decorative 100.
  "amiri": { family: "Amiri", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 138 },
  "scheherazade-new": { family: "Scheherazade New", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 136 },
  "noto-naskh-arabic": { family: "Noto Naskh Arabic", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 114 },
  "markazi-text": { family: "Markazi Text", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 126 },
  "lateef": { family: "Lateef", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 150 },
  "aref-ruqaa": { family: "Aref Ruqaa", category: "serif", scripts: ["arabic", "latin"], sizeAdjust: 120 },
  "noto-kufi-arabic": { family: "Noto Kufi Arabic", category: "sans", scripts: ["arabic", "latin"], sizeAdjust: 90 },
  "noto-sans-arabic": { family: "Noto Sans Arabic", category: "sans", scripts: ["arabic", "latin"] },
  "ibm-plex-sans-arabic": { family: "IBM Plex Sans Arabic", category: "sans", scripts: ["arabic", "latin"], sizeAdjust: 120 },
  "cairo": { family: "Cairo", category: "sans", scripts: ["arabic", "latin"] },
  "tajawal": { family: "Tajawal", category: "sans", scripts: ["arabic", "latin"], sizeAdjust: 112 },
  "reem-kufi": { family: "Reem Kufi", category: "sans", scripts: ["arabic", "latin"] },
  "almarai": { family: "Almarai", category: "sans", scripts: ["arabic", "latin"] },
};

/** Catalog lookup by OWN property only. A bare `FONT_CATALOG[id]` resolves up
 *  the prototype chain, so "constructor" / "toString" would read as known ids
 *  (and reach the fetcher, and name a cache directory) — the same reason
 *  patchSettings checks own-properties on its handler table. */
export function catalogEntry(id: string): CatalogEntry | null {
  return Object.prototype.hasOwnProperty.call(FONT_CATALOG, id) ? FONT_CATALOG[id] : null;
}

export type FontSlot = "prose" | "ui" | "mono" | "arabic";
export const FONT_SLOTS: FontSlot[] = ["prose", "ui", "mono", "arabic"];

/** Which ids a slot accepts. Text and interface take any Latin-text catalog
 *  face (a sans prose column is a legitimate taste); code takes monospace
 *  only — a proportional face in a code block is never what was meant; the
 *  Arabic slot takes anything that actually covers Arabic.
 *
 *  An UPLOADED face is allowed in every slot, and that asymmetry is the
 *  honest one: the catalog's slot rules are knowledge WE have about faces we
 *  chose, and we have none of it about a file that arrived this morning. The
 *  name table does not say "monospace" reliably and a cmap scan would answer
 *  "covers Arabic" for any font carrying three ligatures. Refusing a slot on a
 *  guess would mean telling an operator his own naskh face "does not cover
 *  Arabic"; the specimen block, which renders the choice in the actual face,
 *  is the better judge and it is one row below the picker. */
export function slotAllows(slot: FontSlot, id: string): boolean {
  if (id === SYSTEM) return true;
  if (isCustomId(id)) return true;
  const entry = catalogEntry(id);
  if (!entry) return false;
  if (slot === "arabic") return entry.scripts.includes("arabic");
  if (slot === "mono") return entry.category === "mono";
  return entry.category !== "mono";
}

/** The catalog as a list the settings panel renders its selects from. */
export function catalogList(): (CatalogEntry & { id: string })[] {
  return Object.entries(FONT_CATALOG).map(([id, entry]) => ({ id, ...entry }));
}

// ---------------------------------------------------------------- settings

export interface FontSlots {
  prose: string;
  ui: string;
  mono: string;
  arabic: string;
  /** OPTICAL SIZE OVERRIDE for the Arabic half, in percent (50–300), or null
   *  for "use the catalog's measured value / none".
   *
   *  The catalog carries a measured `sizeAdjust` per Arabic family, because we
   *  measured those faces. An UPLOADED face has no such number and cannot get
   *  one — so the operator gets the dial instead, in the one place where the
   *  two scripts are visible side by side. It applies to whatever face is in
   *  the Arabic slot, catalog or custom: an operator who thinks Amiri sits a
   *  shade small beside HIS Latin face is right about his own instance. */
  arabicSizeAdjust?: number | null;
}

export const SYSTEM_SLOTS: FontSlots = { prose: SYSTEM, ui: SYSTEM, mono: SYSTEM, arabic: SYSTEM };

/** The band a size-adjust override may sit in. Below ~60% or above ~200% the
 *  two scripts are no longer "matched", they are one of them shrunk to
 *  nothing; the wider band is still allowed because display faces exist. */
export const SIZE_ADJUST_MIN = 50;
export const SIZE_ADJUST_MAX = 300;

/** Lenient read side (settings.ts::getSettings): unknown / wrongly-slotted
 *  ids drop back to "system" rather than throwing — reads never fail. */
export function readFontSlots(value: unknown): FontSlots {
  const out: FontSlots = { ...SYSTEM_SLOTS };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  const raw = value as Record<string, unknown>;
  for (const slot of FONT_SLOTS) {
    const id = raw[slot];
    if (typeof id === "string" && slotAllows(slot, id)) out[slot] = id;
  }
  const adjust = raw.arabicSizeAdjust;
  if (
    typeof adjust === "number" &&
    Number.isFinite(adjust) &&
    adjust >= SIZE_ADJUST_MIN &&
    adjust <= SIZE_ADJUST_MAX
  ) {
    out.arabicSizeAdjust = Math.round(adjust);
  }
  return out;
}

/** Strict write side (PATCH /api/settings): an unknown key, a non-string, or
 *  an id the slot does not accept is a 400 — the whole patch is rejected.
 *  Absent slots keep `base` (the stored value), so a one-slot patch is a
 *  one-slot change, the same way `home` merges. */
export function cleanFontSlots(value: unknown, base: FontSlots = SYSTEM_SLOTS): FontSlots {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VaultError(400, 'Settings key "fonts" must be an object or null');
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(FONT_SLOTS as string[]).includes(key) && key !== "arabicSizeAdjust") {
      throw new VaultError(400, `Unknown settings key: fonts.${key}`);
    }
  }
  const out: FontSlots = { ...base };
  if (Object.prototype.hasOwnProperty.call(raw, "arabicSizeAdjust")) {
    const adjust = raw.arabicSizeAdjust;
    if (adjust === null || adjust === "") {
      delete out.arabicSizeAdjust;
    } else if (
      typeof adjust !== "number" ||
      !Number.isFinite(adjust) ||
      adjust < SIZE_ADJUST_MIN ||
      adjust > SIZE_ADJUST_MAX
    ) {
      throw new VaultError(
        400,
        `Settings key "fonts.arabicSizeAdjust" must be a percentage between ${SIZE_ADJUST_MIN} and ${SIZE_ADJUST_MAX}, or null`,
      );
    } else {
      out.arabicSizeAdjust = Math.round(adjust);
    }
  }
  for (const slot of FONT_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(raw, slot)) continue;
    const id = raw[slot];
    if (id === null || id === "" || id === SYSTEM) {
      out[slot] = SYSTEM; // an explicit clear back to the built-in stacks
      continue;
    }
    if (typeof id !== "string") {
      throw new VaultError(400, `Settings key "fonts.${slot}" must be a font id, "system" or null`);
    }
    // An uploaded face: the SHAPE is checked here (the id must name a
    // well-formed custom filename); whether that file is actually on disk is
    // checked by the route, next to the catalog download, because this
    // function is synchronous and the disk is not.
    if (isCustomId(id)) {
      out[slot] = id;
      continue;
    }
    if (!catalogEntry(id)) {
      throw new VaultError(400, `Unknown font id: ${id} (fonts.${slot})`);
    }
    if (!slotAllows(slot, id)) {
      throw new VaultError(
        400,
        slot === "mono"
          ? `Font "${id}" is not monospace (fonts.mono)`
          : `Font "${id}" does not cover Arabic (fonts.arabic)`,
      );
    }
    out[slot] = id;
  }
  return out;
}

/** True when nothing is chosen — the site keeps its system stacks and no
 *  stylesheet is linked at all. */
export function slotsAreSystem(slots: FontSlots): boolean {
  return FONT_SLOTS.every((slot) => slots[slot] === SYSTEM);
}

/** The distinct ids named by the slots (no "system"), uploaded ones included. */
export function slotIds(slots: FontSlots): string[] {
  return [...new Set(FONT_SLOTS.map((slot) => slots[slot]).filter((id) => id !== SYSTEM))];
}

/** …and the CATALOG half of that list: the only ids that name a family this
 *  server can download. An uploaded face is already on disk or does not exist,
 *  which is the route's check, not the fetcher's. */
export function catalogSlotIds(slots: FontSlots): string[] {
  return slotIds(slots).filter((id) => !isCustomId(id));
}

/** The uploaded ids named by the slots — what the delete route consults for
 *  in-use protection. */
export function customSlotIds(slots: FontSlots): string[] {
  return slotIds(slots).filter((id) => isCustomId(id));
}

/** A short version tag for the current picks: it rides on /api/me and becomes
 *  the ?v= on the stylesheet link, so changing a pick changes the URL and the
 *  browser refetches instead of showing yesterday's faces. The size-adjust
 *  rides on it too — it changes the emitted CSS without changing a single id. */
export function fontsSignature(slots: FontSlots): string {
  const picks = FONT_SLOTS.map((slot) => slots[slot]).join(".");
  return slots.arabicSizeAdjust == null ? picks : `${picks}.${slots.arabicSizeAdjust}`;
}

// ---------------------------------------------------------------- the cache

const GOOGLE_CSS_HOST = "fonts.googleapis.com";
const GOOGLE_FONT_HOST = "fonts.gstatic.com";
/** Hard allowlist. Every URL this module fetches — the stylesheet and every
 *  face inside it — must parse to https + exactly one of these two hosts.
 *  Redirects are refused outright (redirect: "error"), so a 302 to anywhere
 *  else is a failed download, not a request to another host. */
const ALLOWED_HOSTS = new Set([GOOGLE_CSS_HOST, GOOGLE_FONT_HOST]);

const CSS_TIMEOUT_MS = 10_000;
const FONT_TIMEOUT_MS = 20_000;
const CSS_MAX_BYTES = 512 * 1024;
const FONT_MAX_BYTES = 4 * 1024 * 1024;
const FAMILY_MAX_BYTES = 16 * 1024 * 1024;
const FAMILY_MAX_FACES = 64;
const DOWNLOAD_CONCURRENCY = 6;

/** A woff2-capable browser UA: the css2 API serves ttf to anything it does not
 *  recognise, and woff2 is the only format worth self-hosting. */
const WOFF2_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** One cached face: a file in the family's cache dir plus the descriptors the
 *  generated @font-face needs. `range` is verbatim from Google (a comma list
 *  of U+… chunks), which is what makes per-character selection work. */
export interface CachedFace {
  file: string;
  weight: string;
  style: string;
  range: string;
  subset: string;
}

interface FamilyMeta {
  id: string;
  family: string;
  fetched: string;
  faces: CachedFace[];
}

const META_FILE = "meta.json";

/** VELLUM_DATA/fonts/catalog — everything this module writes lives under it. */
export function catalogDir(): string {
  return path.join(fontsDir(), "catalog");
}

/** VELLUM_DATA/fonts/catalog/<id> for a KNOWN catalog id. The id is checked
 *  against the catalog by every caller, so this never joins caller input. */
export function fontDir(id: string): string {
  return path.join(catalogDir(), id);
}

/** Cached faces for a family, or null when it is not cached (or the cache was
 *  hand-deleted). Sync-ish helper used by the CSS builder and the file route. */
export async function readFaces(id: string): Promise<CachedFace[] | null> {
  if (!catalogEntry(id)) return null;
  let meta: FamilyMeta;
  try {
    meta = JSON.parse(await fsp.readFile(path.join(fontDir(id), META_FILE), "utf8")) as FamilyMeta;
  } catch {
    return null;
  }
  if (!Array.isArray(meta.faces) || meta.faces.length === 0) return null;
  for (const face of meta.faces) {
    if (typeof face?.file !== "string" || !isCacheFileName(face.file)) return null;
  }
  return meta.faces;
}

/** Cache filenames are generated by this module and nothing else: lowercase
 *  slug + .woff2. The file route re-checks it before touching the disk. */
export function isCacheFileName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}\.woff2$/.test(name);
}

async function isCached(id: string): Promise<boolean> {
  const faces = await readFaces(id);
  if (!faces) return false;
  for (const face of faces) {
    try {
      const stat = await fsp.stat(path.join(fontDir(id), face.file));
      if (!stat.isFile() || stat.size === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Parse + allowlist a URL found in Google's CSS. Anything that is not https
 *  on one of the two allowed hosts (or carries credentials) is refused. */
function assertAllowed(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VaultError(502, `Font source is not a valid URL: ${url.slice(0, 80)}`);
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
    throw new VaultError(502, `Refusing to fetch a font from ${parsed.hostname || "an unknown host"}`);
  }
  return parsed;
}

/** Fetch with the hard host allowlist, no redirects, a timeout and a byte
 *  cap. Every failure is a 502 with a message the settings panel can toast. */
async function fetchCapped(url: string, timeoutMs: number, maxBytes: number, accept: string): Promise<Uint8Array> {
  const parsed = assertAllowed(url);
  let res: Response;
  try {
    res = await fetch(parsed, {
      redirect: "error", // a redirect off the allowlist can never be followed
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": WOFF2_UA, "Accept": accept },
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new VaultError(502, `${parsed.hostname} ${reason} — the font was not downloaded`);
  }
  if (!res.ok) {
    throw new VaultError(502, `${parsed.hostname} answered ${res.status} for ${parsed.pathname}`);
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new VaultError(502, `Font resource too large (${maxBytes} bytes max)`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new VaultError(502, "Empty response from the font server");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new VaultError(502, `Font resource too large (${maxBytes} bytes max)`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

interface ParsedFace {
  family: string;
  weight: string;
  style: string;
  range: string;
  subset: string;
  url: string;
}

const FACE_RE = /(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;

function descriptor(block: string, name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*([^;}]+)`, "i").exec(block);
  return match ? match[1].trim() : "";
}

/** Parse the css2 answer into faces. Google emits one @font-face per subset
 *  per weight/style, each preceded by a `/* subset *\/` comment and carrying
 *  its own unicode-range — which is exactly the granularity buildFontCss()
 *  needs to split Arabic from Latin. */
function parseFaces(css: string): ParsedFace[] {
  const out: ParsedFace[] = [];
  for (const match of css.matchAll(FACE_RE)) {
    const subset = (match[1] ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "") || "sub";
    const block = match[2];
    const src = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(block);
    if (!src) continue;
    const family = descriptor(block, "font-family").replace(/^['"]|['"]$/g, "");
    out.push({
      family,
      weight: descriptor(block, "font-weight") || "400",
      style: descriptor(block, "font-style") || "normal",
      range: descriptor(block, "unicode-range"),
      subset,
      url: src[1].trim(),
    });
  }
  return out;
}

function cssUrl(family: string, spec: string): string {
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  return `https://${GOOGLE_CSS_HOST}/css2?family=${name}${spec}&display=swap`;
}

/** Weight/style specs, most generous first: css2 silently drops axis values a
 *  family does not have, but a family with no variable axis at all can 400 on
 *  the richer form — so fall back rather than fail the save. */
const FAMILY_SPECS = [":ital,wght@0,400;0,700;1,400;1,700", ":wght@400;700", ""];

async function fetchFamilyCss(family: string): Promise<string> {
  let lastError: unknown = null;
  for (const spec of FAMILY_SPECS) {
    try {
      const bytes = await fetchCapped(cssUrl(family, spec), CSS_TIMEOUT_MS, CSS_MAX_BYTES, "text/css,*/*");
      return new TextDecoder().decode(bytes);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof VaultError
    ? lastError
    : new VaultError(502, `Could not fetch the ${family} stylesheet`);
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/** One download per family at a time, process-wide. /api/font-preview.css can
 *  ask for up to four families per request and the panel repaints as a reader
 *  scrubs a select, so without this a burst of previews (or a save racing a
 *  preview) started the same family several times over and they all wrote the
 *  same files. Short-lived by construction: the entry is dropped the moment
 *  the download settles, and a family already on disk never gets here. */
const inFlight = new Map<string, Promise<void>>();

/** Download + cache one catalog family. A no-op when it is already on disk.
 *  Files land first and meta.json (written last, atomically) is what makes the
 *  cache "valid" — an interrupted download leaves junk that the next attempt
 *  overwrites, never a half-registered family. */
export function cacheFamily(id: string): Promise<void> {
  const running = inFlight.get(id);
  if (running) return running;
  const started = downloadFamily(id).finally(() => inFlight.delete(id));
  // A rejection is delivered to every caller that joined this one attempt; the
  // catch here only keeps Node from calling the shared promise unhandled.
  started.catch(() => {});
  inFlight.set(id, started);
  return started;
}

async function downloadFamily(id: string): Promise<void> {
  const entry = catalogEntry(id);
  if (!entry) throw new VaultError(400, `Unknown font id: ${id}`);
  if (await isCached(id)) return;

  const css = await fetchFamilyCss(entry.family);
  const parsed = parseFaces(css);
  if (parsed.length === 0) {
    throw new VaultError(502, `No usable webfont faces came back for ${entry.family}`);
  }
  if (parsed.length > FAMILY_MAX_FACES) parsed.length = FAMILY_MAX_FACES;

  const dir = fontDir(id);
  await fsp.mkdir(dir, { recursive: true });

  const seen = new Set<string>();
  const faces: CachedFace[] = [];
  const jobs: { face: ParsedFace; file: string }[] = [];
  parsed.forEach((face, index) => {
    const slug = `${face.subset}-${face.weight.replace(/[^0-9]/g, "") || "400"}${
      face.style.startsWith("italic") ? "i" : ""
    }`;
    let file = `${slug}.woff2`;
    let n = 2;
    while (seen.has(file)) file = `${slug}-${n++}.woff2`;
    if (!isCacheFileName(file)) file = `f${index}.woff2`;
    seen.add(file);
    jobs.push({ face, file });
    faces.push({ file, weight: face.weight, style: face.style, range: face.range, subset: face.subset });
  });

  // The family budget is CLAIMED BEFORE each fetch, not totted up after it.
  // Six faces download at once, so a limit tested after the byte count went up
  // let five more in-flight faces land past it: the real ceiling was
  // FAMILY_MAX_BYTES + 5 × FONT_MAX_BYTES (~36 MB), not the 16 MB the constant
  // names. A claim reserves its own worst case and refunds the difference, so
  // `committed + reserved` never exceeds the budget and neither can the total
  // written. A worker that finds nothing left WAITS for the others to refund
  // rather than failing — most woff2 subsets are a few dozen KB, and six
  // simultaneous worst-case reservations would otherwise starve every family.
  let committed = 0;
  let reserved = 0;
  let inFlightFaces = 0;
  let waiters: (() => void)[] = [];
  const claim = async (): Promise<number> => {
    for (;;) {
      const free = FAMILY_MAX_BYTES - committed - reserved;
      if (free > 0) {
        const cap = Math.min(FONT_MAX_BYTES, free);
        reserved += cap; // synchronous with the check: no await between them
        inFlightFaces += 1;
        return cap;
      }
      // Nothing left and nothing on the way back: the family really is too big.
      if (inFlightFaces === 0) return 0;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  const release = (cap: number, used: number): void => {
    reserved -= cap;
    committed += used;
    inFlightFaces -= 1;
    const woken = waiters;
    waiters = [];
    for (const resolve of woken) resolve();
  };

  await pool(jobs, DOWNLOAD_CONCURRENCY, async ({ face, file }) => {
    const cap = await claim();
    if (cap === 0) {
      throw new VaultError(502, `${entry.family} is larger than the ${FAMILY_MAX_BYTES}-byte cache budget`);
    }
    let bytes: Uint8Array;
    try {
      bytes = await fetchCapped(face.url, FONT_TIMEOUT_MS, cap, "font/woff2,*/*");
    } catch (err) {
      release(cap, 0);
      throw err;
    }
    release(cap, bytes.byteLength);
    await fsp.writeFile(path.join(dir, file), bytes);
  });

  const meta: FamilyMeta = { id, family: entry.family, fetched: new Date().toISOString(), faces };
  const metaPath = path.join(dir, META_FILE);
  const tmp = `${metaPath}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await fsp.rename(tmp, metaPath);
}

/** Make sure every named family is on disk. Families are cached one at a time
 *  so the first failure is reported with its own name; anything already
 *  downloaded stays cached (a later retry resumes from there). */
export async function ensureFontsCached(ids: string[]): Promise<void> {
  for (const id of ids) {
    if (isCustomId(id)) continue; // uploaded: already on disk, nothing to fetch
    await cacheFamily(id);
  }
}

// ---------------------------------------------------------------- CSS

/** Arabic script blocks — the ranges the Arabic slot is allowed to answer for.
 *  Google's `arabic` subset also carries a few shared punctuation chunks
 *  (U+200C-200E, U+2010-2011, U+204F, U+2E41) that its `latin` subset covers
 *  too; keeping only chunks fully inside these blocks makes the Arabic and
 *  Latin faces of a composite family cover DISJOINT codepoints, so the
 *  per-character pick is exact and never order-dependent. */
const ARABIC_BLOCKS: [number, number][] = [
  [0x0600, 0x06ff], // Arabic
  [0x0750, 0x077f], // Arabic Supplement
  [0x0870, 0x089f], // Arabic Extended-B
  [0x08a0, 0x08ff], // Arabic Extended-A
  [0xfb50, 0xfdff], // Presentation Forms-A
  // Presentation Forms-B stops one short of U+FEFF on purpose: that is the
  // byte-order mark, which every Latin subset carries too — treating it as
  // Arabic pulled a whole extra face into the composite for one invisible
  // character.
  [0xfe70, 0xfefe],
  [0x10e60, 0x10e7f], // Rumi numerals
  [0x1ec70, 0x1ecbf], // Indic Siyaq numbers
  [0x1ed00, 0x1ed4f], // Ottoman Siyaq numbers
  [0x1ee00, 0x1eeff], // Arabic Mathematical Alphabetic Symbols
];

/** The Arabic blocks as a `unicode-range` value, and its complement.
 *
 *  A CATALOG face arrives from Google already sliced into subsets, each with
 *  its own range, so the composite narrows those. An UPLOADED face is one file
 *  with no range at all — and "no range" means "answers for every codepoint",
 *  which would make the Arabic and Latin halves of a composite OVERLAP and
 *  hand the pick to declaration order. So an uploaded face is given the range
 *  its ROLE implies: the Arabic blocks in the Arabic slot, everything else in
 *  a Latin slot that stands beside an Arabic face. The two sets stay disjoint,
 *  which is the invariant the whole composite rests on. */
const ARABIC_RANGE_CSS = ARABIC_BLOCKS.map(([lo, hi]) => rangeChunk(lo, hi)).join(", ");
const NON_ARABIC_RANGE_CSS = complementChunks(ARABIC_BLOCKS).join(", ");

function rangeChunk(lo: number, hi: number): string {
  const hex = (n: number): string => n.toString(16).toUpperCase();
  return lo === hi ? `U+${hex(lo)}` : `U+${hex(lo)}-${hex(hi)}`;
}

/** Everything in U+0000–U+10FFFF that the given (sorted, disjoint) blocks do
 *  not cover. */
function complementChunks(blocks: [number, number][]): string[] {
  const sorted = [...blocks].sort((a, b) => a[0] - b[0]);
  const out: string[] = [];
  let at = 0;
  for (const [lo, hi] of sorted) {
    if (lo > at) out.push(rangeChunk(at, lo - 1));
    at = Math.max(at, hi + 1);
  }
  if (at <= 0x10ffff) out.push(rangeChunk(at, 0x10ffff));
  return out;
}

/** [start, end] of one `U+…` chunk ("U+0600-06FF", "U+04??", "U+2010"). */
function chunkRange(chunk: string): [number, number] | null {
  const match = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(chunk.trim());
  if (!match) return null;
  const head = match[1];
  if (head.includes("?")) {
    const start = Number.parseInt(head.replaceAll("?", "0"), 16);
    const end = Number.parseInt(head.replaceAll("?", "F"), 16);
    return [start, end];
  }
  const start = Number.parseInt(head, 16);
  const end = match[2] === undefined ? start : Number.parseInt(match[2], 16);
  return [start, end];
}

function isArabicChunk(chunk: string): boolean {
  const range = chunkRange(chunk);
  if (!range) return false;
  return ARABIC_BLOCKS.some(([lo, hi]) => range[0] >= lo && range[1] <= hi);
}

function touchesArabic(chunk: string): boolean {
  const range = chunkRange(chunk);
  if (!range) return true; // unparseable: assume overlap, so it is dropped
  return ARABIC_BLOCKS.some(([lo, hi]) => range[0] <= hi && range[1] >= lo);
}

/** Keep only the Arabic chunks of a face's range (Arabic slot), or only the
 *  non-Arabic ones (a Latin slot standing beside a chosen Arabic face). */
function filterRange(range: string, keep: (chunk: string) => boolean): string {
  return range
    .split(",")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "" && keep(chunk))
    .join(", ");
}

/** A `size-adjust` percentage that is safe to emit: a finite number in a sane
 *  band, rounded, and never printed at all when it is a no-op. The catalog is
 *  ours, but this value lands verbatim in a stylesheet — it gets the same
 *  treatment as any other value that reaches a generated file. */
function sizeAdjustPercent(entry: CatalogEntry | null): number | null {
  const value = entry?.sizeAdjust;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const clamped = Math.round(Math.min(300, Math.max(50, value)));
  return clamped === 100 ? null : clamped;
}

function faceBlock(
  family: string,
  id: string,
  face: CachedFace,
  range: string,
  sizeAdjust: number | null,
): string {
  return [
    "@font-face {",
    `  font-family: "${family}";`,
    `  font-style: ${face.style};`,
    `  font-weight: ${face.weight};`,
    "  font-display: swap;",
    // The optical-size compensation rides on the FACE, so it applies wherever
    // that face is picked — including a lone Arabic word inside an English
    // paragraph on an English instance, where no :root multiplier ever runs.
    ...(sizeAdjust === null ? [] : [`  size-adjust: ${sizeAdjust}%;`]),
    `  src: url("/api/fonts/catalog/${id}/${face.file}") format("woff2");`,
    ...(range ? [`  unicode-range: ${range};`] : []),
    "}",
    "",
  ].join("\n");
}

/** One uploaded file as an `@font-face`. It is a single face, so it declares
 *  one weight and one style and lets the browser synthesize the rest: a
 *  reader who uploads "MyFace-Regular.woff2" means "set my text in this", not
 *  "and leave bold unrendered". */
function customFaceBlock(
  family: string,
  file: string,
  range: string,
  sizeAdjust: number | null,
): string {
  return [
    "@font-face {",
    `  font-family: "${family}";`,
    "  font-style: normal;",
    "  font-weight: 400;",
    "  font-display: swap;",
    ...(sizeAdjust === null ? [] : [`  size-adjust: ${sizeAdjust}%;`]),
    `  src: url("/api/fonts/custom/${file}") format("${cssFormat(file)}");`,
    ...(range ? [`  unicode-range: ${range};`] : []),
    "}",
    "",
  ].join("\n");
}

interface Composite {
  /** The generated family name, or null when both slots are "system". */
  family: string | null;
  css: string;
}

/** One composite family: the Arabic slot's faces FIRST (narrowed to Arabic
 *  codepoints), then the Latin slot's (with Arabic codepoints removed when an
 *  Arabic face is present). Because the two sets are disjoint, the browser
 *  picks per CHARACTER — an Arabic word inside an English paragraph gets the
 *  naskh face and the English around it keeps the Latin one, with no
 *  `[lang]` rule and no direction involved. */
async function composite(
  name: string,
  latinId: string,
  arabicId: string,
  arabicAdjust: number | null,
): Promise<Composite> {
  let css = "";
  let any = false;
  if (arabicId !== SYSTEM) {
    // Only the ARABIC half is compensated: the number describes this family's
    // body height against a Latin text face, so it is meaningless (and wrong)
    // on the Latin half — including the case where the same family were ever
    // picked for both. The operator's own override outranks the measurement.
    const adjust = arabicAdjust ?? sizeAdjustPercent(catalogEntry(arabicId));
    if (isCustomId(arabicId)) {
      const file = customFileOf(arabicId);
      if (file && (await customFontExists(arabicId))) {
        css += customFaceBlock(name, file, ARABIC_RANGE_CSS, adjust);
        any = true;
      }
    } else {
      const faces = await readFaces(arabicId);
      for (const face of faces ?? []) {
        const range = face.range ? filterRange(face.range, isArabicChunk) : ARABIC_RANGE_CSS;
        if (!range) continue; // a Latin-only subset of the Arabic family
        css += faceBlock(name, arabicId, face, range, adjust);
        any = true;
      }
    }
  }
  // Captured BEFORE the Latin loop: whether to carve the Arabic codepoints out
  // of the Latin faces is a property of the Arabic slot, not of how many faces
  // have been emitted so far.
  const hasArabic = any;
  if (latinId !== SYSTEM) {
    if (isCustomId(latinId)) {
      const file = customFileOf(latinId);
      if (file && (await customFontExists(latinId))) {
        css += customFaceBlock(name, file, hasArabic ? NON_ARABIC_RANGE_CSS : "", null);
        any = true;
      }
    } else {
      const faces = await readFaces(latinId);
      for (const face of faces ?? []) {
        const range =
          face.range && hasArabic ? filterRange(face.range, (chunk) => !touchesArabic(chunk)) : face.range;
        if (face.range && !range) continue; // an Arabic-only subset of a Latin family
        css += faceBlock(name, latinId, face, range, null);
        any = true;
      }
    }
  }
  return { family: any ? name : null, css };
}

/** The CSS variable each slot drives, and the system stack it falls back to.
 *  The `*-system` tokens live in tokens.css and already flip Arabic-first
 *  under :root[lang="ar"], so appending them keeps every uncovered codepoint
 *  on the stack the instance would have used anyway. */
const SLOT_VAR: Record<"prose" | "ui" | "mono", { name: string; fallback: string }> = {
  prose: { name: "--font-serif", fallback: "var(--font-serif-system)" },
  ui: { name: "--font-ui", fallback: "var(--font-ui-system)" },
  mono: { name: "--font-mono", fallback: "var(--font-mono-system)" },
};

export interface FontCssOptions {
  /** Family-name prefix: "Vellum" for the live site, "VellumPreview" for the
   *  settings panel's unsaved preview (both can be loaded at once). */
  prefix: string;
  /** Emit the :root overrides. The preview only wants the families. */
  root: boolean;
}

/** The generated stylesheet: self-hosted @font-face blocks, three composite
 *  families, and (optionally) the :root remap. Never references an external
 *  host — every src is a /api/fonts/catalog/… path on this server. */
export async function buildFontCss(slots: FontSlots, opts: FontCssOptions): Promise<string> {
  const parts: string[] = [
    "/* Generated by Vellum — self-hosted webfaces from VELLUM_DATA/fonts/catalog.",
    "   Every src below is served by this instance; no external host is contacted. */",
    "",
  ];
  const vars: string[] = [];
  for (const slot of ["prose", "ui", "mono"] as const) {
    const name = `${opts.prefix}${slot === "ui" ? "UI" : slot === "mono" ? "Mono" : "Prose"}`;
    const built = await composite(name, slots[slot], slots.arabic, slots.arabicSizeAdjust ?? null);
    parts.push(built.css);
    if (built.family) vars.push(`  ${SLOT_VAR[slot].name}: "${built.family}", ${SLOT_VAR[slot].fallback};`);
  }
  if (opts.root && vars.length > 0) {
    parts.push(
      "/* Plain :root — same specificity as tokens.css, later in the cascade, so",
      "   this wins; and a VELLUM_DATA/custom.css :root rule (linked after this",
      "   one) still wins over BOTH, which is the escape hatch. The composite",
      "   falls back to --font-*-system, which tokens.css flips Arabic-first",
      "   under :root[lang=\"ar\"] — and the Arabic type-metric multipliers",
      "   there are untouched. */",
      ":root {",
      ...vars,
      "}",
      "",
    );
  }
  return `${parts.join("\n")}\n`;
}

// -------------------------------------------------- the picker's own faces

/** ONE face per font id, under its own `VellumOpt-…` family — what makes the
 *  font picker render every option IN THE FACE IT NAMES.
 *
 *  A list of family names in the UI font is not a font picker: it is a list of
 *  words that happen to be trademarks, and no reader can tell Literata from
 *  Source Serif by reading the words "Literata" and "Source Serif". So the
 *  picker asks for the faces of ONE GROUP at a time (Serif, Sans, Mono,
 *  Arabic, Your fonts) as that group is opened, and this builds them.
 *
 *  Cheap on purpose: regular weight, upright, and NO unicode-range narrowing —
 *  an option row must render its Latin family name AND its Arabic sample from
 *  the same declaration. Uncached families are skipped rather than fetched
 *  here; the route caches first and this reads what landed. */
export async function buildFaceListCss(ids: string[]): Promise<string> {
  const parts: string[] = [
    "/* Generated by Vellum — one face per pickable font, for the settings",
    "   panel's font picker. Self-hosted like everything else. */",
    "",
  ];
  for (const id of ids) {
    const family = optionFamily(id);
    if (isCustomId(id)) {
      const file = customFileOf(id);
      if (file && (await customFontExists(id))) parts.push(customFaceBlock(family, file, "", null));
      continue;
    }
    if (!catalogEntry(id)) continue;
    const faces = await readFaces(id);
    for (const face of faces ?? []) {
      // Regular upright only: the picker sets one line of a name and one line
      // of sample text, and six weights per family across twenty-seven
      // families is a megabyte of downloads to draw a menu.
      if (!/400/.test(face.weight) || face.style.startsWith("italic")) continue;
      parts.push(faceBlock(family, id, face, face.range, null));
    }
  }
  return `${parts.join("\n")}\n`;
}

/** Every pickable id, catalog + uploaded — what the panel's picker offers and
 *  what /api/font-faces.css will answer for. */
export async function pickableIds(): Promise<string[]> {
  const custom = await listCustomFonts();
  return [...Object.keys(FONT_CATALOG), ...custom.map((font) => font.id)];
}
