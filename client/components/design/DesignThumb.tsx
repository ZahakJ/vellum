// THE MINIATURE — a design at 200px, drawn as CSS.
//
// THE DECISION, and it was between three:
//
//  1. SHIPPED SCREENSHOTS. Accurate and dead. Fifty PNGs at two densities is
//     megabytes in a public repo that must be REGENERATED every time a token
//     moves, and every one of them is painted in whatever theme the machine
//     that shot it was wearing — so a reader on `nocturne` browses fifty
//     pictures of `parchment`. Refused.
//  2. FIFTY LIVE CANVASES. Impressive and unusable. Each is a full React tree
//     with a header, a grid, a footer and a ResizeObserver; fifty of them is
//     several thousand nodes mounting while somebody scrolls a gallery.
//  3. THIS. A pure-CSS miniature drawn FROM the design — its header layout,
//     its column width, its density, its actual section list in its actual
//     order — painted entirely in the theme's own tokens, with the artwork
//     coming from `generatedBannerCss()`, the same function the product
//     already uses for a banner-less post. Zero bytes in the repo, zero
//     fetches, ~40 nodes a card, and it repaints on a theme switch because it
//     never named a colour.
//
// AND THE HYBRID IS THE POINT: the miniature is what the GRID shows, and a
// real `<DesignCanvas>` is what a hovered or selected card shows. The
// expensive, honest render is paid once, for the one card somebody is looking
// at, instead of fifty times for the forty-nine they are not.
//
// WHY A WIREFRAME IS NOT A COMPROMISE AT THIS SIZE. A scaled screenshot of a
// real page at 200px is a grey smear with an unreadable word at the top; it
// LOOKS accurate and communicates nothing. The miniature answers the only
// question 200px can answer — what SHAPE is this, and how much air does it
// have — and it answers it in the reader's own palette. The question it cannot
// answer is what the type feels like, which is exactly the question the hover
// canvas exists for.
//
// THE ACTIVE THEME, ALWAYS. A preset may NAME a theme, and the card shows that
// as a labelled swatch — but the miniature itself is painted in the theme the
// operator is running. Fifty cards each in their own palette is a colour riot
// that hides the one variable the grid is for; and the operator is choosing a
// SHAPE here, with the palette one click away in their own picker.

import type { CSSProperties } from "react";
import type { DesignDoc, Section } from "../../../shared/design.ts";
import { generatedBannerCss } from "../../banner.ts";
import { CANVAS_WIDTH } from "../../design/DesignCanvas.tsx";
import "../../styles/presets.css";

export interface DesignThumbProps {
  /** The document to draw. `presetDesignDoc(preset, lang)` for a preset; the
   *  live draft for the designer's own row. */
  design: DesignDoc;
  /** Seed for the generated artwork. The PRESET ID, so a preset's picture is
   *  the same picture on every machine and different from its neighbour's.
   *  (Passing the design's name would repaint every card the moment somebody
   *  renamed a design.) */
  seed: string;
  className?: string;
}

/** How many cells a grid section draws. Two rows is enough to read as a grid;
 *  more is noise at this size and nodes nobody sees. */
function gridCells(columns: number, limit: number): number {
  return Math.max(1, Math.min(limit, columns * 2, 8));
}

/** A generated-artwork background for one block, deterministic in the seed and
 *  the block's own position — so two cards in the same grid are two pictures
 *  and the same card is the same picture on every render. */
function art(seed: string, slot: string): CSSProperties {
  return { background: generatedBannerCss(`${seed}/${slot}`, "thumb") };
}

/** Repeated text rules — the lines that stand in for prose. */
function Lines({ n, className = "" }: { n: number; className?: string }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`s-dsgt-line ${className}`} data-last={i === n - 1 || undefined} />
      ))}
    </>
  );
}

