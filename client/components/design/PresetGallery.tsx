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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
import { designFontRefs } from "../../../shared/designChrome.ts";
import { setDesignFonts } from "../../design/designFonts.ts";
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
  signature: "presetFamSignature",
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

/**
 * IS THE GALLERY DRILLED IN, AND CAN THE PANEL BORROW ESC?
 *
 * The same precedence `SectionPicker` established, for the same measured
 * reason: Esc is claimed by every layer at once, both listen in the CAPTURE
 * phase on `window`, and capture order is registration order — so the panel,
 * mounted first, wins and one Esc closed the WHOLE designer out from under a
 * reader who only meant to leave a preset. `stopPropagation` from in here
 * cannot fix that; it runs second. So the OUTER surface asks.
 *
 * A back-out function rather than a bare flag, because the answer the reader
 * wants from Esc in a drilled-in gallery is not "do nothing" — it is "take me
 * back to the shelf", which is a step the panel cannot perform itself.
 */
let leaveDetail: (() => void) | null = null;
export function isPresetDetailOpen(): boolean {
  return leaveDetail !== null;
}
export function closePresetDetail(): boolean {
  if (!leaveDetail) return false;
  leaveDetail();
  return true;
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

  // THE CARDS PAINT THEIR OWN TYPE. A card is a real `<DesignCanvas>`, so a
  // preset that names EB Garamond has to be DRAWN in EB Garamond or the shelf
  // is fifty-nine designs in one typeface arguing about margins. The cards live
  // in the app's own document, so one link in <head> reaches all of them —
  // client/design/designFonts.ts.
  //
  // The union is taken over the WHOLE catalog rather than the filtered shelf,
  // because a link that changed as the reader typed in the search box would
  // re-fetch a stylesheet per keystroke to dress cards that are already on
  // screen. That union is capped (MAX_REFS): presets share faces heavily by
  // construction — a house style is the point of a family — and if a future
  // catalog ever names more distinct faces than the cap, the cards past it
  // paint in the instance's stacks, which is the same graceful nothing a face
  // that will not download produces. That is the constraint, and it is written
  // here rather than discovered.
  useEffect(() => {
    setDesignFonts("gallery", presets.flatMap((preset) => designFontRefs(preset.design.chrome.typography)));
    return () => setDesignFonts("gallery", []);
  }, [presets]);
  /** The card opened into the detail pane. */
  const [chosen, setChosen] = useState<string | null>(null);
  /**
   * WHERE THE READER WAS STANDING WHEN THEY WENT IN.
   *
   * The shelf is fifty-nine cards long and the detail is a takeover, so
   * "back" has to mean back to the same place, with the same card under the
   * same finger — not the top of a list somebody scrolled two screens into.
   * Two things are remembered and both are restored on the way out: the
   * scrollport's offset, and which card had focus (a keyboard reader who
   * pressed Enter on card 31 and pressed Esc must not land on the search box).
   */
  const scroller = useRef<HTMLDivElement | null>(null);
  const place = useRef<{ top: number; id: string } | null>(null);
  const restore = useRef<string | null>(null);
  /** THE CARD YOU CAME BACK FROM, kept marked. The focus ring says where the
   *  KEYBOARD is and vanishes the moment a pointer touches anything else; a
   *  reader comparing two shapes across fifty-nine cards needs the shelf to
   *  remember which one they just looked at for longer than that. */
  const [seen, setSeen] = useState<string | null>(null);

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
  /** Where in the CURRENT shelf this preset stands. The detail's ‹ › step
   *  through the filtered list, so the position has to be the filtered one:
   *  "3 of 11" inside the Minimal family, not "17 of 59". */
  const at = useMemo(
    () => (chosen === null ? -1 : shown.findIndex((p) => p.id === chosen)),
    [shown, chosen],
  );

  /** Walk into a card: remember the shelf, then open it. */
  const enter = useCallback((id: string): void => {
    place.current = { top: scrollHost(scroller.current)?.scrollTop ?? 0, id };
    setChosen(id);
  }, []);

  /** Walk back out: the shelf, at the same offset, with the same card focused. */
  const leave = useCallback((): void => {
    restore.current = place.current?.id ?? null;
    setSeen(place.current?.id ?? null);
    setChosen(null);
  }, []);

  // THE PANEL BORROWS ESC THROUGH THIS HANDLE, and it must be dropped the
  // instant the detail closes — a stale one would tell the designer an inner
  // layer owns a key nothing is listening for, and Esc would stop closing the
  // panel at all.
  useEffect(() => {
    if (chosen === null) return;
    leaveDetail = leave;
    return () => {
      leaveDetail = null;
    };
  }, [chosen, leave]);

  // Coming back out: the offset first (in the layout the browser is about to
  // paint), then the card. `scrollTop` is written before focus because
  // `focus()` scrolls an off-screen element into view, and doing it in the
  // other order would fight itself.
  useEffect(() => {
    if (chosen !== null || restore.current === null) return;
    const id = restore.current;
    restore.current = null;
    const root = scroller.current;
    const host = scrollHost(root);
    if (host && place.current) host.scrollTop = place.current.top;
    const card = root?.querySelector<HTMLElement>(`[data-preset="${CSS.escape(id)}"]`);
    card?.focus({ preventScroll: true });
  }, [chosen]);

  // Backspace goes back and ← → step along the shelf. (ESC IS NOT HERE: it is
  // claimed in the capture phase by the panel, which asks `isPresetDetailOpen`
  // first and unwinds one step — the same precedence the section picker keeps,
  // and the only place it can live, because a bubble-phase handler in here
  // runs second and cannot stop a capture-phase one.)
  //
  // Local and bubble-phase, and it stands down inside any field: Backspace in
  // a text input is a deletion, not a navigation — that is the mistake
  // browsers spent a decade removing.
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (chosen === null) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      leave();
      return;
    }
    // THE ARROWS FOLLOW THE READING DIRECTION, not the keycap. In an RTL
    // shelf the NEXT card is to the LEFT, and a pair of arrows that ignored
    // that would walk an Arabic reader backwards through their own catalog.
    const rtl = document.documentElement.getAttribute("dir") === "rtl";
    const step = e.key === "ArrowRight" ? (rtl ? -1 : 1) : e.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    if (step === 0 || at < 0) return;
    const next = shown[at + step];
    if (!next) return;
    e.preventDefault();
    setChosen(next.id);
  };

  return (
    <div
      ref={scroller}
      className={`s-dsgp${chosen !== null ? " s-dsgp--detail" : ""}`}
      onKeyDown={onKey}
    >
      {/* THE SHELF IS STILL MOUNTED WHILE THE DETAIL IS OPEN — hidden, never
          unmounted. That is what makes "back" lossless: the query in the
          search box, the family chip, and the fifty-nine cards' own DOM (so
          the offset restored below still means something) all survive the
          round trip, where a conditional render would drop the reader at the
          top of a shelf they had scrolled two screens into. */}
      <div className="s-dsgp__bar" hidden={chosen !== null}>
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

      <div
        className="s-dsgp__families"
        role="group"
        aria-label={t("presetFamilies")}
        hidden={chosen !== null}
      >
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
          at={at}
          total={shown.length}
          onStep={(delta) => {
            const next = shown[at + delta];
            if (next) setChosen(next.id);
          }}
          onApply={() => void onApply(selected)}
          onBack={leave}
          onFacet={(tag) => {
            setText(tag);
            setFamily(null);
            leave();
          }}
        />
      )}

      <ul className="s-dsgp__grid" hidden={chosen !== null}>
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
              chosen={seen === preset.id}
              onChoose={() => enter(preset.id)}
            />
          </li>
        ))}
      </ul>

      {shown.length === 0 && chosen === null && <p className="s-dsgr-empty">{t("presetNoMatch")}</p>}
      {content.synthetic && chosen === null && (
        <p className="s-dsgp__note">{t("presetSampleNote")}</p>
      )}
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
  /** The card the reader most recently walked into and back out of. */
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
      // A card OPENS a preset now rather than toggling a sheet below the
      // shelf, so it is a link-shaped control and says so: `aria-expanded`
      // would be a lie about a disclosure that no longer exists, and
      // `aria-pressed` a lie about a toggle. `data-preset` is the handle the
      // shelf uses to put focus back on this exact card on the way out.
      data-preset={preset.id}
      className={`s-dsgp-card${chosen ? " s-dsgp-card--on" : ""}`}
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

