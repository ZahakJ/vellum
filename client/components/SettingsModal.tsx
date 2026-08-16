// Site settings panel (admin): edits VELLUM_DATA/settings.json through
// GET/PATCH /api/settings. Two-column label/control rows in five groups, in
// the order an operator meets them — Identity / Home page / Site behavior /
// Typography / Backup & sync: what the site IS, what its front door shows,
// how it behaves, how it is set, and last (because it is operational rather
// than editorial, and the only group that touches a network) how it is backed
// up. Text fields left empty inherit the env default (shown as the
// placeholder); a filled field overrides it. The last two groups have no
// "inherit" state at all — neither has an env counterpart — so their controls
// always show the value in force and carry a short note under the heading
// instead. Saving PATCHes only the keys that changed, then refreshes /api/me
// so the wordmark, layout, theme default, fonts and favicon apply live — no
// reload.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Aliased: the panel also installs a window keydown listener, and React's
// KeyboardEvent would shadow the DOM one that listener is typed with.
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { AboutInfo, CustomFontInfo, FontCatalogEntry } from "../../shared/types.ts";
import type { SettingsPatch, SettingsResponse } from "../../shared/types.ts";
import {
  ApiError,
  deleteCustomFont,
  getSettings,
  listAttachments,
  listCustomFonts,
  patchSettings,
  uploadAttachment,
  uploadFont,
} from "../api.ts";
import { bannerSrc } from "../banner.ts";
// The calendar specimen: the panel shows what a choice PRINTS, in this
// instance's own locale and numerals, before the reader commits to it.
import { siteDateIn } from "../dates.ts";
import "../styles/localization.css";
import { useBannerSrc } from "./BannerImg.tsx";
import { refreshTemplateSettings } from "../templates.ts";
import { clearFontFaces, faceStack, loadFontFaces } from "../fontFaces.ts";
import { countPhrase, localeNum, t, tf, type I18nKey } from "../i18n.ts";
import { FONT_UPLOAD_MAX_MB, UPLOAD_MAX_MB } from "../../shared/limits.ts";
import { defaultSide, useStore, type SidebarSidePref } from "../state.ts";
import { attachScrollFade } from "../scrollFade.ts";
import { confirmModal } from "./Confirm.tsx";
import { FontPicker, SYSTEM_FONT } from "./FontPicker.tsx";
import { NumberInput, SegmentedControl, TextInput, Toggle, type Segment } from "./controls/Fields.tsx";
import { isSelectOpen, Select, type SelectGroup } from "./controls/Select.tsx";
import { choiceBase, choiceLabel, isTheme, THEME_GROUPS, THEME_LABELS, THEMES, type Theme } from "../themes.ts";
import { customThemeChoice, isCustomThemeId } from "../../shared/customTheme.ts";
import { getCustomThemes } from "../design/customThemes.ts";
import {
  onSyncChange,
  refreshSyncStatus,
  runSyncInit,
  runSyncNow,
  syncBusy,
  syncCause,
  syncSnapshot,
  syncWhen,
} from "../sync.ts";
import { isThemePickerOpen, openThemePicker } from "./ThemePicker.tsx";
import { toast } from "../toast.ts";
import { isNotePath } from "../../shared/noteFormat.ts";

// ---------------------------------------------------------------------------
// Form model: strings for every control; "" = inherit the env default.
// ---------------------------------------------------------------------------

interface Form {
  siteName: string;
  tagline: string;
  footer: string;
  defaultTheme: string; // "" | theme
  publicLayout: string; // "" | "app" | "blog" | "designed"
  blogLocale: string;
  language: string;       // "" | "en" | "ar"
  languageFilter: string; // "" | "on" | "off"
  languageToggle: string; // "" | "on" | "off" (public EN/ع switch; default off)
  excludeTags: string;  // comma-separated
  comments: string;     // "" | "on" | "off"
  share: string;        // "" | "on" | "off" (blog article share row; default off)
  favicon: string;      // vault path or ""
  logo: string;         // vault path / https URL or ""
  homeMode: string;     // "" | "note" | "dashboard"
  homeNote: string;
  homeBanner: string;
  // ── Templates ────────────────────────────────────────────────────────────
  // Both empty by default. An empty folder field does NOT mean "no templates"
  // — the server auto-detects an unambiguously named folder — so the row
  // prints what was detected rather than sitting blank beside a working
  // feature (the `inherited` note under it).
  templatesFolder: string;
  defaultTemplate: string;
  // ── Backup & sync (gitSync) ──────────────────────────────────────────────
  // These prefill from `effective` rather than from the stored keys: sync has
  // no env counterpart, so "inherit" is meaningless here — every control shows
  // the value in force.
  syncEnabled: string;   // "on" | "off"
  syncRemote: string;
  syncBranch: string;
  syncAuth: string;      // "ssh" | "token"
  syncPullFirst: string; // "on" | "off"
  syncInterval: string;  // whole minutes; "0" = manual only
  syncUser: string;      // username the token pairs with
  syncToken: string;     // WRITE-ONLY: never prefilled, never read back
  // ── Typography (fonts) ───────────────────────────────────────────────────
  // Catalog id or SYSTEM_FONT. Like sync, these prefill from `effective`: a
  // webfont choice has no env counterpart, so "inherit" would mean nothing.
  fontProse: string;
  fontUi: string;
  fontMono: string;
  fontArabic: string;
  /** Optical size match for the Arabic face, in percent; "" = the catalog's
   *  own measured value (or none, for an uploaded face). */
  fontSizeAdjust: string;
  // ── Localization ─────────────────────────────────────────────────────────
  // Like sync and typography, these prefill from `effective`: none of them has
  // an env counterpart, so "inherit" would name a fallback that does not
  // exist. Their defaults ARE the values that change nothing.
  dateCalendar: string;  // "gregorian" | "hijri" | "both"
  textDirection: string; // "auto" | "ltr" | "rtl"
  textAlign: string;     // "start" | "left" | "right" | "center" | "justify"
  tagsFolder: string;
  /** The tag-label table, as ROWS rather than as the wire map — the editor is
   *  a list the reader adds to and deletes from, and a map cannot hold a row
   *  that is being typed (its key is still empty). Never touched by `field()`,
   *  which is for string controls. */
  tagLabels: TagLabelRow[];
}

/** One row of the tag-label editor. `tag` is the CANONICAL tag; the other two
 *  are what the front end says instead, per language. */
interface TagLabelRow {
  tag: string;
  en: string;
  ar: string;
}

/** The stored map → editor rows, sorted so the table does not reshuffle
 *  itself between saves. */
function labelRows(map: Record<string, Record<string, string>> | undefined): TagLabelRow[] {
  return Object.entries(map ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, labels]) => ({ tag, en: labels.en ?? "", ar: labels.ar ?? "" }));
}

/** Editor rows → the wire map. Blank rows and blank languages drop out: a row
 *  whose labels are both empty is a row the reader emptied, which is how a
 *  label is deleted without a second gesture. */
function labelMap(rows: TagLabelRow[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    const tag = row.tag.trim().replace(/^#/, "").toLowerCase();
    if (tag === "") continue;
    const entry: Record<string, string> = {};
    if (row.en.trim() !== "") entry.en = row.en.trim();
    if (row.ar.trim() !== "") entry.ar = row.ar.trim();
    if (Object.keys(entry).length > 0) out[tag] = entry;
  }
  return out;
}

function formFrom(s: SettingsResponse): Form {
  return {
    siteName: s.siteName ?? "",
    tagline: s.tagline ?? "",
    footer: s.footer ?? "",
    defaultTheme: s.defaultTheme ?? "",
    publicLayout: s.publicLayout ?? "",
    blogLocale: s.blogLocale ?? "",
    language: s.language ?? "",
    languageFilter: s.languageFilter === undefined ? "" : s.languageFilter ? "on" : "off",
    languageToggle: s.languageToggle === undefined ? "" : s.languageToggle ? "on" : "off",
    excludeTags: (s.excludeTags ?? []).join(", "),
    comments: s.commentsEnabled === undefined ? "" : s.commentsEnabled ? "on" : "off",
    share: s.shareButtons === undefined ? "" : s.shareButtons ? "on" : "off",
    favicon: s.favicon ?? "",
    logo: s.logo ?? "",
    homeMode: s.home?.mode ?? "",
    homeNote: s.home?.note ?? "",
    homeBanner: s.home?.banner ?? "",
    templatesFolder: s.templatesFolder ?? "",
    defaultTemplate: s.defaultTemplate ?? "",
    syncEnabled: s.effective.gitSync.enabled ? "on" : "off",
    syncRemote: s.effective.gitSync.remote ?? "",
    syncBranch: s.effective.gitSync.branch,
    syncAuth: s.effective.gitSync.authMode,
    syncPullFirst: s.effective.gitSync.pullFirst ? "on" : "off",
    syncInterval: String(s.effective.gitSync.intervalMinutes),
    syncUser: s.effective.gitSync.gitUser ?? "",
    // The stored token never comes back from the server (only `tokenSet`
    // does), so this field always starts empty — typing into it REPLACES the
    // stored value, and leaving it empty leaves that value alone.
    syncToken: "",
    fontProse: s.effective.fonts?.prose ?? SYSTEM_FONT,
    fontUi: s.effective.fonts?.ui ?? SYSTEM_FONT,
    fontMono: s.effective.fonts?.mono ?? SYSTEM_FONT,
    fontArabic: s.effective.fonts?.arabic ?? SYSTEM_FONT,
    fontSizeAdjust:
      s.effective.fonts?.arabicSizeAdjust == null ? "" : String(s.effective.fonts.arabicSizeAdjust),
    dateCalendar: s.effective.dateCalendar ?? "gregorian",
    textDirection: s.effective.textDirection ?? "auto",
    textAlign: s.effective.textAlign ?? "start",
    tagsFolder: s.tagsFolder ?? "",
    // The STORED map only. The tag pages' own labels are merged in by the
    // server at read time and deliberately never prefill this editor: a
    // prefill carrying a label the vault owns would copy it into settings.json
    // the first time the panel was saved, and the page would stop being the
    // source of truth for its own name.
    tagLabels: labelRows(s.tagLabels),
  };
}

const FONT_KEYS = ["fontProse", "fontUi", "fontMono", "fontArabic", "fontSizeAdjust"] as const;

/** The band the server accepts for fonts.arabicSizeAdjust (server/fonts.ts). */
const SIZE_ADJUST_MIN = 50;
const SIZE_ADJUST_MAX = 300;

// Type SPECIMENS, deliberately not in i18n.ts: a Latin sample must stay Latin
// in an Arabic UI and an Arabic sample Arabic in an English one, or the block
// stops previewing the thing it is there to preview. The second line is mixed
// on purpose — it is the whole feature in one line: the Arabic slot answers
// for the Arabic letters and the Latin slot for "Vellum" and the digits,
// chosen per CHARACTER, with no markup and no language attribute.
const SPECIMEN_LATIN = "The vault is open — a candlelit room 0123";
const SPECIMEN_ARABIC = "خَطُّ النَّسْخِ في عمودِ القراءةِ ١٢٣٤";

const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_/-]*$/u;

/** Mirrors server IMAGE_EXT (settings.ts). */
const IMG_EXT_RE = /\.(ico|png|svg|jpe?g|gif|webp|avif)$/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Client mirror of the server's image-reference validators (favicon: vault
 *  image path only; logo / home banner: https URL or vault image path) —
 *  fires inline so an invalid value never reaches the save-time toast. */
function imageRefError(value: string, httpsOk: boolean): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (/^https:\/\//i.test(v)) {
    return httpsOk ? null : t("errVaultImage");
  }
  if (SCHEME_RE.test(v)) {
    return t(httpsOk ? "errHttpsOrVault" : "errVaultImage");
  }
  if (v.split(/[\\/]/).includes("..")) return t("errDotDot");
  if (!IMG_EXT_RE.test(v)) return t("errImageExt");
  return null;
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function isValidLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length > 0;
  } catch {
    return false;
  }
}

/** A stored enum VALUE ("note", "blog") as the reader-facing label the option
 *  rows show — so the greyed "inherit (…)" row names the same choice the list
 *  below it does, in the same language. Unknown values pass through. */
const ENUM_LABELS: Partial<Record<string, I18nKey>> = {
  note: "modeNote",
  dashboard: "modeDashboard",
  app: "layoutApp",
  blog: "layoutBlog",
  designed: "layoutDesigned",
};

function enumLabel(value: string): string {
  const key = ENUM_LABELS[value];
  return key ? t(key) : value;
}

/** "80 chars max" / "80 حرفا كحد أقصى" — the count goes through countPhrase so
 *  the Arabic unit agrees with the number at every budget (a 3–10 budget wants
 *  "أحرف", not the "حرفا" that only reads right from 11 up). */