function ThumbSection({ section, seed }: { section: Section; seed: string }) {
  switch (section.kind) {
    case "hero": {
      // THE ARRANGEMENT FIELDS ARE THE ONES A 200px CARD *CAN* ANSWER. This
      // miniature exists to say what shape a design is, and a band, a split
      // and a panel are three different shapes at any size — where the type
      // and the palette are exactly what a card this small cannot show. The
      // default is restated here for the same reason the renderers restate it:
      // a preset's sections reach this component as authored, without passing
      // validateSection.
      const treatment = section.treatment ?? "panel";
      return (
        <div
          className={`s-dsgt-hero s-dsgt-hero--${treatment} s-dsgt-hero--${section.height} s-dsgt-hero--${section.align}`}
          // Only a PANEL is painted by the shell. A band is ground and type by
          // definition, and a split's artwork belongs to its plate — painting
          // the shell as well puts the picture behind the words, which is the
          // one arrangement a split exists not to be.
          style={
            section.image || treatment !== "panel" ? undefined : art(seed, section.id)
          }
        >
          <span className="s-dsgt-line s-dsgt-line--display" />
          <span className="s-dsgt-line s-dsgt-line--sub" />
          {treatment === "split" && (
            <span className="s-dsgt-hero__plate" style={art(seed, `${section.id}-plate`)} />
          )}
        </div>
      );
    }
    case "richText":
      return (
        <div className={`s-dsgt-rich s-dsgt-rich--${section.align}`}>
          <Lines n={3} />
        </div>
      );
    case "note":
      return (
        <div className="s-dsgt-rich">
          {section.heading !== "" && <span className="s-dsgt-line s-dsgt-line--head" />}
          <Lines n={3} />
        </div>
      );
    case "postGrid": {
      const cells = gridCells(section.columns, section.limit);
      const card = section.card ?? "boxed";
      const overlay = card === "overlay";
      return (
        <div className="s-dsgt-block">
          {section.heading !== "" && <span className="s-dsgt-line s-dsgt-line--head" />}
          <div
            className={`s-dsgt-grid s-dsgt-grid--${card}`}
            style={{ "--dsgt-cols": section.columns } as CSSProperties}
          >
            {Array.from({ length: cells }, (_, i) => (
              <span
                key={i}
                className={`s-dsgt-card s-dsgt-card--${card}`}
                // MASONRY IS RAGGED COLUMNS OR IT IS NOTHING. On the real page
                // the raggedness comes from the photographs' own proportions;
                // a miniature has no photographs, so the three ratios are
                // cycled deterministically — the card says "columns of unequal
                // pictures", which is the true and only thing 200px can say
                // about this treatment.
                style={
                  card === "masonry"
                    ? ({ "--dsgt-ar": ["4 / 3", "3 / 4", "1 / 1"][i % 3] } as CSSProperties)
                    : undefined
                }
              >
                {(section.showBanner || overlay) && (
                  <span className="s-dsgt-card__art" style={art(seed, `${section.id}-${i}`)} />
                )}
                <span className="s-dsgt-card__body">
                  <span className="s-dsgt-line s-dsgt-line--title" />
                  {section.showDate && <span className="s-dsgt-line s-dsgt-line--meta" />}
                  {section.showExcerpt && !overlay && <Lines n={2} className="s-dsgt-line--tight" />}
                </span>
              </span>
            ))}
          </div>
        </div>
      );
    }
    case "postList": {
      const layout = section.layout ?? "river";
      const rows = Math.max(1, Math.min(section.limit, layout === "river" ? 4 : 5));
      // A dateline is GROUPS, and two of them is the fewest that reads as
      // grouping at all — one kicker over a run is just a heading.
      if (layout === "dateline") {
        const per = Math.max(1, Math.ceil(Math.min(section.limit, 4) / 2));
        return (
          <div className="s-dsgt-block">
            {section.heading !== "" && <span className="s-dsgt-line s-dsgt-line--head" />}
            {Array.from({ length: 2 }, (_, g) => (
              <span key={g} className="s-dsgt-group">
                {section.showDate && <span className="s-dsgt-kicker" />}
                {Array.from({ length: per }, (_, i) => (
                  <span key={i} className="s-dsgt-row">
                    <span className="s-dsgt-line s-dsgt-line--title" />
                    {section.showExcerpt && <Lines n={2} className="s-dsgt-line--tight" />}
                  </span>
                ))}
              </span>
            ))}
          </div>
        );
      }
      return (
        <div className={`s-dsgt-block s-dsgt-list--${layout}`}>
          {section.heading !== "" && <span className="s-dsgt-line s-dsgt-line--head" />}
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} className="s-dsgt-row">
              {layout === "numbered" && <span className="s-dsgt-ord" />}
              {layout === "ledger" && section.showDate && <span className="s-dsgt-stamp" />}
              <span className="s-dsgt-row__main">
                <span className="s-dsgt-line s-dsgt-line--title" />
                {layout !== "ledger" && layout !== "index" && section.showDate && (
                  <span className="s-dsgt-line s-dsgt-line--meta" />
                )}
                {section.showExcerpt && layout !== "index" && (
                  <Lines n={layout === "ledger" ? 1 : 2} className="s-dsgt-line--tight" />
                )}
              </span>
              {layout === "index" && <span className="s-dsgt-leader" />}
              {layout === "index" && section.showDate && <span className="s-dsgt-stamp" />}
            </span>
          ))}
        </div>
      );
    }
    case "topics":
      return (
        <div className="s-dsgt-chips">
          {Array.from({ length: Math.max(3, Math.min(section.limit, 6)) }, (_, i) => (
            <span key={i} className="s-dsgt-chip" data-w={i % 3} />
          ))}
        </div>
      );
    case "cta":
      return (
        <div className="s-dsgt-cta">
          <span className="s-dsgt-line s-dsgt-line--head" />
          <span className="s-dsgt-line s-dsgt-line--sub" />
          <span className="s-dsgt-btn" />
        </div>
      );
    case "divider":
      return (
        <div
          className={`s-dsgt-div s-dsgt-div--${section.style}`}
          style={{ "--dsgt-space": `${Math.round(section.space / 12)}cqw` } as CSSProperties}
        />
      );
    default:
      return null;
  }
}