/**
 * THE DETAIL IS A PLACE YOU WALKED INTO, so it has a door with a sign on it.
 *
 * It used to be a sheet that unfolded ABOVE the shelf, with the only way out a
 * button called "Close" at the bottom of a column of copy — under the fold on
 * the panel's own height — beside a button that applies the preset to the
 * site. Two problems, and the second is the one the owner hit: nothing at the
 * TOP of the view said where the reader was or how to get back, and the word
 * "Close" in a modal panel reads as "close the panel".
 *
 * So the view opens with the three things a drilled-in screen owes its reader,
 * in the order they are looked for:
 *   · BACK, at the inline-start, as a real button with the word on it.
 *   · WHERE, as a crumb — Presets › Kiosk — and a position in the shelf being
 *     browsed, so "3 of 11" answers "how much of this have I seen".
 *   · WHAT HAPPENS NEXT, at the inline-end: the one accent button that
 *     actually changes something, with the state it changes FROM printed
 *     beside it ("Preview — not applied yet"). Looking and applying were one
 *     row of two grey-ish buttons; now only one of them is loud.
 */
function PresetDetail({
  preset,
  content,
  busy,
  at,
  total,
  onStep,
  onApply,
  onBack,
  onFacet,
}: {
  preset: Preset;
  content: PreviewContent;
  busy: boolean;
  /** Index in the FILTERED shelf, and its length. */
  at: number;
  total: number;
  /** Walk to the previous (-1) / next (+1) preset without going back out. */
  onStep: (delta: number) => void;
  onApply: () => void;
  onBack: () => void;
  /** Browse everything else shaped like this. */
  onFacet: (tag: string) => void;
}) {
  const lang = useStore((s) => s.language);
  const doc = useMemo(() => presetDesignDoc(preset, lang), [preset, lang]);
  const theme = preset.design.theme;
  const name = preset.name[lang] || preset.name.en;
  const back = useRef<HTMLButtonElement | null>(null);
  // FOCUS FOLLOWS THE READER INTO THE ROOM. A takeover that leaves focus on a
  // card that is now `hidden` strands the keyboard: the next Tab restarts from
  // the top of the document, and Esc is the only thing that still works by
  // accident. Focus lands on Back, which is also the way out.
  useEffect(() => {
    back.current?.focus();
  }, []);
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
      <div className="s-dsgp-detail__bar">
        <button
          ref={back}
          type="button"
          className="s-dsgp-back"
          onClick={onBack}
          // The whole sentence, for a reader who arrives on this button with
          // no idea what "‹" was. The visible label stays two words.
          aria-label={t("presetBackToGallery")}
        >
          <BackArrow />
          <span>{t("presetBack")}</span>
        </button>
        {/* THE LAST SEGMENT OF THE PANEL'S TRAIL, NOT A SECOND TRAIL.
            This line used to draw its own root — "Presets › Broadsheet" —
            about 100px under the panel's own crumb, which was at that moment
            reading "Design your site › Presets". Two breadcrumbs on one screen
            saying different things answer "where you are, in the panel"
            (CONTRACTS) twice, and the shorter one wins the eye. So the root
            and its separator are gone: the panel says where the room is, this
            says which preset is open in it, and the trail reads as one. The
            preset's own name is note-shaped text and takes its own
            direction. */}
        <p className="s-dsgp-detail__crumb">
          <bdi className="s-dsgp-detail__crumbleaf">{name}</bdi>
        </p>
        {total > 1 && at >= 0 && (
          <div className="s-dsgp-detail__step">
            {/* PREVIOUS AND NEXT ARE LOGICAL. The buttons are SVG chevrons —
                geometry, which bidi never touches — so the stylesheet mirrors
                them under [dir="rtl"], and "previous" stays the card on the
                reading-start side in both languages. */}
            <button
              type="button"
              className="s-dsgp-detail__arrow"
              onClick={() => onStep(-1)}
              disabled={at <= 0}
              aria-label={t("presetPrev")}
            >
              <StepArrow back />
            </button>
            <span className="s-dsgp-detail__pos">
              {tf("presetPosition", { n: localeNum(at + 1), total: localeNum(total) })}
            </span>
            <button
              type="button"
              className="s-dsgp-detail__arrow"
              onClick={() => onStep(1)}
              disabled={at >= total - 1}
              aria-label={t("presetNext")}
            >
              <StepArrow />
            </button>
          </div>
        )}
        {/* THE STATE, THEN THE ACT. "You are looking at this, you have not
            taken it" is the fact the old sheet never printed anywhere, and it
            is the difference between a gallery and a settings form that has
            already changed something. */}
        <span className="s-dsgp-detail__state">{t("presetPreviewOnly")}</span>
        <button type="button" className="s-btn s-btn--accent" disabled={busy} onClick={onApply}>
          {t("presetApply")}
        </button>
      </div>

      <div className="s-dsgp-detail__stage">
        <DesignCanvas design={doc} content={content} clipHeight={1400} ownTheme label={name} />
      </div>
      <div className="s-dsgp-detail__text">
        <h3 className="s-dsgp-detail__name" dir="auto">
          {name}
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
        {/* The pair is repeated at the foot of the column because the column
            is long enough to scroll the bar off, and an author who has just
            finished reading the manifest should not have to travel back up to
            act on it. The KEYSTROKES are printed here rather than in the bar:
            the bar is where the eye goes, the foot is where it lingers. */}
        <div className="s-dsgp-detail__acts">
          <button type="button" className="s-btn s-btn--accent" disabled={busy} onClick={onApply}>
            {t("presetApply")}
          </button>
          <button type="button" className="s-btn" disabled={busy} onClick={onBack}>
            {t("presetBack")}
          </button>
        </div>
        <p className="s-dsgp-detail__keys">{t("presetKeysHint")}</p>
        <p className="s-dsgp-detail__fork">{t("presetForkNote")}</p>
      </div>
    </div>
  );
}

/**
 * WHAT ACTUALLY SCROLLS UNDER THE SHELF.
 *
 * The gallery does not own its scrollport — the panel's controls column does,
 * and on the presets tab that column is the whole width of the panel. So the
 * offset that has to be remembered belongs to an ancestor, and which ancestor
 * is a layout fact rather than a constant: it is found by walking up and asking
 * the computed style, which stays right if the panel's grid is ever rearranged
 * and cannot go stale against a class name in another file.
 */
function scrollHost(from: HTMLElement | null): HTMLElement | null {
  for (let el = from; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return null;
}

/** The way out, drawn as geometry rather than as a glyph: an SVG path is not
 *  text, bidi never reorders it, so the stylesheet mirrors it under
 *  `[dir="rtl"]` and the arrow points at the reading-start edge in both
 *  languages (CONTRACTS, "SVG paths are geometry, not text"). */
function BackArrow() {
  return (
    <svg
      className="s-dsgp-back__arrow"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M13 8H3.5M7 3.5 2.5 8 7 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One step along the shelf. Same mirroring rule as the back arrow. */
function StepArrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      className={`s-dsgp-step__arrow${back ? " s-dsgp-step__arrow--back" : ""}`}
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={back ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
