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
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { AboutInfo, FontCatalogEntry } from "../../shared/types.ts";
import type { SettingsPatch, SettingsResponse } from "../../shared/types.ts";
import { getSettings, listAttachments, patchSettings, uploadAttachment } from "../api.ts";
import { bannerSrc } from "../banner.ts";
import { countPhrase, localeNum, t, tf, type I18nKey } from "../i18n.ts";
import { UPLOAD_MAX_MB } from "../../shared/limits.ts";
import { useStore } from "../state.ts";
import { isTheme, THEME_GROUPS, THEME_LABELS, THEMES, type Theme } from "../themes.ts";
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

// ---------------------------------------------------------------------------
// Form model: strings for every control; "" = inherit the env default.
// ---------------------------------------------------------------------------

interface Form {
  siteName: string;
  tagline: string;
  footer: string;
  defaultTheme: string; // "" | theme
  publicLayout: string; // "" | "app" | "blog"
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
}

/** The "no webfont" choice — the built-in system stacks (server SYSTEM). */
const SYSTEM_FONT = "system";

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
  };
}

const FONT_KEYS = ["fontProse", "fontUi", "fontMono", "fontArabic"] as const;

// Type SPECIMENS, deliberately not in i18n.ts: a Latin sample must stay Latin
// in an Arabic UI and an Arabic sample Arabic in an English one, or the block
// stops previewing the thing it is there to preview. The second line is mixed
// on purpose — it is the whole feature in one line: the Arabic slot answers
// for the Arabic letters and the Latin slot for "Vellum" and the digits,
// chosen per CHARACTER, with no markup and no language attribute.
const SPECIMEN_LATIN = "The vault is open — a candlelit room. 0123456789";
const SPECIMEN_ARABIC = "خَطُّ النَّسْخِ في عمودِ القراءةِ — Vellum ١٢٣٤٥٦٧٨٩";

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
  if (f.homeNote.trim() !== "" && !/\.md$/i.test(f.homeNote.trim())) {
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
  return errors;
}

