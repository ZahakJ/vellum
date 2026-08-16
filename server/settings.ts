// Instance settings: VELLUM_DATA/settings.json — the runtime-editable side of
// site configuration, written by the admin UI via PATCH /api/settings and in
// effect at once (no restart). Every stored key OVERRIDES its env counterpart;
// an absent key falls back to env (site.ts getters do the merging). Env-only
// forever — never read from this file: ADMIN_PASSWORD_HASH, SESSION_SECRET,
// TRUSTED_PROXIES, PORT, HOST, VELLUM_VAULT, VELLUM_DATA, PUBLIC.
// Keys: siteName, tagline, footer, defaultTheme, publicLayout, blogLocale,
// language, languageFilter, languageToggle, excludeTags, commentsEnabled, shareButtons,
// favicon, logo, home { mode, note, banner }, attachments { mode, folder },
// templatesFolder, defaultTemplate, dateCalendar, textDirection, textAlign,
// tagsFolder, tagLabels.
// Unknown keys in the file are preserved verbatim on every write so external
// tooling (or future settings) can share the file safely; unknown keys in a
// PATCH are a 400 (strict allowlist).

import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isNotePath } from "../shared/noteFormat.ts";
import {
  ATTACHMENT_MODES,
  folderError,
  isAttachmentMode,
  normalizeFolder,
  type FolderProblem,
} from "../shared/attachments.ts";
import type {
  AboutInfo,
  AttachmentSettings,
  EffectiveSettings,
  FontSlotsEffective,
  HomeSettings,
  LanguageFilterMode,
  SettingsData,
  SettingsResponse,
} from "../shared/types.ts";
import { THEMES as THEME_IDS } from "../shared/themes.ts";
// Localization: the calendar, the note-layout pair and the tag-label map.
// Shapes and validators live in shared/, so the client's editor and this
// file's PATCH handlers cannot drift on what a valid value is.
import { DEFAULT_DATE_CALENDAR, isDateCalendar, type DateCalendar } from "../shared/dates.ts";
import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_DIRECTION,
  isTextAlign,
  isTextDirection,
  TEXT_ALIGNS,
  TEXT_DIRECTIONS,
  type TextAlign,
  type TextDirection,
} from "../shared/textLayout.ts";
import {
  cleanLabelEntry,
  cleanTagLabels,
  DEFAULT_TAGS_FOLDER,
  tagKey,
  TAG_LABEL_MAX,
  type TagLabelMap,
} from "../shared/tagLabels.ts";
import { isCustomThemeId } from "../shared/customTheme.ts";
// The design store owns the custom themes `defaultTheme` may now name. The
// import is one-way (designs.ts asks site.ts for dataDir, never this module).
import { hasThemeChoice } from "./designs.ts";
import { envHomeNote } from "./auth.ts";
import { commentsEnabled } from "./comments.ts";
// Backup & sync: the gitSync validators and the write-only credential store
// live in gitSync.ts (this import pair is circular and inert — both modules
// export functions only and neither calls the other at module top level).
import {
  applyStagedGitCredentials,
  cleanGitSyncPatch,
  discardStagedGitCredentials,
  gitSyncEffective,
  readGitSyncSettings,
  setGitToken,
  setGitUser,
} from "./gitSync.ts";
import {
  attachmentLocation,
  blogLocale,
  dataDir,
  defaultTheme,
  excludedTags,
  footerTemplate,
  LANGUAGE_FILTER_MODES,
  envSiteLanguage,
  languageFilterMode,
  publicLayout,
  siteLanguage,
  siteName,
  tagline,
} from "./site.ts";
import { customDir } from "./customFonts.ts";
import { catalogList, cleanFontSlots, readFontSlots, slotsAreSystem } from "./fonts.ts";
import {
  detectTagsFolder,
  detectTemplatesFolder,
  listImageAttachments,
  publishedCounts,
  resolveImageRef,
  tags,
} from "./indexer.ts";
import { getVaultRoot, normalizeRel, safeAbs, VaultError } from "./vault.ts";

const SETTINGS_FILE = "settings.json";
const VALUE_MAX = 500; // same budget as a frontmatter banner value

// Per-key budgets (spec'd tighter than the generic VALUE_MAX).
const SITE_NAME_MAX = 80;
const TAGLINE_MAX = 160;
const FOOTER_MAX = 200;
const LOCALE_MAX = 35; // BCP47 tags are short; RFC 5646 recommends ≤ 35
const TAG_MAX = 50;
const TAGS_MAX = 200;
const FOLDER_MAX = 180; // attachments.folder — a vault-relative directory

/** Why a folder value was refused, as the tail of the 400 message. */
const FOLDER_PROBLEM: Record<FolderProblem, string> = {
  traversal: "must stay inside the vault (no “..” segments)",
  absolute: "must be a vault-relative folder, not an absolute path",
  dotfolder: "must not be a dot-folder (those are invisible to the vault)",
  control: "must not contain control characters",
  tooLong: `is too long (${FOLDER_MAX} characters max)`,
};

/** The built-in themes. NOT a copy of the client's list — the same list:
 *  `shared/themes.ts` is the single definition both sides validate against,
 *  because at fifteen ids a hand-kept mirror means the panel offers a theme
 *  the PATCH answers 400 to. */
const THEMES = new Set<string>(THEME_IDS);

/** A theme id this file may STORE: one of the fifteen, or a well-formed
 *  `custom:<name>`. Shape only — whether the custom theme still exists is
 *  asked on the PATCH path (which can afford the read) and again by /api/me,
 *  never on this read path, which must never throw and never touch a second
 *  file. A stored id whose theme was deleted then behaves exactly like a
 *  deleted built-in would: the client falls back to its own default. */
function isStoredTheme(value: string): boolean {
  return THEMES.has(value) || isCustomThemeId(value);
}

