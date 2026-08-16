// THE GALLERY — fifty finished designs, browsable, and one click from being
// yours.
//
// THE FLOW, in the order somebody actually does it: look at the shapes, filter
// to the family that matches what you write, open the two you like at full
// size, pick one, and land in the designer with an EDITABLE COPY open. There
// is no step where a preset is "in use": applying FORKS it (`presetExport()` →
// the existing import route) and the shipped preset is never referenced again.
// Nothing an author does afterwards can reach back into the catalog, and no
// upgrade of the catalog can reach forward into their site.
//
// THE PICTURE IS REAL, AND IT IS REAL AT REST. Every card the reader can see
// draws a `<DesignCanvas>`: the actual header, the actual sections, the
// operator's own posts and their own banner PHOTOGRAPHS, at 1120px, scaled
// into the card, painted in the PRESET's own theme. The CSS miniature
// (`DesignThumb`) is still here and still cheap, and it is what a card shows
// before it comes into view and while it is being scrolled past — a placeholder
// with the right shape in it, never a grey box.
//
// It used to be the other way round: fifty-nine wireframes in the operator's
// one hue, and a real render only for the single card under the pointer. That
// is a settings form with pictures, not a template gallery — the "Gallery"
// family, five presets whose entire premise is photographs, rendered as five
// identical pale rectangles on a vault holding eight real banner images.
// WordPress, Ghost and Squarespace all lead with a real rendering in the
// theme's own colours, and the honest render was already written; it was being
// paid for one card and refused to the other fifty-eight.
//
// WHAT KEEPS IT AFFORDABLE is that "visible" is a small number. An
// IntersectionObserver mounts a canvas a screen BEFORE it is needed and
// unmounts it a beat after it leaves, so the document holds the two or three
// screens around the reader rather than fifty-nine trees. A card must dwell in
// that band briefly before it pays, so a fling through the catalog mounts
// nothing it flies past.
//
// COMPONENT CONTRACT. This file owns filtering, visibility and selection; it owns
// NO network and NO store writes. `onApply` and `onBlank` are the host's, and
// they are the only two ways out. That is deliberate: the panel already knows
// how to open a document, refresh its overview and toast a failure, and a
// gallery that did any of it a second way is a gallery that drifts.

import { useEffect, useMemo, useState } from "react";
import {
  PRESET_FAMILIES,
  filterPresets,
  familyCounts,
  presetDesignDoc,
  type Preset,
  type PresetFamily,
} from "../../../shared/presets.ts";
import { isTheme } from "../../../shared/themes.ts";
import DesignCanvas from "../../design/DesignCanvas.tsx";
import type { PreviewContent } from "../../design/previewContent.tsx";
import { localeNum, t, tf, type I18nKey } from "../../i18n.ts";
import { useStore } from "../../state.ts";
import { choiceLabel } from "../../themes.ts";
import { TextInput } from "../controls/Fields.tsx";
import { sectionKindLabel } from "../../design/Sections.tsx";
import DesignThumb from "./DesignThumb.tsx";
import SectionGlyph from "./SectionGlyph.tsx";
import "../../styles/presets.css";

/** Family → its label key. A LITERAL table, for `TYPE_LABEL`'s reason: a
 *  computed `t(\`presetFamily_${family}\`)` reads fine and is invisible to
 *  check-i18n, which then reports eight live keys as dead and fails the
 *  build. */
const FAMILY_LABEL: Record<PresetFamily, I18nKey> = {
  editorial: "presetFamEditorial",
  minimal: "presetFamMinimal",
  journal: "presetFamJournal",
  portfolio: "presetFamPortfolio",
  reference: "presetFamReference",
  landing: "presetFamLanding",
  gallery: "presetFamGallery",
  letter: "presetFamLetter",
};

/**
 * The catalog, loaded on demand.
 *
 * A dynamic import, so fifty layouts are a chunk the ADMIN fetches when they
 * open the gallery rather than bytes every visitor's first paint pays for. The
 * promise is memoized at module scope: opening the gallery twice is one fetch.
 */