function maxChars(n: number): string {
  return tf("errMaxChars", { count: countPhrase(n, "chars") });
}

/** Client-side mirror of the server validators — inline row errors. */
function validate(f: Form): Partial<Record<keyof Form, string>> {
  const errors: Partial<Record<keyof Form, string>> = {};
  if (f.siteName.trim().length > 80) errors.siteName = maxChars(80);
  if (f.tagline.trim().length > 160) errors.tagline = maxChars(160);
  if (f.footer.trim().length > 200) errors.footer = maxChars(200);
  if (f.blogLocale.trim() !== "" && (f.blogLocale.trim().length > 35 || !isValidLocale(f.blogLocale.trim()))) {
    errors.blogLocale = t("errLocale");
  }
  const badTag = splitTags(f.excludeTags).find((tag) => tag.length > 50 || !TAG_RE.test(tag));
  if (badTag !== undefined) errors.excludeTags = tf("errNotSimpleTag", { tag: badTag });
  if (f.homeNote.trim() !== "" && !isNotePath(f.homeNote.trim())) {
    errors.homeNote = t("errMdPath");
  }
  if (/^http:\/\//i.test(f.logo.trim())) {
    errors.logo = t("errMixedContent");
  } else {
    const e = imageRefError(f.logo, true);
    if (e) errors.logo = e;
  }
  if (/^http:\/\//i.test(f.homeBanner.trim())) {
    errors.homeBanner = t("errMixedContent");
  } else {
    const e = imageRefError(f.homeBanner, true);
    if (e) errors.homeBanner = e;
  }
  const faviconError = imageRefError(f.favicon, false);
  if (faviconError) errors.favicon = faviconError;
  // Backup & sync — the same three rules the server enforces, inline.
  const remote = f.syncRemote.trim();
  if (remote !== "") {
    if (remote.length > 300) errors.syncRemote = maxChars(300);
    else if (UNSAFE_REMOTE.test(remote) || remote.startsWith("-")) errors.syncRemote = t("errRemoteChars");
    // Mirrors the server exactly: a password is refused on either scheme, a
    // bare `user@` only on https:// (where it is how a pasted token looks).
    // `ssh://git@host/you/vault.git` is a normal ssh remote and passes.
    else if (/^https:\/\/[^/]*@/i.test(remote) || /^[a-z][a-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/i.test(remote)) {
      errors.syncRemote = t("errRemoteCreds");
    }
    else if (!REMOTE_RE.test(remote)) errors.syncRemote = t("errRemoteScheme");
  }
  const branch = f.syncBranch.trim();
  const badBranch =
    !BRANCH_RE.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock");
  if (branch !== "" && badBranch) errors.syncBranch = t("errBranchName");
  const interval = f.syncInterval.trim();
  if (interval !== "" && !/^\d{1,4}$/.test(interval)) errors.syncInterval = t("errInterval");
  else if (Number(interval || "0") > 1440) errors.syncInterval = t("errInterval");
  if (/\s/.test(f.syncToken)) errors.syncToken = t("errTokenSpaces");
  const adjust = f.fontSizeAdjust.trim();
  if (adjust !== "") {
    const n = Number(adjust);
    if (!/^\d{1,3}$/.test(adjust) || n < SIZE_ADJUST_MIN || n > SIZE_ADJUST_MAX) {
      errors.fontSizeAdjust = tf("errSizeAdjust", {
        min: localeNum(SIZE_ADJUST_MIN),
        max: localeNum(SIZE_ADJUST_MAX),
      });
    }
  }
  return errors;
}

/** THE TAG-LABEL TABLE.
 *
 *  A compact key/value editor and nothing more: one row per tag, one column
 *  per language, a remove button per row and one Add at the foot. It is a
 *  TABLE rather than a textarea of `tag = label` lines because the values are
 *  two scripts side by side — an Arabic label typed into a line-oriented
 *  field reorders around its own separator, and the reader is then editing a
 *  string they cannot read back.
 *
 *  Three deliberate details:
 *   · the TAG field is `dir="ltr"` and the LABEL fields are `dir="auto"`. A
 *     canonical tag is machine text (it is a URL segment, an EXCLUDE_TAGS
 *     match, a search key) and must never be reordered by an RTL panel; a
 *     label is prose in its own language and takes its own direction. Their
 *     ALIGNMENT still follows the panel, per controls.css's rule.
 *   · a row with an empty tag is kept while it is being typed and dropped on
 *     save (`labelMap`), so the first keystroke into a new row does not make
 *     the row vanish.
 *   · emptying BOTH labels deletes the label on save. There is no second
 *     gesture for "clear this" because there is nothing to confirm: the tag
 *     itself is untouched, and what comes back is the tag's own name. */
function TagLabelEditor({
  rows,
  onChange,
}: {
  rows: TagLabelRow[];
  onChange: (rows: TagLabelRow[]) => void;
}) {
  const set = (i: number, patch: Partial<TagLabelRow>): void => {
    onChange(rows.map((row, n) => (n === i ? { ...row, ...patch } : row)));
  };
  return (
    <div className="s-taglabels">
      {rows.length === 0 ? (
        <p className="s-taglabels__empty">{t("tagLabelsEmpty")}</p>
      ) : (
        <>
          <div className="s-taglabels__head" aria-hidden="true">
            <span>{t("tagLabelsTag")}</span>
            <span>{t("tagLabelsEnglish")}</span>
            <span>{t("tagLabelsArabic")}</span>
            <span />
          </div>
          {rows.map((row, i) => (
            <div className="s-taglabels__row" key={`row-${i}`}>
              <TextInput
                value={row.tag}
                onChange={(v) => set(i, { tag: v })}
                placeholder={t("tagLabelsTagPlaceholder")}
                label={t("tagLabelsTag")}
                dir="ltr"
                maxLength={60}
              />
              <TextInput
                value={row.en}
                onChange={(v) => set(i, { en: v })}
                placeholder={t("tagLabelsLabelPlaceholder")}
                label={t("tagLabelsEnglish")}
                dir="auto"
                maxLength={60}
              />
              <TextInput
                value={row.ar}
                onChange={(v) => set(i, { ar: v })}
                placeholder={t("tagLabelsLabelPlaceholder")}
                label={t("tagLabelsArabic")}
                dir="auto"
                maxLength={60}
              />
              <button
                type="button"
                className="s-taglabels__del"
                title={t("tagLabelsRemove")}
                aria-label={t("tagLabelsRemove")}
                onClick={() => onChange(rows.filter((_, n) => n !== i))}
              >
                {/* Geometry, not a glyph: an SVG ✕ takes no bidi and needs no
                    mirroring rule. */}
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
        </>
      )}
      <button
        type="button"
        className="s-taglabels__add"
        onClick={() => onChange([...rows, { tag: "", en: "", ar: "" }])}
      >
        {t("tagLabelsAdd")}
      </button>
    </div>
  );
}

/** Mirrors of the server's gitSync validators (server/gitSync.ts). */
const UNSAFE_REMOTE = /[\s`$;&|<>(){}[\]'"\\^*?!#]/;
const REMOTE_RE = /^(https:\/\/|ssh:\/\/)\S+$|^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^:]+$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** The PATCH: only keys whose form value differs from the loaded snapshot. */
function buildPatch(initial: Form, f: Form): SettingsPatch {
  const patch: SettingsPatch = {};
  const str = (
    key:
      | "siteName"
      | "tagline"
      | "footer"
      | "defaultTheme"
      | "blogLocale"
      | "favicon"
      | "logo"
      | "templatesFolder"
      | "defaultTemplate",
  ): void => {
    const value = f[key].trim();
    if (value !== initial[key].trim()) patch[key] = value === "" ? null : value;
  };
  str("siteName");
  str("tagline");
  str("footer");
  str("defaultTheme");
  str("blogLocale");
  str("favicon");
  str("logo");
  str("templatesFolder");
  str("defaultTemplate");
  if (f.language !== initial.language) {
    patch.language = f.language === "en" || f.language === "ar" ? f.language : null;
  }
  if (f.languageFilter !== initial.languageFilter) {
    patch.languageFilter = f.languageFilter === "" ? null : f.languageFilter === "on";
  }
  if (f.languageToggle !== initial.languageToggle) {
    patch.languageToggle = f.languageToggle === "" ? null : f.languageToggle === "on";
  }
  if (f.publicLayout !== initial.publicLayout) {
    patch.publicLayout =
      f.publicLayout === "app" || f.publicLayout === "blog" || f.publicLayout === "designed"
        ? f.publicLayout
        : null;
  }
  if (f.excludeTags.trim() !== initial.excludeTags.trim()) {
    const tags = splitTags(f.excludeTags);
    patch.excludeTags = tags.length > 0 ? tags : null;
  }
  if (f.comments !== initial.comments) {
    patch.commentsEnabled = f.comments === "" ? null : f.comments === "on";
    patch.shareButtons = f.share === "" ? null : f.share === "on";
  }
  if (
    f.homeMode !== initial.homeMode ||
    f.homeNote.trim() !== initial.homeNote.trim() ||
    f.homeBanner.trim() !== initial.homeBanner.trim()
  ) {
    patch.home = {
      mode: f.homeMode === "dashboard" ? "dashboard" : null,
      note: f.homeNote.trim() === "" ? null : f.homeNote.trim(),
      banner: f.homeBanner.trim() === "" ? null : f.homeBanner.trim(),
    };
  }
  // ── Backup & sync ────────────────────────────────────────────────────────
  const git: NonNullable<SettingsPatch["gitSync"]> = {};
  if (f.syncEnabled !== initial.syncEnabled) git.enabled = f.syncEnabled === "on";
  if (f.syncRemote.trim() !== initial.syncRemote.trim()) {
    git.remote = f.syncRemote.trim() === "" ? null : f.syncRemote.trim();
  }
  if (f.syncBranch.trim() !== initial.syncBranch.trim()) {
    git.branch = f.syncBranch.trim() === "" ? null : f.syncBranch.trim();
  }
  if (f.syncAuth !== initial.syncAuth) git.authMode = f.syncAuth === "token" ? "token" : "ssh";
  if (f.syncPullFirst !== initial.syncPullFirst) git.pullFirst = f.syncPullFirst === "on";
  if (f.syncInterval.trim() !== initial.syncInterval.trim()) {
    git.intervalMinutes = Number(f.syncInterval.trim() || "0");
  }
  if (Object.keys(git).length > 0) patch.gitSync = git;
  // Write-only: an empty field means "leave the stored token alone", never
  // "clear it" — clearing is its own explicit button.
  if (f.syncToken !== "") patch.gitToken = f.syncToken;
  if (f.syncUser.trim() !== initial.syncUser.trim()) {
    patch.gitUser = f.syncUser.trim() === "" ? null : f.syncUser.trim();
  }
  // ── Typography ───────────────────────────────────────────────────────────
  // All four slots travel together: the server needs the whole set to know
  // which families to have on disk before it writes the file.
  if (FONT_KEYS.some((key) => f[key] !== initial[key])) {
    const adjust = f.fontSizeAdjust.trim();
    patch.fonts = {
      prose: f.fontProse,
      ui: f.fontUi,
      mono: f.fontMono,
      arabic: f.fontArabic,
      // Empty = "no override": the catalog's measured value comes back, and an
      // uploaded face goes back to none. null is how the server spells that.
      arabicSizeAdjust: adjust === "" ? null : Number(adjust),
    };
  }
  // ── Localization ─────────────────────────────────────────────────────────
  if (f.dateCalendar !== initial.dateCalendar) {
    patch.dateCalendar = f.dateCalendar === "hijri" || f.dateCalendar === "both" ? f.dateCalendar : null;
  }
  if (f.textDirection !== initial.textDirection) {
    patch.textDirection = f.textDirection === "ltr" || f.textDirection === "rtl" ? f.textDirection : null;
  }
  if (f.textAlign !== initial.textAlign) {
    patch.textAlign =
      f.textAlign === "left" || f.textAlign === "right" || f.textAlign === "center" || f.textAlign === "justify"
        ? f.textAlign
        : null;
  }
  if (f.tagsFolder.trim() !== initial.tagsFolder.trim()) {
    patch.tagsFolder = f.tagsFolder.trim() === "" ? null : f.tagsFolder.trim();
  }
  // The map travels WHOLE, never merged — the editor holds all of it on
  // screen, so a merging PATCH would make deleting a row impossible.
  const nextLabels = labelMap(f.tagLabels);
  if (JSON.stringify(nextLabels) !== JSON.stringify(labelMap(initial.tagLabels))) {
    patch.tagLabels = Object.keys(nextLabels).length > 0 ? nextLabels : null;
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Image picker overlay — the banner picker's upload/pick surfaces, reusable
// against any settings field (favicon, logo, home banner). Same s-bmodal
// styling family as BannerModal.
// ---------------------------------------------------------------------------

function ImagePicker({
  title,
  onPick,
  onClose,
}: {
  title: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [attachments, setAttachments] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let disposed = false;
    listAttachments(true)
      .then((list) => {
        if (!disposed) setAttachments(list);
      })
      .catch(() => {
        if (!disposed) setAttachments([]);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const upload = useCallback(
    (file: File) => {
      if (busy) return;
      setBusy(true);
      uploadAttachment(file, true)
        .then((res) => {
          setBusy(false);
          onPick(res.path);
        })
        .catch((err: unknown) => {
          setBusy(false);
          console.error("vellum: upload failed", err);
          toast(err instanceof Error ? err.message : t("uploadFailed"));
        });
    },
    [busy, onPick],
  );

  const filtered = (attachments ?? []).filter((p) =>
    p.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="s-palette-overlay s-smodal-picker" onMouseDown={onClose}>
      <div
        className="s-bmodal"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-bmodal__head">
          <span className="s-bmodal__title">{title}</span>
          <button type="button" className="s-bmodal__close" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        </div>

        <div
          className={`s-bmodal__drop${dragOver ? " s-bmodal__drop--over" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) upload(file);
          }}
        >
          {t(busy ? "working" : "dropImage")}
          <span className="s-bmodal__drophint">{tf("dropHint", { max: localeNum(UPLOAD_MAX_MB) })}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </div>

        <div className="s-bmodal__pick">
          <input
            className="s-bmodal__input"
            type="text"
            placeholder={t("searchAttachments")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            spellCheck={false}
          />
          <div className="s-bmodal__list">
            {attachments === null && <div className="s-bmodal__empty">{t("loading")}</div>}
            {attachments !== null && filtered.length === 0 && (
              <div className="s-bmodal__empty">
                {t(attachments.length === 0 ? "noAttachments" : "noMatchesDot")}
              </div>
            )}
            {filtered.slice(0, 200).map((p) => (
              <button
                key={p}
                type="button"
                className="s-bmodal__item"
                onClick={() => onPick(p)}
                disabled={busy}
              >
                <img className="s-bmodal__thumb" src={bannerSrc(p)} alt="" loading="lazy" />
                <span className="s-bmodal__itempath" dir="ltr">
                  {p}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row scaffolding
// ---------------------------------------------------------------------------

function Row({
  label,
  hint,
  error,
  wide,
  off,
  inherited,
  env,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** The control is the widest, most typographic thing in the panel (the type
   *  specimen) — it spans both columns with the label above it, instead of
   *  being squeezed into the control column beside the word "Preview". */
  wide?: boolean;
  /** The row is inert because a master switch above it is off. */
  off?: boolean;
  /** The field is EMPTY and therefore inheriting the env default. Greyed
   *  placeholder text alone made that indistinguishable from a field holding
   *  a muted value, which is why the convention needed a note to explain it. */
  inherited?: boolean;
  /** The environment variable this row falls back to. "inherit (en)" was
   *  honest about precedence and opaque about its source: a first-time owner
   *  had no way to learn that the value came from SITE_LANG, or where to
   *  change it. Rendered only while the row is actually inheriting — a row
   *  holding its own value has no fallback worth naming. */
  env?: string;
  children: ReactNode;
}) {
  const cls = [
    "s-smodal__row",
    wide ? "s-smodal__row--wide" : "",
    off ? "s-smodal__row--off" : "",
    error ? "s-smodal__row--invalid" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <div className="s-smodal__label">
        <span className="s-smodal__labeltext">
          {label}
          {inherited && <span className="s-smodal__badge">{t("inheritedBadge")}</span>}
        </span>
        {hint && <span className="s-smodal__hint">{hint}</span>}
      </div>
      <div className="s-smodal__control">
        {children}
        {inherited && env && <EnvSource env={env} />}
        {error && <span className="s-smodal__error">{error}</span>}
      </div>
    </div>
  );
}

/** A theme's human label, falling back to the product default for an unset or
 *  unrecognised value. The picker, this panel and the palette all read the
 *  same table (`THEME_LABELS`); the raw id stays the stored value. */
function themeLabel(id: string | null): string {
  if (id && isCustomThemeId(id)) return choiceLabel(id);
  return t(THEME_LABELS[isTheme(id ?? "") ? (id as Theme) : THEMES[0]].name);
}

/** A NOTE THAT ONLY REPEATS ITS LABEL IS NOISE.
 *
 *  Each theme row carries the raw id as a muted note, because the id is what
 *  `DEFAULT_THEME` takes in a .env and what `settings.defaultTheme` stores —
 *  worth showing. In ARABIC it earns that place twice over: the label is an
 *  Arabic name and the note is the Latin id, two different strings. In English
 *  it produced Iron gall / iron-gall, Cinnabar / cinnabar, Sumi / sumi, Void /
 *  void, Basalt / basalt, Nocturne / nocturne, Lapis / lapis, Verdigris /
 *  verdigris — eight rows of the same word printed twice, ~230px apart at the
 *  far edge of the row. So the note is dropped exactly when it is derivable
 *  from the label it sits beside, which is a property of the pair rather than
 *  of the language: a theme whose English name is not its id keeps it. */
function noteIsDerivable(label: string, id: string): boolean {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") === id
  );
}

/** The theme rows the default-theme picker offers: an "inherit" row naming
 *  the value in force, then the fifteen themes grouped dark/light. The human
 *  label is the option's text and the raw id is its muted note (see above). */
function themeChoices(effective: string | null): SelectGroup[] {
  return [
    {
      id: "inherit",
      label: "",
      options: [{ value: "", label: tf("inheritOption", { value: themeLabel(effective) }) }],
    },
    ...THEME_GROUPS.map((group) => ({
      id: group.group,
      label: t(group.group === "dark" ? "themeGroupDark" : "themeGroupLight"),
      options: group.themes.map((theme) => {
        const label = t(THEME_LABELS[theme].name);
        return {
          value: theme,
          label,
          note: noteIsDerivable(label, theme) ? undefined : theme,
        };
      }),
    })),
    // A custom theme is selectable everywhere a built-in is, and this row —
    // the theme a visitor with no stored choice gets — is the one that makes
    // that promise mean something on the PUBLIC site. The group is omitted
    // entirely when the instance has none, rather than standing empty.
    ...(getCustomThemes().length > 0
      ? [
          {
            id: "custom",
            label: t("themeGroupCustom"),
            options: getCustomThemes().map((theme) => ({
              value: customThemeChoice(theme.id),
              label: theme.name,
              // The note is the value DEFAULT_THEME takes, which for a custom
              // theme is never derivable from its name.
              note: customThemeChoice(theme.id),
            })),
          },
        ]
      : []),
  ];
}

/** "inherited from SITE_LANG" — the env NAME is a literal to be typed into a
 *  shell or a .env file, so it gets the mono face and its own <bdi> isolate
 *  rather than being interpolated into one text run (which is what tf() would
 *  do; correct for direction, but it cannot style half a string). */
function EnvSource({ env }: { env: string }) {
  const [before, after = ""] = t("inheritedFromEnv").split("{env}");
  return (
    <span className="s-smodal__from">
      {before}
      <bdi className="s-smodal__envname">{env}</bdi>
      {after}
    </span>
  );
}

/** Image-valued field: preview chip + pick/clear. An invalid value or an
 *  unloadable image shows a designed ⌀ placeholder chip, never the browser's
 *  raw broken-image glyph. */
function ImageField({
  value,
  placeholder,
  invalid,
  disabled,
  onChange,
  onOpenPicker,
}: {
  value: string;
  placeholder: string;
  invalid?: boolean;
  /** The row is inert (a switch above it is off). The field AND both of its
   *  buttons go with it — a live "Pick…" beside a dimmed field is the same
   *  invisible-state bug the dimming is there to prevent. */
  disabled?: boolean;
  onChange: (v: string) => void;
  onOpenPicker: () => void;
}) {
  const trimmed = value.trim();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [trimmed]);
  const isImage = trimmed !== "";
  // The field's thumbnail answers "did what I typed find a file?", so it has
  // to resolve the value the way the SITE will: bare filenames included
  // (client/banner.ts). It used to preview /api/file?path=<whatever was
  // typed>, which showed the ⌀ for a value the public page would have
  // rendered perfectly — and vice versa.
  const { src, pending, missing } = useBannerSrc(trimmed);
  const showImg = isImage && !invalid && !broken && src !== null;
  return (
    <div className="s-smodal__imgfield">
      {showImg && (
        <img
          className="s-smodal__imgthumb"
          src={src ?? ""}
          alt=""
          onError={() => setBroken(true)}
        />
      )}
      {isImage && !invalid && pending && (
        <span className="s-smodal__imgthumb s-smodal__imgthumb--pending" aria-hidden="true" />
      )}
      {isImage && !showImg && !pending && (
        <span
          className="s-smodal__imgthumb s-smodal__imgthumb--missing"
          title={missing || broken ? tf("bannerMissingTitle", { value: trimmed }) : undefined}
          aria-hidden="true"
        >
          ⌀
        </span>
      )}
      <TextInput
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        invalid={invalid}
        disabled={disabled}
        label={placeholder}
        dir="ltr"
      />
      <button type="button" className="s-btn" disabled={disabled} onClick={onOpenPicker}>
        {t("pick")}
      </button>
      {isImage && (
        <button type="button" className="s-btn" disabled={disabled} onClick={() => onChange("")} aria-label={t("clear")}>
          ×
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backup & sync — the live half of the section: repo state, last result, and
// the two actions (initialize / sync now). The settings ROWS above it are
// ordinary form rows; this block is the mirror the reader checks afterwards.
// ---------------------------------------------------------------------------

/** The remote as a reader can TELL APART: host plus path, credentials-free.
 *  "github.com" alone names the host two different vaults share; the full URL
 *  is five rows above in this same panel, so nothing is revealed by echoing
 *  its identifying half here. Falls back to whatever the server reports. */
function remoteLabel(remote: string): string | null {
  const value = remote.trim();
  if (value === "") return null;
  const scp = /^[^@\s]+@([^:\s]+):(.+)$/.exec(value);
  if (scp) return `${scp[1]}/${scp[2].replace(/^\/+/, "")}`;
  try {
    const url = new URL(value);
    // hostname + pathname only: URL parsing leaves userinfo behind by
    // construction, so a pasted credential can never ride along.
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Live repo state: what the vault's repository IS right now. The two actions
 *  used to live inside this box under a label reading "Status", which made
 *  section-level verbs read as the value of a field; they are their own row
 *  now (SyncActions). */
function SyncStatusBlock({
  authMode,
  remote,
  stale,
}: {
  authMode: string;
  remote: string;
  stale: boolean;
}) {
  const locale = useStore((s) => s.blogLocale);
  const [, bump] = useState(0);

  useEffect(() => onSyncChange(() => bump((n) => n + 1)), []);
  useEffect(() => {
    void refreshSyncStatus();
    const id = window.setInterval(() => void refreshSyncStatus(), 5000);
    return () => window.clearInterval(id);
  }, []);

  const status = syncSnapshot();
  const busy = syncBusy();
  const failed = status?.last != null && !status.last.ok;
  const state = busy ? "busy" : failed ? "error" : status?.repo ? "ok" : "idle";
  const cause = syncCause(authMode, status);
  const target = remoteLabel(remote) ?? status?.remoteHost ?? t("syncNoRemote");
  const lastAt = status?.last != null ? syncWhen(status.last.at, locale) : null;

  return (
    <div className="s-smodal__sync">
      <div className="s-smodal__syncline">
        <span className={`s-syncdot s-syncdot--${state}`} aria-hidden="true" />
        <span>
          {status === null
            ? t("loading")
            : !status.repo
              ? t("syncNotRepo")
              : tf("syncOnBranch", { branch: status.branch ?? "—", host: target })}
        </span>
      </div>
      {status?.repo && (
        // Three counts, separated by a hairline rather than a "·": the Eastern
        // Arabic zero IS a dot, so a middle-dot separator beside it produced
        // the unreadable "٠٠" run. Each count is also its own isolate — one
        // interpolated "{ahead} ahead · {behind} behind" reordered under RTL
        // into two colliding numerals. ahead/behind are number | null, and
        // null is NOT zero: it means nothing here has reached the remote.
        <div className="s-smodal__syncline s-smodal__syncline--muted s-smodal__counts">
          <span>
            {status.dirty > 0 ? tf("syncTipDirty", { count: localeNum(status.dirty) }) : t("syncTipClean")}
          </span>
          {status.ahead !== null && status.behind !== null && (
            <>
              <bdi>{tf("syncAhead", { count: localeNum(status.ahead) })}</bdi>
              <bdi>{tf("syncBehind", { count: localeNum(status.behind) })}</bdi>
            </>
          )}
        </div>
      )}
      {status?.repo && (status.ahead === null || status.behind === null) && (
        <div className="s-smodal__syncline">
          <span className="s-smodal__syncwarn">{t("syncNoTracking")}</span>
        </div>
      )}
      {status?.last != null && lastAt !== null && status.last.ok && (
        <div className="s-smodal__syncline s-smodal__syncline--muted s-smodal__counts">
          {/* Two ISOLATES, not one dir="auto" span: "auto" takes its direction
              from the first strong character — the Arabic date — and then
              reorders everything after it around that. */}
          <bdi>{lastAt}</bdi>
          <bdi>
            {t(
              status.last.committed
                ? "syncPushed"
                : status.last.remoteAdvanced === true
                  ? "syncPushedOnly"
                  : "syncUpToDate",
            )}
          </bdi>
        </div>
      )}
      {status?.last != null && lastAt !== null && !status.last.ok && (
        <div className="s-smodal__syncfail">
          <div className="s-smodal__syncline s-smodal__syncline--bad s-smodal__counts">
            <bdi>{lastAt}</bdi>
            <bdi>{cause ?? t("syncFailed")}</bdi>
          </div>
          {/* git's own words, verbatim and token-scrubbed — the diagnosis, and
              the thing a reader pastes into a search box. Its OWN dir="ltr"
              block: bidi cannot reach into it from the localized line above,
              and it is selectable text rather than a tooltip. */}
          <div className="s-smodal__syncgit">
            <span className="s-smodal__syncgitlabel">{t("syncGitSaid")}</span>
            <code className="s-smodal__syncgittext" dir="ltr">
              {status.last.message}
            </code>
          </div>
        </div>
      )}
      {cause !== null && !failed && (
        <div className="s-smodal__syncline s-smodal__syncwarn">
          <span>{cause}</span>
        </div>
      )}
      {stale && (
        <div className="s-smodal__syncline s-smodal__syncline--muted">
          <span>{t("syncSaveFirst")}</span>
        </div>
      )}
    </div>
  );
}

/** Initialize / Sync now. SECTION-level verbs, so they sit in their own
 *  full-width row rather than inside a field called "Status". Both act on what
 *  the SERVER has stored, never on what the form shows — acting while the two
 *  disagree would push to the old remote and then report success — so they
 *  wait for the save, and the status block above says so.
 *
 *  "Initialize repository" LEAVES once the vault is one. A permanently greyed
 *  button holding the primary position, forever, is not a control. */
function SyncActions({ stale, disabled }: { stale: boolean; disabled: boolean }) {
  const [, bump] = useState(0);
  useEffect(() => onSyncChange(() => bump((n) => n + 1)), []);
  const status = syncSnapshot();
  const busy = syncBusy();
  const blocked = disabled || stale || busy || status === null;
  return (
    <div className={`s-smodal__actions${disabled ? " s-smodal__actions--off" : ""}`}>
      {status !== null && !status.repo && (
        <button type="button" className="s-btn" disabled={blocked} onClick={() => void runSyncInit()}>
          {t("syncInitialize")}
        </button>
      )}
      <button
        type="button"
        className="s-btn s-btn--accent"
        disabled={blocked || !status?.repo || !status.configured}
        onClick={() => void runSyncNow()}
      >
        {busy ? t("syncing") : t("syncNow")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typography — four slots over the self-hosted catalog, plus a live specimen.
// ---------------------------------------------------------------------------

/** WHAT THE SERVER REFUSED, IN THE READER'S LANGUAGE.
 *
 *  `client/api.ts` turns every failure body into an `ApiError` carrying the
 *  server's ENGLISH prose, and every call site here used to toast
 *  `err.message` — so the commonest failure of this feature (choosing the
 *  wrong file) printed "Not a recognized font file (woff2, woff, ttf, otf)"
 *  into a fully Arabic panel, and `t("fontUploadFailed")` was unreachable
 *  code. The font routes now name their failures with a stable `code`; this
 *  translates the ones worth naming and keeps the generic line for the rest.
 *
 *  Falling back to `err.message` was considered and rejected: the prose is
 *  English by construction, so showing it is the bug, not the safety net. An
 *  unnamed failure gets the generic sentence and the detail goes to the
 *  console, where it was already going. */
const FONT_ERROR_KEYS: Record<string, I18nKey> = {
  font_unrecognized: "errFontUnrecognized",
  font_damaged: "errFontDamaged",
  font_too_large: "errFontTooLarge",
  font_no_file: "errFontNoFile",
  font_bad_body: "errFontNoFile",
  font_not_found: "errFontNotFound",
  font_bad_name: "errFontBadName",
  font_no_free_name: "errFontNoFreeName",
  font_in_use: "errFontInUse",
};

function fontErrorText(err: unknown, fallback: I18nKey): string {
  const code = err instanceof ApiError ? err.code : undefined;
  const key = code ? FONT_ERROR_KEYS[code] : undefined;
  if (!key) return t(fallback);
  // The one code with a number in its sentence; the cap is a client constant
  // too, so it is not read back off the wire.
  return key === "errFontTooLarge"
    ? tf(key, { max: localeNum(FONT_UPLOAD_MAX_MB) })
    : t(key);
}

/** The uploaded-face manager: a drop zone and the list of what has been
 *  uploaded. It sits under the four pickers because it is inventory, not a
 *  choice — the choosing happens above, where "Your fonts" is one group among
 *  the catalog's.
 *
 *  Deleting is guarded twice: a face a slot still names is not offered a
 *  delete button at all (the row says which slot holds it), and the server
 *  409s the same case regardless of what the panel believes. */
function CustomFonts({
  fonts,
  usedBy,
  busy,
  onUpload,
  onDelete,
}: {
  fonts: CustomFontInfo[];
  usedBy: (id: string) => string[];
  busy: boolean;
  onUpload: (file: File) => void;
  onDelete: (font: CustomFontInfo) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Each row prints its family name IN that family, which is the only honest
  // way to show what a file called "MyFace-Regular.woff2" actually is — so the
  // list asks for its own faces, exactly as a picker group does.
  useEffect(() => loadFontFaces(fonts.map((font) => font.id)), [fonts]);
  return (
    <div className="s-smodal__fonts">
      <div
        className={`s-bmodal__drop${dragOver ? " s-bmodal__drop--over" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onUpload(file);
        }}
      >
        {t(busy ? "working" : "dropFont")}
        <span className="s-bmodal__drophint">
          {tf("dropFontHint", { max: localeNum(FONT_UPLOAD_MAX_MB) })}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>
      {fonts.length === 0 && <p className="s-smodal__note">{t("noCustomFonts")}</p>}
      {fonts.length > 0 && (
        <ul className="s-smodal__fontlist">
          {fonts.map((font) => {
            const slots = usedBy(font.id);
            return (
              <li className="s-smodal__fontrow" key={font.id}>
                {/* The name is set IN the face: the row is a specimen too. */}
                <span
                  className="s-smodal__fontname"
                  dir="ltr"
                  style={{ fontFamily: faceStack(font.id, "var(--font-ui-system)") }}
                >
                  {font.family}
                </span>
                <span className="s-smodal__fontmeta">
                  <bdi>{font.format}</bdi>
                  <bdi>{tf("fontSizeKb", { count: localeNum(Math.max(1, Math.round(font.size / 1024))) })}</bdi>
                </span>
                {slots.length > 0 ? (
                  <span className="s-smodal__fontused">{tf("fontInUse", { slots: slots.join(" · ") })}</span>
                ) : (
                  <button type="button" className="s-btn s-btn--danger" disabled={busy} onClick={() => onDelete(font)}>
                    {t("remove")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The specimen block. Each row renders in its slot's PREVIEW composite
 *  ("VellumPreviewProse" …), which /api/font-preview.css defines from the
 *  picks currently in the form — so the reader sees the faces before saving
 *  anything, including the size-adjust dial. Every family name falls back to
 *  the matching --font-*-system stack, so an unpicked (or not-yet-fetched)
 *  slot simply shows what the site shows today.
 *
 *  ONE line per slot, and it is MIXED on purpose: that single line is the
 *  whole feature — the Arabic slot answers for the Arabic letters and the
 *  slot's own face for the Latin ones and the digits, chosen per character,
 *  with no markup and no language attribute. It used to be two lines (a Latin
 *  one and a mixed one), which was a better specimen and a worse CONTROL: the
 *  block stood 305px tall inside a 609px body, and it now has to stay on
 *  screen while the pickers below it are open. A sample nobody can see beside
 *  its picker previews nothing.
 *
 *  The line keeps the PANEL's direction and holds one inline isolate per run
 *  (dir on an inline element implies unicode-bidi: isolate), so the Arabic
 *  shapes and orders right-to-left without being flung to the opposite edge
 *  of the box — the faces being compared have to begin at the same place. */
function FontSpecimens() {
  const rows: { key: I18nKey; cls: string }[] = [
    { key: "rowFontProse", cls: "s-smodal__specimen--prose" },
    { key: "rowFontUi", cls: "s-smodal__specimen--ui" },
    { key: "rowFontMono", cls: "s-smodal__specimen--mono" },
  ];
  return (
    <div className="s-smodal__specimens">
      {rows.map((row) => (
        <div key={row.key} className={`s-smodal__specimen ${row.cls}`}>
          <span className="s-smodal__speclabel">{t(row.key)}</span>
          <span className="s-smodal__specline">
            <bdi dir="ltr">{SPECIMEN_LATIN}</bdi>
            <span className="s-smodal__specgap"> · </span>
            <bdi dir="rtl">{SPECIMEN_ARABIC}</bdi>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Keep a <link> to /api/font-preview.css in sync with the four picks. The
 *  server caches a family the first time it is previewed, so the request is
 *  debounced (a select is a burst of changes) and its failures are silent —
 *  the specimen falls back to the system stack, which is a fine preview; a
 *  toast per keystroke is not. */
function useFontPreview(
  prose: string,
  ui: string,
  mono: string,
  arabic: string,
  sizeAdjust: string,
): void {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const q = new URLSearchParams();
      for (const [slot, id] of [["prose", prose], ["ui", ui], ["mono", mono], ["arabic", arabic]]) {
        if (id && id !== SYSTEM_FONT) q.set(slot, id);
      }
      // The dial travels with the picks: it changes what the specimen looks
      // like without changing a single id, and it is judged against the Latin
      // line beside it or not at all.
      if (sizeAdjust.trim() !== "" && arabic !== SYSTEM_FONT) q.set("sizeAdjust", sizeAdjust.trim());
      let link = document.head.querySelector<HTMLLinkElement>("link[data-vellum-fontpreview]");
      if ([...q.keys()].length === 0) {
        link?.remove();
        return;
      }
      if (!link) {
        link = document.createElement("link");
        link.rel = "stylesheet";
        link.setAttribute("data-vellum-fontpreview", "");
        document.head.appendChild(link);
      }
      const href = `/api/font-preview.css?${q.toString()}`;
      if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [prose, ui, mono, arabic, sizeAdjust]);
  // The preview families must not outlive the panel: the saved stylesheet is
  // what the app renders in.
  useEffect(() => () => document.head.querySelector("link[data-vellum-fontpreview]")?.remove(), []);
}

// ---------------------------------------------------------------------------
// About — what this instance IS. Everything here was previously answerable
// only from the terminal that started the server, which is the wrong place to
// ask from when you are editing the site in a browser tab.
// ---------------------------------------------------------------------------

/** The README sections this panel's own settings are documented in. Named
 *  rather than linked: the README ships in the repository, not on the running
 *  site, and a link that 404s into the SPA fallback is worse than a name a
 *  reader can search for. */
const DOC_TOPICS: { key: I18nKey; anchor: string }[] = [
  { key: "docSiteSettings", anchor: "#settings" },
  { key: "docTheming", anchor: "#theming" },
  { key: "docTypography", anchor: "#typography" },
  { key: "docArabic", anchor: "#arabic--rtl" },
  { key: "docBlogMode", anchor: "#blog-mode" },
  { key: "docComments", anchor: "#comments" },
  { key: "docSync", anchor: "#backup--sync" },
];

function AboutTab({ about }: { about: AboutInfo | null }) {
  if (about === null) return <div className="s-bmodal__empty">{t("loading")}</div>;
  const facts: { label: string; value: string; path?: boolean }[] = [
    { label: t("aboutVersion"), value: `Vellum ${about.version}` },
    { label: t("aboutRuntime"), value: `Node ${about.node}` },
    { label: t("aboutVault"), value: about.vaultPath, path: true },
    { label: t("aboutData"), value: about.dataPath, path: true },
    // Where the panel's own answers are kept. The title bar used to say
    // "— settings.json", which named the file without saying where it was;
    // this says both, beside the other absolute paths, and only to an admin
    // (GET /api/settings 404s to everyone else).
    { label: t("aboutSettingsFile"), value: about.settingsPath, path: true },
    { label: t("aboutFontsDir"), value: about.customFontsPath, path: true },
  ];
  const counts: { label: string; value: string }[] = [
    { label: t("aboutNotes"), value: localeNum(about.notes) },
    { label: t("aboutPublished"), value: localeNum(about.published) },
    { label: t("aboutAttachments"), value: localeNum(about.attachments) },
    { label: t("aboutTags"), value: localeNum(about.tags) },
  ];
  return (
    <section data-section="about">
      <dl className="s-about">
        {facts.map((f) => (
          <div className="s-about__row" key={f.label}>
            <dt className="s-about__key">{f.label}</dt>
            {/* Absolute paths are LTR machine strings; in an Arabic panel they
                keep their own direction and their own start edge, or a
                "/home/…" reorders around its slashes. */}
            <dd className={`s-about__val${f.path ? " s-about__val--path" : ""}`} dir="ltr">
              {f.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="s-smodal__note">{t("aboutSettingsNote")}</p>

      <div className="s-smodal__sub">{t("aboutContents")}</div>
      <div className="s-about__counts">
        {counts.map((c) => (
          <div className="s-about__count" key={c.label}>
            <span className="s-about__countnum">{c.value}</span>
            <span className="s-about__countlabel">{c.label}</span>
          </div>
        ))}
      </div>

      <div className="s-smodal__sub">{t("aboutDocs")}</div>
      <p className="s-smodal__note">{t("aboutDocsNote")}</p>
      <ul className="s-about__docs">
        {DOC_TOPICS.map((d) => (
          <li key={d.anchor} className="s-about__doc">
            <span className="s-about__docname">{t(d.key)}</span>
            <code className="s-about__docanchor" dir="ltr">
              README.md{d.anchor}
            </code>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/** The tabs. The rail used to scroll a single ~2,700px document, which made it
 *  a table of contents for a form nobody could see the end of; six TABS make
 *  each one a short read — most of them fit without scrolling at all — and the
 *  rail becomes navigation rather than a bookmark. Each tab opens with one
 *  sentence saying what it decides, because "Language" and "Publishing" are
 *  category names, not explanations. Order is the order an operator meets
 *  them: what the site is, how it looks, what language it speaks, what it
 *  publishes, what it is set in, how it is backed up, and what it is. */
interface Tab {
  id: string;
  key: I18nKey;
  /** One-sentence intro under the tab's heading. */
  intro: I18nKey;
}

const TABS: Tab[] = [
  { id: "identity", key: "tabIdentity", intro: "introIdentity" },
  // Appearance did not earn its own tab. It carried THREE controls inside a
  // panel fixed at 740px — measured body 609/609, so ~500px of dead space —
  // while "Public layout" was a publishing decision filed under looks. The
  // fixed height is right (a rail that moves under the pointer opens a tab
  // nobody chose); the tab COUNT was what needed trimming. So the two theme
  // rows join the language ones — both answer "what does this instance look
  // and sound like to a reader" — and Public layout goes where it belongs.
  { id: "language", key: "tabAppearance", intro: "introAppearance" },
  { id: "publishing", key: "tabPublishing", intro: "introPublishing" },
  { id: "typography", key: "groupTypography", intro: "typographyNote" },
  { id: "sync", key: "groupSync", intro: "syncNote" },
  { id: "about", key: "tabAbout", intro: "introAbout" },
];

/** Automatic-sync periods. A closed set of sentences beats a free number with
 *  a decoder hint under it ("minutes; 0 = manual only"); a stored value from
 *  outside the set (hand-edited settings.json) is added rather than lost. */
const SYNC_INTERVALS = [0, 15, 30, 60, 180, 360, 720, 1440];

function intervalLabel(minutes: number): string {
  if (minutes === 0) return t("syncIntervalManual");
  if (minutes < 60) return tf("syncIntervalMinutes", { count: localeNum(minutes) });
  if (minutes === 60) return t("syncIntervalHourly");
  if (minutes === 1440) return t("syncIntervalDaily");
  if (minutes % 60 === 0) return tf("syncIntervalHours", { count: localeNum(minutes / 60) });
  return tf("syncIntervalMinutes", { count: localeNum(minutes) });
}

export default function SettingsModal() {
  const setOpen = useStore((s) => s.setSettingsOpen);
  useStore((s) => s.language); // re-render the chrome strings on language change
  /** The reader's OWN theme (Appearance tab) — a live subscription, so a pick
   *  made in the picker on top of this panel updates the row underneath it. */
  const theme = useStore((s) => s.theme);
  /** The notes sidebar's edge, same shape as the theme row above it: a DEVICE
   *  preference, not a site setting, so it saves itself on click and never
   *  travels with the Save button. Both halves are read — the three-state
   *  preference drives the control, the resolved edge names what "Auto" is
   *  doing right now — because "Auto" that does not say which edge it landed
   *  on is the invisible state this control exists to end. */
  const sidebarSidePref = useStore((s) => s.sidebarSidePref);
  /** The edge *Auto* would resolve to — `defaultSide(language)`, NOT the store's
   *  `sidebarSide`. The resolved side already has any pin folded into it, so on
   *  an Arabic instance with the pane pinned left it reads "left" while picking
   *  Auto would move the pane right: the note would be describing the pin
   *  instead of the option it sits under. */
  const autoSide = useStore((s) => defaultSide(s.language));
  const setSidebarSidePref = useStore((s) => s.setSidebarSidePref);
  const close = useCallback(() => setOpen(false), [setOpen]);

  const [loaded, setLoaded] = useState<SettingsResponse | null>(null);
  const [initial, setInitial] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"favicon" | "logo" | "homeBanner" | null>(null);
  /** The operator's uploaded faces. Its own request rather than a field on
   *  the settings payload: it changes on upload and delete, several times per
   *  visit to the Typography tab, while the settings payload does not. */
  const [customFonts, setCustomFonts] = useState<CustomFontInfo[]>([]);
  const [fontBusy, setFontBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState(TABS[0].id);
  /** THE BODY'S SCROLL EDGES ARE A MASK, NOT AN OVERLAY.
   *
   *  Two absolutely-positioned gradient `<span>`s used to sit over the top and
   *  bottom of the scroller, painting `--bg-raised` to transparent. A gradient
   *  laid over content only hides what it exactly matches, and it did not: at
   *  the top edge a segmented pill came through cut across its middle with its
   *  accent border flat-cut, which reads as a rendering fault rather than as
   *  "there is more above" — the same slice again at the foot against the
   *  footer rule. `.s-scrollfade` masks the element's own alpha instead, so
   *  the row genuinely dissolves; and being a mask it cannot disagree with the
   *  ground it is drawn on. `attachScrollFade` keeps it honest through
   *  scrolling, resizing, tab changes and rows appearing (the size-adjust row
   *  comes and goes), which the old handler needed three dependencies to do. */
  useEffect(() => attachScrollFade(bodyRef.current), []);

  /** A new tab starts at ITS top — carrying the previous tab's scroll offset
   *  into a shorter tab lands the reader in the middle of it (or past its
   *  end), which reads as a broken panel. */
  const goToTab = useCallback((id: string) => {
    setTab(id);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, []);

  /** ↑/↓ walk the rail, the way a tab list is expected to behave; the arrow
   *  keys never leave the rail, and Home/End jump to its ends. */
  const onRailKey = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      const keys: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
      const delta = keys[e.key];
      const at = TABS.findIndex((s) => s.id === tab);
      let next = -1;
      if (delta !== undefined) next = Math.max(0, Math.min(TABS.length - 1, at + delta));
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = TABS.length - 1;
      if (next < 0 || next === at) return;
      e.preventDefault();
      goToTab(TABS[next].id);
      railRef.current?.querySelectorAll("button")[next]?.focus();
    },
    [goToTab, tab],
  );

  useEffect(() => {
    let disposed = false;
    getSettings()
      .then((s) => {
        if (disposed) return;
        const f = formFrom(s);
        setLoaded(s);
        setInitial(f);
        setForm(f);
      })
      .catch((err: unknown) => {
        console.error("vellum: loading settings failed", err);
        if (!disposed) setLoadError(err instanceof Error ? err.message : t("settingsLoadFailed"));
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Esc closes — the picker first when it is open (capture phase, so the
  // editor never sees it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // The theme picker is mounted on <body>, so its own capture listener was
      // registered LATER than this one and runs SECOND: without this line, Esc
      // in the picker closed the settings panel underneath it (and the picker
      // with it) instead of reverting the previewed theme.
      if (isThemePickerOpen()) return;
      // Same precedence, one level closer: an open select popover is a
      // transient surface INSIDE this panel, and its Esc means "put the value
      // back", not "close the settings". Its own listener is registered later
      // than this capture-phase one and would otherwise never run.
      if (isSelectOpen()) return;
      e.stopPropagation();
      setPicker((p) => {
        if (p !== null) return null;
        close();
        return null;
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  useFontPreview(
    form?.fontProse ?? SYSTEM_FONT,
    form?.fontUi ?? SYSTEM_FONT,
    form?.fontMono ?? SYSTEM_FONT,
    form?.fontArabic ?? SYSTEM_FONT,
    form?.fontSizeAdjust ?? "",
  );

  const reloadCustomFonts = useCallback(() => {
    listCustomFonts()
      .then(setCustomFonts)
      // A vault with no uploads answers [], so a failure here is a real one —
      // and still not worth a toast on open: the section renders empty and
      // the upload path reports its own errors.
      .catch((err: unknown) => console.error("vellum: listing uploaded fonts failed", err));
  }, []);

  useEffect(() => reloadCustomFonts(), [reloadCustomFonts]);

  /** The preview faces are a menu's worth of families; they must not outlive
   *  the panel that draws the menu. */
  useEffect(() => () => clearFontFaces(), []);

  const uploadCustomFont = useCallback(
    (file: File) => {
      if (fontBusy) return;
      setFontBusy(true);
      uploadFont(file)
        .then((font) => {
          reloadCustomFonts();
          toast(tf("fontAdded", { name: font.family }));
        })
        .catch((err: unknown) => {
          console.error("vellum: font upload failed", err);
          toast(fontErrorText(err, "fontUploadFailed"), "error");
        })
        .finally(() => setFontBusy(false));
    },
    [fontBusy, reloadCustomFonts],
  );

  const removeCustomFont = useCallback(
    (font: CustomFontInfo) => {
      void (async () => {
        const ok = await confirmModal({
          title: tf("fontDeleteTitle", { name: font.family }),
          body: t("fontDeleteBody"),
          confirmLabel: t("remove"),
        });
        if (!ok) return;
        setFontBusy(true);
        try {
          await deleteCustomFont(font.file);
          reloadCustomFonts();
          toast(t("fontRemoved"));
        } catch (err) {
          console.error("vellum: font delete failed", err);
          toast(fontErrorText(err, "fontRemoveFailed"), "error");
        } finally {
          setFontBusy(false);
        }
      })();
    },
    [reloadCustomFonts],
  );

  const errors = useMemo(() => (form ? validate(form) : {}), [form]);
  const patch = useMemo(
    () => (form && initial ? buildPatch(initial, form) : {}),
    [form, initial],
  );
  const dirty = Object.keys(patch).length > 0;
  const valid = Object.keys(errors).length === 0;

  /** One helper for every control in the panel, because every control in the
   *  panel now speaks the same language: a string in, a string out. (The old
   *  one spread a native ChangeEvent handler, which is what tied these rows to
   *  <select> and <input> in the first place.) */
  const field = <K extends keyof Form>(key: K) => ({
    value: form ? form[key] : "",
    onChange: (value: string) => setForm((f) => (f ? { ...f, [key]: value } : f)),
  });

  /** A three-way row: inherit the env default, or force on / off. The middle
   *  state is the ROW BEING EMPTY, which is why it is a segment rather than a
   *  checkbox — a checkbox cannot be "not set". */
  const onOffSegments = (envValue: boolean): Segment[] => [
    { value: "", label: t("inheritSegment"), note: envValue ? t("on") : t("off") },
    { value: "on", label: t("on") },
    { value: "off", label: t("off") },
  ];

  const save = useCallback(() => {
    if (!form || !initial || saving) return;
    const body = buildPatch(initial, form);
    if (Object.keys(body).length === 0) return;
    setSaving(true);
    patchSettings(body)
      .then(async (s) => {
        const f = formFrom(s);
        setLoaded(s);
        setInitial(f);
        setForm(f);
        // The template commands cache the folder and the default template
        // (they open on a keystroke and must not wait on a round trip); this
        // save may have just moved either one.
        refreshTemplateSettings();
        // Everything the shell renders from /api/me follows live: wordmark,
        // logo, layout, theme default, favicon link.
        await useStore.getState().loadMe();
        toast(t("settingsSaved"));
      })
      .catch((err: unknown) => {
        console.error("vellum: saving settings failed", err);
        // A typography save is the one that can fail on the NETWORK (the
        // faces are fetched before the file is written), so its fallback
        // message says so — and settings.json is untouched either way.
        toast(err instanceof Error ? err.message : t(body.fonts ? "fontsFetchFailed" : "settingsSaveFailed"));
      })
      .finally(() => setSaving(false));
  }, [form, initial, saving]);

  /** Clearing a credential is not a form edit: it takes effect at once, on its
   *  own, so a reader who wants the token off the disk never has to find the
   *  Save button afterwards. */
  const clearToken = useCallback(() => {
    if (saving) return;
    setSaving(true);
    patchSettings({ gitToken: null })
      .then((s) => {
        const f = formFrom(s);
        setLoaded(s);
        setInitial(f);
        // Unsaved edits elsewhere in the panel survive; only the token field
        // resets (there is nothing left to replace).
        setForm((prev) => (prev ? { ...prev, syncToken: "" } : f));
        toast(t("tokenCleared"));
      })
      .catch((err: unknown) => {
        console.error("vellum: clearing the git token failed", err);
        toast(err instanceof Error ? err.message : t("settingsSaveFailed"));
      })
      .finally(() => setSaving(false));
  }, [saving]);

  const eff = loaded?.effective;
  /** The master switch is off: every control below it in Backup & sync is
   *  inert, and says so. */
  const syncOff = form?.syncEnabled !== "on";
  /** settings.home.mode and the home banner are read by the BLOG shell only —
   *  server/auth.ts sends `me.home` inside `if (publicLayout() === "blog")`,
   *  and BlogDashboard mounts from BlogShell. PUBLIC_LAYOUT defaults to "app",
   *  where both were offered live, with no note and no disabled state: an
   *  operator picked Dashboard, uploaded a hero, got a success toast, and the
   *  site did not change. Read from the FORM (like syncOff) so switching
   *  Public layout to blog lights them up in the same breath, before the save.
   *  The Home NOTE row between them stays live on purpose — the app shell
   *  opens it at boot. */
  // The home rows are live in BOTH public shells: a designed site has a home
  // page too, and it is composed from the same settings the blog's is.
  const homeLayout = form?.publicLayout || eff?.publicLayout;
  const homeOff = homeLayout !== "blog" && homeLayout !== "designed";
  /** The sync fields hold unsaved edits, so the two actions must wait for the
   *  save rather than act on a remote the form no longer shows. */
  const syncStale =
    patch.gitSync !== undefined || patch.gitToken !== undefined || patch.gitUser !== undefined;
  /** A value hand-written into settings.json outside the offered set still
   *  gets an option, so opening the panel can never silently change it. */
  const intervalChoices = useMemo(() => {
    const stored = Number(form?.syncInterval ?? "0");
    const all = Number.isInteger(stored) && stored >= 0 && !SYNC_INTERVALS.includes(stored)
      ? [...SYNC_INTERVALS, stored]
      : SYNC_INTERVALS;
    return [...all].sort((a, b) => a - b);
  }, [form?.syncInterval]);

  return (
    // The palette's overlay drops its panel at 18vh, which is right for a
    // 400px-tall list and wrong for a panel that wants the whole height.
    <div className="s-palette-overlay s-smodal-overlay" onMouseDown={close}>
      <div
        className="s-bmodal s-smodal"
        role="dialog"
        aria-label={t("siteSettings")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-bmodal__head">
          {/* The panel's own name, and nothing else. It used to read
              "Site settings — settings.json", which named an implementation
              file in the title bar of a settings screen: it told a reader
              what the product writes rather than what the panel does, and it
              named a path without saying where that path is. Where the file
              lives is a FACT about the instance, so it moved to About, beside
              the vault and data directories. */}
          <span className="s-bmodal__title">{t("siteSettings")}</span>
          <button type="button" className="s-bmodal__close" onClick={close} aria-label={t("close")}>
            ×
          </button>
        </div>

        {loadError && <div className="s-bmodal__empty">{loadError}</div>}
        {!loadError && (!form || !eff) && <div className="s-bmodal__empty">{t("loading")}</div>}

        {form && eff && (
          <div className="s-smodal__cols">
            {/* Six tabs, not six anchors: the rail switches what the panel
                is showing, and it is sticky so the whole map stays on screen
                while a tab scrolls. */}
            <nav
              className="s-smodal__rail"
              ref={railRef}
              role="tablist"
              aria-orientation="vertical"
              aria-label={t("settingsSections")}
              onKeyDown={onRailKey}
            >
              {TABS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  id={`s-smodal-tab-${s.id}`}
                  aria-selected={tab === s.id}
                  aria-controls={`s-smodal-panel-${s.id}`}
                  tabIndex={tab === s.id ? 0 : -1}
                  className={`s-smodal__railbtn${tab === s.id ? " s-smodal__railbtn--on" : ""}`}
                  onClick={() => goToTab(s.id)}
                >
                  {t(s.key)}
                </button>
              ))}
            </nav>

            <div className="s-smodal__scroll">
              <div
                // data-popbounds: every Select in this panel clamps its
                // popover to THIS box rather than to the dialog, so a long
                // list can no longer run over the footer divider and the
                // Close / Save row (Select.tsx `measure`).
                className="s-smodal__body s-scrollfade"
                data-popbounds
                ref={bodyRef}
                role="tabpanel"
                id={`s-smodal-panel-${tab}`}
                aria-labelledby={`s-smodal-tab-${tab}`}
              >
                {/* Every tab opens the same way: its name, then one sentence
                    saying what it decides. */}
                <div className="s-smodal__group">{t(TABS.find((s) => s.id === tab)?.key ?? "tabIdentity")}</div>
                <p className="s-smodal__note">{t(TABS.find((s) => s.id === tab)?.intro ?? "introIdentity")}</p>

                {tab === "identity" && (
                <section data-section="identity">
                  <p className="s-smodal__note s-smodal__note--inherit">{t("settingsNote")}</p>
                  <Row
                    label={t("rowSiteName")}
                    error={errors.siteName}
                    inherited={form.siteName.trim() === ""}
                    env="SITE_NAME"
                  >
                    <TextInput
                      placeholder={eff.siteName}
                      maxLength={81}
                      label={t("rowSiteName")}
                      invalid={errors.siteName !== undefined}
                      {...field("siteName")}
                    />
                  </Row>
                  <Row
                    label={t("rowTagline")}
                    hint={t("hintTagline")}
                    error={errors.tagline}
                    inherited={form.tagline.trim() === ""}
                    env="SITE_TAGLINE"
                  >
                    <TextInput
                      placeholder={eff.tagline ?? "Notes from the canopy…"}
                      maxLength={161}
                      label={t("rowTagline")}
                      invalid={errors.tagline !== undefined}
                      {...field("tagline")}
                    />
                  </Row>
                  <Row
                    label={t("rowFooter")}
                    hint={t("hintFooter")}
                    error={errors.footer}
                    inherited={form.footer.trim() === ""}
                    env="SITE_FOOTER"
                  >
                    {/* THE ONE FIELD WHOSE CONTENT IS A TEMPLATE.
                        `© {year} {siteName}` is machine syntax, and in an
                        Arabic panel an RTL field laid it out as
                        `{siteName} {year} ©` — measured, tokens at x 538 /
                        628 / 679 — so the operator was shown one token order
                        and had to type another. A field cannot be pinned
                        `ltr` either: this is also the site's footer PROSE, and
                        this owner writes it in Arabic. `auto` is the honest
                        answer — the first strong character decides, so the
                        default template renders exactly as it must be typed
                        and an Arabic footer stays Arabic. Alignment does not
                        follow it (controls.css): the field is flushed to the
                        panel's start edge either way, like every row above. */}
                    <TextInput
                      placeholder={eff.footer ?? "© {year} {siteName}"}
                      maxLength={201}
                      dir="auto"
                      label={t("rowFooter")}
                      invalid={errors.footer !== undefined}
                      {...field("footer")}
                    />
                  </Row>
                  <Row
                    label={t("rowLogo")}
                    hint={t("hintLogo")}
                    error={errors.logo}
                    inherited={form.logo.trim() === ""}
                  >
                    <ImageField
                      value={form.logo}
                      placeholder={t("phVaultImageOrUrl")}
                      invalid={errors.logo !== undefined}
                      onChange={(v) => setForm((f) => (f ? { ...f, logo: v } : f))}
                      onOpenPicker={() => setPicker("logo")}
                    />
                  </Row>
                  <Row
                    label={t("rowFavicon")}
                    hint={t("hintFavicon")}
                    error={errors.favicon}
                    inherited={form.favicon.trim() === ""}
                  >
                    <ImageField
                      value={form.favicon}
                      placeholder={t("phVaultIcon")}
                      invalid={errors.favicon !== undefined}
                      onChange={(v) => setForm((f) => (f ? { ...f, favicon: v } : f))}
                      onOpenPicker={() => setPicker("favicon")}
                    />
                  </Row>
                </section>
                )}

                {tab === "language" && (
                <section data-section="language">
                  <div className="s-smodal__sub">{t("groupTheme")}</div>
                  <Row
                    label={t("rowDefaultTheme")}
                    hint={t("hintDefaultTheme")}
                    inherited={form.defaultTheme === ""}
                    env="DEFAULT_THEME"
                  >
                    {/* Grouped, because fifteen names in one flat list is the
                        same "which of these is dark?" guess the picker exists
                        to end. The GROUP names and the theme labels are both
                        chrome copy — an Arabic reader met "verdigris" and
                        "porphyry" in Latin script here — while the raw id
                        stays the option's VALUE and its muted note, because
                        that is what settings.defaultTheme and DEFAULT_THEME
                        take and what a reader has to type into a .env. */}
                    <Select
                      label={t("rowDefaultTheme")}
                      groups={themeChoices(eff.defaultTheme)}
                      {...field("defaultTheme")}
                    />
                  </Row>
                  {/* The reader's OWN theme, which is a different thing from
                      the row above it and was previously findable only by
                      clicking a status-bar word until the room changed color.
                      The picker previews live and reverts on Esc.

                      TWO ROWS THAT ANSWER THE SAME QUESTION WEAR THE SAME
                      FACE. This one used to be a 58px swatch and a "Browse
                      themes…" text link flung to opposite ends of the control
                      column with ~280px of nothing between them, one row under
                      a full-width Select that chooses a theme — the least
                      finished-looking row in the panel, in both languages. It
                      is ONE trigger now, built on `.s-ctl-select` like the row
                      above it: same measure, same border, same chevron. What
                      it opens is a browsing panel rather than a list, and that
                      is the honest difference — fifteen rooms are chosen by
                      looking at them, which is why the trigger carries the
                      miniature the picker itself draws. */}
                  <Row label={t("rowYourTheme")} hint={t("hintYourTheme")}>
                    <button
                      type="button"
                      className="s-ctl s-ctl-select s-smodal__themebtn"
                      aria-haspopup="dialog"
                      aria-label={t("rowYourTheme")}
                      onClick={openThemePicker}
                    >
                      {/* The SAME miniature the picker draws, so the row and
                          the panel it opens are visibly the same object. */}
                      {/* The swatch tokens are keyed on the fifteen built-in
                          ids and are CONSTANT by design, so a custom theme
                          shows the room it was built on — under its OWN name,
                          below. */}
                      <span className="s-tpick__card" data-theme-swatch={choiceBase(theme)} aria-hidden="true">
                        <span className="s-tpick__card-rule" />
                        <span className="s-tpick__card-line" />
                        <span className="s-tpick__card-foot">
                          <span className="s-tpick__card-chip" />
                          <span className="s-tpick__card-line s-tpick__card-line--short" />
                        </span>
                      </span>
                      <bdi className="s-ctl-select__value s-smodal__themename">
                        {choiceLabel(theme)}
                      </bdi>
                      <span className="s-ctl-select__note">{t("browseThemes")}</span>
                      <svg className="s-ctl-select__chev" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <path
                          d="M4 6.5 L8 10.5 L12 6.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </Row>
                
                  <div className="s-smodal__sub">{t("groupLanguage")}</div>
                  <Row
                    label={t("rowLanguage")}
                    hint={t("hintLanguage")}
                    inherited={form.language === ""}
                    env="SITE_LANG"
                  >
                    {/* Language names stay in their own script — that is how
                        a language picker reads to the person who needs it. */}
                    <SegmentedControl
                      label={t("rowLanguage")}
                      segments={[
                        { value: "", label: t("inheritSegment"), note: eff.language },
                        { value: "en", label: "English" },
                        { value: "ar", label: "العربية" },
                      ]}
                      {...field("language")}
                    />
                  </Row>
                  {/* Directly under Language, because it is the ROW ABOVE
                      that moves it: "auto" means the reading direction's
                      leading edge, so switching this instance to Arabic
                      carries the notes sidebar to the right. Naming the edge
                      it resolved to is the whole point of the note — a
                      three-state preference whose default state is invisible
                      is the trap the palette commands were already fixing.
                      A device preference, so it commits on click like the
                      theme row and is never part of the Save diff. */}
                  <Row label={t("rowSidebarSide")} hint={t("hintSidebarSide")}>
                    <SegmentedControl
                      label={t("rowSidebarSide")}
                      value={sidebarSidePref}
                      onChange={(v) => setSidebarSidePref(v as SidebarSidePref)}
                      segments={[
                        {
                          value: "auto",
                          label: t("sideAuto"),
                          note: t(autoSide === "left" ? "sideLeft" : "sideRight"),
                        },
                        { value: "left", label: t("sideLeft") },
                        { value: "right", label: t("sideRight") },
                      ]}
                    />
                  </Row>
                  <Row
                    label={t("rowDateLocale")}
                    hint={t("hintDateLocale")}
                    error={errors.blogLocale}
                    inherited={form.blogLocale.trim() === ""}
                    env="BLOG_LOCALE"
                  >
                    <TextInput
                      placeholder={eff.blogLocale}
                      dir="ltr"
                      label={t("rowDateLocale")}
                      invalid={errors.blogLocale !== undefined}
                      {...field("blogLocale")}
                    />
                  </Row>
                  <Row
                    label={t("rowLanguageFilter")}
                    hint={t("hintLanguageFilter")}
                    inherited={form.languageFilter === ""}
                    env="LANGUAGE_FILTER"
                  >
                    <SegmentedControl
                      label={t("rowLanguageFilter")}
                      segments={onOffSegments(eff.languageFilter)}
                      {...field("languageFilter")}
                    />
                  </Row>
                  {/* The visitor switch, spelled out. It EXISTS — it has since
                      the language round — but it lived as a two-word row in a
                      list nobody could reach, and the one person who wanted it
                      could not tell whether it was there. So it gets its own
                      sub-heading and a sentence saying exactly what turning it
                      on puts on the public page, and what it deliberately does
                      not move (dates and numerals stay on the site's locale). */}
                  <div className="s-smodal__sub">{t("visitorSwitchHead")}</div>
                  <p className="s-smodal__note">{t("visitorSwitchNote")}</p>
                  <Row label={t("rowLanguageToggle")} hint={t("hintLanguageToggle")}>
                    <SegmentedControl
                      label={t("rowLanguageToggle")}
                      segments={onOffSegments(eff.languageToggle)}
                      {...field("languageToggle")}
                    />
                  </Row>
                  {(form.languageToggle === "on" || (form.languageToggle === "" && eff.languageToggle)) && (
                    <p className="s-smodal__offnote">{t("visitorSwitchOn")}</p>
                  )}

                  {/* ── Calendar ────────────────────────────────────────────
                      Under Language because it is the same question one layer
                      down: the language decides the WORDS a date is spelled
                      in, this decides which date it is. Hijri is Umm al-Qura
                      — see shared/dates.ts for why that one and not the other
                      three Intl offers. */}
                  <div className="s-smodal__sub">{t("groupCalendar")}</div>
                  <Row label={t("rowDateCalendar")} hint={t("hintDateCalendar")}>
                    <SegmentedControl
                      label={t("rowDateCalendar")}
                      segments={[
                        { value: "gregorian", label: t("calGregorian") },
                        { value: "hijri", label: t("calHijri") },
                        { value: "both", label: t("calBoth") },
                      ]}
                      {...field("dateCalendar")}
                    />
                  </Row>
                  {/* A SPECIMEN, not a promise. The three words above name
                      three calendars; this line is the only thing that shows
                      what one of them actually prints, in this instance's own
                      locale and numerals, and it moves as the segments do —
                      the same argument the type specimen makes one tab over. */}
                  <p className="s-smodal__note">
                    {t("calSpecimen")}
                    {": "}
                    <bdi className="s-smodal__specdate">
                      {siteDateIn(
                        new Date(),
                        eff.blogLocale,
                        form.dateCalendar === "hijri" || form.dateCalendar === "both"
                          ? form.dateCalendar
                          : "gregorian",
                        { dateStyle: "long" },
                      )}
                    </bdi>
                  </p>
                  <p className="s-smodal__note">{t("calFeedNote")}</p>
                  {/* SUGGEST, NEVER FORCE. An Arabic instance still starts on
                      the Gregorian calendar — changing what an existing site
                      prints because its language changed would be a settings
                      panel making an editorial decision. So the panel says the
                      sentence and leaves the click to the owner. */}
                  {(form.language === "ar" || (form.language === "" && eff.language === "ar")) &&
                    form.dateCalendar === "gregorian" && (
                      <p className="s-smodal__offnote">{t("calArabicSuggest")}</p>
                    )}

                  {/* ── Note layout ─────────────────────────────────────────
                      Direction and alignment for the PROSE, applied
                      identically in the editor, the reading view and blog
                      articles. A note overrides both from its own
                      frontmatter, and says so where the reader can see it. */}
                  <div className="s-smodal__sub">{t("groupNoteLayout")}</div>
                  <Row label={t("rowTextDirection")} hint={t("hintTextDirection")}>
                    <SegmentedControl
                      label={t("rowTextDirection")}
                      segments={[
                        { value: "auto", label: t("layoutDirAuto") },
                        { value: "ltr", label: t("layoutDirLtr") },
                        { value: "rtl", label: t("layoutDirRtl") },
                      ]}
                      {...field("textDirection")}
                    />
                  </Row>
                  {/* Five values, so a Select rather than a fifth segment: a
                      segmented control this wide stops being scannable and
                      starts wrapping, which is the trap the theme list was
                      moved out of the palette to avoid. */}
                  <Row label={t("rowTextAlign")} hint={t("hintTextAlign")}>
                    <Select
                      label={t("rowTextAlign")}
                      options={[
                        { value: "start", label: t("layoutAlignStart") },
                        { value: "left", label: t("layoutAlignLeft") },
                        { value: "right", label: t("layoutAlignRight") },
                        { value: "center", label: t("layoutAlignCenter") },
                        { value: "justify", label: t("layoutAlignJustify") },
                      ]}
                      {...field("textAlign")}
                    />
                  </Row>
                  <p className="s-smodal__note">{t("noteLayoutOverride")}</p>

                  {/* ── Tag labels ──────────────────────────────────────────
                      DISPLAY ONLY, and the copy says so before the table does
                      anything: the vault keeps its canonical tags, the URLs
                      keep canonical slugs, and search answers to both. */}
                  <div className="s-smodal__sub">{t("groupTagLabels")}</div>
                  <p className="s-smodal__note">{t("tagLabelsNote")}</p>
                  <Row
                    label={t("rowTagsFolder")}
                    hint={t("hintTagsFolder")}
                    inherited={form.tagsFolder.trim() === ""}
                  >
                    <TextInput
                      placeholder={eff.tagsFolder}
                      dir="ltr"
                      label={t("rowTagsFolder")}
                      {...field("tagsFolder")}
                    />
                  </Row>
                  {/* Same note the templates folder carries, from the same
                      key: both fields auto-detect, so both have to SAY which
                      folder they found — an empty field that silently means
                      "2 - Tags" on this vault and "tags" on the next one is a
                      field the reader cannot reason about. */}
                  {form.tagsFolder.trim() === "" && eff.tagsFolderDetected && (
                    <p className="s-smodal__note">
                      {tf("templatesDetectedHint", { folder: eff.tagsFolder })}
                    </p>
                  )}
                  <Row label={t("tagLabelsRowLabel")} hint={t("tagLabelsPageWins")} wide>
                    <TagLabelEditor
                      rows={form.tagLabels}
                      onChange={(rows) => setForm((f) => (f ? { ...f, tagLabels: rows } : f))}
                    />
                  </Row>
                </section>
                )}

                {tab === "publishing" && (
                <section data-section="publishing">
                  {/* Which shell a visitor lands in is a publishing decision,
                      not a colour one — it moved here from Appearance. */}
                  <Row
                    label={t("rowPublicLayout")}
                    hint={t("hintPublicLayout")}
                    inherited={form.publicLayout === ""}
                    env="PUBLIC_LAYOUT"
                  >
                    <SegmentedControl
                      label={t("rowPublicLayout")}
                      segments={[
                        { value: "", label: t("inheritSegment"), note: enumLabel(eff.publicLayout) },
                        { value: "app", label: t("layoutApp") },
                        { value: "blog", label: t("layoutBlog") },
                        // The third value. Flipping between blog and designed
                        // is LOSSLESS in both directions — the design lives in
                        // its own file and is not consulted while this reads
                        // anything else — so this segment is a switch, never a
                        // migration, and "back to blog" is the rescue.
                        { value: "designed", label: t("layoutDesigned") },
                      ]}
                      {...field("publicLayout")}
                    />
                  </Row>
                  <Row
                    label={t("rowExcludeTags")}
                    hint={t("hintExcludeTags")}
                    error={errors.excludeTags}
                    inherited={form.excludeTags.trim() === ""}
                    env="EXCLUDE_TAGS"
                  >
                    <TextInput
                      placeholder={eff.excludeTags.length > 0 ? eff.excludeTags.join(", ") : t("phExcludeTags")}
                      label={t("rowExcludeTags")}
                      invalid={errors.excludeTags !== undefined}
                      {...field("excludeTags")}
                    />
                  </Row>
                  <Row
                    label={t("rowComments")}
                    hint={t("hintComments")}
                    inherited={form.comments === ""}
                    env="COMMENTS"
                  >
                    <SegmentedControl
                      label={t("rowComments")}
                      segments={onOffSegments(eff.commentsEnabled)}
                      {...field("comments")}
                    />
                  </Row>
                  <Row label={t("rowShareButtons")} hint={t("hintShareButtons")}>
                    <SegmentedControl
                      label={t("rowShareButtons")}
                      segments={onOffSegments(eff.shareButtons)}
                      {...field("share")}
                    />
                  </Row>
                  <div className="s-smodal__sub">{t("groupHome")}</div>
                  <p className="s-smodal__note">{t("homeNote")}</p>
                  {homeOff && <p className="s-smodal__offnote">{t("homeBlogOnlyNotice")}</p>}
                  <Row label={t("rowMode")} hint={t("hintMode")} off={homeOff}>
                    <SegmentedControl
                      label={t("rowMode")}
                      disabled={homeOff}
                      segments={[
                        { value: "", label: t("inheritSegment"), note: enumLabel(eff.home.mode) },
                        { value: "note", label: t("modeNote") },
                        { value: "dashboard", label: t("modeDashboard") },
                      ]}
                      {...field("homeMode")}
                    />
                  </Row>
                  <Row
                    label={t("rowHomeNote")}
                    hint={t("hintHomeNote")}
                    error={errors.homeNote}
                    inherited={form.homeNote.trim() === ""}
                    env="HOME_NOTE"
                  >
                    <TextInput
                      placeholder={eff.home.note ?? "Welcome.md"}
                      dir="ltr"
                      label={t("rowHomeNote")}
                      invalid={errors.homeNote !== undefined}
                      {...field("homeNote")}
                    />
                  </Row>
                  <Row
                    label={t("rowHomeBanner")}
                    hint={t("hintHomeBanner")}
                    error={errors.homeBanner}
                    inherited={form.homeBanner.trim() === ""}
                    off={homeOff}
                  >
                    <ImageField
                      value={form.homeBanner}
                      placeholder={t("phVaultImageOrUrl")}
                      invalid={errors.homeBanner !== undefined}
                      disabled={homeOff}
                      onChange={(v) => setForm((f) => (f ? { ...f, homeBanner: v } : f))}
                      onOpenPicker={() => setPicker("homeBanner")}
                    />
                  </Row>
                  {/* TEMPLATES SIT UNDER PUBLISHING, and not as a filing
                      accident: the templates folder is the one setting that
                      REMOVES notes from the blog's post list. A stencil
                      carrying `publish: true` — which is exactly what a
                      publishing template carries, so the notes made from it
                      inherit it — would otherwise appear on the site as an
                      article of literal `{{date}}` placeholders. */}
                  <div className="s-smodal__sub">{t("templatesSection")}</div>
                  <p className="s-smodal__note">{t("templatePlaceholdersHint")}</p>
                  <Row
                    label={t("templatesFolderLabel")}
                    hint={t("templatesFolderHint")}
                    inherited={form.templatesFolder.trim() === "" && eff.templatesFolder !== null}
                  >
                    <TextInput
                      // The placeholder is the DETECTED folder when there is
                      // one: an empty field beside a working feature has to
                      // say what is in force, or the reader clears a folder
                      // they never set and cannot tell what changed.
                      placeholder={eff.templatesFolder ?? "Templates"}
                      dir="ltr"
                      label={t("templatesFolderLabel")}
                      {...field("templatesFolder")}
                    />
                  </Row>
                  {form.templatesFolder.trim() === "" && eff.templatesFolderDetected && eff.templatesFolder && (
                    <p className="s-smodal__note">
                      {tf("templatesDetectedHint", { folder: eff.templatesFolder })}
                    </p>
                  )}
                  <Row label={t("defaultTemplateLabel")} hint={t("defaultTemplateHint")}>
                    <TextInput
                      placeholder={eff.templatesFolder ? `${eff.templatesFolder}/Note.md` : "Templates/Note.md"}
                      dir="ltr"
                      label={t("defaultTemplateLabel")}
                      {...field("defaultTemplate")}
                    />
                  </Row>
                </section>
                )}

                {tab === "typography" && (
                <section data-section="typography">
                  {/* The specimen leads the tab and STAYS on screen while a
                      picker is open: it is stuck to the top of the scroller,
                      and every picker below opens downward into the space
                      under its own trigger. Choosing a face is a
                      compare-and-adjust loop — the control and its effect have
                      to be in one frame, and a popover that covers the effect
                      is the same bug as no preview at all. */}
                  <div className="s-smodal__specwrap" data-popclear>
                    <div className="s-smodal__speclabelrow">
                      <span className="s-smodal__speccaption">{t("fontPreview")}</span>
                      <span className="s-smodal__spechint">{t("fontPreviewNote")}</span>
                      <button
                        type="button"
                        className="s-btn"
                        onClick={() =>
                          setForm((f) =>
                            f
                              ? {
                                  ...f,
                                  fontProse: SYSTEM_FONT,
                                  fontUi: SYSTEM_FONT,
                                  fontMono: SYSTEM_FONT,
                                  fontArabic: SYSTEM_FONT,
                                  fontSizeAdjust: "",
                                }
                              : f,
                          )
                        }
                      >
                        {t("fontReset")}
                      </button>
                    </div>
                    <FontSpecimens />
                  </div>

                  <Row label={t("rowFontProse")} hint={t("hintFontProse")}>
                    <FontPicker
                      slot="text"
                      label={t("rowFontProse")}
                      value={form.fontProse}
                      catalog={loaded?.fontCatalog ?? []}
                      custom={customFonts}
                      onChange={(id) => setForm((f) => (f ? { ...f, fontProse: id } : f))}
                    />
                  </Row>
                  <Row label={t("rowFontUi")} hint={t("hintFontUi")}>
                    <FontPicker
                      slot="text"
                      label={t("rowFontUi")}
                      value={form.fontUi}
                      catalog={loaded?.fontCatalog ?? []}
                      custom={customFonts}
                      onChange={(id) => setForm((f) => (f ? { ...f, fontUi: id } : f))}
                    />
                  </Row>
                  <Row label={t("rowFontMono")} hint={t("hintFontMono")}>
                    <FontPicker
                      slot="mono"
                      label={t("rowFontMono")}
                      value={form.fontMono}
                      catalog={loaded?.fontCatalog ?? []}
                      custom={customFonts}
                      onChange={(id) => setForm((f) => (f ? { ...f, fontMono: id } : f))}
                    />
                  </Row>
                  {/* The Arabic slot is not a fourth Latin slot: it is one face
                      that answers for Arabic letters INSIDE the three above,
                      per character. Its own sub-heading says so before the
                      hint has to. */}
                  <div className="s-smodal__sub">{t("fontArabicHead")}</div>
                  <p className="s-smodal__note">{t("fontArabicHeadNote")}</p>
                  <Row label={t("rowFontArabic")} hint={t("hintFontArabic")}>
                    <FontPicker
                      slot="arabic"
                      label={t("rowFontArabic")}
                      value={form.fontArabic}
                      catalog={loaded?.fontCatalog ?? []}
                      custom={customFonts}
                      onChange={(id) => setForm((f) => (f ? { ...f, fontArabic: id } : f))}
                    />
                  </Row>
                  {/* The dial only exists while there IS an Arabic face to
                      match, and it is the one number in the panel a reader
                      arrives at by eye: it is set against the specimen two
                      rows up, which is why it lives here and not in a
                      config file. */}
                  {form.fontArabic !== SYSTEM_FONT && (
                    <Row
                      label={t("rowSizeAdjust")}
                      hint={t("hintSizeAdjust")}
                      error={errors.fontSizeAdjust}
                    >
                      <NumberInput
                        label={t("rowSizeAdjust")}
                        unit="%"
                        min={SIZE_ADJUST_MIN}
                        max={SIZE_ADJUST_MAX}
                        step={2}
                        placeholder={t("sizeAdjustAuto")}
                        invalid={errors.fontSizeAdjust !== undefined}
                        {...field("fontSizeAdjust")}
                      />
                    </Row>
                  )}

                  {/* Uploading is the answer to the question the catalog
                      cannot answer: the face an operator already owns. */}
                  <div className="s-smodal__sub">{t("fontCustomHead")}</div>
                  <p className="s-smodal__note">{t("fontCustomNote")}</p>
                  <CustomFonts
                    fonts={customFonts}
                    busy={fontBusy}
                    usedBy={(id) =>
                      (
                        [
                          [form.fontProse, "rowFontProse"],
                          [form.fontUi, "rowFontUi"],
                          [form.fontMono, "rowFontMono"],
                          [form.fontArabic, "rowFontArabic"],
                        ] as [string, I18nKey][]
                      )
                        .filter(([value]) => value === id)
                        .map(([, key]) => t(key))
                    }
                    onUpload={uploadCustomFont}
                    onDelete={removeCustomFont}
                  />
                </section>
                )}

                {/* ── Backup & sync ───────────────────────────────────────
                    No "inherit" option anywhere in this group: sync has no env
                    counterpart, so every control shows the value in force.
                    Everything below the master switch is DISABLED while that
                    switch is off — six fields and two actions at full contrast
                    and full interactivity, all inert, read as a configured and
                    running backup at a glance. */}
                {tab === "sync" && (
                <section data-section="sync">
                  {/* A master switch is a SWITCH: two states, both visible,
                      no list to open to learn there are only two. */}
                  <Row label={t("rowSyncEnabled")} hint={t("hintSyncEnabled")}>
                    <Toggle
                      label={t("rowSyncEnabled")}
                      onLabel={t("on")}
                      offLabel={t("off")}
                      value={form.syncEnabled === "on"}
                      onChange={(on) => setForm((f) => (f ? { ...f, syncEnabled: on ? "on" : "off" } : f))}
                    />
                  </Row>
                  {syncOff && <p className="s-smodal__offnote">{t("syncOffNotice")}</p>}
                  <Row
                    label={t("rowSyncRemote")}
                    hint={t("hintSyncRemote")}
                    error={errors.syncRemote}
                    off={syncOff}
                  >
                    <TextInput
                      placeholder={t("phSyncRemote")}
                      dir="ltr"
                      autoComplete="off"
                      label={t("rowSyncRemote")}
                      invalid={errors.syncRemote !== undefined}
                      disabled={syncOff}
                      {...field("syncRemote")}
                    />
                  </Row>
                  <Row
                    label={t("rowSyncBranch")}
                    hint={t("hintSyncBranch")}
                    error={errors.syncBranch}
                    off={syncOff}
                  >
                    <TextInput
                      placeholder="main"
                      dir="ltr"
                      autoComplete="off"
                      label={t("rowSyncBranch")}
                      invalid={errors.syncBranch !== undefined}
                      disabled={syncOff}
                      {...field("syncBranch")}
                    />
                  </Row>
                  <Row label={t("rowSyncAuth")} hint={t("hintSyncAuth")} off={syncOff}>
                    <SegmentedControl
                      label={t("rowSyncAuth")}
                      disabled={syncOff}
                      segments={[
                        { value: "ssh", label: t("authSsh") },
                        { value: "token", label: t("authToken") },
                      ]}
                      {...field("syncAuth")}
                    />
                  </Row>
                  {form.syncAuth === "token" && (
                    <>
                      <Row label={t("rowSyncUser")} hint={t("hintSyncUser")} off={syncOff}>
                        <TextInput
                          placeholder={t("phSyncUser")}
                          dir="ltr"
                          autoComplete="off"
                          label={t("rowSyncUser")}
                          disabled={syncOff}
                          {...field("syncUser")}
                        />
                      </Row>
                      <Row
                        label={t("rowSyncToken")}
                        hint={t("hintSyncToken")}
                        error={errors.syncToken}
                        off={syncOff}
                      >
                        <div className="s-smodal__tokenfield">
                          <TextInput
                            type="password"
                            placeholder={t(eff.gitSync.tokenSet ? "phTokenStored" : "phTokenNew")}
                            dir="ltr"
                            autoComplete="new-password"
                            label={t("rowSyncToken")}
                            invalid={errors.syncToken !== undefined}
                            disabled={syncOff}
                            {...field("syncToken")}
                          />
                          <button
                            type="button"
                            className="s-btn"
                            disabled={syncOff || !eff.gitSync.tokenSet || saving}
                            onClick={clearToken}
                          >
                            {t("clearToken")}
                          </button>
                        </div>
                        <span className="s-smodal__hint">
                          {t(eff.gitSync.tokenSet ? "tokenSetYes" : "tokenSetNo")}
                        </span>
                      </Row>
                    </>
                  )}
                  <Row label={t("rowSyncPull")} hint={t("hintSyncPull")} off={syncOff}>
                    <Toggle
                      label={t("rowSyncPull")}
                      onLabel={t("on")}
                      offLabel={t("off")}
                      disabled={syncOff}
                      value={form.syncPullFirst === "on"}
                      onChange={(on) => setForm((f) => (f ? { ...f, syncPullFirst: on ? "on" : "off" } : f))}
                    />
                  </Row>
                  <Row
                    label={t("rowSyncInterval")}
                    hint={t("hintSyncInterval")}
                    error={errors.syncInterval}
                    off={syncOff}
                  >
                    {/* A closed set of SENTENCES, not a number with a decoder
                        hint under it ("minutes; 0 = manual only"): the panel
                        has a NumberInput with a unit for the case where a
                        number is genuinely the value (the Arabic size match),
                        and this is not that case — "Every 6 hours" and
                        "Manual only" are the two things a reader is choosing
                        between. A value hand-written into settings.json
                        outside the set still gets a row. */}
                    <Select
                      label={t("rowSyncInterval")}
                      disabled={syncOff}
                      options={intervalChoices.map((minutes) => ({
                        value: String(minutes),
                        label: intervalLabel(minutes),
                      }))}
                      {...field("syncInterval")}
                    />
                  </Row>
                  <Row label={t("rowSyncStatus")} hint={t("hintSyncStatus")} off={syncOff}>
                    <SyncStatusBlock
                      authMode={form.syncAuth}
                      remote={form.syncRemote}
                      stale={syncStale}
                    />
                  </Row>
                  {/* Section-level verbs, on their own line and with no label
                      at all: they are not the value of a field called
                      "Status", and an empty label cell would only reintroduce
                      the grid they do not belong in. */}
                  <SyncActions stale={syncStale} disabled={syncOff} />
                </section>
                )}

                {tab === "about" && <AboutTab about={loaded?.about ?? null} />}
              </div>
            </div>
          </div>
        )}

        <div className="s-smodal__foot">
          <span className="s-smodal__dirty">
            {saving
              ? t(patch.fonts ? "fontFetching" : "saving")
              : dirty
                ? t(valid ? "unsavedChanges" : "fixMarkedFields")
                : ""}
          </span>
          <button type="button" className="s-btn" onClick={close}>
            {t("close")}
          </button>
          <button
            type="button"
            className="s-btn s-btn--accent"
            disabled={!dirty || !valid || saving}
            onClick={save}
          >
            {t("save")}
          </button>
        </div>

        {picker && (
          <ImagePicker
            title={t(
              picker === "favicon" ? "faviconImage" : picker === "logo" ? "logoImage" : "rowHomeBanner",
            )}
            onPick={(path) => {
              setForm((f) => (f ? { ...f, [picker]: path } : f));
              setPicker(null);
            }}
            onClose={() => setPicker(null)}
          />
        )}
      </div>
    </div>
  );
}