/** Vault-image extensions a favicon/logo may carry (what /api/upload can
 *  produce, plus .ico for hand-placed favicons). */
const IMAGE_EXT = /\.(ico|png|svg|jpe?g|gif|webp|avif)$/i;

// mtime-checked cache: external edits to settings.json (hand edits, another
// process) are picked up without a restart, but the common case is one cheap
// stat per read.
let cache: { raw: Record<string, unknown>; mtimeMs: number } | null = null;

function settingsPath(): string {
  return path.join(dataDir(), SETTINGS_FILE);
}

/** The parsed file as-is (unknown keys included), {} when absent/corrupt. */
function readRaw(): Record<string, unknown> {
  const file = settingsPath();
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    cache = { raw: {}, mtimeMs };
    return cache.raw;
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.raw;
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      raw = parsed as Record<string, unknown>;
    } else {
      console.warn("vellum: settings.json is not a JSON object — ignoring it (env defaults in effect)");
    }
  } catch (err) {
    console.warn("vellum: settings.json unreadable — ignoring it (env defaults in effect):", err);
  }
  cache = { raw, mtimeMs };
  return raw;
}

/** A settings string value: single-line, control-chars stripped, capped. */
function cleanValue(value: string, key: string, max = VALUE_MAX): string | null {
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (clean.length > max) {
    throw new VaultError(400, `Settings value "${key}" too long (${max} characters max)`);
  }
  return clean === "" ? null : clean;
}

/** True when a value looks like a valid BCP47 tag (Intl-canonicalizable). */
function isValidLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length > 0;
  } catch {
    return false;
  }
}

/** A vault-relative image path (favicon/logo): safe, non-markdown, image ext.
 *  Throws 400 with the offending key on anything else. */
function cleanVaultImage(value: string, key: string): string | null {
  const clean = cleanValue(value, key);
  if (clean === null) return null;
  let rel: string;
  try {
    rel = normalizeRel(clean);
    safeAbs(rel); // traversal / ignored-dir rejection
  } catch {
    throw new VaultError(400, `Settings value "${key}" is not a valid vault path`);
  }
  if (rel === "" || !IMAGE_EXT.test(rel)) {
    throw new VaultError(
      400,
      `Settings value "${key}" must be a vault image path (ico, png, svg, jpeg, gif, webp)`,
    );
  }
  return rel;
}

/** An image reference that may travel to visitors' browsers (logo,
 *  home.banner): an https URL passes through; any other scheme (http:,
 *  javascript:, data:, …) is a clear 400 rather than falling through to
 *  path normalization (which would mangle "http://x/y.png" into a broken
 *  vault path); everything else must be a safe vault image path. */
function cleanImageRef(value: string, key: string): string | null {
  const clean = cleanValue(value, key);
  if (clean === null) return null;
  if (/^https:\/\//i.test(clean)) return clean;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) {
    throw new VaultError(400, `Settings value "${key}" must be an https:// URL or a vault image path`);
  }
  return cleanVaultImage(clean, key);
}

/** One exclude tag: leading # tolerated, then a simple token (letters, digits,
 *  _ - and / for nested tags), ≤ 50 chars. Throws 400 otherwise. */
function cleanTag(value: unknown): string {
  if (typeof value !== "string") {
    throw new VaultError(400, 'Settings key "excludeTags" must be an array of strings');
  }
  const tag = value.trim().replace(/^#/, "");
  if (tag === "" || tag.length > TAG_MAX || !/^[\p{L}\p{N}][\p{L}\p{N}_/-]*$/u.test(tag)) {
    throw new VaultError(
      400,
      `Settings excludeTags entry ${JSON.stringify(value)} is not a simple tag (letters/digits/_-/, ≤ ${TAG_MAX} chars)`,
    );
  }
  return tag;
}

/** A stored `languageFilter` in either shape, normalized — or null when the
 *  key is absent or unusable.
 *
 *  The BOOLEAN branch is the upgrade path, and its choice is the whole reason
 *  the enum has both "follow" and pinned values. `true` used to mean "hide
 *  every note not written in the site language", which is precisely `"ar"` or
 *  `"en"` — so that is what it becomes. It deliberately does NOT become
 *  "follow", even though "follow" is the better setting for most sites:
 *  upgrading a live site must never change what its visitors can see. The
 *  owner opts into "follow" by clicking it, having read what it will do. */
function languageFilterFrom(value: unknown, raw: Record<string, unknown>): LanguageFilterMode | null {
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    return (LANGUAGE_FILTER_MODES as readonly string[]).includes(clean)
      ? (clean as LanguageFilterMode)
      : null;
  }
  if (typeof value === "boolean") return value ? rawSiteLanguage(raw) : "off";
  return null;
}

/** The site language, resolved from the RAW file plus the env default —
 *  deliberately not via siteLanguage().
 *
 *  This runs INSIDE getSettings(), and siteLanguage() calls getSettings(). The
 *  first version reached for the convenient getter and the server died at boot
 *  with "Maximum call stack size exceeded" the moment it met a real pre-enum
 *  settings.json — a migration path that could only fail on the exact files it
 *  existed for. It is the same two-layer merge siteLanguage() performs (stored
 *  key over SITE_LANG), done one level down where no cycle is possible. */
function rawSiteLanguage(raw: Record<string, unknown>): "en" | "ar" {
  return raw.language === "ar" || raw.language === "en" ? raw.language : envSiteLanguage();
}

/** One-time on-disk migration of the pre-enum boolean, run at startup.
 *
 *  Read-time coercion alone would have left the boolean in the file forever,
 *  and a stored `true` resolves through `siteLanguage()` — so an owner who
 *  later switched the site's chrome to English would have found their Arabic
 *  posts swapped for their English ones by a setting they had not touched.
 *  Freezing it at the language it means TODAY is the only stable reading.
 *  Idempotent, and silent unless it actually rewrote something. */