let catalog: Promise<readonly Preset[]> | null = null;
export function loadPresets(): Promise<readonly Preset[]> {
  catalog ??= import("../../../shared/presetCatalog.ts").then((m) => m.PRESETS);
  return catalog;
}

export interface PresetGalleryProps {
  /** Every shipped preset. `loadPresets()` above is where they come from; the
   *  host does the awaiting so the gallery has no loading state of its own. */
  presets: readonly Preset[];
  /** What the miniatures and the live canvas draw from — the operator's own
   *  posts where there are any, generated artwork where there are not
   *  (client/design/previewContent.tsx). */
  content: PreviewContent;
  /**
   * FORK this preset into a new editable design and open it.
   *
   * The host's whole implementation is two lines, and it must stay two lines:
   *
   *     const doc = await importDesignDoc(presetExport(preset, lang));
   *     openDraft(doc);
   *
   * Rejection is the host's to toast — the gallery does not know what a design
   * store's error sentences look like and must not learn.
   */
  onApply: (preset: Preset) => Promise<void>;
  /** Start from the stock defaults instead — `createDesignDoc(name)`. */
  onBlank: () => Promise<void>;
  /** Host is mid-flight; every action disables. */
  busy?: boolean;
}

export default function PresetGallery({
  presets,
  content,
  onApply,
  onBlank,
  busy = false,
}: PresetGalleryProps) {
  const [family, setFamily] = useState<PresetFamily | null>(null);
  const [text, setText] = useState("");
  /** The card opened into the detail pane. */
  const [chosen, setChosen] = useState<string | null>(null);

  // Text first, family second — so the family chips can carry counts that
  // describe what the CURRENT search would show. A chip reading "0" beside a
  // grid full of matches is not a state this can reach.
  const searched = useMemo(
    () => filterPresets(presets, { family: null, text }),
    [presets, text],
  );
  const shown = useMemo(
    () => (family === null ? searched : searched.filter((p) => p.family === family)),
    [searched, family],
  );
  const counts = useMemo(() => familyCounts(searched), [searched]);
  const selected = useMemo(
    () => presets.find((p) => p.id === chosen) ?? null,
    [presets, chosen],
  );

  return (
    <div className="s-dsgp">
      <div className="s-dsgp__bar">
        <div className="s-dsgp__search">
          <TextInput
            value={text}
            onChange={setText}
            label={t("presetSearch")}
            placeholder={t("presetSearch")}
            dir="auto"
            maxLength={60}
          />
        </div>
        <p className="s-dsgp__count">{tf("presetCount", { n: localeNum(shown.length) })}</p>
      </div>

      <div className="s-dsgp__families" role="group" aria-label={t("presetFamilies")}>
        <button
          type="button"
          className={`s-dsgp-chip${family === null ? " s-dsgp-chip--on" : ""}`}
          aria-pressed={family === null}
          onClick={() => setFamily(null)}
        >
          {t("presetFamAll")}
          <span className="s-dsgp-chip__n">{localeNum(searched.length)}</span>
        </button>
        {PRESET_FAMILIES.map((entry) => {
          const n = counts.get(entry) ?? 0;
          return (
            <button
              key={entry}
              type="button"
              className={`s-dsgp-chip${family === entry ? " s-dsgp-chip--on" : ""}`}
              aria-pressed={family === entry}
              disabled={n === 0}
              onClick={() => setFamily(family === entry ? null : entry)}
            >
              {t(FAMILY_LABEL[entry])}
              <span className="s-dsgp-chip__n">{localeNum(n)}</span>
            </button>
          );
        })}
      </div>

      {selected && (
        <PresetDetail
          preset={selected}
          content={content}
          busy={busy}
          onApply={() => void onApply(selected)}
          onClose={() => setChosen(null)}
          onFacet={(tag) => {
            setText(tag);
            setFamily(null);
            setChosen(null);
          }}
        />
      )}

      <ul className="s-dsgp__grid">
        <li className="s-dsgp__cell">
          <button
            type="button"
            className="s-dsgp-blank"
            disabled={busy}
            onClick={() => void onBlank()}
          >
            <span className="s-dsgp-blank__mark" aria-hidden="true">
              +
            </span>
            <span className="s-dsgp-blank__name">{t("presetBlank")}</span>
            <span className="s-dsgp-blank__why">{t("presetBlankHint")}</span>
          </button>
        </li>
        {shown.map((preset) => (
          <li key={preset.id} className="s-dsgp__cell">
            <PresetCard
              preset={preset}
              content={content}
              chosen={chosen === preset.id}
              onChoose={() => setChosen(chosen === preset.id ? null : preset.id)}
            />
          </li>
        ))}
      </ul>

      {shown.length === 0 && <p className="s-dsgr-empty">{t("presetNoMatch")}</p>}
      {content.synthetic && <p className="s-dsgp__note">{t("presetSampleNote")}</p>}
    </div>
  );
}

