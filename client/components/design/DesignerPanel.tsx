// THE DESIGNER — where a blogger designs their public site from inside the
// app. Controls on one side, the live site on the other; nothing is applied
// to the public site until Save.
//
// FOUR THINGS MAKE THIS A DESIGN SURFACE RATHER THAN A SETTINGS FORM:
//
//  1. A DRAFT. Every control writes to a draft, the preview redraws from the
//     draft, and Save is one request. A design is a set of decisions that
//     only makes sense together — shipping each keystroke to the public site
//     would publish six half-designs on the way to one.
//  2. BOUNDS. Every numeric control is a slider between two values that both
//     read well (shared/designChrome.ts, TYPO_BOUNDS). There is no way to
//     type 9px, and no way to reach a 200-character measure. A designer
//     control that lets its owner ship an unreadable site is a bug.
//  3. THE STOCK SWITCH IS IN HERE, AT THE TOP. "Put the site back on the
//     stock blog" is the rescue, so it lives where the trouble is, not three
//     tabs deep in another panel — and it is lossless: the design file is not
//     touched, and switching back returns it exactly as it was.
//  4. THE DESIGN IS A FILE. Named, versioned, exportable, importable, and
//     resettable to stock defaults.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  type DesignChrome,
  type HeadingCase,
  type FontFamilyChoice,
  type HeaderDensity,
  type HeaderLayout,
  type StickyMode,
  type TypoNumberKey,
  stockChrome,
  TYPO_BOUNDS,
} from "../../../shared/designChrome.ts";
import type { PageMeta } from "../../../shared/types.ts";
import { getTags, patchSettings } from "../../api.ts";
import { collectNotes } from "../../editor/links.ts";
import { localeNum, t, tf, type I18nKey } from "../../i18n.ts";
import { notePathToUrl } from "../../router.ts";
import { useStore } from "../../state.ts";
import { toast } from "../../toast.ts";
import { confirmModal } from "../Confirm.tsx";
import { SegmentedControl, TextInput, Toggle } from "../controls/Fields.tsx";
import { isSelectOpen } from "../controls/Select.tsx";
import {
  createDesignDoc,
  deleteDesignDoc,
  duplicateDesignDoc,
  exportDesignDoc,
  getDesignDoc,
  getDesignOverview,
  importDesignDoc,
  resetDesignDoc,
  saveDesignDoc,
  setActiveDesignId,
  type DesignOverview,
} from "../../design/api.ts";
import {
  MAX_SECTIONS,
  newSection,
  stockDesign,
  type DesignDoc,
  type Section,
  type SectionKind,
} from "../../../shared/design.ts";
import { sectionKindLabel } from "../../design/Sections.tsx";
import SectionList from "./SectionList.tsx";
import { SectionOptions, sectionKindHint, type SectionContext } from "./SectionOptions.tsx";
import { designId } from "../../../shared/designChrome.ts";
import { NumberInput } from "../controls/Fields.tsx";
import { Select } from "../controls/Select.tsx";
import { promptModal } from "../Confirm.tsx";
import "../../styles/composer.css";
import DesignPreview from "./DesignPreview.tsx";
import FooterBuilder from "./FooterBuilder.tsx";
import NavBuilder from "./NavBuilder.tsx";
import "../../styles/designer.css";

type Tab = "designs" | "sections" | "nav" | "pages" | "type" | "chrome" | "file";

/** Slider → its label key. A LITERAL table rather than a computed key: a
 *  `t(\`designType_${name}\`)` reads fine and is invisible to check-i18n,
 *  which then reports five live keys as dead and fails the build. */
const TYPE_LABEL: Record<TypoNumberKey, I18nKey> = {
  baseSize: "designTypeBase",
  scale: "designTypeScale",
  measure: "designTypeMeasure",
  lineHeight: "designTypeLine",
  headingWeight: "designTypeWeight",
  rhythm: "designTypeRhythm",
};

/** The copyright field's placeholder. NOT copy and therefore not a dictionary
 *  entry: it is the TEMPLATE SYNTAX, the same two placeholders settings.footer
 *  takes, and it must render exactly as it has to be typed — in both
 *  languages. (It is also why the field is dir="auto": an RTL paragraph
 *  reorders those three tokens, teaching the operator a syntax that does not
 *  work. Same finding as the settings panel's footer row.) */
const COPYRIGHT_TEMPLATE = "© {year} {siteName}";