export function migrateSettings(): void {
  const raw = readRaw();
  if (typeof raw.languageFilter !== "boolean") return;
  const wasOn = raw.languageFilter;
  const mode = wasOn ? rawSiteLanguage(raw) : "off";
  console.log(
    `  migrated settings.languageFilter: ${String(wasOn)} → "${mode}" ` +
      (wasOn
        ? "(the language it already meant — visitors see exactly what they saw)"
        : "(it was off and stays off)"),
  );
  persist({ ...raw, languageFilter: mode });
}

/** The validated, client-facing view of the file (unknown keys dropped,
 *  malformed values dropped silently — reads never throw). */
export function getSettings(): SettingsData {
  const raw = readRaw();
  const out: SettingsData = {};
  const str = (key: "siteName" | "tagline" | "footer" | "blogLocale" | "logo" | "favicon", max: number): void => {
    const v = raw[key];
    if (typeof v === "string" && v.trim() !== "" && v.trim().length <= max) out[key] = v.trim();
  };
  str("siteName", SITE_NAME_MAX);
  str("tagline", TAGLINE_MAX);
  str("footer", FOOTER_MAX);
  if (typeof raw.defaultTheme === "string" && isStoredTheme(raw.defaultTheme)) {
    out.defaultTheme = raw.defaultTheme;
  }
  if (raw.publicLayout === "app" || raw.publicLayout === "blog" || raw.publicLayout === "designed") {
    out.publicLayout = raw.publicLayout;
  }
  if (typeof raw.blogLocale === "string" && raw.blogLocale.length <= LOCALE_MAX && isValidLocale(raw.blogLocale)) {
    out.blogLocale = raw.blogLocale;
  }
  if (Array.isArray(raw.excludeTags)) {
    const tags: string[] = [];
    for (const entry of raw.excludeTags) {
      try {
        tags.push(cleanTag(entry));
      } catch {
        // malformed entry — dropped on read
      }
    }
    // Presence of the key (even empty) is meaningful: it overrides EXCLUDE_TAGS.
    out.excludeTags = tags;
  }
  if (raw.language === "en" || raw.language === "ar") out.language = raw.language;
  {
    // Enum since 1.3, boolean before it. A stored boolean is COERCED on read
    // as well as rewritten on disk at startup (migrateSettings), so a file
    // this process has not migrated yet — one hand-edited, or restored from a
    // backup while the server ran — still behaves, and behaves the same way.
    const mode = languageFilterFrom(raw.languageFilter, raw);
    if (mode !== null) out.languageFilter = mode;
  }
  if (typeof raw.languageToggle === "boolean") out.languageToggle = raw.languageToggle;
  if (typeof raw.commentsEnabled === "boolean") out.commentsEnabled = raw.commentsEnabled;
  if (typeof raw.shareButtons === "boolean") out.shareButtons = raw.shareButtons;
  str("favicon", VALUE_MAX);
  str("logo", VALUE_MAX);
  // ── Attachments ──────────────────────────────────────────────────────────
  const attachments = raw.attachments;
  if (typeof attachments === "object" && attachments !== null && !Array.isArray(attachments)) {
    const a = attachments as Record<string, unknown>;
    const as: AttachmentSettings = {};
    if (isAttachmentMode(a.mode)) as.mode = a.mode;
    if (typeof a.folder === "string") {
      const folder = normalizeFolder(a.folder);
      if (folder !== "" && folderError(folder) === null) as.folder = folder;
    }
    if (Object.keys(as).length > 0) out.attachments = as;
  }
  // ── Templates ────────────────────────────────────────────────────────────
  if (typeof raw.templatesFolder === "string" && raw.templatesFolder.trim() !== "") {
    out.templatesFolder = raw.templatesFolder.trim();
  }
  if (typeof raw.defaultTemplate === "string" && raw.defaultTemplate.trim() !== "") {
    out.defaultTemplate = raw.defaultTemplate.trim();
  }
  const home = raw.home;
  if (typeof home === "object" && home !== null && !Array.isArray(home)) {
    const h = home as Record<string, unknown>;
    const hs: HomeSettings = {};
    if (h.mode === "note" || h.mode === "dashboard") hs.mode = h.mode;
    if (typeof h.note === "string" && h.note.trim() !== "") hs.note = h.note.trim();
    if (typeof h.banner === "string" && h.banner.trim() !== "") hs.banner = h.banner.trim();
    if (Object.keys(hs).length > 0) out.home = hs;
  }
  // Backup & sync (gitSync.ts validates; malformed values drop on read).
  const gitSync = readGitSyncSettings(raw.gitSync);
  if (gitSync) out.gitSync = gitSync;
  // Typography (fonts.ts validates; an unknown/wrongly-slotted id reads back
  // as "system" rather than throwing — reads never fail).
  if (raw.fonts !== undefined) {
    const fonts = readFontSlots(raw.fonts);
    if (!slotsAreSystem(fonts)) out.fonts = fonts;
  }
  // ── Localization: calendar, note layout, tag labels ──────────────────────
  // Reads never throw: a hand-edited settings.json naming a calendar nobody
  // implemented falls back to the default rather than taking the instance
  // down, exactly like an unknown theme id above.
  if (isDateCalendar(raw.dateCalendar)) out.dateCalendar = raw.dateCalendar;
  if (isTextDirection(raw.textDirection)) out.textDirection = raw.textDirection;
  if (isTextAlign(raw.textAlign)) out.textAlign = raw.textAlign;
  if (typeof raw.tagsFolder === "string" && raw.tagsFolder.trim() !== "") {
    out.tagsFolder = raw.tagsFolder.trim();
  }
  if (raw.tagLabels !== undefined) {
    const labels = cleanTagLabels(raw.tagLabels);
    if (Object.keys(labels).length > 0) out.tagLabels = labels;
  }
  return out;
}

