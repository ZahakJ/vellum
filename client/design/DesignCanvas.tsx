// THE CANVAS — one component that draws ANY design at ANY width, using the
// real renderers, and scales the result into whatever box it is given.
//
// This is the thing the panel's "LIVE PREVIEW" pane was missing. The old pane
// drew the chrome around a typography SPECIMEN — a heading ladder and two
// paragraphs — so the six controls that shape the composed page (every section,
// the column width, the density, the grid columns, the banners) changed
// nothing on screen. The specimen was the right answer for a typography tab and
// the wrong one for a designer, and it is kept: `route: "article"` renders it,
// because an article page IS the specimen and is also a real page of the
// design.
//
// THREE PROPERTIES, and every one of them is load-bearing:
//
//  1. IT IS THE REAL RENDERER. `DesignHeader`, `RenderSection`, `DesignFooter`,
//     `typographyVars`, the `.s-dsn` scope, the `--dsn-width` variable. Not one
//     line of section markup is written twice. A preview assembled from a
//     simplified copy is a preview of the copy, and every divergence is a bug
//     the author finds after publishing.
//  2. IT LAYS OUT AT A WIDTH AND SCALES THE PIXELS. The inner tree is given
//     `width: <width>px` and then `transform: scale(k)` where k is the box over
//     that width. So a 200px card and a 900px pane show the SAME page at two
//     sizes — not two responsive breakpoints, which is what putting the design
//     in a narrow box would show and would be a lie about what a reader sees.
//  3. IT IS INERT AND IT CANNOT TAKE THE PANEL DOWN. No nav handler is
//     registered (the site owns the address bar; a preview inside the app must
//     not), clicks are swallowed at the container, `pointer-events` are off
//     inside, and every part is wrapped in the same `DesignBoundary` the live
//     site uses — so a preset with a broken section renders a card in the card
//     instead of unmounting the designer.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { DesignDoc, Section } from "../../shared/design.ts";
import { typographyVars } from "../../shared/designChrome.ts";
import { isTheme } from "../../shared/themes.ts";
import { t } from "../i18n.ts";
import { useStore } from "../state.ts";
import DesignFooter from "./DesignFooter.tsx";
import DesignHeader from "./DesignHeader.tsx";
import { DesignBoundary, type SectionFailure } from "./DesignBoundary.tsx";
import { PreviewContentProvider, type PreviewContent } from "./previewContent.tsx";
import { RenderSection, sectionKindLabel } from "./Sections.tsx";
import "../styles/design.css";
import "../styles/presets.css";

export interface DesignCanvasProps {
  /** The document to draw. Any valid `DesignDoc` — the panel's live draft, a
   *  stored design, or a preset turned into one by `presetDesignDoc()`. */
  design: DesignDoc;
  /** What the sections read instead of the live vault. */
  content: PreviewContent;
  /**
   * The viewport width to LAY OUT at, in CSS px, before scaling. Default 1120
   * — a desktop reader, which is what a design is being judged as.
   *
   * This is not the size the canvas occupies: that is its container's, and the
   * scale factor between them is computed. Pass a small number here only to
   * preview the design's own narrow-screen behaviour, never to make the canvas
   * fit — that is what `fit` is for.
   */
  width?: number;
  /**
   * How the laid-out tree meets its box.
   *   · `"scale"` (default) — `transform: scale()` to the box's width. The
   *     whole page, small.
   *   · `"native"` — no transform; the box scrolls. The designer's own pane,
   *     where the author is reading the type rather than judging the shape.
   */
  fit?: "scale" | "native";
  /** Which page of the design to draw. `"home"` is the composed section tree;
   *  `"article"` is an article page's furniture around the type specimen. */
  route?: "home" | "article";
  /** Clip the drawn page to this many px of LAID-OUT height (before scaling),
   *  with a fade at the cut. A thumbnail wants 900; a full pane wants none. */
  clipHeight?: number;
  /** Paint the design's own theme on the canvas root rather than inheriting
   *  the app's. On for the gallery (the palette IS the preset at that size),
   *  off for the designer (the author is looking at their own site in their
   *  own theme). Custom themes are keyed at `:root` and cannot be painted on a
   *  nested element — a `custom:` choice is therefore ignored here and applies
   *  on fork, which is when it matters. */
  ownTheme?: boolean;
  /**
   * The canvas is in a REAL VIEWPORT — the designer's preview frame — rather
   * than in a box in the app's own document. Two things follow, and neither is
   * safe anywhere else:
   *
   *  · IT CAN BE HOVERED. `pointer-events` come back on, so an author can see
   *    their own link, card and topic-chip hover states. Clicks are still
   *    swallowed, by the frame's own capture listener (React's synthetic
   *    events do not cross a document boundary, so the handler below is inert
   *    in there — see PreviewFrame).
   *  · STICKY IS HONOURED. The note on `s-dsg-top` below explains why a scaled
   *    canvas must drop it; a frame has its own scrollport, so the header pins
   *    exactly where a reader will see it pin, and the switch that turns it on
   *    finally has a preview.
   */
  live?: boolean;
  className?: string;
  /** Accessible name. The canvas is a picture of a page, so it is labelled
   *  rather than read: everything inside it is `aria-hidden`. */
  label?: string;
}

