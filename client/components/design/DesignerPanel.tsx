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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDialog } from "../../a11y.ts";
import {
  type ChromeOrnament,
  type ChromeScenery,
  type ChromeSurface,
  type DesignChrome,
  type FooterForm,
  type HeadingCase,
  type FontFamilyChoice,
  type HeaderDensity,
  type HeaderLayout,
  type NavStyle,
  type StickyMode,
  type TypoNumberKey,
  stockChrome,
  TYPO_BOUNDS,
} from "../../../shared/designChrome.ts";
import type { PageMeta } from "../../../shared/types.ts";
import { getTags, patchSettings } from "../../api.ts";
import { collectNotes } from "../../editor/links.ts";
import { countPhrase, localeNum, t, tf, type I18nKey } from "../../i18n.ts";
import { shortcutKey } from "../../keys.ts";
import { notePathToUrl } from "../../router.ts";
import { useStore } from "../../state.ts";
import { toast } from "../../toast.ts";
import { actionToast } from "../../undoToast.ts";
import { confirmModal, isConfirmOpen } from "../Confirm.tsx";
import { SegmentedControl, TextInput, Toggle } from "../controls/Fields.tsx";
import { FontPicker, SYSTEM_FONT } from "../FontPicker.tsx";
import { catalogList } from "../../../shared/fontCatalog.ts";
import { designFontRefs } from "../../../shared/designChrome.ts";
import { setDesignFonts } from "../../design/designFonts.ts";
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
  DESIGN_IMPORT_MAX_BYTES,
  designErrorText,
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
import SectionPicker, { isSectionPickerOpen } from "./SectionPicker.tsx";
import SectionGlyph from "./SectionGlyph.tsx";
import { TabGlyph } from "./PanelGlyphs.tsx";
import { SectionOptions, sectionKindHint, type SectionContext } from "./SectionOptions.tsx";
import { designId } from "../../../shared/designChrome.ts";
import { NumberInput } from "../controls/Fields.tsx";
import { promptModal } from "../Confirm.tsx";
import DesignThemeCards from "./DesignThemeCards.tsx";
import "../../styles/composer.css";
import FooterBuilder from "./FooterBuilder.tsx";
import NavBuilder from "./NavBuilder.tsx";
import "../../styles/designer.css";
// THE PREVIEW IS THE COMPOSED PAGE NOW, IN A VIEWPORT OF ITS OWN. It used to
// be the chrome around a typography specimen, so the six controls that shape
// the page — every section, the column width, the density, the grid columns,
// the banners — changed nothing on screen. `PreviewStage` puts the real
// renderers in a real nested document at a real device width; the specimen is
// still one click away, because an article page IS the specimen and is also a
// real page of the design.
import PreviewStage from "./PreviewStage.tsx";
import { usePreviewBuild } from "../../design/previewContent.tsx";
import PresetGallery, { closePresetDetail, isPresetDetailOpen, loadPresets } from "./PresetGallery.tsx";
import { presetExport, type Preset } from "../../../shared/presets.ts";
import type { PostMeta } from "../../../shared/types.ts";

type Tab = "designs" | "presets" | "sections" | "nav" | "pages" | "type" | "chrome" | "file";

/** The rail's groups. Eight tabs in one column is a menu; three named runs of
 *  two or three is a place with rooms in it — and the names are the author's
 *  own question ("which design am I editing", "what is on the page", "what
 *  does it look like"), not our file layout. */
type RailGroup = { label: I18nKey; tabs: Tab[] };

/** Slider → its label key. A LITERAL table rather than a computed key: a
 *  `t(\`designType_${name}\`)` reads fine and is invisible to check-i18n,
 *  which then reports five live keys as dead and fails the build. */
const TYPE_LABEL: Record<TypoNumberKey, I18nKey> = {
  baseSize: "designTypeBase",
  scale: "designTypeScale",
  measure: "designTypeMeasure",
  lineHeight: "designTypeLine",
  headingWeight: "designTypeWeight",
  tracking: "designTypeTracking",
  rhythm: "designTypeRhythm",
};

/** The faces a typography block asks for, as one comparable string. Two
 *  callers: the effect that keeps the draft's `<link>` current, and the save
 *  handler deciding whether the PUBLIC site's stylesheet URL just moved. */
function faceSpecOf(typo: DesignChrome["typography"]): string {
  return designFontRefs(typo)
    .map((ref) => `${ref.slot}:${ref.id}`)
    .join(",");
}

/** The copyright field's placeholder. NOT copy and therefore not a dictionary
 *  entry: it is the TEMPLATE SYNTAX, the same two placeholders settings.footer
 *  takes, and it must render exactly as it has to be typed — in both
 *  languages. (It is also why the field is dir="auto": an RTL paragraph
 *  reorders those three tokens, teaching the operator a syntax that does not
 *  work. Same finding as the settings panel's footer row.) */
const COPYRIGHT_TEMPLATE = "© {year} {siteName}";

const TABS: { id: Tab; label: I18nKey; intro: I18nKey }[] = [
  { id: "designs", label: "designTabDesigns", intro: "designTabDesignsIntro" },
  { id: "presets", label: "designTabPresets", intro: "designTabPresetsIntro" },
  { id: "sections", label: "designTabSections", intro: "designTabSectionsIntro" },
  { id: "nav", label: "designTabNav", intro: "designTabNavIntro" },
  { id: "pages", label: "designTabPages", intro: "designTabPagesIntro" },
  { id: "type", label: "designTabType", intro: "designTabTypeIntro" },
  { id: "chrome", label: "designTabChrome", intro: "designTabChromeIntro" },
  { id: "file", label: "designTabFile", intro: "designTabFileIntro" },
];

const RAIL: RailGroup[] = [
  { label: "designGroupLibrary", tabs: ["designs", "presets"] },
  { label: "designGroupPage", tabs: ["sections", "nav", "pages"] },
  { label: "designGroupLook", tabs: ["type", "chrome"] },
  { label: "designGroupFile", tabs: ["file"] },
];

