// THE GALLERY — fifty finished designs, browsable, and one click from being
// yours.
//
// THE FLOW, in the order somebody actually does it: look at the shapes, filter
// to the family that matches what you write, hover the two you like to see them
// alive, pick one, and land in the designer with an EDITABLE COPY open. There
// is no step where a preset is "in use": applying FORKS it (`presetExport()` →
// the existing import route) and the shipped preset is never referenced again.
// Nothing an author does afterwards can reach back into the catalog, and no
// upgrade of the catalog can reach forward into their site.
//
// THE TWO-TIER PICTURE. The grid draws CSS miniatures (`DesignThumb`), which
// cost nothing and are painted in the operator's own theme. The card under the
// pointer — one at a time, after a short dwell — swaps to a real
// `<DesignCanvas>`: the actual header, the actual sections, the operator's own
// posts and banners, at 1120px, scaled into the card. So the grid stays cheap
// and the thing you are looking at is the thing you will get.
//
// COMPONENT CONTRACT. This file owns filtering, hover and selection; it owns
// NO network and NO store writes. `onApply` and `onBlank` are the host's, and
// they are the only two ways out. That is deliberate: the panel already knows
// how to open a document, refresh its overview and toast a failure, and a
// gallery that did any of it a second way is a gallery that drifts.

import { useEffect, useMemo, useRef, useState } from "react";
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
import DesignThumb from "./DesignThumb.tsx";
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
  /** The card showing a LIVE canvas. Exactly one, ever. */
  const [live, setLive] = useState<string | null>(null);
  /** The card opened into the detail pane. */
  const [chosen, setChosen] = useState<string | null>(null);
  const dwell = useRef<number | null>(null);

  useEffect(() => () => {
    if (dwell.current !== null) window.clearTimeout(dwell.current);
  }, []);

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

  // A dwell, not a hover. Swapping a miniature for a real render on `mouseenter`
  // turns a mouse crossing the grid into a dozen React trees mounting and
  // unmounting; 180ms is long enough that only a card somebody stopped on
  // pays, and short enough that stopping on one feels immediate.
  const hover = (id: string | null): void => {
    if (dwell.current !== null) window.clearTimeout(dwell.current);
    if (id === null) {
      dwell.current = window.setTimeout(() => setLive(null), 120);
      return;
    }
    dwell.current = window.setTimeout(() => setLive(id), 180);
  };

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
              live={live === preset.id}
              chosen={chosen === preset.id}
              onHover={hover}
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

function PresetCard({
  preset,
  content,
  live,
  chosen,
  onHover,
  onChoose,
}: {
  preset: Preset;
  content: PreviewContent;
  live: boolean;
  chosen: boolean;
  onHover: (id: string | null) => void;
  onChoose: () => void;
}) {
  const lang = useStore((s) => s.language);
  // Rebuilt only when the preset or the language changes — `presetDesignDoc`
  // deep-copies, and a copy per pointer move is a copy per pointer move.
  const doc = useMemo(() => presetDesignDoc(preset, lang), [preset, lang]);
  const theme = preset.design.theme;
  return (
    <button
      type="button"
      className={`s-dsgp-card${chosen ? " s-dsgp-card--on" : ""}`}
      aria-pressed={chosen}
      onClick={onChoose}
      onMouseEnter={() => onHover(preset.id)}
      onMouseLeave={() => onHover(null)}
      // Keyboard reaches the live render immediately: a focus ring is a
      // deliberate stop, and there is nothing to debounce.
      onFocus={() => onHover(preset.id)}
      onBlur={() => onHover(null)}
    >
      <span className="s-dsgp-card__stage">
        {live ? (
          <DesignCanvas
            design={doc}
            content={content}
            clipHeight={860}
            ownTheme
            className="s-dsgp-card__canvas"
            label={preset.name[lang] || preset.name.en}
          />
        ) : (
          <DesignThumb design={doc} seed={preset.id} />
        )}
      </span>
      <span className="s-dsgp-card__foot">
        <span className="s-dsgp-card__name" dir="auto">
          {preset.name[lang] || preset.name.en}
        </span>
        <span className="s-dsgp-card__fam">{t(FAMILY_LABEL[preset.family])}</span>
        {theme && isTheme(theme) && (
          <span
            className="s-dsgp-card__theme"
            data-theme={theme}
            title={choiceLabel(theme)}
            aria-hidden="true"
          />
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
}: {
  preset: Preset;
  content: PreviewContent;
  busy: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const lang = useStore((s) => s.language);
  const doc = useMemo(() => presetDesignDoc(preset, lang), [preset, lang]);
  const theme = preset.design.theme;
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