/** The calendar every human-facing date on this instance is printed in.
 *  No env counterpart, for the same reason `languageToggle` has none: it is a
 *  runtime editorial decision whose default ("gregorian") is the one that
 *  changes nothing. */
export function dateCalendar(): DateCalendar {
  return getSettings().dateCalendar ?? DEFAULT_DATE_CALENDAR;
}

/** The SITE default direction/alignment for note prose. A note's own
 *  frontmatter `dir:`/`align:` beats both, and the client resolves that pair —
 *  the server only says what the site asked for. */
export function textDirection(): TextDirection {
  return getSettings().textDirection ?? DEFAULT_TEXT_DIRECTION;
}

export function textAlign(): TextAlign {
  return getSettings().textAlign ?? DEFAULT_TEXT_ALIGN;
}

/** The typography slots in effect (every slot present, "system" when unset).
 *  No env counterpart: a webfont choice is a runtime editorial decision, and
 *  its default — the built-in system stacks — is the "nothing is fetched,
 *  nothing is served" one. */
export function fontSlots(): FontSlotsEffective {
  return readFontSlots(readRaw().fonts);
}

/** The merged values the site is using right now: stored value when set, env
 *  default otherwise. This is what the settings panel prefills from. */
export function effectiveSettings(): EffectiveSettings {
  const s = getSettings();
  return {
    // site.ts getters already merge settings over env — reuse them so this
    // can never drift from what the routes actually serve.
    siteName: siteName(),
    tagline: tagline(),
    footer: footerTemplate(),
    defaultTheme: defaultTheme(),
    publicLayout: publicLayout(),
    blogLocale: blogLocale(),
    language: siteLanguage(),
    languageFilter: languageFilterMode(),
    // No env counterpart: a visitor-facing switch is a runtime editorial
    // choice, and its default (off) is the "nothing changes" one.
    languageToggle: s.languageToggle ?? false,
    excludeTags: [...excludedTags()],
    commentsEnabled: commentsEnabled(),
    shareButtons: s.shareButtons ?? true,
    favicon: s.favicon ?? null,
    logo: s.logo ?? null,
    // Always resolved: what the next upload will actually do.
    attachments: attachmentLocation(),
    templatesFolder: templatesFolder(),
    templatesFolderDetected: s.templatesFolder === undefined && templatesFolder() !== null,
    defaultTemplate: defaultTemplate(),
    home: {
      mode: s.home?.mode ?? "note",
      ...(s.home?.note ?? envHomeNote() ? { note: s.home?.note ?? envHomeNote() ?? undefined } : {}),
      ...(s.home?.banner ? { banner: s.home.banner } : {}),
    },
    // The stored token is never part of this: gitSyncEffective() answers
    // `tokenSet` (and the non-secret username) and nothing more.
    gitSync: gitSyncEffective(),
    fonts: fontSlots(),
    // Localization. `tagLabels` is the STORED map only — the tag pages' own
    // labels are merged in by server/tagLabels.ts at read time and must never
    // be folded in here: the settings editor writes this key back whole, and
    // a prefill carrying a label the vault owns would copy that label into
    // settings.json the first time the panel is saved.
    dateCalendar: dateCalendar(),
    textDirection: textDirection(),
    textAlign: textAlign(),
    tagsFolder: tagsFolder(),
    tagsFolderDetected: s.tagsFolder === undefined && detectTagsFolder() !== null,
    tagLabels: s.tagLabels ?? {},
  };
}

/** GET/PATCH /api/settings payload: stored keys + the effective merge (plus
 *  the typography catalog the panel's selects are built from). */
export function settingsResponse(): SettingsResponse {
  return { ...getSettings(), effective: effectiveSettings(), fontCatalog: catalogList(), about: aboutInfo() };
}

/** package.json's version, read once. The file sits next to server/ in every
 *  layout this ships in (clone-and-run, no bundling on the server side). */