/**
 * HOW MANY DECISIONS ARE WAITING TO BE SAVED.
 *
 * "Unsaved changes" is true and says nothing; "4 changes not saved yet" is the
 * difference between a footer an author reads once and a footer they can act
 * on. The count has to be COUNTED THE WAY AN AUTHOR COUNTS, though, which is
 * why this is not a leaf-wise diff of two JSON blobs: moving one section in a
 * list of seven rewrites six array slots, and a bar reading "31 changes"
 * after one drag is worse than no number at all.
 *
 * So sections are compared BY ID — one change for an edited section, one for
 * each added or removed, one for the order — and everything else (the chrome,
 * the page, the article page, the name, the theme) is compared leaf by leaf,
 * where a leaf really is one decision an author made with one control.
 */
export function countChanges(before: DesignDoc | null, after: DesignDoc | null): number {
  if (!before || !after) return 0;
  let n = 0;
  const byId = (list: Section[]): Map<string, string> =>
    new Map(list.map((section) => [section.id, JSON.stringify(section)]));
  const was = byId(before.sections);
  const now = byId(after.sections);
  for (const [id, json] of now) {
    const previous = was.get(id);
    if (previous === undefined || previous !== json) n++;
  }
  for (const id of was.keys()) if (!now.has(id)) n++;
  // The ORDER counts once, and only over the sections BOTH documents have: an
  // added or removed section already counted itself (charging it twice makes
  // one act read as two), while a move made in the same sitting as an add is
  // a second decision and has to show up as one.
  const order = (list: Section[], keep: Map<string, string>): string =>
    list
      .map((section) => section.id)
      .filter((id) => keep.has(id))
      .join(",");
  if (order(before.sections, now) !== order(after.sections, was)) n++;
  n += leafChanges(
    { name: before.name, theme: before.theme, site: before.site, article: before.article, chrome: before.chrome },
    { name: after.name, theme: after.theme, site: after.site, article: after.article, chrome: after.chrome },
  );
  return n;
}

/** Leaf-by-leaf, where a leaf is one control. Arrays are one leaf: a nav item
 *  list is edited by its own builder, and "the menu changed" is the fact. */
function leafChanges(before: unknown, after: unknown): number {
  if (before === after) return 0;
  const both =
    typeof before === "object" && before !== null && !Array.isArray(before) &&
    typeof after === "object" && after !== null && !Array.isArray(after);
  if (!both) return JSON.stringify(before) === JSON.stringify(after) ? 0 : 1;
  const keys = new Set([
    ...Object.keys(before as Record<string, unknown>),
    ...Object.keys(after as Record<string, unknown>),
  ]);
  let n = 0;
  for (const key of keys) {
    n += leafChanges(
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
    );
  }
  return n;
}


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
  onBrowsePresets,
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
  /** Send the author to the gallery. The panel owns the rail, so the tab is
   *  the panel's to change — this list only knows that "look at the finished
   *  ones" is the other answer to an empty store. */
  onBrowsePresets: () => void;
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
        toast(designErrorText(err, t("designSaveFailed")), "error");
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
          toast(designErrorText(err, t("designSaveFailed")), "error");
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
      {/* AN EMPTY STORE IS THE FIRST SCREEN OF A FRESH INSTANCE — the panel
          opens on this tab — so it is the invitation with both doors on it,
          not a line reporting that a list is empty. */}
      {admin.designs.length === 0 ? (
        <div className="s-dsgr-invite">
          <span className="s-dsgr-invite__art" aria-hidden="true">
            <SectionGlyph kind="hero" size="card" />
            <SectionGlyph kind="postGrid" size="card" />
            <SectionGlyph kind="postList" size="card" />
          </span>
          <h2 className="s-dsgr-invite__title">{t("designEmptyTitle")}</h2>
          <p className="s-dsgr-invite__body">{t("designEmptyBody")}</p>
          <div className="s-dsgr-invite__acts">
            <button
              type="button"
              className="s-btn s-btn--accent"
              disabled={busy}
              onClick={onBrowsePresets}
            >
              {t("designBrowsePresets")}
            </button>
            <button type="button" className="s-btn" onClick={create} disabled={busy}>
              {t("designNew")}
            </button>
          </div>
        </div>
      ) : (
        <div className="s-dsgr-add">
          <button type="button" className="s-btn s-btn--accent" onClick={create} disabled={busy}>
            {t("designNew")}
          </button>
        </div>
      )}
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
              them in two panels is how they drift apart — and keeping the
              built-ins OUT of the only control that sets it (this was
              a `<Select>` over `admin.themes`, i.e. the instance's CUSTOM
              themes and nothing else) meant the first thing a blogger changes
              was the one thing they could not. Cards, in their own colours,
              for the reason the theme picker and the builder both give. */}
          <div className="s-dsgr-ctlrow s-dsgr-ctlrow--stack">
            <div className="s-dsgr-ctlrow__text">
              <span className="s-dsgr-ctlrow__label">{t("designTheme")}</span>
              <span className="s-dsgr-ctlrow__hint">{t("designThemeHint")}</span>
            </div>
            <DesignThemeCards
              value={draft.theme ?? null}
              onChange={(theme) => setDoc({ theme })}
              custom={admin.themes}
              disabled={busy}
            />
          </div>
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
  // A SIGNED SLIDER ISOLATES ITS NUMBERS; an unsigned one must not. In an
  // Arabic panel the bidi algorithm resolves a leading minus that touches only
  // one number to the PARAGRAPH's direction, so "-0.02 em" prints as
  // "em 0.02-" — a trailing dash the reader has to guess the meaning of. The
  // other six sliders have no sign and are better left reordered: "٪ ١٠٠" and
  // "بكسل ١٧" are how Arabic writes a quantity and its unit, and forcing those
  // into English order would be a fix that breaks five working controls. So
  // only a slider whose FLOOR is negative isolates, and it isolates all three
  // of its numbers rather than just the one that would have been mangled —
  // two ends of one range in two different orders is its own kind of wrong.
  const signed = min < 0;
  const num = (text: string) => (signed ? <bdi dir="ltr">{text}</bdi> : text);
  return (
    <div className="s-dsgr-slider">
      <div className="s-dsgr-slider__head">
        <span className="s-dsgr-slider__label">{t(TYPE_LABEL[name])}</span>
        <span className="s-dsgr-slider__value">{num(format(value))}</span>
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
        <span>{num(format(min))}</span>
        <span>{num(format(max))}</span>
      </div>
    </div>
  );
}

/** One crumb separator. `›` (U+203A) is Bidi_Mirrored, so the browser draws it
 *  flipped under `dir="rtl"` on its own and it must NOT be given a transform —
 *  that would flip it back to pointing the wrong way (CONTRACTS). */
