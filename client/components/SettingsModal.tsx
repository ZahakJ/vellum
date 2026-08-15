// Site settings panel (admin): edits VELLUM_DATA/settings.json through
// GET/PATCH /api/settings. Two-column label/control rows in three groups —
// Identity / Home page / Site behavior. Text fields left empty inherit the
// env default (shown as the placeholder); a filled field overrides it. Saving
// PATCHes only the keys that changed, then refreshes /api/me so the wordmark,
// layout, theme default, and favicon apply live — no reload.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type { SettingsPatch, SettingsResponse } from "../../shared/types.ts";
import { getSettings, listAttachments, patchSettings, uploadAttachment } from "../api.ts";
import { bannerSrc } from "../banner.ts";
import { countPhrase, localeNum, t, tf, type I18nKey } from "../i18n.ts";
import { UPLOAD_MAX_MB } from "../../shared/limits.ts";
import { THEMES, useStore } from "../state.ts";
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
  excludeTags: string;  // comma-separated
  comments: string;     // "" | "on" | "off"
  share: string;        // "" | "on" | "off" (blog article share row; default off)
  favicon: string;      // vault path or ""
  logo: string;         // vault path / https URL or ""
  homeMode: string;     // "" | "note" | "dashboard"
  homeNote: string;
  homeBanner: string;
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
    excludeTags: (s.excludeTags ?? []).join(", "),
    comments: s.commentsEnabled === undefined ? "" : s.commentsEnabled ? "on" : "off",
    share: s.shareButtons === undefined ? "" : s.shareButtons ? "on" : "off",
    favicon: s.favicon ?? "",
    logo: s.logo ?? "",
    homeMode: s.home?.mode ?? "",
    homeNote: s.home?.note ?? "",
    homeBanner: s.home?.banner ?? "",
  };
}

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
  return errors;
}

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
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={`s-smodal__row${error ? " s-smodal__row--invalid" : ""}`}>
      <div className="s-smodal__label">
        {label}
        {hint && <span className="s-smodal__hint">{hint}</span>}
      </div>
      <div className="s-smodal__control">
        {children}
        {error && <span className="s-smodal__error">{error}</span>}
      </div>
    </div>
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
// The panel
// ---------------------------------------------------------------------------

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
        toast(err instanceof Error ? err.message : t("settingsSaveFailed"));
      })
      .finally(() => setSaving(false));
  }, [form, initial, saving]);

  const eff = loaded?.effective;

  return (
    <div className="s-palette-overlay" onMouseDown={close}>
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
          <div className="s-smodal__body">
            <p className="s-smodal__note">{t("settingsNote")}</p>

            <div className="s-smodal__group">{t("groupIdentity")}</div>
            <Row label={t("rowSiteName")} error={errors.siteName}>
              <input
                className="s-bmodal__input"
                type="text"
                placeholder={eff.siteName}
                maxLength={81}
                {...field("siteName")}
              />
            </Row>
            <Row label={t("rowTagline")} hint={t("hintTagline")} error={errors.tagline}>
              <input
                className="s-bmodal__input"
                type="text"
                placeholder={eff.tagline ?? "Notes from the canopy…"}
                maxLength={161}
                {...field("tagline")}
              />
            </Row>
            <Row label={t("rowFooter")} hint={t("hintFooter")} error={errors.footer}>
              <input
                className="s-bmodal__input"
                type="text"
                placeholder={eff.footer ?? "© {year} {siteName}"}
                maxLength={201}
                {...field("footer")}
              />
            </Row>
            <Row label={t("rowLogo")} hint={t("hintLogo")} error={errors.logo}>
              <ImageField
                value={form.logo}
                placeholder={t("phVaultImageOrUrl")}
                invalid={errors.logo !== undefined}
                onChange={(v) => setForm((f) => (f ? { ...f, logo: v } : f))}
                onOpenPicker={() => setPicker("logo")}
              />
            </Row>
            <Row label={t("rowFavicon")} hint={t("hintFavicon")} error={errors.favicon}>
              <ImageField
                value={form.favicon}
                placeholder={t("phVaultIcon")}
                invalid={errors.favicon !== undefined}
                onChange={(v) => setForm((f) => (f ? { ...f, favicon: v } : f))}
                onOpenPicker={() => setPicker("favicon")}
              />
            </Row>

            <div className="s-smodal__group">{t("groupHome")}</div>
            <Row label={t("rowMode")} hint={t("hintMode")}>
              <select className="s-bmodal__input s-smodal__select" {...field("homeMode")}>
                <option value="">{tf("inheritOption", { value: enumLabel(eff.home.mode) })}</option>
                <option value="note">{t("modeNote")}</option>
                <option value="dashboard">{t("modeDashboard")}</option>
              </select>
            </Row>
            <Row label={t("rowHomeNote")} hint={t("hintHomeNote")} error={errors.homeNote}>
              <input
                className="s-bmodal__input"
                type="text"
                placeholder={eff.home.note ?? "Welcome.md"}
                spellCheck={false}
                dir="ltr"
                {...field("homeNote")}
              />
            </Row>
            <Row label={t("rowHomeBanner")} hint={t("hintHomeBanner")} error={errors.homeBanner}>
              <ImageField
                value={form.homeBanner}
                placeholder={t("phVaultImageOrUrl")}
                invalid={errors.homeBanner !== undefined}
                onChange={(v) => setForm((f) => (f ? { ...f, homeBanner: v } : f))}
                onOpenPicker={() => setPicker("homeBanner")}
              />
            </Row>

            <div className="s-smodal__group">{t("groupBehavior")}</div>
            <Row label={t("rowDefaultTheme")} hint={t("hintDefaultTheme")}>
              <select className="s-bmodal__input s-smodal__select" {...field("defaultTheme")}>
                <option value="">
                  {tf("inheritOption", { value: eff.defaultTheme ?? "iron-gall" })}
                </option>
                {THEMES.map((theme) => (
                  <option key={theme} value={theme}>
                    {theme}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t("rowPublicLayout")} hint={t("hintPublicLayout")}>
              <select className="s-bmodal__input s-smodal__select" {...field("publicLayout")}>
                <option value="">{tf("inheritOption", { value: enumLabel(eff.publicLayout) })}</option>
                <option value="app">{t("layoutApp")}</option>
                <option value="blog">{t("layoutBlog")}</option>
              </select>
            </Row>
            <Row label={t("rowLanguage")} hint={t("hintLanguage")}>
              <select className="s-bmodal__input s-smodal__select" {...field("language")}>
                <option value="">{tf("inheritOption", { value: eff.language })}</option>
                {/* Language names stay in their own script — that is how a
                    language picker reads to the person who needs it. */}
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </Row>
            <Row label={t("rowLanguageFilter")} hint={t("hintLanguageFilter")}>
              <select className="s-bmodal__input s-smodal__select" {...field("languageFilter")}>
                <option value="">
                  {tf("inheritOption", { value: eff.languageFilter ? t("on") : t("off") })}
                </option>
                <option value="on">{t("on")}</option>
                <option value="off">{t("off")}</option>
              </select>
            </Row>
            <Row label={t("rowDateLocale")} hint={t("hintDateLocale")} error={errors.blogLocale}>
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
              label={t("rowExcludeTags")}
              hint={t("hintExcludeTags")}
              error={errors.excludeTags}
            >
              <input
                className="s-bmodal__input"
                type="text"
                placeholder={eff.excludeTags.length > 0 ? eff.excludeTags.join(", ") : t("phExcludeTags")}
                spellCheck={false}
                {...field("excludeTags")}
              />
            </Row>
            <Row label={t("rowComments")} hint={t("hintComments")}>
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
          </div>
        )}

        <div className="s-smodal__foot">
          <span className="s-smodal__dirty">
            {saving
              ? t("saving")
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
