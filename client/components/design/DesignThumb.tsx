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
    case "hero":
      return (
        <div
          className={`s-dsgt-hero s-dsgt-hero--${section.height} s-dsgt-hero--${section.align}`}
          style={section.image ? undefined : art(seed, section.id)}
        >
          <span className="s-dsgt-line s-dsgt-line--display" />
          <span className="s-dsgt-line s-dsgt-line--sub" />
        </div>
      );
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
      return (
        <div className="s-dsgt-block">
          {section.heading !== "" && <span className="s-dsgt-line s-dsgt-line--head" />}
          <div className="s-dsgt-grid" style={{ "--dsgt-cols": section.columns } as CSSProperties}>
            {Array.from({ length: cells }, (_, i) => (
              <span key={i} className="s-dsgt-card">
                {section.showBanner && (
                  <span className="s-dsgt-card__art" style={art(seed, `${section.id}-${i}`)} />
                )}
                <span className="s-dsgt-line s-dsgt-line--title" />
                {section.showDate && <span className="s-dsgt-line s-dsgt-line--meta" />}
                {section.showExcerpt && <Lines n={2} className="s-dsgt-line--tight" />}
              </span>
            ))}
          </div>
        </div>
      );
    }
    case "postList": {
      const rows = Math.max(1, Math.min(section.limit, 4));
      return (
        <div className="s-dsgt-block">
          {section.heading !== "" && <span className="s-dsgt-line s-dsgt-line--head" />}
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} className="s-dsgt-row">
              <span className="s-dsgt-line s-dsgt-line--title" />
              {section.showDate && <span className="s-dsgt-line s-dsgt-line--meta" />}
              {section.showExcerpt && <Lines n={2} className="s-dsgt-line--tight" />}
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
    <div className={`s-dsgt s-dsgt--${design.site.density}${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
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

      <div className={`s-dsgt-foot s-dsgt-foot--${footer.align}`}>
        <span className="s-dsgt-line s-dsgt-line--meta" />
      </div>
    </div>
  );
}
