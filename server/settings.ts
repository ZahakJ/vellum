// Instance settings: VELLUM_DATA/settings.json — the runtime-editable side of
// site configuration, written by the admin UI via PATCH /api/settings and in
// effect at once (no restart). Every stored key OVERRIDES its env counterpart;
// an absent key falls back to env (site.ts getters do the merging). Env-only
// forever — never read from this file: ADMIN_PASSWORD_HASH, SESSION_SECRET,
// TRUSTED_PROXIES, PORT, HOST, VELLUM_VAULT, VELLUM_DATA, PUBLIC.
// Keys: siteName, tagline, footer, defaultTheme, publicLayout, blogLocale,
// language, languageFilter, languageToggle, excludeTags, commentsEnabled, shareButtons,
// favicon, logo, home { mode, note, banner }, attachments { mode, folder }.
// Unknown keys in the file are preserved verbatim on every write so external
// tooling (or future settings) can share the file safely; unknown keys in a
// PATCH are a 400 (strict allowlist).

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ATTACHMENT_MODES,
  folderError,
  isAttachmentMode,
  normalizeFolder,
  type FolderProblem,
} from "../shared/attachments.ts";
import type {
  AttachmentSettings,
  EffectiveSettings,
  HomeSettings,
  SettingsData,
  SettingsResponse,
} from "../shared/types.ts";
import { envHomeNote } from "./auth.ts";
import { commentsEnabled } from "./comments.ts";
import {
  attachmentLocation,
  blogLocale,
  dataDir,
  defaultTheme,
  excludedTags,
  footerTemplate,
  languageFilterEnabled,
  publicLayout,
  siteLanguage,
  siteName,
  tagline,
} from "./site.ts";
import { normalizeRel, safeAbs, VaultError } from "./vault.ts";

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

/** The four built-in themes (mirrors client/state.ts THEMES). */
const THEMES = new Set(["iron-gall", "void", "lapis", "parchment"]);

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
  if (typeof raw.defaultTheme === "string" && THEMES.has(raw.defaultTheme)) {
    out.defaultTheme = raw.defaultTheme;
  }
  if (raw.publicLayout === "app" || raw.publicLayout === "blog") out.publicLayout = raw.publicLayout;
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
  if (typeof raw.languageFilter === "boolean") out.languageFilter = raw.languageFilter;
  if (typeof raw.languageToggle === "boolean") out.languageToggle = raw.languageToggle;
  if (typeof raw.commentsEnabled === "boolean") out.commentsEnabled = raw.commentsEnabled;
  if (typeof raw.shareButtons === "boolean") out.shareButtons = raw.shareButtons;
  str("favicon", VALUE_MAX);
  str("logo", VALUE_MAX);
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
  const home = raw.home;
  if (typeof home === "object" && home !== null && !Array.isArray(home)) {
    const h = home as Record<string, unknown>;
    const hs: HomeSettings = {};
    if (h.mode === "note" || h.mode === "dashboard") hs.mode = h.mode;
    if (typeof h.note === "string" && h.note.trim() !== "") hs.note = h.note.trim();
    if (typeof h.banner === "string" && h.banner.trim() !== "") hs.banner = h.banner.trim();
    if (Object.keys(hs).length > 0) out.home = hs;
  }
  return out;
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
    languageFilter: languageFilterEnabled(),
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
    home: {
      mode: s.home?.mode ?? "note",
      ...(s.home?.note ?? envHomeNote() ? { note: s.home?.note ?? envHomeNote() ?? undefined } : {}),
      ...(s.home?.banner ? { banner: s.home.banner } : {}),
    },
  };
}

/** GET/PATCH /api/settings payload: stored keys + the effective merge. */
export function settingsResponse(): SettingsResponse {
  return { ...getSettings(), effective: effectiveSettings() };
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
  }
  return out;
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

const PATCH_HANDLERS: Record<string, PatchHandler> = {
  siteName: stringKey("siteName", (v) => cleanValue(v, "siteName", SITE_NAME_MAX)),
  tagline: stringKey("tagline", (v) => cleanValue(v, "tagline", TAGLINE_MAX)),
  footer: stringKey("footer", (v) => cleanValue(v, "footer", FOOTER_MAX)),
  defaultTheme: stringKey("defaultTheme", (v) => {
    const clean = cleanValue(v, "defaultTheme");
    if (clean === null) return null;
    if (!THEMES.has(clean)) {
      throw new VaultError(400, `Settings key "defaultTheme" must be one of: ${[...THEMES].join(", ")}`);
    }
    return clean;
  }),
  publicLayout: stringKey("publicLayout", (v) => {
    const clean = cleanValue(v, "publicLayout")?.toLowerCase() ?? null;
    if (clean === null) return null;
    if (clean !== "app" && clean !== "blog") {
      throw new VaultError(400, 'Settings key "publicLayout" must be "app" or "blog"');
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
  languageFilter: (raw, value) => {
    if (value === null) delete raw.languageFilter;
    else if (typeof value === "boolean") raw.languageFilter = value;
    else throw new VaultError(400, 'Settings key "languageFilter" must be a boolean or null');
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
          let rel: string;
          try {
            rel = normalizeRel(clean);
            safeAbs(rel);
          } catch {
            throw new VaultError(400, 'Settings key "home.note" is not a valid vault path');
          }
          if (!rel.toLowerCase().endsWith(".md")) {
            throw new VaultError(400, 'Settings key "home.note" must be a markdown path (…​.md)');
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
};

/** Apply a partial update (null clears a key back to its env default) and
 *  persist atomically. Throws VaultError(400) on anything malformed — the
 *  whole patch is rejected, nothing partial lands. Returns stored+effective. */
export function patchSettings(patch: Record<string, unknown>): SettingsResponse {
  // Note: when settings.json was externally corrupted, readRaw() is {} — the
  // patch below then rewrites the file from scratch, discarding whatever the
  // corrupt file held (it was unrecoverable anyway; availability wins).
  const raw = { ...readRaw() };
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
  return settingsResponse();
}

function persist(raw: Record<string, unknown>): void {
  const file = settingsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename so a crash mid-write never leaves a torn settings.json.
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
  cache = null; // next read restats — the rename just changed mtime
}