function Sep() {
  return (
    <span className="s-dsgr__crumbsep" aria-hidden="true">
      ›
    </span>
  );
}

function Row({
  label,
  hint,
  stack,
  children,
}: {
  label: string;
  hint?: string;
  /**
   * PUT THE CONTROL ON ITS OWN LINE. A side-by-side row gives the control 58%
   * of the column, which is right for a slider, a toggle and a three-way
   * segmented control and is not enough for a four- or five-way one:
   * `.s-ctl-seg` is an `inline-flex` of `nowrap` buttons capped at `max-width:
   * 100%`, so the segments past the cap are CLIPPED rather than wrapped —
   * measured at 1440 the four nav styles overran their column by 7px and at
   * 1280 by 69px, which is a control whose last option cannot be seen or
   * clicked. Stacking gives the run the whole column and costs one line.
   */
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`s-dsgr-ctlrow${stack ? " s-dsgr-ctlrow--stack" : ""}`}>
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
  // (The add-a-section sheet keeps its own open state — `SectionPicker` owns
  // the button, the sheet, the outside-click and the focus return together,
  // because a popover whose open flag lives in another component is a popover
  // that eventually opens with nothing to close it.)
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** The dialog panel itself — what `useDialog` traps Tab inside of. */
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** `dirty`, readable from handlers that must not be re-created (the Esc
   *  listener registers once and has to see the CURRENT draft). */
  const dirtyRef = useRef(false);
  /** The shipped catalog, once. `null` while the chunk is in flight — the
   *  gallery has no loading state of its own, so the tab shows the panel's. */
  const [presets, setPresets] = useState<readonly Preset[] | null>(null);
  /**
   * THE FEED THE DESIGNED SITE WILL PRINT, not the one this session can read.
   *
   * The preview draws from the instance's own posts before it invents
   * anything — that is what makes a preset look like YOUR site rather than
   * like a screenshot of somebody else's. But it has to be the VISITOR's list:
   * `/api/posts` answers for the session and for the layout that is live, so
   * to an admin whose `publicLayout` is still "blog" — the state every
   * operator is in while building their first design — it returned the static
   * pages and the language-hidden notes as ordinary posts, and every preview
   * and all fifty-nine gallery cards opened with "Contact" and "Colophon" as
   * the lead stories. `GET /api/design` carries the scoped list instead.
   */
  const posts: PostMeta[] | null = useMemo(() => admin?.posts ?? null, [admin]);
  /** Which page of the design the preview pane is showing. */
  const [previewRoute, setPreviewRoute] = useState<"home" | "article">("home");

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
        // A FRESH INSTANCE OPENS ON THE SHELF. "Nothing designed yet" over an
        // empty preview column is the screen this product's whole comparison
        // is won or lost on, and it had nothing to look at; the gallery is
        // fifty-nine finished sites and it is already two columns wide. The
        // invitation is still on the Designs tab for anyone who goes back.
        if (data.designs.length === 0) setTab("presets");
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
    // The catalog is a dynamic import: fifty layouts are a chunk the admin
    // fetches when they open the designer, never bytes on a visitor's first
    // paint. A failure is not fatal — every other tab still works, and the
    // gallery simply shows its empty state.
    loadPresets()
      .then((list) => {
        if (!disposed) setPresets(list);
      })
      .catch((err: unknown) => console.error("vellum: loading the presets failed", err));
    return () => {
      disposed = true;
    };
  }, []);

  // THE DESIGNER IS A MODAL SURFACE AND NOW SAYS SO IN THE ONE WAY THAT
  // COUNTS. It carried `role="dialog" aria-modal="true"` while every other
  // modal in the product went through `useDialog` and it did not: focus never
  // entered the panel on open, ONE Tab from the status-bar glyph landed on the
  // Settings gear BEHIND the aria-modal overlay (the whole app was tabbable
  // underneath it), and closing left the reader on <body> — the top of the
  // document, which is precisely the failure a11y.ts was written to end.
  // Escape is NOT delegated to the hook: this panel has three layers of its
  // own (Select, the section sheet, the preset detail) and the effect below is
  // the thing that knows their order.
  useDialog(panelRef);

  // Esc closes — unless an inner layer owns it (a Select popover, the
  // add-a-section sheet, a confirm dialog stacked on top), which is the same
  // precedence the settings panel and the theme picker already keep. Both
  // listeners are capture-phase on `window` and this one is registered first,
  // so asking is the ONLY way the inner surface can win: one Esc used to close
  // the whole designer out from under an open picker.
  //
  // THE GALLERY'S DRILL-IN IS A THIRD LAYER, and it is the one a reader is
  // most likely to press Esc inside: they opened a preset to look at it. So
  // Esc UNWINDS one step — out of the preset, back to the shelf — and only
  // closes the panel once there is nothing left to step out of. Anything else
  // makes Esc a trapdoor: one keystroke from browsing a catalog to no panel at
  // all, with the design under edit still unsaved behind it.
  //
  // AND THE LAST STEP OUT IS NOT FREE EITHER. Esc used to throw the draft
  // away without a word — the bar could read "one change not saved yet", one
  // keystroke later the panel was gone and reopening it said "everything
  // saved". The overlay's backdrop and the × did the same thing, so a stray
  // click outside was enough. The comment above reasons at length about not
  // making Esc a trapdoor "with the design under edit still unsaved behind
  // it"; this is that same trapdoor, one level further out.
  const requestClose = useCallback(() => {
    if (!dirtyRef.current) {
      onClose();
      return;
    }
    void confirmModal({
      title: t("designCloseUnsavedTitle"),
      body: t("designCloseUnsavedBody"),
      confirmLabel: t("designDiscard"),
    }).then((ok) => {
      if (ok) onClose();
    });
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || isSelectOpen() || isSectionPickerOpen() || isConfirmOpen()) return;
      e.preventDefault();
      if (isPresetDetailOpen()) {
        closePresetDetail();
        return;
      }
      requestClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [requestClose]);

  const dirty = draft !== null && JSON.stringify(draft) !== saved;
  dirtyRef.current = dirty;
  /** How many decisions the bar is holding. Recomputed only when the draft or
   *  the stored document actually moves — a diff per keystroke of a heading
   *  field is a diff per keystroke. */
  const changes = useMemo(
    () => (dirty && saved ? countChanges(JSON.parse(saved) as DesignDoc, draft) : 0),
    [dirty, saved, draft],
  );
  const notes = useMemo(() => collectNotes(tree), [tree]);
  // Memoized on `admin` rather than `admin?.pages`: a bare `?? []` is a NEW
  // array every render, which is a new preview-content object every render,
  // which is the whole canvas remounting while somebody drags a slider.
  const pages: PageMeta[] = useMemo(() => admin?.pages ?? [], [admin]);
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

  /** A face row. "Inherit" DELETES the key rather than storing an empty
   *  string, because absent is the state the renderer, the validator and the
   *  change counter all understand: a design that names no face is a design
   *  with no field, byte for byte the document it was before the picker
   *  existed. */
  const setFace = (key: "headingFont" | "bodyFont" | "monoFont", id: string): void => {
    setDraft((current) => {
      if (!current) return current;
      const typography = { ...current.chrome.typography };
      if (id === SYSTEM_FONT || id === "") delete typography[key];
      else typography[key] = id;
      return { ...current, chrome: { ...current.chrome, typography } };
    });
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
    const facesBefore = saved ? faceSpecOf((JSON.parse(saved) as DesignDoc).chrome.typography) : "";
    saveDesignDoc(draft.id, { ...draft, name: name.trim() || draft.name })
      .then(async (doc) => {
        // The SERVER's normalization is authoritative: the draft is re-seeded
        // from what was actually stored, so what the panel shows next is what
        // a visitor would get, not what was typed.
        setSaved(JSON.stringify(doc));
        setDraft(doc);
        setName(doc.name);
        void getDesignOverview().then(setAdmin).catch(() => undefined);
        // A SAVE THAT CHANGES THE PUBLIC SITE'S TYPE HAS TO CHANGE THE LINK
        // THAT SERVES IT. /api/site-fonts.css is fetched with a `?v=` from
        // /api/me, and that signature now covers the ACTIVE design's faces —
        // so an owner who saves a new typeface and then looks at their own
        // live site would otherwise be reading yesterday's stylesheet until
        // they reloaded. Only when it is the active design, and only when the
        // faces actually moved: `loadMe` is a boot-shaped refresh, not
        // something to run on every slider.
        if (admin?.activeId === doc.id && faceSpecOf(doc.chrome.typography) !== facesBefore) {
          await useStore.getState().loadMe();
        }
        toast(t("designSaved"));
      })
      .catch((err: unknown) => {
        console.error("vellum: saving the design failed", err);
        toast(designErrorText(err, t("designSaveFailed")), "error");
      })
      .finally(() => setBusy(false));
  };

  // Ctrl/Cmd+S saves the draft. A surface whose whole promise is "nothing
  // leaves this panel until you say so" has to answer the keystroke everybody
  // presses to say so — and it must SWALLOW it either way, because the
  // browser's own Save dialog over a design panel is a jump-scare, not a
  // feature. Declared after `save` so the dependency array never reads it
  // before it exists.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // `shortcutKey`, not `e.key`: on an Arabic keyboard the physical S key
      // types "س" and this panel's save was as dead as everything else — see
      // client/keys.ts.
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (shortcutKey(e) !== "s") return;
      e.preventDefault();
      if (dirty && !busy) save();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dirty, busy, save]);

  const setLayout = (next: string, quiet = false): void => {
    const from = publicLayout;
    setBusy(true);
    patchSettings({ publicLayout: next as "app" | "blog" | "designed" })
      .then(async () => {
        await useStore.getState().loadMe();
        const message = next === "designed" ? t("designLayoutDesigned") : t("designLayoutStock");
        // The reader who just pointed the PUBLIC SITE at something new is the
        // reader most likely to want it pointed back, and "the switch is
        // lossless in both directions" (DESIGN.md) is only a promise if the
        // way back is on screen (v1.8 UX audit F26). `from` is where they
        // actually came from — offering "the stock blog" to someone who was on
        // the app layout would be a third destination, not an undo.
        //
        // The undo itself is quiet: a second toast saying "visitors now see
        // the stock site" after the reader pressed a button labelled exactly
        // that is a receipt for something they watched happen.
        if (quiet || from === next) toast(message);
        else actionToast(message, t("designLayoutBack"), () => setLayout(from, true));
      })
      .catch((err: unknown) => {
        console.error("vellum: switching the public layout failed", err);
        toast(designErrorText(err, t("designSaveFailed")), "error");
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
    // THE CAP IS CHECKED BEFORE THE FILE IS READ. The server 413s at
    // API_BODY_MAX and always did, but by the time it answers, the admin's tab
    // has already read an eleven-megabyte string into memory and run
    // `JSON.parse` over it. A `File` knows its own size for free.
    if (file.size > DESIGN_IMPORT_MAX_BYTES) {
      toast(tf("designImportTooBig", { n: localeNum(Math.round(DESIGN_IMPORT_MAX_BYTES / 1048576)) }), "error");
      return;
    }
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
        toast(designErrorText(err, t("designImportFailed")), "error");
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
          toast(designErrorText(err, t("designSaveFailed")), "error");
        })
        .finally(() => setBusy(false));
    });
  };

  /**
   * APPLYING A PRESET IS AN IMPORT, and that is the whole implementation.
   *
   * `presetExport()` produces the exact `vellum.design` envelope
   * `POST /api/design/docs/import` already takes, and that route gives us
   * every property the word "fork" is supposed to buy: a fresh id, fresh
   * timestamps, strict validation, custom themes under fresh slugs, and
   * nothing the instance already has overwritten. The shipped preset is never
   * referenced again by anything — there is no id stored, no link kept, and
   * nothing an author edits afterwards can reach back into the catalog.
   */
  const applyPreset = async (preset: Preset): Promise<void> => {
    setBusy(true);
    try {
      const doc = await importDesignDoc(presetExport(preset, language));
      setDraft(doc);
      setName(doc.name);
      setSaved(JSON.stringify(doc));
      void getDesignOverview().then(setAdmin).catch(() => undefined);
      // Straight into the sections tab: an author who just chose a shape is
      // about to change it, and the gallery has nothing left to tell them.
      setTab("sections");
      toast(t("presetApplied"));
    } catch (err) {
      console.error("vellum: applying the preset failed", err);
      toast(designErrorText(err, t("designSaveFailed")), "error");
    } finally {
      setBusy(false);
    }
  };

  const startBlank = async (): Promise<void> => {
    const value = await promptModal({
      title: t("designNewTitle"),
      placeholder: t("designName"),
      confirmLabel: t("designCreate"),
    });
    const wanted = (value ?? "").trim();
    if (!wanted) return;
    setBusy(true);
    try {
      const doc = await createDesignDoc(wanted);
      setDraft(doc);
      setName(doc.name);
      setSaved(JSON.stringify(doc));
      void getDesignOverview().then(setAdmin).catch(() => undefined);
      setTab("sections");
      toast(t("designCreated"));
    } catch (err) {
      console.error("vellum: creating the design failed", err);
      toast(designErrorText(err, t("designSaveFailed")), "error");
    } finally {
      setBusy(false);
    }
  };

  /** The rail's rooms in the order they are drawn — the order the arrows
   *  walk, which is the order the eye reads, groups flattened. */
  const railOrder = useMemo(() => RAIL.flatMap((group) => group.tabs), []);
  /** Is the panel in the LIBRARY (no one document under edit) or in a room of
   *  one? The crumb's first segment differs, and so does what "up" means. */
  const isLibraryTab = tab === "designs" || tab === "presets";

  /**
   * ARROWS WALK THE RAIL; HOME AND END GO TO ITS ENDS.
   *
   * Up/Down are the vertical tablist's own keys. Left/Right are accepted too
   * and follow the READING direction — the rail sits on the inline-start edge,
   * so in Arabic the key that means "further into the panel" is the left one —
   * because a reader who has just moved between two side-by-side columns with
   * the horizontal arrows does not switch hands to walk the column they landed
   * in. The selection MOVES with the focus (an "automatic" tablist), which is
   * right here because every panel is instant and none of them is a form that
   * loses anything on the way past.
   */
  const onRailKey = (e: ReactKeyboardEvent<HTMLElement>): void => {
    const rtl = document.documentElement.getAttribute("dir") === "rtl";
    const at = railOrder.indexOf(tab);
    let next = -1;
    if (e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight")) next = at + 1;
    else if (e.key === "ArrowUp" || e.key === (rtl ? "ArrowRight" : "ArrowLeft")) next = at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = railOrder.length - 1;
    else return;
    if (next < 0 || next >= railOrder.length) return;
    e.preventDefault();
    const id = railOrder[next];
    setTab(id);
    // Focus follows in the SAME tick the class does not: the button already
    // exists, only its `tabIndex` changes, so there is nothing to wait for.
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus();
  };

  const chrome = draft?.chrome ?? null;
  const typo = chrome?.typography ?? stockChrome().typography;

  // THE DRAFT'S OWN FACES, IN <head>, FROM THE FIRST KEYSTROKE. The preview
  // frame clones this document's stylesheets, so one link there dresses the
  // pane, the gallery cards and the article specimen at once — and it dresses
  // them in the SAME families the live site will use, which is what makes the
  // preview a preview. Dropped on unmount: nothing the designer downloaded
  // should still be linked on the page behind it.
  const faceSpec = faceSpecOf(typo);
  useEffect(() => {
    setDesignFonts("draft", designFontRefs(typo));
    // `faceSpec` and not `typo`: the object is rebuilt on every slider drag and
    // the faces change perhaps twice a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceSpec]);
  useEffect(() => () => setDesignFonts("draft", []), []);

  // The catalog is a fact about this BUILD, not about this instance, so the
  // three font rows are drawn from the shared list rather than from a fetch
  // that can fail while the panel is open.
  const fontCatalog = useMemo(() => catalogList(), []);
  // ONE content object for the preview pane and the gallery both. Real posts
  // first, sample rows only to make up the numbers, generated artwork wherever
  // a banner is missing — client/design/previewContent.tsx says why.
  const previewContent = usePreviewBuild({ posts, pages, noteMode: "fetch" });

  /* THE BUTTON IS OFFERED ONLY WHEN THERE IS SOMETHING TO PUT LIVE. Pointing
     `publicLayout` at "designed" on an instance with no renderable design
     leaves the owner a notice and drops every visitor to stock — a correct
     rescue, and a terrible thing to have volunteered. A quarantined document
     does not count: this build cannot draw it. */
  const hasDesign = (admin?.designs ?? []).some((d) => !d.quarantine);

  return (
    <div
      className="s-dsgr-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div
        ref={panelRef}
        className="s-dsgr"
        role="dialog"
        aria-modal="true"
        aria-label={t("designTitle")}
        lang={language}
      >
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
          <button
            type="button"
            className="s-dsgr__close"
            aria-label={t("close")}
            onClick={requestClose}
          >
            ✕
          </button>
        </header>

        {/* ── THE LIVE BAR ──────────────────────────────────────────────────
            WHAT ARE VISITORS SEEING, AND HOW DO I PUT IT BACK. Both halves, on
            screen, in every state, always.

            What was here before was a note that appeared ONLY while the design
            was off and read "switch it above when you are ready" — a sentence
            pointing at the `Public site` control in the head, which a reader
            who has not yet used it does not read as a switch. So it pointed at
            nothing, and the state it never described at all was the one an
            author is most likely to want out of: the design already live, with
            no visible way back except the control they could not find.

            The bar carries the ACTION rather than a description of where the
            action is, it names the destination in the button ("Back to the
            stock blog", not "Undo" — nothing was lost and nothing is being
            repaired), and it prints the sentence that is the whole point in
            both directions: nothing is lost either way. The segmented control
            in the head keeps all three rooms including `app`; this is the one
            move an author makes over and over, done in one press.

            It is also the answer to "I am afraid to try a design because I
            like the one I have" — which is the report that built it. */}
        <div
          className={`s-dsgr__live${publicLayout === "designed" ? " s-dsgr__live--on" : ""}`}
        >
          <p className="s-dsgr__livesay">
            <span className="s-dsgr__livedot" aria-hidden="true" />
            {publicLayout === "designed"
              ? t("designLiveOnBody")
              : publicLayout === "app"
                ? t("designLiveOffApp")
                : t("designLiveOffBlog")}
          </p>
          {publicLayout === "designed" ? (
            <button
              type="button"
              className="s-btn s-dsgr__livebtn"
              disabled={busy}
              onClick={() => setLayout("blog")}
            >
              {t("designLiveRevert")}
            </button>
          ) : hasDesign ? (
            <button
              type="button"
              className="s-btn s-btn--accent s-dsgr__livebtn"
              disabled={busy}
              onClick={() => setLayout("designed")}
            >
              {t("designLiveGo")}
            </button>
          ) : (
            <span className="s-dsgr__livenone">{t("designLiveNoneYet")}</span>
          )}
          <p className="s-dsgr__livekeep">{t("designLiveKeep")}</p>
        </div>
        {/* A design this build cannot render is QUARANTINED, not deleted —
            the bytes stay on disk and the notice names it. */}
        {admin?.designs.some((d) => d.quarantine) && (
          <p className="s-dsgr__offnote">{t("designCorruptNotice")}</p>
        )}

        {/* ── WHERE YOU ARE, ONE LINE, ALWAYS ────────────────────────────────
            Three segments at most: the panel, the DESIGN, the room. The rail
            already said which room and the footer already said whether
            anything was unsaved; the middle segment is the one nothing on
            screen carried, and it is the subject of every control on every
            tab. Quiet by construction — one hairline, 0.76rem, muted — because
            it is glanced at rather than read. */}
        <nav className="s-dsgr__crumbs" aria-label={t("designWhereLabel")}>
          <button
            type="button"
            className="s-dsgr__crumb s-dsgr__crumb--root"
            // THE ROOT OF THE CRUMB IS A LINK, because a crumb whose first
            // segment does nothing is a label wearing a trail's clothes. It
            // goes to the shelf of designs — the panel's own front door, and
            // the one screen every other tab is downstream of.
            onClick={() => setTab("designs")}
          >
            {t("designTitle")}
          </button>
          {/* `›` is Bidi_Mirrored: the browser flips it under dir="rtl" on its
              own, so it gets no rule (CONTRACTS). */}
          <Sep />
          {/* THE MIDDLE SEGMENT IS THE DOCUMENT, and it is what the panel never
              printed: the rail said which ROOM, the footer said whether
              anything was unsaved, and nothing said which DESIGN — so a panel
              holding two of them looked identical whichever was loaded. It
              appears only where it is true: the library tabs are a shelf of
              designs, not a room inside one. */}
          {!isLibraryTab && draft && (
            <>
              <button
                type="button"
                className="s-dsgr__crumb"
                onClick={() => setTab("designs")}
                title={t("designTabDesigns")}
              >
                {/* An author names their own design, in their own script, and
                    a Latin name spliced into an Arabic trail reorders it. Same
                    <bdi> rule as every other note-derived label in the chrome;
                    the separators stay OUTSIDE the isolate so they keep the
                    chrome's direction. */}
                <bdi>{name || draft.name}</bdi>
              </button>
              <Sep />
            </>
          )}
          <span className="s-dsgr__crumb s-dsgr__crumb--leaf" aria-current="page">
            {t((TABS.find((x) => x.id === tab)?.label ?? "designTabNav") as "designTabNav")}
          </span>
        </nav>

        <div className={`s-dsgr__body${tab === "presets" ? " s-dsgr__body--wide" : ""}`}>
          {/* A TABLIST ANSWERS ARROW KEYS, and this one is the panel's whole
              address bar. Eight buttons that were each their own tab stop made
              the rail cost eight presses to cross and gave a reader no way to
              walk it the way the pattern (and every screen reader's tab-list
              mode) promises: one stop for the rail, arrows inside it, Home and
              End to the ends. `roving` is the index that carries the tab stop;
              it follows the selection, so Tab always re-enters at the room the
              reader is actually in. */}
          <nav
            className="s-dsgr__rail"
            role="tablist"
            aria-orientation="vertical"
            aria-label={t("designSections")}
            onKeyDown={onRailKey}
          >
            {RAIL.map((group) => (
              <div key={group.label} className="s-dsgr__railgroup">
                <span className="s-dsgr__railhead">{t(group.label as "designGroupPage")}</span>
                {group.tabs.map((id) => {
                  const entry = TABS.find((x) => x.id === id);
                  if (!entry) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      data-tab={id}
                      aria-selected={tab === id}
                      aria-controls="s-dsgr-panel"
                      tabIndex={tab === id ? 0 : -1}
                      className={`s-dsgr__tab${tab === id ? " s-dsgr__tab--on" : ""}`}
                      onClick={() => setTab(id)}
                    >
                      <TabGlyph tab={id} />
                      <span className="s-dsgr__tablabel">{t(entry.label as "designTabNav")}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* `key={tab}` is the cross-fade: the panel's body is REPLACED when
              the rail moves, so the new controls arrive over 160ms instead of
              popping into a column the eye has to re-find. */}
          <div
            className="s-dsgr__controls"
            id="s-dsgr-panel"
            role="tabpanel"
            // NOT focusable, deliberately: every panel in here starts with a
            // real control, and a tabpanel with `tabIndex={0}` adds a stop
            // that announces the panel and then makes the reader press Tab
            // again to reach the first thing they can use.
            aria-label={t((TABS.find((x) => x.id === tab)?.label ?? "designTabNav") as "designTabNav")}
            data-popbounds
            key={tab}
          >
            {/* The tab's own sentence — but not over an empty instance: "drag
                a row, or move it with the arrows" above a panel with no rows
                in it is instructions for a thing that is not there. The
                invitation below says the only thing there is to say. */}
            {(draft !== null || tab === "designs" || tab === "presets") && (
              <p className="s-dsgr__intro">
                {t((TABS.find((x) => x.id === tab)?.intro ?? "designTabNavIntro") as "designTabNavIntro")}
              </p>
            )}

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
                onBrowsePresets={() => setTab("presets")}
              />
            ) : tab === "presets" ? (
              presets === null ? (
                <p className="s-dsgr-empty">{t("designLoading")}</p>
              ) : (
                <PresetGallery
                  presets={presets}
                  content={previewContent}
                  busy={busy}
                  onApply={applyPreset}
                  onBlank={startBlank}
                />
              )
            ) : chrome === null || draft === null ? (
              // NOTHING TO EDIT YET — and an empty designer is the FIRST thing
              // a new instance sees, so it is an invitation with the two ways
              // in on it rather than a sentence explaining what is absent.
              <div className="s-dsgr-invite">
                <span className="s-dsgr-invite__art" aria-hidden="true">
                  <SectionGlyph kind="hero" size="card" />
                  <SectionGlyph kind="postGrid" size="card" />
                  <SectionGlyph kind="postList" size="card" />
                </span>
                <h2 className="s-dsgr-invite__title">{t("designEmptyTitle")}</h2>
                <p className="s-dsgr-invite__body">{t("designEmptyBody")}</p>
                <div className="s-dsgr-invite__acts">
                  <button
                    type="button"
                    className="s-btn s-btn--accent"
                    disabled={busy}
                    onClick={() => setTab("presets")}
                  >
                    {t("designBrowsePresets")}
                  </button>
                  <button type="button" className="s-btn" disabled={busy} onClick={() => void startBlank()}>
                    {t("presetBlank")}
                  </button>
                </div>
              </div>
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
                  // A page with no sections is not an error and must not read
                  // as one: it is the moment before the first decision, so it
                  // shows what a section IS and offers the first one.
                  empty={
                    <div className="s-dsnc-empty">
                      <span className="s-dsnc-empty__art" aria-hidden="true">
                        <SectionGlyph kind="hero" size="card" />
                        <SectionGlyph kind="postList" size="card" />
                        <SectionGlyph kind="topics" size="card" />
                      </span>
                      <h2 className="s-dsnc-empty__title">{t("dsnEmptyTitle")}</h2>
                      <p className="s-dsnc-empty__body">{t("dsnEmptyBody")}</p>
                    </div>
                  }
                />
                {/* The menu is built from the schema's own list, so a section
                    kind added to shared/design.ts is reachable here without a
                    second edit. */}
                <SectionPicker
                  kinds={admin?.sectionKinds ?? []}
                  label={sectionKindLabel}
                  hint={sectionKindHint}
                  onAdd={(kind) => addSection(kind as SectionKind)}
                  full={draft.sections.length >= MAX_SECTIONS}
                  disabled={busy}
                />
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
                    ["showBanner", "dsoArtBanner", null],
                    ["showMeta", "dsoArtMeta", null],
                    ["showTags", "dsoArtTags", null],
                    ["showRelated", "dsoArtRelated", null],
                    ["showBackLink", "dsoArtBack", null],
                    // The only row here that needs a sentence: it is off in
                    // Arabic prose whatever the switch says, and an author who
                    // is not told that reads it as a bug in the switch.
                    ["dropCap", "dsoArtDropCap", "dsoArtDropCapHint"],
                  ] as const
                ).map(([key, label, hint]) => (
                  <Row key={key} label={t(label)} hint={hint ? t(hint) : undefined}>
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
                {/* The STYLE lives beside the menu it dresses rather than in
                    the chrome tab: an author who has just built six items is
                    the author who wants to see them as pills. */}
                <Row label={t("designNavStyle")} hint={t("designNavStyleHint")} stack>
                  <SegmentedControl
                    value={chrome.nav.style}
                    onChange={(value) => set({ nav: { ...chrome.nav, style: value as NavStyle } })}
                    label={t("designNavStyle")}
                    segments={[
                      { value: "plain", label: t("designNavPlain") },
                      { value: "pills", label: t("designNavPills") },
                      { value: "underline", label: t("designNavUnderline") },
                      { value: "brackets", label: t("designNavBrackets") },
                    ]}
                  />
                </Row>
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
                  name="tracking"
                  value={typo.tracking}
                  onChange={(value) => set({ typography: { ...typo, tracking: value } })}
                  format={(v) => `${localeNum(v)} em`}
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
                      { value: "mono", label: t("designMono") },
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
                      { value: "mono", label: t("designMono") },
                    ]}
                  />
                </Row>
                <h2 className="s-dsgr__section">{t("designFacesSection")}</h2>
                <Row label={t("designHeadingFont")} hint={t("designFaceHint")}>
                  <FontPicker
                    slot="any"
                    value={typo.headingFont ?? SYSTEM_FONT}
                    onChange={(id) => setFace("headingFont", id)}
                    catalog={fontCatalog}
                    // NO UPLOADED FACES HERE, and it is not an oversight: a
                    // design is exported, imported and shipped as a preset,
                    // and `custom:my-face.woff2` names a file that exists on
                    // exactly one machine. The operator's own faces belong in
                    // the four instance slots, which every design inherits.
                    custom={[]}
                    label={t("designHeadingFont")}
                    systemLabel={t("designFaceInherit")}
                  />
                </Row>
                <Row label={t("designBodyFont")} hint={t("designFaceHint")}>
                  <FontPicker
                    slot="any"
                    value={typo.bodyFont ?? SYSTEM_FONT}
                    onChange={(id) => setFace("bodyFont", id)}
                    catalog={fontCatalog}
                    custom={[]}
                    label={t("designBodyFont")}
                    systemLabel={t("designFaceInherit")}
                  />
                </Row>
                <Row label={t("designMonoFont")} hint={t("designMonoFontHint")}>
                  <FontPicker
                    slot="mono"
                    value={typo.monoFont ?? SYSTEM_FONT}
                    onChange={(id) => setFace("monoFont", id)}
                    catalog={fontCatalog}
                    custom={[]}
                    label={t("designMonoFont")}
                    systemLabel={t("designFaceInherit")}
                  />
                </Row>
                <p className="s-dsgr__prose">{t("designFacesNote")}</p>
                <p className="s-dsgr__prose">{t("designBoundsNote")}</p>
              </>
            ) : tab === "chrome" ? (
              <>
                {/* THE GROUND COMES FIRST because it is under everything below
                    it — the masthead, the writing and the footer are all
                    printed on whatever this row says. */}
                <h2 className="s-dsgr__section">{t("designSurfaceSection")}</h2>
                <Row label={t("designSurface")} hint={t("designSurfaceHint")} stack>
                  <SegmentedControl
                    value={chrome.surface}
                    onChange={(value) => set({ surface: value as ChromeSurface })}
                    label={t("designSurface")}
                    segments={[
                      { value: "flat", label: t("designSurfaceFlat") },
                      { value: "ruled", label: t("designSurfaceRuled") },
                      { value: "grid", label: t("designSurfaceGrid") },
                      { value: "tinted", label: t("designSurfaceTinted") },
                      { value: "paper", label: t("designSurfacePaper") },
                    ]}
                  />
                </Row>
                {/* THE WORLD SITS UNDER THE GROUND, LITERALLY AND IN THE
                    PANEL. A surface is what the page is printed ON; a scenery
                    is what it is standing IN, and the two compose — laid paper
                    under a starfield is a letter written somewhere. The note
                    under the row is the honest half about motion, said once
                    here rather than smuggled into six labels. */}
                <Row label={t("designScenery")} hint={t("designSceneryHint")} stack>
                  <SegmentedControl
                    value={chrome.scenery}
                    onChange={(value) => set({ scenery: value as ChromeScenery })}
                    label={t("designScenery")}
                    segments={[
                      { value: "none", label: t("designSceneryNone") },
                      { value: "starfield", label: t("designSceneryStarfield") },
                      { value: "aurora", label: t("designSceneryAurora") },
                      { value: "horizon", label: t("designSceneryHorizon") },
                      { value: "topography", label: t("designSceneryTopography") },
                      { value: "halftone", label: t("designSceneryHalftone") },
                    ]}
                  />
                </Row>
                <p className="s-dsgr__prose">{t("designSceneryMotionNote")}</p>
                {/* THE MARK IS A PAGE-LEVEL DECISION for the reason the ground
                    is: every divider in the document draws it, and a design
                    that signs half its breaks with one glyph and half with
                    another has not decided anything. The GLYPH is the label and
                    its name is the note, because the reader is picking a mark
                    and not a word — the same row shape the face pickers use. */}
                <Row label={t("designOrnament")} hint={t("designOrnamentHint")} stack>
                  <SegmentedControl
                    value={chrome.ornament}
                    onChange={(value) => set({ ornament: value as ChromeOrnament })}
                    label={t("designOrnament")}
                    segments={[
                      { value: "asterism", label: "\u2726", note: t("designOrnamentAsterism") },
                      { value: "star", label: "\u2727", note: t("designOrnamentStar") },
                      { value: "burst", label: "\u2736", note: t("designOrnamentBurst") },
                      { value: "moon", label: "\u263E", note: t("designOrnamentMoon") },
                      { value: "lozenge", label: "\u25C8", note: t("designOrnamentLozenge") },
                      { value: "fleuron", label: "\u2766", note: t("designOrnamentFleuron") },
                    ]}
                  />
                </Row>

                <h2 className="s-dsgr__section">{t("designHeaderSection")}</h2>
                <Row label={t("designHeaderLayout")} stack>
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
                      { value: "rule", label: t("designLayoutRule") },
                      { value: "banner", label: t("designLayoutBanner") },
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
                <Row label={t("designFooterForm")} hint={t("designFooterFormHint")}>
                  <SegmentedControl
                    value={chrome.footer.form}
                    onChange={(value) =>
                      set({ footer: { ...chrome.footer, form: value as FooterForm } })
                    }
                    label={t("designFooterForm")}
                    segments={[
                      { value: "columns", label: t("designFormColumns") },
                      { value: "colophon", label: t("designFormColophon") },
                      { value: "grand", label: t("designFormGrand") },
                    ]}
                  />
                </Row>
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

          {/* THE GALLERY IS ITS OWN PREVIEW, so it takes the pane.
              Everywhere else the right-hand column is where the author looks —
              but on the presets tab it was drawing the DRAFT, which is the one
              document the person browsing fifty-nine alternatives is not
              thinking about, or the words "no design yet" over two thirds of
              the panel. Meanwhile the grid it belongs to was folded into a
              380px form column at two cards across.
              The gallery already answers every question that pane exists to
              answer, at three magnifications: a miniature per card, a real
              `DesignCanvas` under the pointer after a dwell, and a full canvas
              in the detail sheet. So the tab collapses the panel to TWO columns
              and the shelf gets the width — five across instead of two, which
              is the difference between browsing a catalog and scrolling a
              list. The stage is unmounted rather than hidden: it owns an
              iframe, a MutationObserver and a clock, and none of them should be
              running behind a surface that is not showing them. */}
          {tab !== "presets" && (
            <div className="s-dsgr__preview">
              <div className="s-dsgr__previewhead">
                <span>{t("designPreview")}</span>
                <SegmentedControl
                  value={previewRoute}
                  onChange={(value) => setPreviewRoute(value as "home" | "article")}
                  label={t("designPreview")}
                  segments={[
                    { value: "home", label: t("designPreviewHome") },
                    { value: "article", label: t("designPreviewArticle") },
                  ]}
                />
              </div>
              {/* THE STAGE, not a bare canvas: the composed page in a document
                  of its own, at a device width the author picks, settling on the
                  trailing edge of their edits. A canvas in a div would answer
                  every media query with the PANEL's width, which is the one lie
                  a responsive preview may not tell. */}
              {draft ? (
                <PreviewStage design={draft} content={previewContent} route={previewRoute} />
              ) : (
                // "Make one" WAS A SENTENCE (v1.8 UX audit F41), sitting in the
                // widest pane of the panel, two thirds of the screen from
                // anything that could make one. It is a button now, and it goes
                // to the tab that holds the list, the New-design door and the
                // gallery door — the invitation, not a bare prompt dialog.
                <div className="s-dsgr-empty s-dsgr-empty--door">
                  <p className="s-dsgr-empty__body">{t("designNoneYetBody")}</p>
                  <button
                    type="button"
                    className="s-btn s-btn--accent"
                    onClick={() => setTab("designs")}
                  >
                    {t("designMakeOne")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* THE SAVE BAR IS A STATE, NOT A ROW OF BUTTONS. Nothing here reaches
            the public site until it is pressed, so the one thing the bar has to
            do is make "there are decisions in the air" impossible to miss: it
            lights (accent hairline, a pulsing dot) the moment the draft leaves
            the stored document, and it says HOW MANY changes are waiting — a
            number an author can check against what they remember doing. */}
        <footer className={`s-dsgr__foot${dirty ? " s-dsgr__foot--dirty" : ""}`}>
          <span className="s-dsgr__state" role="status" aria-live="polite">
            <span className="s-dsgr__dot" aria-hidden="true" />
            {!dirty
              ? t("designAllSaved")
              : changes > 0
                ? tf("designUnsavedN", { n: countPhrase(changes, "changes") })
                : // The draft differs in something no control produced (an id,
                  // a stamp): still unsaved, and still true, but there is no
                  // honest number to print.
                  t("designUnsaved")}
          </span>
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
