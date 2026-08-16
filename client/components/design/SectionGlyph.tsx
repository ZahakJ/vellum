// WHAT A SECTION LOOKS LIKE, at 20px and at 44px.
//
// A row that says only "Post grid" makes the reader translate a name into a
// picture every time they scan the list; a row that shows two columns of cards
// beside the words is read at a glance and read the same way by somebody who
// does not have the vocabulary yet. That is the whole argument, and it is the
// same one `DesignThumb` makes one size up: at small sizes a WIREFRAME carries
// the shape a screenshot cannot.
//
// THREE RULES, so these stay glyphs rather than becoming a second icon set:
//
//  * `currentColor` only — never a named colour. The glyph inherits whatever
//    the row is painting (`--text-muted` at rest, `--accent` when the row is
//    open or hovered), so it is correct in all fifteen themes and on all three
//    grounds without one rule of its own. The interior shading IS opacity, and
//    that is legal here for the reason the miniature's is: this is a picture,
//    the token under it is never `--text-faint` (which is at its floor already
//    — fading it is the "failing the floor without failing the check" trick
//    CONTRACTS names), and no shade of it carries a fact.
//  * The drawing is the SHAPE OF THE SECTION, in the same visual language the
//    miniature uses: a filled block is artwork, a hairline is a rule of text, a
//    rounded pill is a chip.
//  * It is decoration for a name that is always present. Every glyph is
//    `aria-hidden` and nothing here is the only carrier of any fact.

/** Where the glyph is being drawn. `row` is the section list's 20px slot;
 *  `card` is the add-a-section picker's illustration. */
export type GlyphSize = "row" | "card";

const BOX: Record<GlyphSize, { w: number; h: number }> = {
  row: { w: 22, h: 16 },
  card: { w: 52, h: 34 },
};

/** The drawing for one kind, in a 22×16 viewBox. Scaled by the box. */
function Shape({ kind }: { kind: string }) {
  switch (kind) {
    // A big opening block: artwork with a display line over it.
    case "hero":
      return (
        <>
          <rect x="1" y="1" width="20" height="10" rx="1.5" fill="currentColor" opacity="0.28" />
          <rect x="5.5" y="4" width="11" height="1.6" rx="0.8" fill="currentColor" />
          <rect x="7.5" y="7" width="7" height="1.2" rx="0.6" fill="currentColor" opacity="0.7" />
          <rect x="1" y="13.4" width="20" height="1.2" rx="0.6" fill="currentColor" opacity="0.35" />
        </>
      );
    // Prose: four rules of text, the last one short.
    case "richText":
      return (
        <>
          <rect x="1" y="2" width="20" height="1.4" rx="0.7" fill="currentColor" />
          <rect x="1" y="5.6" width="20" height="1.4" rx="0.7" fill="currentColor" opacity="0.6" />
          <rect x="1" y="9.2" width="20" height="1.4" rx="0.7" fill="currentColor" opacity="0.6" />
          <rect x="1" y="12.8" width="12" height="1.4" rx="0.7" fill="currentColor" opacity="0.6" />
        </>
      );
    // One note: a page with a turned corner.
    case "note":
      return (
        <>
          <path
            d="M3.5 1h9l5.5 5v9a1 1 0 0 1-1 1h-13.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M12.5 1v5h5.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <rect x="5.5" y="9" width="8" height="1.2" rx="0.6" fill="currentColor" />
          <rect x="5.5" y="11.8" width="6" height="1.2" rx="0.6" fill="currentColor" opacity="0.6" />
        </>
      );
    // Cards: two columns, artwork over a title.
    case "postGrid":
      return (
        <>
          {[1, 12].map((x) => (
            <g key={x}>
              <rect x={x} y="1" width="9" height="6" rx="1" fill="currentColor" opacity="0.28" />
              <rect x={x} y="8.6" width="9" height="1.3" rx="0.65" fill="currentColor" />
              <rect x={x} y="11.4" width="6" height="1.1" rx="0.55" fill="currentColor" opacity="0.55" />
            </g>
          ))}
        </>
      );
    // A river: three rows, each a title over a meta line.
    case "postList":
      return (
        <>
          {[1, 6.6, 12.2].map((y) => (
            <g key={y}>
              <rect x="1" y={y} width="14" height="1.5" rx="0.75" fill="currentColor" />
              <rect x="1" y={y + 2.4} width="20" height="1.1" rx="0.55" fill="currentColor" opacity="0.5" />
            </g>
          ))}
        </>
      );
    // Topics: chips.
    case "topics":
      return (
        <>
          <rect x="1" y="2.2" width="7.5" height="4.4" rx="2.2" fill="currentColor" opacity="0.5" />
          <rect x="10" y="2.2" width="5.5" height="4.4" rx="2.2" fill="currentColor" opacity="0.75" />
          <rect x="17" y="2.2" width="4" height="4.4" rx="2.2" fill="currentColor" opacity="0.5" />
          <rect x="1" y="9.4" width="5" height="4.4" rx="2.2" fill="currentColor" opacity="0.75" />
          <rect x="7.5" y="9.4" width="7.5" height="4.4" rx="2.2" fill="currentColor" opacity="0.5" />
        </>
      );
    // A line and a button.
    case "cta":
      return (
        <>
          <rect x="2.5" y="1.6" width="17" height="1.6" rx="0.8" fill="currentColor" />
          <rect x="5" y="5" width="12" height="1.2" rx="0.6" fill="currentColor" opacity="0.55" />
          <rect x="6" y="8.6" width="10" height="5.6" rx="2.8" fill="currentColor" opacity="0.8" />
        </>
      );
    // Air, with a rule through it.
    case "divider":
      return (
        <>
          <rect x="1" y="7.4" width="8" height="1.2" rx="0.6" fill="currentColor" opacity="0.55" />
          <rect x="13" y="7.4" width="8" height="1.2" rx="0.6" fill="currentColor" opacity="0.55" />
          <circle cx="11" cy="8" r="1.6" fill="currentColor" />
        </>
      );
    // A kind this build does not draw yet: a plain block, never nothing. A
    // missing glyph in a row of glyphs reads as a broken row.
    default:
      return <rect x="1" y="4" width="20" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />;
  }
}

/** The picture for a section kind. Decoration: the name is always beside it. */
export default function SectionGlyph({
  kind,
  size = "row",
  className,
}: {
  kind: string;
  size?: GlyphSize;
  className?: string;
}) {
  const { w, h } = BOX[size];
  return (
    <svg
      className={`s-dsnc-glyph s-dsnc-glyph--${size}${className ? ` ${className}` : ""}`}
      viewBox="0 0 22 16"
      width={w}
      height={h}
      aria-hidden="true"
      focusable="false"
    >
      <Shape kind={kind} />
    </svg>
  );
}