/**
 * IS THIS CARD WORTH DRAWING FOR REAL YET?
 *
 * True a screen before the card arrives and false a beat after it leaves, with
 * a short dwell in between so a fling through fifty-nine designs mounts
 * nothing it flies past. The margin is deliberately asymmetric in TIME rather
 * than in space: arriving early is what makes the grid look already-painted,
 * and leaving late is what stops a one-pixel scroll from unmounting the card
 * somebody just scrolled to.
 */
const CARD_ARRIVE_MS = 90;
const CARD_LEAVE_MS = 600;

function useNearViewport(el: HTMLElement | null): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!el) return;
    // No IntersectionObserver (a very old browser, a test harness): draw
    // everything rather than nothing. A gallery of blank cards is the one
    // outcome worse than a slow one.
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    let timer: number | null = null;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(
          () => setNear(entry.isIntersecting),
          entry.isIntersecting ? CARD_ARRIVE_MS : CARD_LEAVE_MS,
        );
      },
      { rootMargin: "400px 0px" },
    );
    obs.observe(el);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      obs.disconnect();
    };
  }, [el]);
  return near;
}

function PresetCard({
  preset,
  content,
  chosen,
  onChoose,
}: {
  preset: Preset;
  content: PreviewContent;
  chosen: boolean;
  onChoose: () => void;
}) {
  const lang = useStore((s) => s.language);
  // Rebuilt only when the preset or the language changes — `presetDesignDoc`
  // deep-copies, and a copy per render is a copy per render.
  const doc = useMemo(() => presetDesignDoc(preset, lang), [preset, lang]);
  const theme = preset.design.theme;
  const [box, setBox] = useState<HTMLButtonElement | null>(null);
  const near = useNearViewport(box);
  const name = preset.name[lang] || preset.name.en;
  return (
    <button
      ref={setBox}
      type="button"
      className={`s-dsgp-card${chosen ? " s-dsgp-card--on" : ""}`}
      aria-pressed={chosen}
      onClick={onChoose}
    >
      <span className="s-dsgp-card__stage">
        {near ? (
          <DesignCanvas
            design={doc}
            content={content}
            clipHeight={860}
            ownTheme
            className="s-dsgp-card__canvas"
            label={name}
          />
        ) : (
          // The miniature is the PLACEHOLDER now, not the product: same shape,
          // no fetch, ~40 nodes, and it is on screen for as long as it takes a
          // canvas to arrive.
          <DesignThumb design={doc} seed={preset.id} />
        )}
      </span>
      <span className="s-dsgp-card__foot">
        <span className="s-dsgp-card__name" dir="auto">
          {name}
        </span>
        <span className="s-dsgp-card__fam">{t(FAMILY_LABEL[preset.family])}</span>
        {theme && isTheme(theme) && (
          <>
            <span className="s-dsgp-card__theme" data-theme={theme} aria-hidden="true" />
            {/* THE ONE PIECE OF COLOUR INFORMATION THE GRID CARRIES, IN WORDS.
                The dot was `aria-hidden` with only a `title`, so the preset's
                named theme reached neither a screen reader nor a finger — and
                a `title` is a tooltip, which is not a label on a touch screen
                and not a label on any screen for anyone who is not hovering. */}
            <span className="s-dsgp-card__themename">{choiceLabel(theme)}</span>
          </>
        )}
      </span>
    </button>
  );
}