/** Mirrors of the server's gitSync validators (server/gitSync.ts). */
const UNSAFE_REMOTE = /[\s`$;&|<>(){}[\]'"\\^*?!#]/;
const REMOTE_RE = /^(https:\/\/|ssh:\/\/)\S+$|^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^:]+$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** The PATCH: only keys whose form value differs from the loaded snapshot. */
function buildPatch(initial: Form, f: Form): SettingsPatch {
  const patch: SettingsPatch = {};
  const str = (key: "siteName" | "tagline" | "footer" | "defaultTheme" | "blogLocale" | "favicon" | "logo"): void => {
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
    patch.publicLayout = f.publicLayout === "app" || f.publicLayout === "blog" ? f.publicLayout : null;
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
    patch.fonts = { prose: f.fontProse, ui: f.fontUi, mono: f.fontMono, arabic: f.fontArabic };
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
  return t(THEME_LABELS[isTheme(id ?? "") ? (id as Theme) : THEMES[0]].name);
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
  onChange,
  onOpenPicker,
}: {
  value: string;
  placeholder: string;
  invalid?: boolean;
  onChange: (v: string) => void;
  onOpenPicker: () => void;
}) {
  const trimmed = value.trim();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [trimmed]);
  const isImage = trimmed !== "";
  const showImg = isImage && !invalid && !broken;
  return (
    <div className="s-smodal__imgfield">
      {showImg && (
        <img
          className="s-smodal__imgthumb"
          src={bannerSrc(trimmed)}
          alt=""
          onError={() => setBroken(true)}
        />
      )}
      {isImage && !showImg && (
        <span className="s-smodal__imgthumb s-smodal__imgthumb--missing" aria-hidden="true">
          ⌀
        </span>
      )}
      <input
        className="s-bmodal__input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        dir="ltr"
      />
      <button type="button" className="s-btn" onClick={onOpenPicker}>
        {t("pick")}
      </button>
      {isImage && (
        <button type="button" className="s-btn" onClick={() => onChange("")} aria-label={t("clear")}>
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

/** The option groups a slot offers. Text and Interface list the Latin-only
 *  families (the Arabic ones have their own slot, which answers for Arabic
 *  letters in ALL THREE composites — offering them here too would only invite
 *  picking a naskh face as the Latin one); Code lists the monospace family;
 *  Arabic splits naskh/classical from modern/kufi, which is the distinction a
 *  reader is actually choosing between. */
function fontGroups(
  catalog: FontCatalogEntry[],
  slot: "text" | "mono" | "arabic",
): { key: I18nKey; items: FontCatalogEntry[] }[] {
  const latin = catalog.filter((f) => !f.scripts.includes("arabic"));
  const arabic = catalog.filter((f) => f.scripts.includes("arabic"));
  if (slot === "mono") return [{ key: "fontGroupMono", items: latin.filter((f) => f.category === "mono") }];
  if (slot === "arabic") {
    return [
      { key: "fontGroupArabicNaskh", items: arabic.filter((f) => f.category === "serif") },
      { key: "fontGroupArabicModern", items: arabic.filter((f) => f.category === "sans") },
    ];
  }
  return [
    { key: "fontGroupSerif", items: latin.filter((f) => f.category === "serif") },
    { key: "fontGroupSans", items: latin.filter((f) => f.category === "sans") },
  ];
}

function FontSelect({
  value,
  groups,
  onChange,
}: {
  value: string;
  groups: { key: I18nKey; items: FontCatalogEntry[] }[];
  onChange: (id: string) => void;
}) {
  return (
    <select
      className="s-bmodal__input s-smodal__select"
      // The VALUES are Latin family names (Lora, JetBrains Mono, Amiri). In an
      // RTL panel a select right-aligns its value, which flung every name to
      // the far edge away from its chevron and left the column ragged; the
      // names get to keep their own direction and start-alignment.
      dir="ltr"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value={SYSTEM_FONT}>{t("fontSystem")}</option>
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <optgroup key={group.key} label={t(group.key)}>
            {group.items.map((font) => (
              // Family names are proper nouns — untranslated, like the theme
              // names one section up.
              <option key={font.id} value={font.id}>
                {font.family}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </select>
  );
}

/** The specimen block. Each row renders in its slot's PREVIEW composite
 *  ("VellumPreviewProse" …), which /api/font-preview.css defines from the
 *  picks currently in the form — so the reader sees the faces before saving
 *  anything. The second line of each row is mixed on purpose: the Arabic slot
 *  answers for the Arabic letters and the slot's own face for the Latin ones,
 *  chosen per character. Every family name falls back to the matching
 *  --font-*-system stack, so an unpicked (or not-yet-fetched) slot simply
 *  shows what the site shows today. */
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
          {/* Both lines start at the SAME edge. The block keeps the panel's
              direction and each sample is an inline isolate inside it (dir on
              an inline element implies unicode-bidi: isolate), so the Arabic
              still shapes and orders right-to-left but is not flung to the
              opposite edge of the box — two faces judged against each other
              have to begin at the same place. */}
          <span className="s-smodal__specline">
            <bdi dir="ltr">{SPECIMEN_LATIN}</bdi>
          </span>
          <span className="s-smodal__specline">
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
function useFontPreview(prose: string, ui: string, mono: string, arabic: string): void {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const q = new URLSearchParams();
      for (const [slot, id] of [["prose", prose], ["ui", ui], ["mono", mono], ["arabic", arabic]]) {
        if (id && id !== SYSTEM_FONT) q.set(slot, id);
      }
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
  }, [prose, ui, mono, arabic]);
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
  { key: "docSiteSettings", anchor: "#site-settings" },
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
 *  a table of contents for a form nobody could see the end of; seven TABS make
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
  const close = useCallback(() => setOpen(false), [setOpen]);

  const [loaded, setLoaded] = useState<SettingsResponse | null>(null);
  const [initial, setInitial] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"favicon" | "logo" | "homeBanner" | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState(TABS[0].id);
  /** Which scroll edges have content beyond them. Without this the content is
   *  sliced flush at the top and bottom of the box and reads as a rendering
   *  bug rather than as something that scrolls. */
  const [edges, setEdges] = useState({ top: false, bottom: false });

  /** Edge fades, from one scroll handler (also run on mount, on resize and on
   *  every tab change, so the state is right before anything is scrolled). */
  const syncScrollState = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const top = body.scrollTop > 2;
    const bottom = body.scrollTop + body.clientHeight < body.scrollHeight - 2;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);

  useEffect(() => {
    syncScrollState();
    window.addEventListener("resize", syncScrollState);
    return () => window.removeEventListener("resize", syncScrollState);
  }, [syncScrollState, form, tab]);

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
  );

  const errors = useMemo(() => (form ? validate(form) : {}), [form]);
  const patch = useMemo(
    () => (form && initial ? buildPatch(initial, form) : {}),
    [form, initial],
  );
  const dirty = Object.keys(patch).length > 0;
  const valid = Object.keys(errors).length === 0;

  const field = <K extends keyof Form>(key: K) => ({
    value: form ? form[key] : "",
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => (f ? { ...f, [key]: e.target.value } : f)),
  });

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
          <span className="s-bmodal__title">
            {t("siteSettings")} — <em>settings.json</em>
          </span>
          <button type="button" className="s-bmodal__close" onClick={close} aria-label={t("close")}>
            ×
          </button>
        </div>

        {loadError && <div className="s-bmodal__empty">{loadError}</div>}
        {!loadError && (!form || !eff) && <div className="s-bmodal__empty">{t("loading")}</div>}

        {form && eff && (
          <div className="s-smodal__cols">
            {/* Seven tabs, not seven anchors: the rail switches what the panel
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
                className="s-smodal__body"
                ref={bodyRef}
                onScroll={syncScrollState}
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
                    <input
                      className="s-bmodal__input"
                      type="text"
                      placeholder={eff.siteName}
                      maxLength={81}
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
                    <input
                      className="s-bmodal__input"
                      type="text"
                      placeholder={eff.tagline ?? "Notes from the canopy…"}
                      maxLength={161}
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
                    <input
                      className="s-bmodal__input"
                      type="text"
                      placeholder={eff.footer ?? "© {year} {siteName}"}
                      maxLength={201}
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
                    <select className="s-bmodal__input s-smodal__select" {...field("defaultTheme")}>
                      <option value="">
                        {tf("inheritOption", { value: themeLabel(eff.defaultTheme) })}
                      </option>
                      {/* Grouped, because fifteen names in one flat list is the
                          same "which of these is dark?" guess the picker
                          exists to end. The GROUP names and the theme labels
                          are both chrome copy now — an Arabic reader met
                          "verdigris" and "porphyry" in Latin script here — but
                          the option VALUE is still the id, which is what
                          settings.defaultTheme and DEFAULT_THEME take. */}
                      {THEME_GROUPS.map((group) => (
                        <optgroup
                          key={group.group}
                          label={t(group.group === "dark" ? "themeGroupDark" : "themeGroupLight")}
                        >
                          {group.themes.map((theme) => (
                            <option key={theme} value={theme}>
                              {`${t(THEME_LABELS[theme].name)} (${theme})`}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </Row>
                  {/* The reader's OWN theme, which is a different thing from
                      the row above it and was previously findable only by
                      clicking a status-bar word until the room changed color.
                      The picker previews live and reverts on Esc. */}
                  <Row label={t("rowYourTheme")} hint={t("hintYourTheme")}>
                    <div className="s-smodal__themepick">
                      {/* The SAME miniature the picker draws, so the row and
                          the panel it opens are visibly the same object. */}
                      <span className="s-tpick__card" data-theme-swatch={theme} aria-hidden="true">
                        <span className="s-tpick__card-rule" />
                        <span className="s-tpick__card-line" />
                        <span className="s-tpick__card-foot">
                          <span className="s-tpick__card-chip" />
                          <span className="s-tpick__card-line s-tpick__card-line--short" />
                        </span>
                      </span>
                      <bdi className="s-smodal__themename">{t(THEME_LABELS[theme].name)}</bdi>
                      <button type="button" className="s-btn" onClick={openThemePicker}>
                        {t("browseThemes")}
                      </button>
                    </div>
                  </Row>
                
                  <div className="s-smodal__sub">{t("groupLanguage")}</div>
                  <Row
                    label={t("rowLanguage")}
                    hint={t("hintLanguage")}
                    inherited={form.language === ""}
                    env="SITE_LANG"
                  >
                    <select className="s-bmodal__input s-smodal__select" {...field("language")}>
                      <option value="">{tf("inheritOption", { value: eff.language })}</option>
                      {/* Language names stay in their own script — that is how a
                          language picker reads to the person who needs it. */}
                      <option value="en">English</option>
                      <option value="ar">العربية</option>
                    </select>
                  </Row>
                  <Row
                    label={t("rowDateLocale")}
                    hint={t("hintDateLocale")}
                    error={errors.blogLocale}
                    inherited={form.blogLocale.trim() === ""}
                    env="BLOG_LOCALE"
                  >
                    <input
                      className="s-bmodal__input"
                      type="text"
                      placeholder={eff.blogLocale}
                      spellCheck={false}
                      dir="ltr"
                      {...field("blogLocale")}
                    />
                  </Row>
                  <Row
                    label={t("rowLanguageFilter")}
                    hint={t("hintLanguageFilter")}
                    inherited={form.languageFilter === ""}
                    env="LANGUAGE_FILTER"
                  >
                    <select className="s-bmodal__input s-smodal__select" {...field("languageFilter")}>
                      <option value="">
                        {tf("inheritOption", { value: eff.languageFilter ? t("on") : t("off") })}
                      </option>
                      <option value="on">{t("on")}</option>
                      <option value="off">{t("off")}</option>
                    </select>
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
                    <select className="s-bmodal__input s-smodal__select" {...field("languageToggle")}>
                      <option value="">
                        {tf("inheritOption", { value: eff.languageToggle ? t("on") : t("off") })}
                      </option>
                      <option value="on">{t("on")}</option>
                      <option value="off">{t("off")}</option>
                    </select>
                  </Row>
                  {(form.languageToggle === "on" || (form.languageToggle === "" && eff.languageToggle)) && (
                    <p className="s-smodal__offnote">{t("visitorSwitchOn")}</p>
                  )}
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
                    <select className="s-bmodal__input s-smodal__select" {...field("publicLayout")}>
                      <option value="">{tf("inheritOption", { value: enumLabel(eff.publicLayout) })}</option>
                      <option value="app">{t("layoutApp")}</option>
                      <option value="blog">{t("layoutBlog")}</option>
                    </select>
                  </Row>
                  <Row
                    label={t("rowExcludeTags")}
                    hint={t("hintExcludeTags")}
                    error={errors.excludeTags}
                    inherited={form.excludeTags.trim() === ""}
                    env="EXCLUDE_TAGS"
                  >
                    <input
                      className="s-bmodal__input"
                      type="text"
                      placeholder={eff.excludeTags.length > 0 ? eff.excludeTags.join(", ") : t("phExcludeTags")}
                      spellCheck={false}
                      {...field("excludeTags")}
                    />
                  </Row>
                  <Row
                    label={t("rowComments")}
                    hint={t("hintComments")}
                    inherited={form.comments === ""}
                    env="COMMENTS"
                  >
                    <select className="s-bmodal__input s-smodal__select" {...field("comments")}>
                      <option value="">
                        {tf("inheritOption", { value: eff.commentsEnabled ? t("on") : t("off") })}
                      </option>
                      <option value="on">{t("on")}</option>
                      <option value="off">{t("off")}</option>
                    </select>
                  </Row>
                  <Row label={t("rowShareButtons")} hint={t("hintShareButtons")}>
                    <select className="s-bmodal__input s-smodal__select" {...field("share")}>
                      <option value="">
                        {tf("inheritOption", { value: eff.shareButtons ? t("on") : t("off") })}
                      </option>
                      <option value="on">{t("on")}</option>
                      <option value="off">{t("off")}</option>
                    </select>
                  </Row>
                  <div className="s-smodal__sub">{t("groupHome")}</div>
                  <p className="s-smodal__note">{t("homeNote")}</p>
                  <Row label={t("rowMode")} hint={t("hintMode")}>
                    <select className="s-bmodal__input s-smodal__select" {...field("homeMode")}>
                      <option value="">{tf("inheritOption", { value: enumLabel(eff.home.mode) })}</option>
                      <option value="note">{t("modeNote")}</option>
                      <option value="dashboard">{t("modeDashboard")}</option>
                    </select>
                  </Row>
                  <Row
                    label={t("rowHomeNote")}
                    hint={t("hintHomeNote")}
                    error={errors.homeNote}
                    inherited={form.homeNote.trim() === ""}
                    env="HOME_NOTE"
                  >
                    <input
                      className="s-bmodal__input"
                      type="text"
                      placeholder={eff.home.note ?? "Welcome.md"}
                      spellCheck={false}
                      dir="ltr"
                      {...field("homeNote")}
                    />
                  </Row>
                  <Row
                    label={t("rowHomeBanner")}
                    hint={t("hintHomeBanner")}
                    error={errors.homeBanner}
                    inherited={form.homeBanner.trim() === ""}
                  >
                    <ImageField
                      value={form.homeBanner}
                      placeholder={t("phVaultImageOrUrl")}
                      invalid={errors.homeBanner !== undefined}
                      onChange={(v) => setForm((f) => (f ? { ...f, homeBanner: v } : f))}
                      onOpenPicker={() => setPicker("homeBanner")}
                    />
                  </Row>
                </section>
                )}

                {tab === "typography" && (
                <section data-section="typography">
                  <Row label={t("rowFontProse")} hint={t("hintFontProse")}>
                    <FontSelect
                      value={form.fontProse}
                      groups={fontGroups(loaded?.fontCatalog ?? [], "text")}
                      onChange={(id) => setForm((f) => (f ? { ...f, fontProse: id } : f))}
                    />
                  </Row>
                  <Row label={t("rowFontUi")} hint={t("hintFontUi")}>
                    <FontSelect
                      value={form.fontUi}
                      groups={fontGroups(loaded?.fontCatalog ?? [], "text")}
                      onChange={(id) => setForm((f) => (f ? { ...f, fontUi: id } : f))}
                    />
                  </Row>
                  <Row label={t("rowFontMono")} hint={t("hintFontMono")}>
                    <FontSelect
                      value={form.fontMono}
                      groups={fontGroups(loaded?.fontCatalog ?? [], "mono")}
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
                    <FontSelect
                      value={form.fontArabic}
                      groups={fontGroups(loaded?.fontCatalog ?? [], "arabic")}
                      onChange={(id) => setForm((f) => (f ? { ...f, fontArabic: id } : f))}
                    />
                  </Row>
                  {/* Full width, directly under the four selects: choosing a
                      face is a compare-and-adjust loop, and it only works when
                      the control and its effect are in the same frame. */}
                  <Row label={t("fontPreview")} hint={t("fontPreviewNote")} wide>
                    <FontSpecimens />
                    <div className="s-smodal__fontfoot">
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
                                }
                              : f,
                          )
                        }
                      >
                        {t("fontReset")}
                      </button>
                    </div>
                  </Row>
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
                  <Row label={t("rowSyncEnabled")} hint={t("hintSyncEnabled")}>
                    <select className="s-bmodal__input s-smodal__select" {...field("syncEnabled")}>
                      <option value="off">{t("off")}</option>
                      <option value="on">{t("on")}</option>
                    </select>
                  </Row>
                  {syncOff && <p className="s-smodal__offnote">{t("syncOffNotice")}</p>}
                  <Row
                    label={t("rowSyncRemote")}
                    hint={t("hintSyncRemote")}
                    error={errors.syncRemote}
                    off={syncOff}
                  >
                    <input
                      className="s-bmodal__input"
                      type="text"
                      placeholder={t("phSyncRemote")}
                      spellCheck={false}
                      dir="ltr"
                      autoComplete="off"
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
                    <input
                      className="s-bmodal__input"
                      type="text"
                      placeholder="main"
                      spellCheck={false}
                      dir="ltr"
                      autoComplete="off"
                      disabled={syncOff}
                      {...field("syncBranch")}
                    />
                  </Row>
                  <Row label={t("rowSyncAuth")} hint={t("hintSyncAuth")} off={syncOff}>
                    <select
                      className="s-bmodal__input s-smodal__select"
                      disabled={syncOff}
                      {...field("syncAuth")}
                    >
                      <option value="ssh">{t("authSsh")}</option>
                      <option value="token">{t("authToken")}</option>
                    </select>
                  </Row>
                  {form.syncAuth === "token" && (
                    <>
                      <Row label={t("rowSyncUser")} hint={t("hintSyncUser")} off={syncOff}>
                        <input
                          className="s-bmodal__input"
                          type="text"
                          placeholder={t("phSyncUser")}
                          spellCheck={false}
                          dir="ltr"
                          autoComplete="off"
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
                          <input
                            className="s-bmodal__input"
                            type="password"
                            placeholder={t(eff.gitSync.tokenSet ? "phTokenStored" : "phTokenNew")}
                            spellCheck={false}
                            dir="ltr"
                            autoComplete="new-password"
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
                    <select
                      className="s-bmodal__input s-smodal__select"
                      disabled={syncOff}
                      {...field("syncPullFirst")}
                    >
                      <option value="on">{t("on")}</option>
                      <option value="off">{t("off")}</option>
                    </select>
                  </Row>
                  <Row
                    label={t("rowSyncInterval")}
                    hint={t("hintSyncInterval")}
                    error={errors.syncInterval}
                    off={syncOff}
                  >
                    <select
                      className="s-bmodal__input s-smodal__select"
                      disabled={syncOff}
                      {...field("syncInterval")}
                    >
                      {intervalChoices.map((minutes) => (
                        <option key={minutes} value={String(minutes)}>
                          {intervalLabel(minutes)}
                        </option>
                      ))}
                    </select>
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
              {/* Content beyond an edge gets a fade, so a sliced heading reads
                  as "there is more" instead of as a rendering bug. */}
              <span
                className={`s-smodal__edge s-smodal__edge--top${edges.top ? " s-smodal__edge--on" : ""}`}
                aria-hidden="true"
              />
              <span
                className={`s-smodal__edge s-smodal__edge--bottom${
                  edges.bottom ? " s-smodal__edge--on" : ""
                }`}
                aria-hidden="true"
              />
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