export default function DesignThumb({ design, seed, className }: DesignThumbProps) {
  const { header, typography, footer, nav } = design.chrome;
  // THE CHROME FIELDS A 200px CARD CAN ACTUALLY ANSWER, and no more. A ground,
  // a masthead shape and the shape of the end of the page are three different
  // pictures at any size — which is the same test the hero's treatment and the
  // grid's card had to pass. `nav.style` deliberately does NOT appear: pills,
  // an accent rail and a pair of brackets on a 7px bar are the same 7px bar,
  // and a miniature that pretends otherwise is drawing a difference the reader
  // cannot see. That question belongs to the hover canvas, like the type and
  // the palette.
  //
  // Each default is restated because a preset's sections and chrome reach this
  // component as AUTHORED, without passing the normalizer.
  const surface = design.chrome.surface ?? "flat";
  // THE WORLD IS THE ONE THING A 200px CARD ALWAYS RESOLVES. Two designs that
  // differ in measure and in face are one grey card twice; two that differ in
  // sky are two cards. It is the reason `scenery` earned a place on a miniature
  // that deliberately refuses `nav.style`.
  const scenery = design.chrome.scenery ?? "none";
  // AND THE ROOM, which is the loudest term of all at 200px. A rail, a floating
  // bar and a fixed panel are three different CARDS before a reader has read a
  // word of one — this is the first thing the eye resolves and the last thing
  // the old miniature knew about.
  const shell = design.chrome.shell ?? "stack";
  const form = footer.form ?? "columns";
  const sections = design.sections.filter((section) => !section.hidden).slice(0, 6);
  // The column, as a PERCENTAGE of the canvas the design is drawn against —
  // the one fact a miniature can carry that a screenshot at this size cannot:
  // whether this design is a narrow reading column or a wide magazine.
  const columnPct = Math.round(Math.min(100, (design.site.width / CANVAS_WIDTH) * 100));
  const style = {
    "--dsgt-col": `${columnPct}%`,
    // The mark's weight and the heading rules' contrast come from the design's
    // own typography, so a 700-weight uppercase masthead and a 400-weight
    // lowercase one are two different cards rather than the same grey bar.
    "--dsgt-weight": String(typography.headingWeight),
    "--dsgt-scale": String(typography.scale),
  } as CSSProperties;

  return (
    <div
      className={`s-dsgt s-dsgt--${design.site.density} s-dsgt--surf-${surface} s-dsgt--sky-${scenery} s-dsgt--shell-${shell}${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden="true"
    >
      {scenery !== "none" && <span className="s-dsgt-sky" />}
      <div className={`s-dsgt-head s-dsgt-head--${header.layout} s-dsgt-head--${header.density}${header.divider ? " s-dsgt-head--ruled" : ""}`}>
        <span className={`s-dsgt-mark${typography.headingCase === "uppercase" ? " s-dsgt-mark--upper" : ""}`} />
        {header.showTagline && <span className="s-dsgt-tagline" />}
        <span className="s-dsgt-nav">
          {Array.from({ length: nav.items.length > 0 ? Math.min(nav.items.length, 4) : 3 }, (_, i) => (
            <span key={i} className="s-dsgt-navitem" data-w={i % 3} />
          ))}
          {nav.showSearch && <span className="s-dsgt-tool" />}
        </span>
      </div>

      <div className="s-dsgt-body">
        {sections.length === 0 ? (
          <div className="s-dsgt-block">
            <Lines n={3} />
          </div>
        ) : (
          sections.map((section) => (
            <ThumbSection key={section.id} section={section} seed={seed} />
          ))
        )}
      </div>

      <div className={`s-dsgt-foot s-dsgt-foot--${footer.align} s-dsgt-foot--${form}`}>
        {/* A GRAND FOOTER IS A BAR OF TYPE, not a meta line, and at this size
            that is the whole difference: the end of the page is either a
            whisper or the site's name across it. */}
        {form === "grand" && <span className="s-dsgt-grand" />}
        <span className="s-dsgt-line s-dsgt-line--meta" />
      </div>
    </div>
  );
}
