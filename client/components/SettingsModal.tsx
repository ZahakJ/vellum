// The settings panel (admin): eight tabs over VELLUM_DATA/settings.json,
// read and written through GET/PATCH /api/settings.
//
// ONE TAB IS NOT ABOUT THE SITE AT ALL, and saying so out loud is what this
// round was for. "This device" (settings/DeviceTab.tsx) holds the preferences
// that live in localStorage and commit on click — your theme, your editor
// language, the sidebar's edge, vim, the floating toolbar, reading-view
// numbering. Every other tab is a form under one Save button. The two used to
// be interleaved, two rows apart, in one visual rank.
//
// The rest is the ordinary shape: two-column label/control rows, a label that
// SAYS what its control decides in five words or fewer, and one sentence of
// help under it — never a paragraph. Text fields left empty inherit the env
// default (shown as the placeholder); a filled field overrides it, and the ⓘ
// beside such a label opens the variable's own line, ready to copy. Typography,
// Backup and the localisation rows have no "inherit" state at all — none of
// them has an env counterpart — so their controls always show the value in
// force. Saving PATCHes only the keys that changed, then refreshes /api/me so
// the wordmark, layout, theme default, fonts and favicon apply live — no
// reload.
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
// Aliased: the panel also installs a window keydown listener, and React's
// KeyboardEvent would shadow the DOM one that listener is typed with.
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useDialog } from "../a11y.ts";
import {
  folderError,
  isAttachmentMode,
  modeUsesFolder,
  type FolderProblem,
} from "../../shared/attachments.ts";
import type { AboutInfo, CustomFontInfo, FontCatalogEntry, VisibilityImpact } from "../../shared/types.ts";
import type { SettingsPatch, SettingsResponse } from "../../shared/types.ts";
import {
  ApiError,
  deleteCustomFont,
  getSettings,
  getVisibility,
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
import { useStore } from "../state.ts";
import { attachScrollFade } from "../scrollFade.ts";
import { confirmModal } from "./Confirm.tsx";
import { FontPicker, SYSTEM_FONT } from "./FontPicker.tsx";
import SettingsSearch from "./settings/SettingsSearch.tsx";
import { NumberInput, SegmentedControl, TextInput, Toggle, type Segment } from "./controls/Fields.tsx";
import { isSelectOpen, Select, type SelectGroup } from "./controls/Select.tsx";
import DeviceTab from "./settings/DeviceTab.tsx";
import { Row } from "./settings/Row.tsx";
import { choiceLabel, isTheme, THEME_GROUPS, THEME_LABELS, THEMES, type Theme } from "../themes.ts";
import { customThemeChoice, isCustomThemeId } from "../../shared/customTheme.ts";
import { getCustomThemes } from "../design/customThemes.ts";
import { FOLLOW_THEME } from "../../shared/themes.ts";
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
import { isThemePickerOpen } from "./ThemePicker.tsx";
import { openDesigner } from "./design/openDesigner.ts";
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
  /** "" (inherit LANGUAGE_FILTER) | "off" | "follow" | "ar" | "en". Four
   *  values where there used to be two, because the two could not express the
   *  thing the visitor switch needed ("follow") without also being the thing
   *  that silently hid a live site. */
  languageFilter: string;
  languageToggle: string; // "" | "on" | "off" (public EN/ع switch; default off)
  excludeTags: string;  // comma-separated
  authorSites: string;  // one per line: "https://url | optional title"
  comments: string;     // "" | "on" | "off"
  share: string;        // "" | "on" | "off" (blog article share row; default on)
  favicon: string;      // vault path or ""
  logo: string;         // vault path / https URL or ""
  homeMode: string;     // "" | "note" | "dashboard"
  homeNote: string;
  homeBanner: string;
  // ── Attachments ──────────────────────────────────────────────────────────
  // Where an upload lands. Empty mode = inherit the pre-setting behaviour (one
  // fixed folder, ATTACHMENTS_DIR), so an upgrade changes nothing until the
  // admin says otherwise. `attachFolder` means different things per mode — a
  // vault-relative path under "specified", a bare folder NAME under
  // "subfolder" — and is ignored entirely by the other two.
  attachMode: string;   // "" | vault-root | same-folder | subfolder | specified
  attachFolder: string; // vault-relative folder (specified) / name (subfolder)
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
    languageFilter: s.languageFilter ?? "",
    languageToggle: s.languageToggle === undefined ? "" : s.languageToggle ? "on" : "off",
    excludeTags: (s.excludeTags ?? []).join(", "),
    authorSites: (s.authorSites ?? [])
      .map((site) => (site.title ? `${site.url} | ${site.title}` : site.url))
      .join("\n"),
    comments: s.commentsEnabled === undefined ? "" : s.commentsEnabled ? "on" : "off",
    share: s.shareButtons === undefined ? "" : s.shareButtons ? "on" : "off",
    favicon: s.favicon ?? "",
    logo: s.logo ?? "",
    homeMode: s.home?.mode ?? "",
    homeNote: s.home?.note ?? "",
    homeBanner: s.home?.banner ?? "",
    attachMode: s.attachments?.mode ?? "",
    attachFolder: s.attachments?.folder ?? "",
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

/** One author site per line: "https://url" or "https://url | Display title". */
function splitSites(value: string): { url: string; title?: string }[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const bar = line.indexOf("|");
      if (bar < 0) return { url: line };
      const url = line.slice(0, bar).trim();
      const title = line.slice(bar + 1).trim();
      return title === "" ? { url } : { url, title };
    });
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
  "vault-root": "locVaultRoot",
  "same-folder": "locSameFolder",
  subfolder: "locSubfolder",
  specified: "locSpecified",
};