function PresetDetail({
  preset,
  content,
  busy,
  onApply,
  onClose,
  onFacet,
}: {
  preset: Preset;
  content: PreviewContent;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
  /** Browse everything else shaped like this. */
  onFacet: (tag: string) => void;
}) {
  const lang = useStore((s) => s.language);
  const doc = useMemo(() => presetDesignDoc(preset, lang), [preset, lang]);
  const theme = preset.design.theme;
  // WHAT THIS PAGE IS MADE OF, in order. The right half of this sheet was a
  // name, a blurb, two buttons and then ~350px of nothing, while the one thing
  // an author is actually deciding — is this the shape I want — was only
  // readable off the picture beside it.
  const manifest = useMemo(
    () => doc.sections.filter((section) => !section.hidden).map((section) => section.kind),
    [doc],
  );
  return (
    <div className="s-dsgp-detail">
      <div className="s-dsgp-detail__stage">
        <DesignCanvas
          design={doc}
          content={content}
          clipHeight={1400}
          ownTheme
          label={preset.name[lang] || preset.name.en}
        />
      </div>
      <div className="s-dsgp-detail__text">
        <h3 className="s-dsgp-detail__name" dir="auto">
          {preset.name[lang] || preset.name.en}
        </h3>
        <p className="s-dsgp-detail__blurb" dir="auto">
          {preset.blurb[lang] || preset.blurb.en}
        </p>
        <p className="s-dsgp-detail__meta">
          <span className="s-dsgp-detail__fam">{t(FAMILY_LABEL[preset.family])}</span>
          {theme && isTheme(theme) && (
            <span className="s-dsgp-detail__theme">
              <span className="s-dsgp-card__theme" data-theme={theme} aria-hidden="true" />
              {choiceLabel(theme)}
            </span>
          )}
        </p>
        <ol className="s-dsgp-detail__manifest">
          {manifest.map((kind, i) => (
            <li key={`${kind}-${i}`} className="s-dsgp-detail__part">
              <SectionGlyph kind={kind} size="row" />
              <span>{sectionKindLabel(kind)}</span>
            </li>
          ))}
        </ol>
        {/* THE TAGS ARE FACETS, NOT DECORATION. Every preset already carries a
            rich `tags` array ("wide", "grid", "uppercase", "masthead", "news",
            "dense", "headlines") and the only way to reach any of it was to
            guess the word into the free-text box. `presetMatches` already
            searches tags, so a chip is one setText away from being a filter. */}
        {preset.tags.length > 0 && (
          <div className="s-dsgp-detail__tags">
            {preset.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="s-dsgp-facet"
                onClick={() => onFacet(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        {/* The one thing an author must be told BEFORE they apply, because it
            is the difference between a design and a design that is finished:
            a preset ships pure form and no words. */}
        <p className="s-dsgp-detail__fill">{t("presetFillIn")}</p>
        <div className="s-dsgp-detail__acts">
          <button type="button" className="s-btn s-btn--accent" disabled={busy} onClick={onApply}>
            {t("presetApply")}
          </button>
          <button type="button" className="s-btn" disabled={busy} onClick={onClose}>
            {t("close")}
          </button>
        </div>
        <p className="s-dsgp-detail__fork">{t("presetForkNote")}</p>
      </div>
    </div>
  );
}