const VERSION = ((): string => {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const value = (parsed as { version?: unknown }).version;
    return typeof value === "string" ? value : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** The instance's own facts for the settings panel's About tab. Admin-only by
 *  construction — it rides GET /api/settings, which is 404 to visitors — which
 *  is why it is allowed to name absolute paths on the operator's disk. */
export function aboutInfo(): AboutInfo {
  const counts = publishedCounts();
  return {
    version: VERSION,
    node: process.version,
    vaultPath: getVaultRoot(),
    dataPath: dataDir(),
    settingsPath: settingsPath(),
    customFontsPath: customDir(),
    notes: counts.total,
    published: counts.notes,
    attachments: listImageAttachments().length,
    tags: tags(false, null).length,
  };
}

/** Vault-relative attachment paths named by settings (home banner, logo,
 *  favicon) — /api/file lets visitors fetch exactly these beyond the
 *  published-note allowlist, since the public shell must render them for
 *  everyone. (The favicon also rides /favicon.ico, but the panel preview
 *  and the shell fetch it via /api/file too.) */
export function settingsAssetPaths(): Set<string> {
  const out = new Set<string>();
  const s = getSettings();
  for (const value of [s.home?.banner, s.logo, s.favicon]) {
    if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue; // URLs serve themselves
    try {
      out.add(normalizeRel(value));
    } catch {
      // malformed path — nothing to allow
    }
    // The value as WRITTEN and the file it RESOLVES to are two different
    // paths whenever the admin typed a bare filename ("mark.svg" for
    // "brand/mark.svg") — the same ladder every note banner climbs
    // (indexer.ts resolveImageRef). Allowlisting only the literal string is
    // how a logo the admin can see in the panel 404s for every visitor.
    const resolved = resolveImageRef(value);
    if (resolved !== null && !/^https:/i.test(resolved)) out.add(resolved);
  }
  return out;
}

// ── Templates ───────────────────────────────────────────────────────────────

/** The templates folder in force: the stored setting, else the unambiguous
 *  auto-detection (indexer.ts). Null when neither answers — and null is a
 *  real answer: the two template commands then say the folder is unset
 *  rather than offering an empty picker. */
export function templatesFolder(): string | null {
  const stored = getSettings().templatesFolder;
  if (stored) {
    try {
      const rel = normalizeRel(stored);
      safeAbs(rel);
      return rel === "" ? null : rel;
    } catch {
      return null; // stored garbage — fall back to nothing, never to a guess
    }
  }
  return detectTemplatesFolder();
}

/** Where this instance's tag pages live: the stored setting, else the
 *  unambiguous auto-detection, else the documented `tags` default.
 *
 *  It resolves like `templatesFolder()` above and it sits here, beside it,
 *  rather than in `server/tagLabels.ts` where the first version of it lived —
 *  the two fields answer the same question about the same vault and a reader
 *  comparing them should not have to read two files to learn that only one of
 *  them looks. Unlike templates this one never answers null: an unlabelled
 *  chip is a correct chip, so falling back to the documented folder name costs
 *  nothing, while a null templates folder has to make the picker say so. */
export function tagsFolder(): string {
  const stored = getSettings().tagsFolder;
  if (stored) {
    try {
      const rel = normalizeRel(stored);
      safeAbs(rel);
      if (rel !== "") return rel;
    } catch {
      // stored garbage — fall through to detection, never to a crash
    }
  }
  return detectTagsFolder() ?? DEFAULT_TAGS_FOLDER;
}

/** The template applied to new notes, or null (the default). */
export function defaultTemplate(): string | null {
  const stored = getSettings().defaultTemplate;
  if (!stored) return null;
  try {
    const rel = normalizeRel(stored);
    safeAbs(rel);
    return isNotePath(rel) ? rel : null;
  } catch {
    return null;
  }
}

/** The configured favicon as a safe vault-relative path, or null. */
export function faviconPath(): string | null {
  const value = getSettings().favicon;
  if (!value) return null;
  try {
    const rel = normalizeRel(value);
    safeAbs(rel);
    return rel;
  } catch {
    return null;
  }
}

type PatchHandler = (raw: Record<string, unknown>, value: unknown) => void;

/** Set raw[key] = clean(value), or delete raw[key] when the value clears
 *  (null / "" / clean() returning null). */
function stringKey(
  key: string,
  clean: (value: string) => string | null,
): PatchHandler {
  return (raw, value) => {
    if (value === null || value === "") {
      delete raw[key];
      return;
    }
    if (typeof value !== "string") {
      throw new VaultError(400, `Settings key "${key}" must be a string or null`);
    }
    const cleaned = clean(value);
    if (cleaned === null) delete raw[key];
    else raw[key] = cleaned;
  };
}

/** A settings value that names a place INSIDE the vault → its relative path.
 *
 *  AN ABSOLUTE PATH IS REFUSED, NOT REWRITTEN. `normalizeRel()` strips a
 *  leading slash before `path.isAbsolute()` could ever see one, so
 *  `{"templatesFolder": "/etc"}` came back 200 and was stored as `etc`, and
 *  `{"defaultTemplate": "/etc/passwd.md"}` as `etc/passwd.md`. `safeAbs()`
 *  kept both inside the vault, so nothing escaped — but the admin who typed an
 *  absolute path silently got a DIFFERENT folder from the one they named,
 *  while `..`, a dotdir and a note-where-a-folder-belongs all answer with a
 *  clear 400. A path that cannot mean what it says is an error, not a hint. */
function vaultRel(clean: string, key: string): string {
  if (/^(?:[/\\]|[A-Za-z]:[/\\])/.test(clean)) {
    throw new VaultError(
      400,
      `Settings key "${key}" must be a path inside the vault, not an absolute one`,
    );
  }
  let rel: string;
  try {
    rel = normalizeRel(clean);
    safeAbs(rel); // traversal / ignored-dir rejection
  } catch {
    throw new VaultError(400, `Settings key "${key}" is not a valid vault path`);
  }
  return rel;
}

const PATCH_HANDLERS: Record<string, PatchHandler> = {
  siteName: stringKey("siteName", (v) => cleanValue(v, "siteName", SITE_NAME_MAX)),
  tagline: stringKey("tagline", (v) => cleanValue(v, "tagline", TAGLINE_MAX)),
  footer: stringKey("footer", (v) => cleanValue(v, "footer", FOOTER_MAX)),
  defaultTheme: stringKey("defaultTheme", (v) => {
    // Lowercased like `language` and `publicLayout`, and for a sharper reason
    // than symmetry: `DEFAULT_THEME` is lowercased by readEnvTheme() before it
    // is validated, so `DEFAULT_THEME=SOLAR` started the instance on solar
    // while `PATCH {"defaultTheme":"SOLAR"}` was a 400 — the same value
    // accepted through one door and refused at the other. Theme ids are a
    // closed lowercase enum, so there is one canonical form to coerce to.
    const clean = cleanValue(v, "defaultTheme")?.toLowerCase() ?? null;
    if (clean === null) return null;
    // A custom theme is selectable everywhere a built-in is, and this is one
    // of those places — but only one that EXISTS. `hasThemeChoice` reads
    // designs.json, so the failure mode a bare shape check would leave (a
    // default theme naming a theme somebody deleted, and a public site quietly
    // painted in the fallback) is a 400 here instead.
    if (!THEMES.has(clean) && !hasThemeChoice(clean)) {
      throw new VaultError(
        400,
        `Settings key "defaultTheme" must be one of: ${[...THEMES].join(", ")} — or a custom theme this instance has`,
      );
    }
    return clean;
  }),
  publicLayout: stringKey("publicLayout", (v) => {
    const clean = cleanValue(v, "publicLayout")?.toLowerCase() ?? null;
    if (clean === null) return null;
    if (clean !== "app" && clean !== "blog" && clean !== "designed") {
      throw new VaultError(400, 'Settings key "publicLayout" must be "app", "blog" or "designed"');
    }
    return clean;
  }),
  blogLocale: stringKey("blogLocale", (v) => {
    const clean = cleanValue(v, "blogLocale", LOCALE_MAX);
    if (clean === null) return null;
    if (!isValidLocale(clean)) {
      throw new VaultError(400, `Settings key "blogLocale" is not a valid BCP47 locale: ${clean}`);
    }
    return Intl.getCanonicalLocales(clean)[0];
  }),
  excludeTags: (raw, value) => {
    if (value === null) {
      delete raw.excludeTags;
      return;
    }
    if (!Array.isArray(value)) {
      throw new VaultError(400, 'Settings key "excludeTags" must be an array of strings or null');
    }
    if (value.length > TAGS_MAX) {
      throw new VaultError(400, `Settings key "excludeTags" holds too many tags (${TAGS_MAX} max)`);
    }
    const tags = [...new Set(value.map(cleanTag))];
    // An explicit empty array still clears back to env — "no exclusions at
    // all despite EXCLUDE_TAGS" has no use case worth the extra state.
    if (tags.length === 0) delete raw.excludeTags;
    else raw.excludeTags = tags;
  },
  language: stringKey("language", (v) => {
    const clean = cleanValue(v, "language")?.toLowerCase() ?? null;
    if (clean === null) return null;
    if (clean !== "en" && clean !== "ar") {
      throw new VaultError(400, 'Settings key "language" must be "en" or "ar"');
    }
    return clean;
  }),
  // Strict enum, no coercion beyond trim+lowercase (which `language` and
  // `publicLayout` already get, and which an enum has an obvious canonical
  // form for). "off" is spelled out rather than expressed as null: null clears
  // the key back to LANGUAGE_FILTER, which is a different thing from "this
  // site filters nothing".
  languageFilter: (raw, value) => {
    if (value === null) {
      delete raw.languageFilter;
      return;
    }
    const clean = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!(LANGUAGE_FILTER_MODES as readonly string[]).includes(clean)) {
      throw new VaultError(
        400,
        `Settings key "languageFilter" must be one of: ${LANGUAGE_FILTER_MODES.join(", ")}, or null`,
      );
    }
    raw.languageFilter = clean;
  },
  languageToggle: (raw, value) => {
    if (value === null) delete raw.languageToggle;
    else if (typeof value === "boolean") raw.languageToggle = value;
    else throw new VaultError(400, 'Settings key "languageToggle" must be a boolean or null');
  },
  commentsEnabled: (raw, value) => {
    if (value === null) delete raw.commentsEnabled;
    else if (typeof value === "boolean") raw.commentsEnabled = value;
    else throw new VaultError(400, 'Settings key "commentsEnabled" must be a boolean or null');
  },
  shareButtons: (raw, value) => {
    if (value === null) delete raw.shareButtons;
    else if (typeof value === "boolean") raw.shareButtons = value;
    else throw new VaultError(400, 'Settings key "shareButtons" must be a boolean or null');
  },
  favicon: stringKey("favicon", (v) => cleanVaultImage(v, "favicon")),
  // A logo may be an https URL or a vault image path.
  logo: stringKey("logo", (v) => cleanImageRef(v, "logo")),
  // ── Templates ────────────────────────────────────────────────────────────
  // A FOLDER, not a note: no extension check, and clearing it hands the key
  // back to auto-detection rather than to "no templates at all".
  templatesFolder: stringKey("templatesFolder", (v) => {
    const clean = cleanValue(v, "templatesFolder");
    if (clean === null) return null;
    const rel = vaultRel(clean, "templatesFolder");
    if (rel === "") return null;
    if (isNotePath(rel)) {
      throw new VaultError(400, 'Settings key "templatesFolder" must be a folder, not a note');
    }
    return rel;
  }),
  defaultTemplate: stringKey("defaultTemplate", (v) => {
    const clean = cleanValue(v, "defaultTemplate");
    if (clean === null) return null;
    const rel = vaultRel(clean, "defaultTemplate");
    if (rel === "") return null;
    if (!isNotePath(rel)) {
      throw new VaultError(400, 'Settings key "defaultTemplate" must be a note path (.md, .tex or .latex)');
    }
    return rel;
  }),
  // Where new attachments land. Two sub-keys, patched together like `home`:
  // an unknown mode or an unusable folder rejects the WHOLE patch, so a typo
  // never half-lands and starts writing uploads somewhere unintended.
  attachments: (raw, value) => {
    if (value === null) {
      delete raw.attachments;
      return;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new VaultError(400, 'Settings key "attachments" must be an object or null');
    }
    const a = value as Record<string, unknown>;
    const current =
      typeof raw.attachments === "object" && raw.attachments !== null && !Array.isArray(raw.attachments)
        ? { ...(raw.attachments as Record<string, unknown>) }
        : {};
    for (const key of Object.keys(a)) {
      if (key !== "mode" && key !== "folder") {
        throw new VaultError(400, `Unknown settings key: attachments.${key}`);
      }
    }
    if ("mode" in a) {
      // "specified" IS the default; storing it would only pin the same
      // behaviour absence already gives.
      if (a.mode === null || a.mode === "" || a.mode === "specified") delete current.mode;
      else if (isAttachmentMode(a.mode)) current.mode = a.mode;
      else {
        throw new VaultError(
          400,
          `Settings key "attachments.mode" must be one of: ${ATTACHMENT_MODES.join(", ")}`,
        );
      }
    }
    if ("folder" in a) {
      if (a.folder === null || a.folder === "") delete current.folder;
      else if (typeof a.folder === "string") {
        // JUDGE THE RAW STRING FIRST. `cleanValue` REPAIRS control characters
        // (it replaces every run of them with a space), so by the time it had
        // run, "med\0ia" was the perfectly storable folder "med ia" and
        // `FOLDER_PROBLEM.control` was unreachable code — while CONTRACTS
        // says such a value is REFUSED. Nothing unsafe reached the disk either
        // way; the bug is that the API answered 200 and quietly stored a
        // folder the author never typed.
        const rawProblem = folderError(a.folder);
        if (rawProblem !== null) {
          throw new VaultError(400, `Settings key "attachments.folder" ${FOLDER_PROBLEM[rawProblem]}`);
        }
        const clean = cleanValue(a.folder, "attachments.folder", FOLDER_MAX);
        if (clean === null) delete current.folder;
        else {
          const problem = folderError(clean);
          if (problem !== null) {
            throw new VaultError(400, `Settings key "attachments.folder" ${FOLDER_PROBLEM[problem]}`);
          }
          const folder = normalizeFolder(clean);
          // Last word goes to the vault's own path rules (traversal, ignored
          // trees): the upload will be written through safeAbs, so a folder
          // that cannot survive it must not be storable in the first place.
          try {
            safeAbs(folder);
          } catch {
            throw new VaultError(400, 'Settings key "attachments.folder" is not a valid vault folder');
          }
          if (folder === "") delete current.folder;
          else current.folder = folder;
        }
      } else throw new VaultError(400, 'Settings key "attachments.folder" must be a string or null');
    }
    if (Object.keys(current).length === 0) delete raw.attachments;
    else raw.attachments = current;
  },
  home: (raw, value) => {
    if (value === null) {
      delete raw.home;
      return;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new VaultError(400, 'Settings key "home" must be an object or null');
    }
    const h = value as Record<string, unknown>;
    const current =
      typeof raw.home === "object" && raw.home !== null && !Array.isArray(raw.home)
        ? { ...(raw.home as Record<string, unknown>) }
        : {};
    for (const key of Object.keys(h)) {
      if (key !== "mode" && key !== "note" && key !== "banner") {
        throw new VaultError(400, `Unknown settings key: home.${key}`);
      }
    }
    if ("mode" in h) {
      if (h.mode === null || h.mode === "note") delete current.mode; // note = default
      else if (h.mode === "dashboard") current.mode = "dashboard";
      else throw new VaultError(400, 'Settings key "home.mode" must be "note" or "dashboard"');
    }
    if ("note" in h) {
      if (h.note === null || h.note === "") delete current.note;
      else if (typeof h.note === "string") {
        const clean = cleanValue(h.note, "home.note");
        if (clean === null) delete current.note;
        else {
          const rel = vaultRel(clean, "home.note");
          if (!isNotePath(rel)) {
            throw new VaultError(400, 'Settings key "home.note" must be a note path (.md, .tex or .latex)');
          }
          current.note = rel;
        }
      } else throw new VaultError(400, 'Settings key "home.note" must be a string or null');
    }
    if ("banner" in h) {
      const banner = h.banner;
      if (banner === null || banner === "") delete current.banner;
      else if (typeof banner === "string") {
        // Same shape as the logo: an https URL or a safe vault image path —
        // never an arbitrary string (defense in depth for what lands in an
        // <img src> on every visitor's home page).
        const clean = cleanImageRef(banner, "home.banner");
        if (clean === null) delete current.banner;
        else current.banner = clean;
      } else throw new VaultError(400, 'Settings key "home.banner" must be a string or null');
    }
    if (Object.keys(current).length === 0) delete raw.home;
    else raw.home = current;
  },
  // ── Backup & sync ────────────────────────────────────────────────────────
  gitSync: (raw, value) => {
    const next = cleanGitSyncPatch(value, raw.gitSync);
    if (next === null) delete raw.gitSync;
    else raw.gitSync = next;
  },
  // WRITE-ONLY. Neither of these lands in settings.json: they go to
  // VELLUM_DATA/git-credentials.json (0600), and no read ever answers with the
  // token — only `effective.gitSync.tokenSet`.
  gitToken: (_raw, value) => setGitToken(value),
  gitUser: (_raw, value) => setGitUser(value),
  // Typography. The ids are re-validated here (strict allowlist — an unknown
  // id or one the slot does not accept is a 400) even though the route
  // already validated them to download the faces: this handler is the only
  // thing that writes settings.json, so it owns the guarantee. The download
  // itself happens BEFORE this runs (api.ts), so a fetch failure 502s with
  // the file untouched.
  fonts: (raw, value) => {
    if (value === null) {
      delete raw.fonts;
      return;
    }
    const slots = cleanFontSlots(value, readFontSlots(raw.fonts));
    if (slotsAreSystem(slots)) delete raw.fonts; // all system = the default
    else raw.fonts = { ...slots };
  },
  // ── Localization: calendar, note layout, tag labels ──────────────────────
  // Three closed enums and one map. The enums are validated STRICTLY (an
  // unknown value is a 400, not a silent fallback) for the reason
  // `languageFilter` gives: a typo in a value the panel offers as a fixed set
  // of buttons is a mistake worth answering, and there is no ambiguity about
  // the canonical form to coerce to.
  dateCalendar: (raw, value) => {
    if (value === null || value === "") {
      delete raw.dateCalendar;
      return;
    }
    if (!isDateCalendar(value)) {
      throw new VaultError(400, 'Settings key "dateCalendar" must be "gregorian", "hijri" or "both"');
    }
    if (value === DEFAULT_DATE_CALENDAR) delete raw.dateCalendar; // the default stores nothing
    else raw.dateCalendar = value;
  },
  textDirection: (raw, value) => {
    if (value === null || value === "") {
      delete raw.textDirection;
      return;
    }
    if (!isTextDirection(value)) {
      throw new VaultError(400, `Settings key "textDirection" must be one of: ${TEXT_DIRECTIONS.join(", ")}`);
    }
    if (value === DEFAULT_TEXT_DIRECTION) delete raw.textDirection;
    else raw.textDirection = value;
  },
  textAlign: (raw, value) => {
    if (value === null || value === "") {
      delete raw.textAlign;
      return;
    }
    if (!isTextAlign(value)) {
      throw new VaultError(400, `Settings key "textAlign" must be one of: ${TEXT_ALIGNS.join(", ")}`);
    }
    if (value === DEFAULT_TEXT_ALIGN) delete raw.textAlign;
    else raw.textAlign = value;
  },
  tagsFolder: stringKey("tagsFolder", (v) => {
    const clean = cleanValue(v, "tagsFolder", VALUE_MAX);
    if (clean === null) return null;
    let rel: string;
    try {
      rel = normalizeRel(clean);
      safeAbs(rel); // traversal / ignored-tree rejection
    } catch {
      throw new VaultError(400, 'Settings key "tagsFolder" is not a valid vault path');
    }
    if (rel === "" || isNotePath(rel)) {
      throw new VaultError(400, 'Settings key "tagsFolder" must be a folder, not a note');
    }
    // Stored even when it equals the default: an operator who typed "tags"
    // meant to pin it, and a vault that later grows a `topics/` convention
    // must not silently inherit a changed default.
    return rel;
  }),
  // REPLACED WHOLE, never merged. The settings editor holds the entire map on
  // screen, so a merging PATCH would make deleting a row impossible — the row
  // would come back on the next read. Malformed entries are dropped rather
  // than 400ed for the same reason the excludeTags array drops them: this is a
  // bulk key-value editor, and one bad row must not lose the other forty.
  tagLabels: (raw, value) => {
    if (value === null) {
      delete raw.tagLabels;
      return;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new VaultError(400, 'Settings key "tagLabels" must be an object or null');
    }
    // A CAP ON THE MAP, not only on its keys and labels. Its sibling
    // `excludeTags` has capped its LENGTH at TAGS_MAX since the day it was
    // written; this one capped a key at 50 characters and a label at 60 and
    // then accepted as many of them as were sent. A 5,000-entry PATCH was
    // taken with a 200: settings.json grew to 378 KB and GET /api/settings to
    // 489 KB — a response the settings panel fetches every time it opens. No
    // visitor could see any of it (/api/tag-labels stayed at 46 bytes), which
    // makes this a self-inflicted wound rather than a hole, and the fix is
    // still the same number the sibling key already uses: a vault with more
    // than TAGS_MAX localized tags wants a tags FOLDER, which is the other
    // half of this feature.
    if (Object.keys(value).length > TAGS_MAX) {
      throw new VaultError(
        400,
        `Settings key "tagLabels" holds too many tags (${TAGS_MAX} max) — a tag with a page in the tags folder is named there instead`,
      );
    }
    const map: TagLabelMap = {};
    for (const [rawTag, rawLabels] of Object.entries(value as Record<string, unknown>)) {
      const tag = tagKey(rawTag);
      if (tag === "") continue;
      if (tag.length > TAG_LABEL_MAX || !/^[\p{L}\p{N}][\p{L}\p{N}_/-]*$/u.test(tag)) {
        throw new VaultError(
          400,
          `Settings tagLabels key ${JSON.stringify(rawTag)} is not a simple tag (letters/digits/_-/, ≤ ${TAG_LABEL_MAX} chars)`,
        );
      }
      const entry = cleanLabelEntry(rawLabels);
      if (Object.keys(entry).length > 0) map[tag] = entry;
    }
    if (Object.keys(map).length === 0) delete raw.tagLabels;
    else raw.tagLabels = map;
  },
};

/** Apply a partial update (null clears a key back to its env default) and
 *  persist atomically. Throws VaultError(400) on anything malformed — the
 *  whole patch is rejected, nothing partial lands. Returns stored+effective. */
export function patchSettings(patch: Record<string, unknown>): SettingsResponse {
  // Note: when settings.json was externally corrupted, readRaw() is {} — the
  // patch below then rewrites the file from scratch, discarding whatever the
  // corrupt file held (it was unrecoverable anyway; availability wins).
  const raw = { ...readRaw() };
  // gitToken/gitUser write to a different file (VELLUM_DATA/git-credentials.json),
  // so they only VALIDATE below and are written after the whole patch is
  // accepted — a patch that 400s later must not have changed the credential.
  // Anything a previous failed patch staged is dropped here.
  discardStagedGitCredentials();
  const own = (key: string): boolean => Object.prototype.hasOwnProperty.call(PATCH_HANDLERS, key);
  for (const key of Object.keys(patch)) {
    // Own-property check, NOT `in`: inherited Object.prototype names
    // (__proto__, constructor, toString, …) must hit the strict-allowlist
    // 400 like any other unknown key, never resolve up the prototype chain.
    if (!own(key)) throw new VaultError(400, `Unknown settings key: ${key}`);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!own(key)) continue; // unreachable after the loop above; belt-and-braces
    PATCH_HANDLERS[key](raw, value);
  }
  persist(raw);
  applyStagedGitCredentials();
  return settingsResponse();
}

function persist(raw: Record<string, unknown>): void {
  const file = settingsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename so a crash mid-write never leaves a torn settings.json.
  const tmp = `${file}.tmp`;
  // Same treatment as the git credential file next door in VELLUM_DATA: this
  // file holds no secret by design, but it does hold operator-private
  // configuration (the backup remote, the branch), it is the file a pasted
  // token would land in if any validator ever let one through, and there is no
  // reader but this process. The mode argument is masked by umask and a
  // pre-existing file keeps its own mode, so chmod after the rename asserts it
  // rather than trusting either.
  writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  cache = null; // next read restats — the rename just changed mtime
}