/** The default layout width. A desktop reader — the size a design is judged
 *  at, and the size every preset in the catalog was drawn against. */
export const CANVAS_WIDTH = 1120;

export default function DesignCanvas({
  design,
  content,
  width = CANVAS_WIDTH,
  fit = "scale",
  route = "home",
  clipHeight,
  ownTheme = false,
  live = false,
  className,
  label,
}: DesignCanvasProps) {
  const siteName = useStore((s) => s.siteName);
  const tagline = useStore((s) => s.tagline);
  const footerLine = useStore((s) => s.footerLine);
  const logo = useStore((s) => s.logo);
  const locale = useStore((s) => s.blogLocale);
  const language = useStore((s) => s.language);

  const box = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  // The scale factor is the box over the layout width, remeasured whenever the
  // box changes — a panel that is resizable, a card in a grid that reflows, a
  // pane that grows when the controls column collapses. ResizeObserver rather
  // than a window listener: none of those three fire `resize`.
  const measure = useCallback(() => {
    const el = box.current;
    if (!el || fit === "native") return;
    const available = el.clientWidth;
    if (available > 0) setScale(available / width);
  }, [fit, width]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    const el = box.current;
    if (!el || fit === "native") return;
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [fit, measure]);

  // Every link in here points at the real site; inside the panel it must go
  // nowhere. One capture-phase swallow covers the header, the whole menu
  // (submenus included), every card and the footer at once — and it is kept
  // even though `pointer-events: none` is set inside, because a keyboard
  // Enter on a focused link does not go through the pointer.
  //
  // SCOPED TO THE CANVAS, and that scoping is not tidiness. A canvas is
  // routinely mounted INSIDE a button — a gallery card is one — so an
  // unscoped `closest("a,button")` finds the CARD, swallows its click, and the
  // preset can be hovered but never chosen. Only a link or button that is a
  // DESCENDANT of the canvas is the page's own furniture, and only that is
  // swallowed.
  const swallow = (e: MouseEvent): void => {
    const hit = (e.target as HTMLElement).closest("a,button");
    if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const chrome = design.chrome;
  const sections = useMemo(
    () => design.sections.filter((section) => !section.hidden),
    [design.sections],
  );
  // The topics FALLBACK is computed here rather than passed, because it is a
  // property of the design meeting the content: an author who built no menu
  // gets the busiest tags, exactly as the live site gives them.
  const topics = useMemo(() => {
    if (chrome.nav.items.length > 0 || chrome.nav.fallback !== "topics") return [];
    const counts = new Map<string, number>();
    for (const post of content.posts) {
      for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([tag]) => tag);
  }, [chrome.nav.items.length, chrome.nav.fallback, content.posts]);

  // Sticky is DROPPED inside a SCALED canvas. `position: sticky` resolves
  // against the nearest scroll container, and inside a `transform: scale()`
  // wrapper that container is the transformed element itself — the header
  // would pin to a position that is not where the reader sees it. A preview
  // that draws a header in the wrong place to honour a switch is worse than
  // one that draws it in the right place. `live` is the one case where the
  // canvas has a scrollport of its OWN — the preview frame's document — and
  // there the switch is previewed rather than deferred.
  //
  // `scale` lays out at a fixed width and transforms the pixels — the same
  // page at two sizes. `native` lets the pane's OWN width be the viewport, so
  // the design reflows exactly as it would on a reader's screen of that width;
  // that is what the designer's pane wants, because an author there is reading
  // their own type rather than judging a shape from across the room.
  const style: CSSProperties = {
    ...(fit === "scale"
      ? { width: `${width}px`, transform: `scale(${scale})`, transformOrigin: "top left" }
      : {}),
    "--dsn-width": `${design.site.width}px`,
    ...typographyVars(chrome.typography),
  } as CSSProperties;

  const themeAttr = ownTheme && design.theme && isTheme(design.theme) ? design.theme : undefined;
  /** The header's own stickiness, in a frame that can honour it. */
  const sticky = live ? chrome.header.sticky : "none";

  return (
    <div
      ref={box}
      className={`s-dsgv s-dsgv--${fit}${live ? " s-dsgv--live" : ""}${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={label ?? t("designCanvasLabel")}
      onClickCapture={swallow}
      // THE THEME GOES ON THE BOX, not on the page inside it. The box paints
      // the ground the scaled page sits on and the fade at the clip, and both
      // must be the DESIGN's colours — a parchment preset fading into the
      // app's iron-gall reads as a shadow somebody forgot to remove.
      data-theme={themeAttr}
      style={
        {
          // The box's own height follows the scaled content when the caller
          // clipped it; otherwise the caller's CSS decides and the content
          // overflows into a scroll (`native`) or is simply cut (`scale`).
          ...(clipHeight !== undefined && fit === "scale"
            ? { height: `${Math.round(clipHeight * scale)}px` }
            : {}),
        } as CSSProperties
      }
    >
      <div
        className={`s-dsgv__page s-dsn s-dsg s-dsn--${design.site.density}${
          sticky !== "none" ? " s-dsn--sticky" : ""
        }`}
        style={style}
        data-lang={language}
        aria-hidden="true"
      >
        <PreviewContentProvider value={content}>
          <div
            className={`s-dsg-top${
              sticky === "header"
                ? " s-dsg-top--sticky"
                : sticky === "nav"
                  ? " s-dsg-top--stickynav"
                  : ""
            }`}
          >
            <DesignBoundary
              key={`${design.updatedMs}:header`}
              id="header"
              kind="header"
              onFail={noop}
              fallback={(failure) => <CanvasFailure failure={failure} />}
            >
              <DesignHeader
                header={chrome.header}
                items={chrome.nav.items}
                topics={topics}
                pathname="/"
                siteName={siteName}
                tagline={chrome.header.showTagline ? tagline : null}
                logo={logo}
                menuOpen={false}
                onToggleMenu={noop}
                tools={<CanvasTools nav={chrome.nav} />}
              />
            </DesignBoundary>
          </div>

          <main className="s-dsn-main">
            <div className="s-dsn-page">
              {route === "article" ? (
                <ArticleSpecimen />
              ) : (
                sections.map((section) => (
                  <DesignBoundary
                    key={`${design.updatedMs}:${section.id}`}
                    id={section.id}
                    kind={section.kind}
                    onFail={noop}
                    fallback={(failure) => <CanvasFailure failure={failure} />}
                  >
                    <RenderSection section={section as Section} posts={content.posts} locale={locale} />
                  </DesignBoundary>
                ))
              )}
            </div>
          </main>

          <DesignBoundary
            key={`${design.updatedMs}:footer`}
            id="footer"
            kind="footer"
            onFail={noop}
            fallback={(failure) => <CanvasFailure failure={failure} />}
          >
            <DesignFooter
              footer={chrome.footer}
              siteName={siteName}
              instanceFooter={footerLine}
              authProtected={false}
              onSignIn={noop}
            />
          </DesignBoundary>
        </PreviewContentProvider>
      </div>
    </div>
  );
}

function noop(): void {
  /* a canvas swallows what the live site would act on */
}

/** The three instance tools, as inert glyphs. A preview that dropped them
 *  would leave their switches with no visible effect, and a live search box
 *  inside the panel would open the site's own overlay over the designer. */
function CanvasTools({ nav }: { nav: DesignDoc["chrome"]["nav"] }) {
  return (
    <>
      {nav.showSearch && (
        <span className="s-dsn-nav__tool" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.6-3.6" />
          </svg>
        </span>
      )}
      {nav.showLangSwitch && (
        <span className="s-dsn-nav__tool" aria-hidden="true">
          ع
        </span>
      )}
      {nav.showThemeToggle && (
        <span className="s-dsn-nav__tool" aria-hidden="true">
          ☾
        </span>
      )}
    </>
  );
}

/** The typography specimen, in the article page's own furniture — the honest
 *  thing to show a type control, because it shows the sizes, the measure, the
 *  rhythm and the case at once and without waiting on a fetch. */
function ArticleSpecimen() {
  return (
    <article className="s-dsn-article">
      <h1 className="s-dsn-article__title" dir="auto">
        {t("designSpecimenTitle")}
      </h1>
      <div className="s-dsn-rich s-dsn-article__body">
        <p className="s-rv-p" dir="auto">
          {t("designSpecimenLead")}
        </p>
        <h2 className="s-rv-h s-rv-h2" dir="auto">
          {t("designSpecimenH2")}
        </h2>
        <p className="s-rv-p" dir="auto">
          {t("designSpecimenBody")}
        </p>
        <h3 className="s-rv-h s-rv-h3" dir="auto">
          {t("designSpecimenH3")}
        </h3>
        <p className="s-rv-p" dir="auto">
          {t("designSpecimenBody")}
        </p>
      </div>
    </article>
  );
}

/** A part that threw, inside a canvas. Named, small, and it never escalates:
 *  the canvas is a picture, so a broken picture is a caption rather than a
 *  rescue — the rescue belongs to the live site, which has its own boundary. */
function CanvasFailure({ failure }: { failure: SectionFailure }) {
  return (
    <p className="s-dsgv__failed" role="status">
      {sectionKindLabel(failure.kind)}
    </p>
  );
}