const TABS: { id: Tab; label: I18nKey; intro: I18nKey }[] = [
  { id: "designs", label: "designTabDesigns", intro: "designTabDesignsIntro" },
  { id: "sections", label: "designTabSections", intro: "designTabSectionsIntro" },
  { id: "nav", label: "designTabNav", intro: "designTabNavIntro" },
  { id: "pages", label: "designTabPages", intro: "designTabPagesIntro" },
  { id: "type", label: "designTabType", intro: "designTabTypeIntro" },
  { id: "chrome", label: "designTabChrome", intro: "designTabChromeIntro" },
  { id: "file", label: "designTabFile", intro: "designTabFileIntro" },
];


/**
 * THE DESIGNS TAB — the store, not one document.
 *
 * A design is a FILE: named, versioned, duplicated, exported, imported and
 * deleted, with exactly one of them ACTIVE. That last word is the one that
 * matters: activating a design does not publish it, because `publicLayout`
 * is a separate switch at the top of this panel. So an author can build a
 * second design against their live site and turn it on in one click — and
 * turn it off in one more, with nothing lost either way.
 */
function DesignsTab({
  admin,
  draft,
  name,
  setName,
  busy,
  setBusy,
  onOpen,
  onRefresh,
  setDoc,
}: {
  admin: DesignOverview | null;
  draft: DesignDoc | null;
  name: string;
  setName: (name: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onOpen: (doc: DesignDoc) => void;
  onRefresh: () => void;
  setDoc: (patch: Partial<DesignDoc>) => void;
}) {
  if (!admin) return <p className="s-dsgr-empty">{t("designLoading")}</p>;

  const run = (work: Promise<unknown>, ok: I18nKey): void => {
    setBusy(true);
    work
      .then(() => {
        onRefresh();
        toast(t(ok));
      })
      .catch((err: unknown) => {
        console.error("vellum: the design store refused that", err);
        toast(t("designSaveFailed"), "error");
      })
      .finally(() => setBusy(false));
  };

  const create = (): void => {
    void promptModal({
      title: t("designNewTitle"),
      placeholder: t("designName"),
      confirmLabel: t("designCreate"),
    }).then((value) => {
      const wanted = (value ?? "").trim();
      if (!wanted) return;
      setBusy(true);
      createDesignDoc(wanted)
        .then((doc) => {
          onOpen(doc);
          onRefresh();
          toast(t("designCreated"));
        })
        .catch((err: unknown) => {
          console.error("vellum: creating the design failed", err);
          toast(t("designSaveFailed"), "error");
        })
        .finally(() => setBusy(false));
    });
  };

  return (
    <>
      <ul className="s-dsgr-list">
        {admin.designs.map((summary) => {
          const open = draft?.id === summary.id;
          const active = admin.activeId === summary.id;
          return (
            <li
              key={summary.id}
              className={`s-dsgr-listrow${open ? " s-dsgr-listrow--open" : ""}`}
            >
              <button
                type="button"
                className="s-dsgr-listrow__name"
                disabled={busy || !!summary.quarantine}
                onClick={() => {
                  void getDesignDoc(summary.id)
                    .then(onOpen)
                    .catch(() => toast(t("designLoadFailed"), "error"));
                }}
              >
                <bdi>{summary.name}</bdi>
                {active && <span className="s-dsgr-listrow__badge">{t("designActive")}</span>}
                {summary.quarantine && (
                  <span className="s-dsgr-listrow__warn">{summary.quarantine}</span>
                )}
              </button>
              <div className="s-dsgr-listrow__acts">
                {!active && !summary.quarantine && (
                  <button
                    type="button"
                    className="s-btn"
                    disabled={busy}
                    onClick={() => run(setActiveDesignId(summary.id), "designActivated")}
                  >
                    {t("designActivate")}
                  </button>
                )}
                <button
                  type="button"
                  className="s-btn"
                  disabled={busy}
                  onClick={() => run(duplicateDesignDoc(summary.id), "designDuplicated")}
                >
                  {t("designDuplicate")}
                </button>
                <button
                  type="button"
                  className="s-btn"
                  disabled={busy}
                  onClick={() => {
                    void confirmModal({
                      title: t("designDeleteTitle"),
                      body: tf("designDeleteBody", { name: summary.name }),
                      confirmLabel: t("delete"),
                    }).then((okd) => {
                      if (okd) run(deleteDesignDoc(summary.id), "designDeleted");
                    });
                  }}
                >
                  {t("delete")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {admin.designs.length === 0 && <p className="s-dsgr-empty">{t("designNoneYet")}</p>}
      <div className="s-dsgr-add">
        <button type="button" className="s-btn s-btn--accent" onClick={create} disabled={busy}>
          {t("designNew")}
        </button>
      </div>
      {draft && (
        <>
          <h2 className="s-dsgr__section">{t("designOpenSection")}</h2>
          <Row label={t("designName")} hint={t("designNameHint")}>
            <TextInput
              value={name}
              onChange={setName}
              label={t("designName")}
              dir="auto"
              maxLength={60}
              placeholder={t("designUnnamed")}
            />
          </Row>
          {/* A design is a look, and a look is a theme plus a layout. Keeping
              them in two panels is how they drift apart. */}
          <Row label={t("designTheme")} hint={t("designThemeHint")}>
            <Select
              value={draft.theme ?? ""}
              onChange={(theme) => setDoc({ theme: theme === "" ? null : theme })}
              options={[
                { value: "", label: t("designThemeInherit") },
                ...admin.themes.map((theme) => ({
                  value: `custom:${theme.id}`,
                  label: theme.name,
                  note: `custom:${theme.id}`,
                })),
              ]}
              label={t("designTheme")}
            />
          </Row>
        </>
      )}
    </>
  );
}

/** A bounded numeric control. The bounds are not decoration and not advice:
 *  min/max/step come from the same table the server validates against, so the
 *  control physically cannot produce a value the PATCH would refuse. */
function Slider({
  name,
  value,
  onChange,
  format,
}: {
  name: TypoNumberKey;
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  const { min, max, step } = TYPO_BOUNDS[name];
  return (
    <div className="s-dsgr-slider">
      <div className="s-dsgr-slider__head">
        <span className="s-dsgr-slider__label">{t(TYPE_LABEL[name])}</span>
        <span className="s-dsgr-slider__value">{format(value)}</span>
      </div>
      <input
        className="s-dsgr-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={t(TYPE_LABEL[name])}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="s-dsgr-slider__ends">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="s-dsgr-ctlrow">
      <div className="s-dsgr-ctlrow__text">
        <span className="s-dsgr-ctlrow__label">{label}</span>
        {hint && <span className="s-dsgr-ctlrow__hint">{hint}</span>}
      </div>
      <div className="s-dsgr-ctlrow__control">{children}</div>
    </div>
  );
}

function DesignerPanel({ onClose }: { onClose: () => void }) {
  const language = useStore((s) => s.language);
  const publicLayout = useStore((s) => s.publicLayout);
  const tree = useStore((s) => s.tree);

  const [tab, setTab] = useState<Tab>("designs");
  const [admin, setAdmin] = useState<DesignOverview | null>(null);
  /** The WHOLE document under edit — sections and chrome together. One draft,
   *  one Save: a design is a set of decisions that only makes sense as a set. */
  const [draft, setDraft] = useState<DesignDoc | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string>(""); // JSON of the last saved doc
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** The add-a-section menu, open or shut. */
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Load the stored design + the two pickers' vocabularies.
  useEffect(() => {
    let disposed = false;
    getDesignOverview()
      .then(async (data) => {
        if (disposed) return;
        setAdmin(data);
        // The ACTIVE design is the one the panel opens on; with an empty store
        // there is nothing to open, and the Designs tab is where you make one.
        const openId = data.activeId ?? data.designs.find((d) => !d.quarantine)?.id ?? null;
        if (!openId) return;
        const doc = await getDesignDoc(openId);
        if (disposed) return;
        setDraft(doc);
        setName(doc.name);
        setSaved(JSON.stringify(doc));
      })
      .catch((err: unknown) => {
        console.error("vellum: loading the design failed", err);
        toast(t("designLoadFailed"), "error");
      });
    getTags()
      .then((list) => {
        if (!disposed) setTags(list.map((entry) => entry.tag));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  // Esc closes — unless a Select popover owns it, which is the same
  // precedence the settings panel and the theme picker already keep.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || isSelectOpen()) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const dirty = draft !== null && JSON.stringify(draft) !== saved;
  const notes = useMemo(() => collectNotes(tree), [tree]);
  const pages: PageMeta[] = admin?.pages ?? [];
  // What the PUBLIC site can reach — posts AND pages, as the server scopes
  // them. The builder flags an item pointing anywhere else, because a menu
  // that looks fine while shipping a dead link is the one thing this panel
  // must never do.
  const visible = useMemo(() => new Set(admin?.visible ?? []), [admin]);
  /** What the section pickers offer. The note list is the vault's, because a
   *  `note` section may point at any note the ADMIN can see — the server
   *  scrubs it per session on the way out (designRoutes.visitorSafe). */
  const sectionCtx: SectionContext = useMemo(
    () => ({ notes, tags, posts: [] }),
    [notes, tags],
  );

  /** Every chrome control writes through here, so the tab bodies below are
   *  unchanged from the day they were written: they still say `set({ nav })`
   *  and still read `chrome.nav`. The document simply owns the chrome now. */
  const set = (patch: Partial<DesignChrome>): void => {
    setDraft((current) => (current ? { ...current, chrome: { ...current.chrome, ...patch } } : current));
  };

  /** The same seam for the rest of the document (sections, site, article). */
  const setDoc = (patch: Partial<DesignDoc>): void => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const setSections = (sections: Section[]): void => setDoc({ sections });

  const patchSection = (id: string, patch: Record<string, unknown>): void => {
    setDraft((current) =>
      current
        ? {
            ...current,
            sections: current.sections.map((s) => (s.id === id ? ({ ...s, ...patch } as Section) : s)),
          }
        : current,
    );
  };

  const addSection = (kind: SectionKind): void => {
    if (!draft || draft.sections.length >= MAX_SECTIONS) return;
    setSections([...draft.sections, newSection(kind, designId())]);
  };

  const moveSection = (from: number, to: number): void => {
    if (!draft) return;
    const next = [...draft.sections];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setSections(next);
  };

  const save = (): void => {
    if (!draft) return;
    setBusy(true);
    saveDesignDoc(draft.id, { ...draft, name: name.trim() || draft.name })
      .then((doc) => {
        // The SERVER's normalization is authoritative: the draft is re-seeded
        // from what was actually stored, so what the panel shows next is what
        // a visitor would get, not what was typed.
        setSaved(JSON.stringify(doc));
        setDraft(doc);
        setName(doc.name);
        void getDesignOverview().then(setAdmin).catch(() => undefined);
        toast(t("designSaved"));
      })
      .catch((err: unknown) => {
        console.error("vellum: saving the design failed", err);
        toast(t("designSaveFailed"), "error");
      })
      .finally(() => setBusy(false));
  };

  const setLayout = (next: string): void => {
    setBusy(true);
    patchSettings({ publicLayout: next as "app" | "blog" | "designed" })
      .then(async () => {
        await useStore.getState().loadMe();
        toast(next === "designed" ? t("designLayoutDesigned") : t("designLayoutStock"));
      })
      .catch((err: unknown) => {
        console.error("vellum: switching the public layout failed", err);
        toast(t("designSaveFailed"), "error");
      })
      .finally(() => setBusy(false));
  };

  const exportDesign = (): void => {
    if (!draft) return;
    void exportDesignDoc(draft.id).then((payload) => {
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "vellum-design").replace(/[^\w-]+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    });
  };

  const runImport = (file: File): void => {
    setBusy(true);
    file
      .text()
      .then((text) => importDesignDoc(JSON.parse(text) as unknown))
      .then((doc) => {
        setDraft(doc);
        setName(doc.name);
        setSaved(JSON.stringify(doc));
        void getDesignOverview().then(setAdmin).catch(() => undefined);
        toast(t("designImported"));
      })
      .catch((err: unknown) => {
        console.error("vellum: importing the design failed", err);
        toast(t("designImportFailed"), "error");
      })
      .finally(() => setBusy(false));
  };

  const runReset = (): void => {
    void confirmModal({
      title: t("designResetTitle"),
      body: t("designResetBody"),
      confirmLabel: t("designResetConfirm"),
    }).then((ok) => {
      if (!ok) return;
      setBusy(true);
      if (!draft) return;
      resetDesignDoc(draft.id)
        .then((doc) => {
          setDraft(doc);
          setName(doc.name);
          setSaved(JSON.stringify(doc));
          toast(t("designReset"));
        })
        .catch((err: unknown) => {
          console.error("vellum: resetting the design failed", err);
          toast(t("designSaveFailed"), "error");
        })
        .finally(() => setBusy(false));
    });
  };

  const chrome = draft?.chrome ?? null;
  const typo = chrome?.typography ?? stockChrome().typography;

  return (
    <div className="s-dsgr-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="s-dsgr" role="dialog" aria-modal="true" aria-label={t("designTitle")} lang={language}>
        <header className="s-dsgr__head">
          <h1 className="s-dsgr__title">{t("designTitle")}</h1>
          <div className="s-dsgr__layout">
            <span className="s-dsgr__layoutlabel">{t("designPublicSite")}</span>
            <SegmentedControl
              value={publicLayout}
              onChange={setLayout}
              disabled={busy}
              label={t("designPublicSite")}
              segments={[
                { value: "app", label: t("designLayoutApp") },
                { value: "blog", label: t("designLayoutBlog") },
                { value: "designed", label: t("designLayoutDesign") },
              ]}
            />
          </div>
          <button type="button" className="s-dsgr__close" aria-label={t("close")} onClick={onClose}>
            ✕
          </button>
        </header>

        {publicLayout !== "designed" && (
          <p className="s-dsgr__offnote">{t("designNotLiveNote")}</p>
        )}
        {/* A design this build cannot render is QUARANTINED, not deleted —
            the bytes stay on disk and the notice names it. */}
        {admin?.designs.some((d) => d.quarantine) && (
          <p className="s-dsgr__offnote">{t("designCorruptNotice")}</p>
        )}

        <div className="s-dsgr__body">
          <nav className="s-dsgr__rail" role="tablist" aria-label={t("designSections")}>
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className={`s-dsgr__tab${tab === entry.id ? " s-dsgr__tab--on" : ""}`}
                onClick={() => setTab(entry.id)}
              >
                {t(entry.label as "designTabNav")}
              </button>
            ))}
          </nav>

          <div className="s-dsgr__controls" data-popbounds>
            <p className="s-dsgr__intro">
              {t((TABS.find((x) => x.id === tab)?.intro ?? "designTabNavIntro") as "designTabNavIntro")}
            </p>

            {tab === "designs" ? (
              <DesignsTab
                admin={admin}
                draft={draft}
                name={name}
                setName={setName}
                busy={busy}
                setBusy={setBusy}
                onOpen={(doc) => {
                  setDraft(doc);
                  setName(doc.name);
                  setSaved(JSON.stringify(doc));
                }}
                onRefresh={() => void getDesignOverview().then(setAdmin).catch(() => undefined)}
                setDoc={setDoc}
              />
            ) : chrome === null || draft === null ? (
              <p className="s-dsgr-empty">{t("designNoneYet")}</p>
            ) : tab === "sections" ? (
              <>
                <SectionList
                  items={draft.sections.map((section) => ({
                    id: section.id,
                    type: section.kind,
                    enabled: !section.hidden,
                  }))}
                  label={(row) => sectionKindLabel(row.type)}
                  desc={(row) => sectionKindHint(row.type)}
                  renderOptions={(row) => {
                    const section = draft.sections.find((s) => s.id === row.id);
                    if (!section) return null;
                    return (
                      <SectionOptions
                        section={section}
                        ctx={sectionCtx}
                        onChange={(patch) => patchSection(section.id, patch)}
                      />
                    );
                  }}
                  onReorder={moveSection}
                  // `hidden` is the stored field; the list speaks in "enabled",
                  // which is the same fact the other way up.
                  onToggle={(id, enabled) => patchSection(id, { hidden: !enabled })}
                  onRemove={(id) => setSections(draft.sections.filter((s) => s.id !== id))}
                />
                <div className="s-dsnc-addwrap">
                  <button
                    type="button"
                    className="s-btn s-dsnc-addbtn"
                    aria-expanded={adding}
                    disabled={draft.sections.length >= MAX_SECTIONS}
                    onClick={() => setAdding((v) => !v)}
                  >
                    <span aria-hidden="true">+</span> {t("dsoAddSection")}
                  </button>
                  {adding && (
                    <div className="s-dsnc-add">
                      {/* The menu is built from the schema's own list, so a
                          section kind added to shared/design.ts is reachable
                          here without a second edit. */}
                      {(admin?.sectionKinds ?? []).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className="s-dsnc-addcard"
                          onClick={() => {
                            addSection(kind);
                            setAdding(false);
                          }}
                        >
                          <span className="s-dsnc-addcard__name">{sectionKindLabel(kind)}</span>
                          <span className="s-dsnc-addcard__desc">{sectionKindHint(kind)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <h2 className="s-dsgr__section">{t("dsoPageSection")}</h2>
                <Row label={t("dsoWidth")} hint={t("dsoWidthHint")}>
                  <NumberInput
                    value={String(draft.site.width)}
                    label={t("dsoWidth")}
                    unit="px"
                    min={520}
                    max={1400}
                    onChange={(raw) => {
                      const n = Number(raw);
                      if (raw.trim() === "" || !Number.isFinite(n)) return;
                      setDoc({ site: { ...draft.site, width: Math.min(1400, Math.max(520, Math.round(n))) } });
                    }}
                  />
                </Row>
                <Row label={t("dsoDensity")}>
                  <SegmentedControl
                    value={draft.site.density}
                    onChange={(v) =>
                      setDoc({ site: { ...draft.site, density: v as "compact" | "regular" | "roomy" } })
                    }
                    label={t("dsoDensity")}
                    segments={[
                      { value: "compact", label: t("dsoCompact") },
                      { value: "regular", label: t("dsoRegular") },
                      { value: "roomy", label: t("dsoRoomy") },
                    ]}
                  />
                </Row>
                <h2 className="s-dsgr__section">{t("dsoArticleSection")}</h2>
                {(
                  [
                    ["showBanner", "dsoArtBanner"],
                    ["showMeta", "dsoArtMeta"],
                    ["showTags", "dsoArtTags"],
                    ["showRelated", "dsoArtRelated"],
                    ["showBackLink", "dsoArtBack"],
                  ] as const
                ).map(([key, label]) => (
                  <Row key={key} label={t(label)}>
                    <Toggle
                      value={draft.article[key]}
                      onChange={(on) => setDoc({ article: { ...draft.article, [key]: on } })}
                      label={t(label)}
                      onLabel={t("on")}
                      offLabel={t("off")}
                    />
                  </Row>
                ))}
              </>
            ) : tab === "nav" ? (
              <>
                <NavBuilder
                  items={chrome.nav.items}
                  onChange={(items) => set({ nav: { ...chrome.nav, items } })}
                  notes={notes}
                  pages={pages}
                  tags={tags}
                  visible={visible}
                />
                <Row label={t("designNavFallback")} hint={t("designNavFallbackHint")}>
                  <SegmentedControl
                    value={chrome.nav.fallback}
                    onChange={(value) =>
                      set({ nav: { ...chrome.nav, fallback: value as "topics" | "none" } })
                    }
                    label={t("designNavFallback")}
                    segments={[
                      { value: "topics", label: t("designFallbackTopics") },
                      { value: "none", label: t("designFallbackNone") },
                    ]}
                  />
                </Row>
                <Row label={t("designShowSearch")}>
                  <Toggle
                    value={chrome.nav.showSearch}
                    onChange={(on) => set({ nav: { ...chrome.nav, showSearch: on } })}
                    label={t("designShowSearch")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
                <Row label={t("designShowTheme")}>
                  <Toggle
                    value={chrome.nav.showThemeToggle}
                    onChange={(on) => set({ nav: { ...chrome.nav, showThemeToggle: on } })}
                    label={t("designShowTheme")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
                <Row label={t("designShowLang")} hint={t("designShowLangHint")}>
                  <Toggle
                    value={chrome.nav.showLangSwitch}
                    onChange={(on) => set({ nav: { ...chrome.nav, showLangSwitch: on } })}
                    label={t("designShowLang")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
              </>
            ) : tab === "pages" ? (
              <div className="s-dsgr-pages">
                <p className="s-dsgr__prose">{t("designPagesHow")}</p>
                <pre className="s-dsgr__code" dir="ltr">
                  {"---\npublish: true\npage: true\n---"}
                </pre>
                <p className="s-dsgr__prose">{t("designPagesEffect")}</p>
                {pages.length === 0 ? (
                  <p className="s-dsgr-empty">{t("designNoPages")}</p>
                ) : (
                  <ul className="s-dsgr-pagelist">
                    {pages.map((page) => (
                      <li key={page.path}>
                        <span className="s-dsgr-pagelist__title" dir="auto">
                          {page.title}
                        </span>
                        <span className="s-dsgr-pagelist__url" dir="ltr">
                          {notePathToUrl(page.path)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="s-dsgr__prose">{tf("designPagesCount", { n: localeNum(pages.length) })}</p>
              </div>
            ) : tab === "type" ? (
              <>
                <Slider
                  name="baseSize"
                  value={typo.baseSize}
                  onChange={(value) => set({ typography: { ...typo, baseSize: value } })}
                  format={(v) => `${localeNum(v)} px`}
                />
                <Slider
                  name="scale"
                  value={typo.scale}
                  onChange={(value) => set({ typography: { ...typo, scale: value } })}
                  format={(v) => v.toFixed(3)}
                />
                <Slider
                  name="measure"
                  value={typo.measure}
                  onChange={(value) => set({ typography: { ...typo, measure: value } })}
                  format={(v) => `${localeNum(v)} ch`}
                />
                <Slider
                  name="lineHeight"
                  value={typo.lineHeight}
                  onChange={(value) => set({ typography: { ...typo, lineHeight: value } })}
                  format={(v) => v.toFixed(2)}
                />
                <Slider
                  name="headingWeight"
                  value={typo.headingWeight}
                  onChange={(value) => set({ typography: { ...typo, headingWeight: value } })}
                  format={(v) => localeNum(v)}
                />
                <Slider
                  name="rhythm"
                  value={typo.rhythm}
                  onChange={(value) => set({ typography: { ...typo, rhythm: value } })}
                  format={(v) => `${localeNum(Math.round(v * 100))} %`}
                />
                <Row label={t("designHeadingCase")}>
                  <SegmentedControl
                    value={typo.headingCase}
                    onChange={(value) =>
                      set({ typography: { ...typo, headingCase: value as HeadingCase } })
                    }
                    label={t("designHeadingCase")}
                    segments={[
                      { value: "normal", label: t("designCaseNormal") },
                      { value: "smallcaps", label: t("designCaseSmall") },
                      { value: "uppercase", label: t("designCaseUpper") },
                    ]}
                  />
                </Row>
                <Row label={t("designHeadingFamily")} hint={t("designFamilyHint")}>
                  <SegmentedControl
                    value={typo.headingFamily}
                    onChange={(value) =>
                      set({ typography: { ...typo, headingFamily: value as FontFamilyChoice } })
                    }
                    label={t("designHeadingFamily")}
                    segments={[
                      { value: "serif", label: t("designSerif") },
                      { value: "sans", label: t("designSans") },
                    ]}
                  />
                </Row>
                <Row label={t("designBodyFamily")} hint={t("designFamilyHint")}>
                  <SegmentedControl
                    value={typo.bodyFamily}
                    onChange={(value) =>
                      set({ typography: { ...typo, bodyFamily: value as FontFamilyChoice } })
                    }
                    label={t("designBodyFamily")}
                    segments={[
                      { value: "serif", label: t("designSerif") },
                      { value: "sans", label: t("designSans") },
                    ]}
                  />
                </Row>
                <p className="s-dsgr__prose">{t("designBoundsNote")}</p>
              </>
            ) : tab === "chrome" ? (
              <>
                <h2 className="s-dsgr__section">{t("designHeaderSection")}</h2>
                <Row label={t("designHeaderLayout")}>
                  <SegmentedControl
                    value={chrome.header.layout}
                    onChange={(value) =>
                      set({ header: { ...chrome.header, layout: value as HeaderLayout } })
                    }
                    label={t("designHeaderLayout")}
                    segments={[
                      { value: "stacked", label: t("designLayoutStacked") },
                      { value: "stackedStart", label: t("designLayoutStart") },
                      { value: "inline", label: t("designLayoutInline") },
                    ]}
                  />
                </Row>
                <Row label={t("designHeaderDensity")}>
                  <SegmentedControl
                    value={chrome.header.density}
                    onChange={(value) =>
                      set({ header: { ...chrome.header, density: value as HeaderDensity } })
                    }
                    label={t("designHeaderDensity")}
                    segments={[
                      { value: "compact", label: t("designDensityCompact") },
                      { value: "regular", label: t("designDensityRegular") },
                      { value: "tall", label: t("designDensityTall") },
                    ]}
                  />
                </Row>
                <Row label={t("designSticky")} hint={t("designStickyHint")}>
                  <SegmentedControl
                    value={chrome.header.sticky}
                    onChange={(value) =>
                      set({ header: { ...chrome.header, sticky: value as StickyMode } })
                    }
                    label={t("designSticky")}
                    segments={[
                      { value: "none", label: t("designStickyNone") },
                      { value: "nav", label: t("designStickyNav") },
                      { value: "header", label: t("designStickyHeader") },
                    ]}
                  />
                </Row>
                <Row label={t("designShowLogo")} hint={t("designShowLogoHint")}>
                  <Toggle
                    value={chrome.header.showLogo}
                    onChange={(on) => set({ header: { ...chrome.header, showLogo: on } })}
                    label={t("designShowLogo")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
                <Row label={t("designShowName")}>
                  <Toggle
                    value={chrome.header.showName}
                    onChange={(on) => set({ header: { ...chrome.header, showName: on } })}
                    label={t("designShowName")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
                <Row label={t("designShowTagline")}>
                  <Toggle
                    value={chrome.header.showTagline}
                    onChange={(on) => set({ header: { ...chrome.header, showTagline: on } })}
                    label={t("designShowTagline")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
                <Row label={t("designDivider")}>
                  <Toggle
                    value={chrome.header.divider}
                    onChange={(on) => set({ header: { ...chrome.header, divider: on } })}
                    label={t("designDivider")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>

                <h2 className="s-dsgr__section">{t("designFooterSection")}</h2>
                <FooterBuilder
                  columns={chrome.footer.columns}
                  onChange={(columns) => set({ footer: { ...chrome.footer, columns } })}
                />
                <Row label={t("designCopyright")} hint={t("designCopyrightHint")}>
                  <TextInput
                    value={chrome.footer.copyright}
                    onChange={(value) => set({ footer: { ...chrome.footer, copyright: value } })}
                    label={t("designCopyright")}
                    dir="auto"
                    placeholder={COPYRIGHT_TEMPLATE}
                    maxLength={200}
                  />
                </Row>
                <Row label={t("designShowCopyright")}>
                  <Toggle
                    value={chrome.footer.showCopyright}
                    onChange={(on) => set({ footer: { ...chrome.footer, showCopyright: on } })}
                    label={t("designShowCopyright")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
                <Row label={t("designFooterAlign")}>
                  <SegmentedControl
                    value={chrome.footer.align}
                    onChange={(value) =>
                      set({ footer: { ...chrome.footer, align: value as "start" | "center" } })
                    }
                    label={t("designFooterAlign")}
                    segments={[
                      { value: "start", label: t("designAlignStart") },
                      { value: "center", label: t("designAlignCenter") },
                    ]}
                  />
                </Row>
                <Row label={t("designShowRss")}>
                  <Toggle
                    value={chrome.footer.showRss}
                    onChange={(on) => set({ footer: { ...chrome.footer, showRss: on } })}
                    label={t("designShowRss")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
                <Row label={t("designShowHint")}>
                  <Toggle
                    value={chrome.footer.showSearchHint}
                    onChange={(on) => set({ footer: { ...chrome.footer, showSearchHint: on } })}
                    label={t("designShowHint")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
                <Row label={t("designShowPowered")}>
                  <Toggle
                    value={chrome.footer.showPoweredBy}
                    onChange={(on) => set({ footer: { ...chrome.footer, showPoweredBy: on } })}
                    label={t("designShowPowered")}
                    onLabel={t("on")}
                    offLabel={t("off")}
                  />
                </Row>
              </>
            ) : (
              <>
                <Row label={t("designName")} hint={t("designNameHint")}>
                  <TextInput
                    value={name}
                    onChange={setName}
                    label={t("designName")}
                    placeholder={t("designUnnamed")}
                    maxLength={60}
                  />
                </Row>
                <div className="s-dsgr-add">
                  <button type="button" className="s-dsgr-add__btn" onClick={exportDesign} disabled={busy}>
                    {t("designExport")}
                  </button>
                  <button
                    type="button"
                    className="s-dsgr-add__btn"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                  >
                    {t("designImport")}
                  </button>
                  <button type="button" className="s-dsgr-add__btn" onClick={runReset} disabled={busy}>
                    {t("designReset")}
                  </button>
                </div>
                <input
                  ref={fileRef}
                  className="s-dsgr-file"
                  type="file"
                  accept="application/json,.json"
                  aria-label={t("designImport")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) runImport(file);
                  }}
                />
                <p className="s-dsgr__prose">{t("designFileNote")}</p>
              </>
            )}
          </div>

          <div className="s-dsgr__preview">
            <div className="s-dsgr__previewhead">{t("designPreview")}</div>
            {chrome && <DesignPreview chrome={chrome} />}
          </div>
        </div>

        <footer className="s-dsgr__foot">
          <span className="s-dsgr__state">{dirty ? t("designUnsaved") : t("designAllSaved")}</span>
          <button
            type="button"
            className="s-btn"
            onClick={() => {
              if (saved) {
                const doc = JSON.parse(saved) as DesignDoc;
                setDraft(doc);
                setName(doc.name);
              }
            }}
            disabled={!dirty || busy}
          >
            {t("designDiscard")}
          </button>
          <button type="button" className="s-btn s-btn--accent" onClick={save} disabled={!dirty || busy}>
            {t("designSave")}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── Mounting (the ThemePicker pattern: a root on <body>) ────────────────────

let host: HTMLDivElement | null = null;
let root: Root | null = null;

export function isDesignerOpen(): boolean {
  return host !== null;
}

export function closeDesigner(): void {
  if (!root || !host) return;
  const [r, h] = [root, host];
  root = null;
  host = null;
  // A later tick: React refuses to unmount a root while it is rendering, and
  // this is called from inside the panel's own handlers.
  setTimeout(() => {
    r.unmount();
    h.remove();
  }, 0);
}

export function openDesigner(): void {
  if (host) return;
  host = document.createElement("div");
  host.className = "s-dsgr-host";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<DesignerPanel onClose={closeDesigner} />);
}

export default DesignerPanel;