/** The server's folder rules, spoken in the reader's language. The same
 *  refusals the 400 would carry — said inline instead, before the save.
 *  "tooLong" is not here: it is a budget, so it uses the shared maxChars copy
 *  every other length-capped field uses. */
const FOLDER_ERRORS: Partial<Record<FolderProblem, I18nKey>> = {
  traversal: "errFolderTraversal",
  absolute: "errFolderAbsolute",
  dotfolder: "errFolderDotfolder",
  control: "errFolderControl",
};

const FOLDER_MAX = 180; // mirrors server settings.ts

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
  const badSite = splitSites(f.authorSites).find(
    (site) => !/^https?:\/\/[^\s|]+$/i.test(site.url) || (site.title ?? "").length > 80,
  );
  if (badSite !== undefined) errors.authorSites = tf("errAuthorSite", { url: badSite.url });
  if (splitSites(f.authorSites).length > 6) errors.authorSites = t("errAuthorSitesMax");
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
  // The attachment folder, judged by the SAME function the server judges it
  // with (shared/attachments.ts) so the inline error and the 400 can never
  // disagree about what a legal folder is.
  const folder = f.attachFolder.trim();
  if (folder.length > FOLDER_MAX) errors.attachFolder = maxChars(FOLDER_MAX);
  else {
    const problem = folderError(folder);
    const key = problem && FOLDER_ERRORS[problem];
    if (key) errors.attachFolder = t(key);
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
    // "" clears the key back to LANGUAGE_FILTER; the four enum values are sent
    // verbatim. "off" is a stored value, not a cleared key — "this site
    // filters nothing" and "this site takes the env default" are different
    // statements and the panel can now make either.
    patch.languageFilter =
      f.languageFilter === "" ? null : (f.languageFilter as NonNullable<SettingsPatch["languageFilter"]>);
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
  if (f.authorSites.trim() !== initial.authorSites.trim()) {
    const sites = splitSites(f.authorSites);
    patch.authorSites = sites.length > 0 ? sites : null;
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
    f.attachMode !== initial.attachMode ||
    f.attachFolder.trim() !== initial.attachFolder.trim()
  ) {
    patch.attachments = {
      // "specified" is the default, so choosing it clears the key rather than
      // pinning the same behaviour absence already gives.
      mode: isAttachmentMode(f.attachMode) && f.attachMode !== "specified" ? f.attachMode : null,
      folder: f.attachFolder.trim() === "" ? null : f.attachFolder.trim(),
    };
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
// Consequence lines: what a visitor-facing setting will actually cost, in
// notes from THIS vault, before the save.
//
// Four controls on this panel can shrink the public site — the language
// filter, excluded tags, the blog front door, and (env-only, but it belongs in
// the same sentence) PUBLIC. Every one of them used to be a switch with a name
// and no stated consequence, and the language one took a real site from twenty
// published posts to two on a single click, silently. The server holds the
// only numbers that can answer "what will this do"; this asks it, live, as the
// controls move.
// ---------------------------------------------------------------------------

/** How loud a consequence line is. `warn` is amber (most of the site would go
 *  dark), `stop` is the danger colour (NOTHING would qualify). */
type Loudness = "plain" | "warn" | "stop";

function Consequence({ level = "plain", children }: { level?: Loudness; children: ReactNode }) {
  return <p className={`s-smodal__conseq s-smodal__conseq--${level}`}>{children}</p>;
}

/** The site as the current FORM would leave it, refetched as the operator
 *  moves the controls.
 *
 *  Debounced and abortable because it re-runs on every keystroke in the
 *  excluded-tags field; keyed on the exact five values the server's answer
 *  depends on, so moving an unrelated control costs nothing. It deliberately
 *  keeps the LAST good answer while a new one is in flight — a preview that
 *  blinked out between keystrokes would be a worse companion than one that is
 *  briefly a beat behind. */
function useVisibility(form: Form | null): VisibilityImpact | null {
  const [impact, setImpact] = useState<VisibilityImpact | null>(null);
  // The exact inputs the answer depends on. Not the whole form: this fires an
  // HTTP request, and the typography tab must not.
  const key = form
    ? JSON.stringify([
        form.languageFilter,
        form.excludeTags.trim(),
        form.publicLayout,
        form.homeMode,
        form.homeNote.trim(),
      ])
    : "";
  useEffect(() => {
    if (form === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getVisibility(
        {
          // "" means "inherit the env default" — and the server's own default
          // is what an absent param already asks for, so it is simply omitted.
          languageFilter: form.languageFilter || undefined,
          excludeTags: splitTags(form.excludeTags),
          publicLayout: form.publicLayout || undefined,
          home: form.homeMode || undefined,
          homeNote: form.homeNote.trim(),
        },
        controller.signal,
      )
        .then(setImpact)
        .catch(() => {
          // Aborted, offline, or a visitor-preview session (404). A missing
          // preview is a missing preview — never a wrong number.
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return impact;
}

/** The language-filter consequence, in the operator's language, with this
 *  vault's numbers. The mode being described is the PENDING one — the segment
 *  the operator has clicked but not yet saved. */
function LanguageConsequence({
  mode,
  impact,
  toggleOn,
  siteLang,
}: {
  mode: string;
  impact: VisibilityImpact;
  /** settings.languageToggle as the form would leave it. */
  toggleOn: boolean;
  /** The site language as the form would leave it — what "follow" collapses
   *  to for every reader when there is no switch to state a preference with. */
  siteLang: string;
}) {
  const { published, census } = impact;
  const total = localeNum(published);
  if (published === 0) return <Consequence>{t("visibilityNothingPublished")}</Consequence>;
  if (mode === "off") return <Consequence>{t("langFilterOffWhy")}</Consequence>;
  if (mode === "follow") {
    // One number cannot describe a per-reader setting, so this prints both
    // reader populations rather than pretending there is a single answer.
    return (
      <>
        <Consequence>{t("langFilterFollowWhy")}</Consequence>
        {!toggleOn && (
          <Consequence level="warn">
            {tf("langFilterFollowNeedsToggle", {
              lang: t(siteLang === "ar" ? "langAr" : "langEn"),
            })}
          </Consequence>
        )}
        <Consequence level={census.arabic === 0 || census.latin === 0 ? "warn" : "plain"}>
          {tf("langFilterFollowSplit", {
            ar: localeNum(census.arabic + census.neutral),
            en: localeNum(census.latin + census.neutral),
            total,
          })}
        </Consequence>
      </>
    );
  }
  const langName = t(mode === "ar" ? "langAr" : "langEn");
  const qualify = (mode === "ar" ? census.arabic : census.latin) + census.neutral;
  const hidden = published - qualify;
  if (qualify === 0) {
    return (
      <Consequence level="stop">{tf("langFilterEmptyWarn", { lang: langName, total })}</Consequence>
    );
  }
  // "Most of the site" is the threshold that matters: the real incident was 18
  // of 20 hidden, which is 90%. Half is where a reasonable person wants to be
  // asked twice.
  const heavy = hidden > published / 2;
  return (
    <>
      <Consequence level={heavy ? "warn" : "plain"}>
        {tf("langFilterPinnedWhy", {
          lang: langName,
          visible: localeNum(qualify),
          total,
          hidden: localeNum(hidden),
        })}
      </Consequence>
      {heavy && (
        <Consequence level="warn">
          {tf("langFilterMostHiddenWarn", { hidden: localeNum(hidden), total })}
        </Consequence>
      )}
      <Consequence>{t("langFilterPinnedIgnoresReader")}</Consequence>
    </>
  );
}

/** The tab-level standing summary. Not a warning — a statement of fact that
 *  happens to become a warning when the fact is bad. It is the thing whose
 *  absence made the original incident invisible: there was nowhere in this
 *  product that said how many published notes the public could actually find. */
function VisibilityBanner({ impact }: { impact: VisibilityImpact | null }) {
  if (!impact) return null;
  const { published, visible, publicReads, fallback } = impact;
  const total = localeNum(published);
  const lines: { level: Loudness; text: string }[] = [];
  // PUBLIC first: while it is off, every other number on the tab is
  // hypothetical, and saying so is more honest than printing counts that
  // describe a site nobody can reach.
  if (!publicReads) lines.push({ level: "warn", text: t("publicReadsOffWarn") });
  if (published === 0) {
    lines.push({ level: "plain", text: t("visibilityNothingPublished") });
  } else if (fallback) {
    // The filter stood down. The visitor sees everything; the admin sees why.
    lines.push({
      level: "stop",
      text: tf("langFilterEmptyWarn", {
        lang: t(impact.languageFilter === "ar" ? "langAr" : "langEn"),
        total,
      }),
    });
  } else if (visible === published) {
    lines.push({ level: "plain", text: tf("visibilityAll", { total }) });
  } else {
    lines.push({
      level: visible * 2 < published ? "warn" : "plain",
      text: tf("visibilityNow", { visible: localeNum(visible), total }),
    });
  }
  return (
    <div className="s-smodal__reach">
      <div className="s-smodal__sub">{t("visibilityHead")}</div>
      {lines.map((line) => (
        <Consequence key={line.text} level={line.level}>
          {line.text}
        </Consequence>
      ))}
    </div>
  );
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
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // The picker is a dialog stacked on the settings dialog: it takes the trap
  // while it is up and gives focus back to the "Pick" button that opened it.
  // (Escape is owned by SettingsModal's own capture-phase handler, which
  // closes the picker first — so no onEscape here.)
  useDialog(panelRef);

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
        ref={panelRef}
        className="s-bmodal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-bmodal__head">
          <span className="s-bmodal__title" id={titleId}>{title}</span>
          <button type="button" className="s-bmodal__close" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        </div>

        {/* Real button: a div that opens a file picker is unreachable by
            keyboard (see BannerModal). Drag handlers ride along on it. */}
        <button
          type="button"
          className={`s-bmodal__drop${dragOver ? " s-bmodal__drop--over" : ""}`}
          aria-label={t("chooseImageFile")}
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
        </button>

        <div className="s-bmodal__pick">
          <input
            className="s-bmodal__input"
            type="text"
            placeholder={t("searchAttachments")}
            aria-label={t("searchAttachments")}
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

/** A theme's human label, falling back to the product default for an unset or
 *  unrecognised value. The picker, this panel and the palette all read the
 *  same table (`THEME_LABELS`); the raw id stays the stored value. "follow" is
 *  not a theme and never has been — it is the RULE, so it answers with the
 *  rule's own name rather than pretending to be a room. */
function themeLabel(id: string | null): string {
  if (id === FOLLOW_THEME) return t("themeFollowOption");
  if (id && isCustomThemeId(id)) return choiceLabel(id);
  return t(THEME_LABELS[isTheme(id ?? "") ? (id as Theme) : THEMES[0]].name);
}

/** "Visitors see Cinnabar — following your editor theme", under the default-
 *  theme select, with the one control that changes the rule.
 *
 *  THE ROW USED TO BE HONEST AND UNREADABLE: it named a theme (or "inherit")
 *  and said nothing about who gets it or why. Now that the default FOLLOWS the
 *  owner's own editor theme unless pinned, silence would be worse than
 *  unreadable — an owner would change their theme at midnight and change their
 *  blog with it, having been told nothing. So the rule is printed in the
 *  theme's own name, and it tracks the select LIVE (before saving), because a
 *  sentence that only tells the truth after a round-trip teaches nothing while
 *  the choice is being made. */
function VisitorThemeLine({
  pref,
  effective,
  onSet,
}: {
  /** The preference the panel is showing: a theme id or "follow". */
  pref: string | null;
  /** What the server says a visitor gets right now (the fallback for an
   *  instance whose preference the client cannot resolve on its own). */
  effective: string | null;
  onSet: (value: string) => void;
}) {
  const theme = useStore((s) => s.theme);
  const following = pref === null || pref === "" || pref === FOLLOW_THEME;
  // Following: the owner's own theme is what visitors get (the server mirrors
  // it within a second of a pick). Pinned: the pin, whoever is editing.
  // A pin may name a CUSTOM theme as readily as one of the fifteen, so the
  // value is passed through as-is: themeLabel() below is what knows how to
  // name either kind (and how to fall back for an id this instance lost).
  const shown = following ? theme : pref !== null && pref !== "" ? pref : effective ?? THEMES[0];
  return (
    <p className="s-smodal__visitors">
      <span className="s-smodal__visitorsnote">
        {tf(following ? "visitorsFollow" : "visitorsPinned", { theme: themeLabel(shown) })}
      </span>
      <button
        type="button"
        className="s-smodal__visitorspin"
        onClick={() => onSet(following ? theme : FOLLOW_THEME)}
      >
        {t(following ? "pinForVisitors" : "followMyTheme")}
      </button>
    </p>
  );
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
      options: [
        { value: "", label: tf("inheritOption", { value: themeLabel(effective) }) },
        // The third state, offered as plainly as the fifteen rooms: not a
        // theme but a rule, and the one this product now defaults to. It is a
        // STORABLE value rather than merely the absence of one, because an
        // instance whose .env pins DEFAULT_THEME needs a way to say "no,
        // follow me" — clearing the key would only fall back to the pin.
        { value: FOLLOW_THEME, label: t("themeFollowOption") },
      ],
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
  // Forwarded by Row: the row's <label> points at `id`, so the text field —
  // not the wrapper div — has to be the thing carrying it.
  id,
  "aria-describedby": describedBy,
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
  id?: string;
  "aria-describedby"?: string;
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
      {/* Real button, like the banner and logo drop zones above: a div that
          opens a file picker is a control no keyboard can reach. The drag
          handlers ride along on it. */}
      <button
        type="button"
        className={`s-bmodal__drop${dragOver ? " s-bmodal__drop--over" : ""}`}
        aria-label={t("chooseFontFile")}
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
      </button>
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
 *  a table of contents for a form nobody could see the end of; TABS make each
 *  one a short read and the rail navigation rather than a bookmark. Each tab
 *  opens with one sentence saying what it DECIDES, because "Language" and
 *  "Publishing" are category names, not explanations.
 *
 *  EIGHT, AND THE FIRST ONE IS THE POINT. Six of them held one long form under
 *  one Save button — and three rows inside that form were not part of it at
 *  all: your theme, your editor language and the sidebar's edge live in this
 *  browser's localStorage and commit on click. Nothing distinguished them from
 *  the thirty-seven server settings they sat between, so the panel's most
 *  common question was "did that save?" about rows that had already saved, and
 *  "why did nothing happen?" about rows that had not. The device preferences
 *  are their own tab now, and it opens first: this browser is what a reader
 *  can change without consequence to anyone else, and it is where vim, the
 *  floating toolbar and reading-view numbering — three preferences that were
 *  reachable only from a status-bar pill, a palette row and an outline button
 *  — are finally listed.
 *
 *  The rest split by the QUESTION each answers rather than by the machinery
 *  behind it: what the site is called (Identity), what it speaks and how it
 *  writes dates (Language & dates), what a visitor may see (Publishing), which
 *  folders it writes into (Vault), what it is set in (Typography), how it is
 *  backed up (Backup), and what it IS (About). "Appearance & language" is gone
 *  as a name: half of it was this browser's and half of it was the site's,
 *  which is the confusion the split exists to end. */
interface Tab {
  id: string;
  key: I18nKey;
  /** One-sentence intro under the tab's heading. */
  intro: I18nKey;
}

// THREE KEYS ARE NAMED HERE AND USED NOWHERE, and this comment is the ONE
// place in the client where a quoted dictionary key is not a use.
// `client/i18n.ts` belongs to another agent this round; check-i18n's usage
// scan counts a key surviving inside a comment, and a gate that goes red
// halfway through a handover is a gate people learn to run without reading.
// So they are named here, listed for the dictionary's owner in
// i18n-stage4.md, and deleted WITH the dictionary rather than before it:
const TABS: Tab[] = [
  { id: "device", key: "tabDevice", intro: "introDevice" },
  { id: "identity", key: "tabIdentity", intro: "introIdentity" },
  { id: "language", key: "tabLanguage", intro: "introLanguage" },
  { id: "publishing", key: "tabPublishing", intro: "introPublishing" },
  { id: "vault", key: "tabVault", intro: "introVault" },
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
  const close = useCallback(() => setOpen(false), [setOpen]);

  const [loaded, setLoaded] = useState<SettingsResponse | null>(null);
  const [initial, setInitial] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"favicon" | "logo" | "homeBanner" | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Trap + restore. Escape stays with the capture-phase handler below, which
  // has to close the PICKER first when one is stacked on top.
  useDialog(panelRef);

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

  /** The mode a segment's "inherit" note prints. Not enumLabel(): these four
   *  values have names in the panel's own language, and "follow" in particular
   *  is meaningless as a raw id to the person reading it. */
  const langFilterLabel = (mode: string): string => {
    if (mode === "follow") return t("langFilterFollow");
    if (mode === "ar") return t("langFilterAr");
    if (mode === "en") return t("langFilterEn");
    return t("langFilterOff");
  };

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
  // The live consequence preview, shared by every row that can shrink the
  // public site (language filter, excluded tags, home note) and by both tabs'
  // standing summary. One request per settled edit, for all of them.
  const impact = useVisibility(form);
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
        ref={panelRef}
        className="s-bmodal s-smodal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-bmodal__head">
          {/* The panel's own name, and nothing else. It used to read
              "Site settings — settings.json", which named an implementation
              file in the title bar of a settings screen: it told a reader
              what the product writes rather than what the panel does, and it
              named a path without saying where that path is. Where the file
              lives is a FACT about the instance, so it moved to About, beside
              the vault and data directories.
              The id is what the dialog's aria-labelledby points at, so the
              panel's accessible name is this same line and not a second copy
              of it that could drift. */}
          <span className="s-bmodal__title" id={titleId}>
            {t("siteSettings")}
          </span>
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
            <div className="s-smodal__railwrap">
            {/* SEARCH SITS ABOVE THE RAIL, not inside the body: it searches
                every tab, so putting it in one of them would say it searched
                that one. */}
            <SettingsSearch
              tabName={(id) => {
                const found = TABS.find((x) => x.id === id);
                return found === undefined ? id : t(found.key);
              }}
              onGo={(entry, label) => {
                goToTab(entry.tab);
                // After the tab has painted: find the row by the label it
                // stamped (settings/Row.tsx), bring it into view, and mark it
                // for a moment. Scrolling to a row without marking it leaves
                // the reader looking at a list and guessing which one answered.
                requestAnimationFrame(() => {
                  const row = bodyRef.current?.querySelector<HTMLElement>(
                    `[data-setting="${CSS.escape(label)}"]`,
                  );
                  if (!row) return;
                  row.scrollIntoView({ block: "center", behavior: "smooth" });
                  row.classList.add("s-smodal__row--found");
                  window.setTimeout(() => row.classList.remove("s-smodal__row--found"), 1600);
                });
              }}
            />
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
            </div>

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

                {/* "This device" is its own module (settings/DeviceTab.tsx) and
                    the FIRST tab, because it is the one tab the Save button in
                    the footer does not speak for. A boundary a reader crosses
                    by clicking a tab name is a boundary they can see; the same
                    boundary drawn three rows into a form of thirty-seven
                    server settings is one they discover by being wrong. */}
                {tab === "device" && <DeviceTab />}

                {tab === "identity" && (
                <section data-section="identity">
                  <p className="s-smodal__note s-smodal__note--inherit">{t("settingsNote")}</p>
                  <Row
                    label={t("rowSiteName")}
                    error={errors.siteName}
                    env={{ name: "SITE_NAME", value: eff.siteName, inherits: form.siteName.trim() === "" }}
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
                    env={{ name: "SITE_TAGLINE", value: eff.tagline ?? "", inherits: form.tagline.trim() === "" }}
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
                    env={{ name: "SITE_FOOTER", value: eff.footer ?? "", inherits: form.footer.trim() === "" }}
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
                  {/* The standing answer to "how much of my site is public",
                      at the top of both tabs that can change it. It describes
                      the site AS THE FORM WOULD LEAVE IT, so it moves as the
                      controls move — the operator never has to save to find
                      out. */}
                  <VisibilityBanner impact={impact} />
                  <Row
                    label={t("rowLanguage")}
                    hint={t("hintLanguage")}
                    env={{ name: "SITE_LANG", value: eff.language, inherits: form.language === "" }}
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
                  <Row
                    label={t("rowDateLocale")}
                    hint={t("hintDateLocale")}
                    error={errors.blogLocale}
                    env={{ name: "BLOG_LOCALE", value: eff.blogLocale, inherits: form.blogLocale.trim() === "" }}
                  >
                    <TextInput
                      placeholder={eff.blogLocale}
                      dir="ltr"
                      label={t("rowDateLocale")}
                      invalid={errors.blogLocale !== undefined}
                      {...field("blogLocale")}
                    />
                  </Row>
                  {/* Four states, not two. The boolean this replaces could
                      only say "on", and "on" meant "pin to the site language"
                      — which is why turning it on took a real site from twenty
                      published posts to two with nothing said. Each segment
                      now names WHO decides, and the block under it prints, in
                      this vault's own numbers, exactly what the pending choice
                      would do. */}
                  <Row
                    label={t("rowLanguageFilter")}
                    hint={t("hintLanguageFilter")}
                    env={{ name: "LANGUAGE_FILTER", value: eff.languageFilter, inherits: form.languageFilter === "" }}
                    wide
                  >
                    <SegmentedControl
                      label={t("rowLanguageFilter")}
                      segments={[
                        { value: "", label: t("inheritSegment"), note: langFilterLabel(eff.languageFilter) },
                        { value: "off", label: t("langFilterOff"), note: t("langFilterOffNote") },
                        {
                          value: "follow",
                          label: t("langFilterFollow"),
                          note: t("langFilterFollowNote"),
                        },
                        { value: "ar", label: t("langFilterAr") },
                        { value: "en", label: t("langFilterEn") },
                      ]}
                      {...field("languageFilter")}
                    />
                    {impact && (
                      <LanguageConsequence
                        mode={form.languageFilter === "" ? eff.languageFilter : form.languageFilter}
                        impact={impact}
                        toggleOn={
                          form.languageToggle === "" ? eff.languageToggle : form.languageToggle === "on"
                        }
                        siteLang={form.language === "" ? eff.language : form.language}
                      />
                    )}
                    {impact && impact.topics.visible < impact.topics.total && (
                      <Consequence>
                        {tf("langFilterTopicsCut", {
                          visible: localeNum(impact.topics.visible),
                          total: localeNum(impact.topics.total),
                        })}
                      </Consequence>
                    )}
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
                  {/* The standing answer to "how much of my site is public",
                      at the top of both tabs that can change it. It describes
                      the site AS THE FORM WOULD LEAVE IT, so it moves as the
                      controls move — the operator never has to save to find
                      out. */}
                  <VisibilityBanner impact={impact} />
                  {/* THE THEME A VISITOR ARRIVES ON, filed with everything
                      else a visitor gets. It used to stand two rows from "Your
                      theme" — two labels carrying the same word, one of them
                      in the Save diff and one of them saving itself on click,
                      with nothing on screen to tell them apart. Yours is a tab
                      away now, and this row keeps the only question it ever
                      answered: which room a reader with no stored choice
                      walks into. */}
                  <Row
                    label={t("rowDefaultTheme")}
                    hint={t("hintDefaultTheme")}
                    env={{ name: "DEFAULT_THEME", value: eff.defaultTheme ?? "", inherits: form.defaultTheme === "" }}
                    /* THE ROW SAYS WHAT IT DOES, IN A THEME'S NAME.
                       "Follow my editor theme" is a rule, not an appearance,
                       and an owner reading it still does not know what their
                       readers are looking at tonight. This line answers that
                       in the same breath, and — while the instance is
                       following — offers the single click that stops it. It
                       rides `after` rather than being a second child: the row
                       wires the label onto its ONE control child. */
                    after={
                      <VisitorThemeLine
                        pref={form.defaultTheme === "" ? eff.defaultTheme : form.defaultTheme}
                        effective={eff.visitorTheme}
                        onSet={(v) => setForm((f) => (f ? { ...f, defaultTheme: v } : f))}
                      />
                    }
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
                  {/* Which shell a visitor lands in is a publishing decision,
                      not a colour one — which is why it sits under Publishing
                      and not under the tab that used to own the word "looks". */}
                  <Row
                    label={t("rowPublicLayout")}
                    hint={t("hintPublicLayout")}
                    env={{ name: "PUBLIC_LAYOUT", value: eff.publicLayout, inherits: form.publicLayout === "" }}
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
                  {/* THE DOOR TO THE DESIGNER, BESIDE THE SWITCH THAT NEEDS IT.
                      `openDesigner()` had exactly ONE call site in the whole
                      client — the command palette — so an operator who flipped
                      the segment above landed on a designed site with no design
                      and nothing anywhere saying where designs are made. This
                      is the row that just told them the word "designed"; it is
                      the row that has to hand them the tool. (WordPress puts
                      Appearance → Themes in the primary nav; this is the same
                      idea, one panel over.) */}
                  <Row label={t("rowOpenDesigner")} hint={t("hintOpenDesigner")}>
                    <button
                      type="button"
                      className="s-btn s-btn--accent"
                      onClick={() => {
                        setOpen(false);
                        openDesigner();
                      }}
                    >
                      {t("designTitle")}
                    </button>
                  </Row>
                  {/* Same treatment as the language filter, one control over:
                      this removes topic pills — and with them whole topic
                      pages — and it used to do it in silence, including when
                      the tag it names matches nothing at all. */}
                  <Row
                    label={t("rowExcludeTags")}
                    hint={t("hintExcludeTags")}
                    error={errors.excludeTags}
                    env={{ name: "EXCLUDE_TAGS", value: eff.excludeTags.join(","), inherits: form.excludeTags.trim() === "" }}
                  >
                    <TextInput
                      placeholder={eff.excludeTags.length > 0 ? eff.excludeTags.join(", ") : t("phExcludeTags")}
                      label={t("rowExcludeTags")}
                      invalid={errors.excludeTags !== undefined}
                      {...field("excludeTags")}
                    />
                    {impact &&
                      (impact.topics.suppressed.length > 0 ? (
                        <Consequence>
                          {tf("excludeTagsEffect", {
                            hidden: localeNum(impact.topics.suppressed.length),
                            total: localeNum(impact.topics.total),
                            tags: impact.topics.suppressed.join("، "),
                          })}
                        </Consequence>
                      ) : splitTags(form.excludeTags).length > 0 ? (
                        <Consequence>{t("excludeTagsNoop")}</Consequence>
                      ) : (
                        <Consequence>
                          {tf("excludeTagsNone", { total: localeNum(impact.topics.total) })}
                        </Consequence>
                      ))}
                  </Row>
                  <Row
                    label={t("rowComments")}
                    hint={t("hintComments")}
                    env={{ name: "COMMENTS", value: eff.commentsEnabled ? "on" : "off", inherits: form.comments === "" }}
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
                  {/* The author's other homes. One per line, because a URL
                      list belongs in a textarea: pasting six links into six
                      separate fields is busywork this panel refuses to
                      assign. The server enriches each with the site's own
                      OpenGraph title, description and cover, so the row asks
                      only for what the admin alone knows: which sites, and
                      what to call one when its own title is wrong. */}
                  <Row
                    label={t("rowAuthorSites")}
                    hint={t("hintAuthorSites")}
                    error={errors.authorSites}
                  >
                    <textarea
                      className="s-smodal__textarea"
                      rows={3}
                      dir="ltr"
                      placeholder={t("phAuthorSites")}
                      aria-label={t("rowAuthorSites")}
                      aria-invalid={errors.authorSites !== undefined || undefined}
                      value={field("authorSites").value}
                      onChange={(e) => field("authorSites").onChange(e.target.value)}
                    />
                    {splitSites(form.authorSites).length > 0 && (
                      <Consequence>
                        {tf("authorSitesEffect", {
                          count: localeNum(splitSites(form.authorSites).length),
                        })}
                      </Consequence>
                    )}
                  </Row>
                  <div className="s-smodal__sub">{t("groupHome")}</div>
                  <p className="s-smodal__note">{t("homeNote")}</p>
                  {homeOff && <p className="s-smodal__offnote">{t("homeBlogOnlyNotice")}</p>}
                  <Row label={t("rowMode")} hint={t("hintMode")} off={homeOff}>
                    {homeOff && <Consequence>{t("homeModeAppNote")}</Consequence>}
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
                    env={{ name: "HOME_NOTE", value: eff.home.note ?? "", inherits: form.homeNote.trim() === "" }}
                  >
                    <TextInput
                      placeholder={eff.home.note ?? "Welcome.md"}
                      dir="ltr"
                      label={t("rowHomeNote")}
                      invalid={errors.homeNote !== undefined}
                      {...field("homeNote")}
                    />
                    {/* A front door pointing at a note visitors cannot see
                        renders a blank homepage and says nothing about it.
                        Now it says something — and it can only be answered by
                        the server, which knows the publish flag AND the
                        language filter this note is about to meet. */}
                    {impact &&
                      (impact.home.note === null ? (
                        <Consequence>{t("homeNoteUnset")}</Consequence>
                      ) : impact.home.noteVisible ? (
                        <Consequence>{t("homeNoteOk")}</Consequence>
                      ) : (
                        <Consequence level="warn">{t("homeNoteHidden")}</Consequence>
                      ))}
                  </Row>
                  <Row
                    label={t("rowHomeBanner")}
                    hint={t("hintHomeBanner")}
                    error={errors.homeBanner}
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
                </section>
                )}

                {tab === "vault" && (
                <section data-section="vault">
                  {/* WHERE THIS INSTANCE PUTS THINGS, all in one tab. Templates
                      were filed under Publishing (a stencil carrying
                      `publish: true` really does reach the post list) and
                      attachments under it too, which meant an operator looking
                      for "which folder does this write to" read a tab about
                      comments and share buttons first. Three folder questions
                      in one place answer each other; a folder filed by its
                      consequence answers nobody. */}
                  <div className="s-smodal__sub">{t("templatesSection")}</div>
                  <p className="s-smodal__note">{t("templatePlaceholdersHint")}</p>
                  <Row
                    label={t("templatesFolderLabel")}
                    hint={t("templatesFolderHint")}
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

                  {/* Obsidian's "Default location for new attachments", named
                      the same way so a migrating vault owner finds what they
                      expect. Every upload path obeys it — editor paste and
                      drop, the tree's file drop, the banner picker — and
                      nothing already on disk moves when it changes.

                      Beside Templates for the same reason Templates is here:
                      both answer "where does this instance PUT things in the
                      vault", and both are folders the operator will look for
                      in one place. */}
                  <div className="s-smodal__sub">{t("groupAttachments")}</div>
                  <Row
                    label={t("rowAttachmentLocation")}
                    hint={t("hintAttachmentLocation")}
                  >
                    <Select
                      label={t("rowAttachmentLocation")}
                      value={form.attachMode}
                      onChange={(v) => setForm((f) => (f ? { ...f, attachMode: v } : f))}
                      options={[
                        {
                          value: "",
                          label: tf("inheritOption", { value: enumLabel(eff.attachments.mode) }),
                        },
                        { value: "vault-root", label: t("locVaultRoot") },
                        { value: "same-folder", label: t("locSameFolder") },
                        { value: "subfolder", label: t("locSubfolder") },
                        { value: "specified", label: t("locSpecified") },
                      ]}
                    />
                  </Row>
                  {/* The folder field belongs to two of the four modes; under
                      the other two it would be a control that quietly does
                      nothing, so it is disabled rather than left to mislead. */}
                  <Row
                    label={t("rowAttachmentFolder")}
                    hint={t(
                      (form.attachMode || eff.attachments.mode) === "subfolder"
                        ? "hintAttachmentSubfolder"
                        : "hintAttachmentFolder",
                    )}
                    error={errors.attachFolder}
                    off={
                      !modeUsesFolder(
                        isAttachmentMode(form.attachMode) ? form.attachMode : eff.attachments.mode,
                      )
                    }
                  >
                    <TextInput
                      placeholder={eff.attachments.folder}
                      maxLength={FOLDER_MAX + 1}
                      dir="ltr"
                      label={t("rowAttachmentFolder")}
                      invalid={errors.attachFolder !== undefined}
                      disabled={
                        !modeUsesFolder(
                          isAttachmentMode(form.attachMode)
                            ? form.attachMode
                            : eff.attachments.mode,
                        )
                      }
                      {...field("attachFolder")}
                    />
                  </Row>

                  {/* The tag pages' folder, with the two folder rows above it
                      rather than beside the LABELS table it used to sit on top
                      of: this row answers "where does this instance write", and
                      the table answers "what does a tag get called". They were
                      one group because a page in this folder outranks the
                      table — which is a sentence, and now it is one, in the
                      table's own hint. */}
                  <div className="s-smodal__sub">{t("tags")}</div>
                  <Row
                    label={t("rowTagsFolder")}
                    hint={t("hintTagsFolder")}
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
          {/* "Unsaved changes" / "Fix the marked fields" / "Saving…" is the
              panel's only status text — it has to be spoken, not just shown. */}
          <span className="s-smodal__dirty" role="status">
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
