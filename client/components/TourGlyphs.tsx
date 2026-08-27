// THE FOLIO MINIATURES — one drawing per card, at 64×48.
//
// Same three rules `SectionGlyph` sets out, because this is the same visual
// language one size up (a manuscript's miniature rather than its marginal
// mark):
//
//   * `currentColor` only — never a named colour, never a hex. The glyph
//     inherits what the folio paints, so it is right in every theme and
//     on every ground without a rule of its own. The GOLD is not an exception:
//     an accent part sits inside `<g className="s-tour__gold">`, and that class
//     sets `color: var(--accent)` in tour.css, so the fill is still
//     `currentColor` and there is still no colour in this file. Interior
//     shading is opacity, which is legal here for the reason SectionGlyph
//     gives: this is a picture, the token under it is `--text-muted` rather
//     than `--text-faint`, and no shade of it carries a fact.
//   * The drawing is the SHAPE OF THE THING: a filled block is artwork, a
//     hairline is a rule of text, a rounded pill is a chip, a disc is a note.
//   * It is decoration for a name that is always present. Every glyph is
//     `aria-hidden` and nothing here is the only carrier of anything.
//
// A card whose id has no drawing gets the fallback frame rather than a hole —
// a missing miniature in a deck of miniatures reads as a broken deck.

/** The drawing for one card id, in a 32×24 viewBox. */
function Shape({ id }: { id: string }) {
  switch (id) {
    // THE DESIGNER: a rail of parts, and the page they compose.
    case "designer":
      return (
        <>
          {[2, 7.5, 13, 18.5].map((y) => (
            <rect key={y} x="1" y={y} width="7" height="3.6" rx="1" fill="currentColor" opacity="0.35" />
          ))}
          <rect x="11" y="1.5" width="20" height="21" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <g className="s-tour__gold">
            <rect x="13" y="3.5" width="16" height="6" rx="1" fill="currentColor" opacity="0.55" />
          </g>
          <rect x="13" y="11.5" width="7.5" height="4" rx="0.8" fill="currentColor" opacity="0.5" />
          <rect x="21.5" y="11.5" width="7.5" height="4" rx="0.8" fill="currentColor" opacity="0.5" />
          <rect x="13" y="17.5" width="16" height="1.4" rx="0.7" fill="currentColor" opacity="0.7" />
        </>
      );
    // TWENTY-ONE ROOMS: three grounds, each carrying its own type and accent.
    case "themes":
      return (
        <>
          <rect x="0.8" y="4" width="13" height="16" rx="1.6" fill="currentColor" opacity="0.18" />
          <rect x="0.8" y="4" width="13" height="16" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <rect x="3.4" y="7" width="7.5" height="1.4" rx="0.7" fill="currentColor" opacity="0.8" />
          <rect x="3.4" y="10.4" width="5" height="1.2" rx="0.6" fill="currentColor" opacity="0.5" />
          <g className="s-tour__gold">
            <circle cx="4.6" cy="16" r="1.7" fill="currentColor" />
          </g>
          <rect x="15.5" y="6.5" width="7" height="11" rx="1.4" fill="currentColor" opacity="0.3" />
          <rect x="24" y="8.5" width="7" height="7" rx="1.4" fill="currentColor" opacity="0.5" />
        </>
      );
    // PUBLISH: the page leaves, and an eye is on it.
    case "publish":
      return (
        <>
          <path
            d="M2.5 1.6h10l5 5v11.4a1.4 1.4 0 0 1-1.4 1.4H2.5a1.4 1.4 0 0 1-1.4-1.4V3a1.4 1.4 0 0 1 1.4-1.4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path d="M12.5 1.6v5h5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <rect x="4.2" y="9.5" width="8" height="1.3" rx="0.65" fill="currentColor" opacity="0.65" />
          <rect x="4.2" y="12.6" width="5.5" height="1.3" rx="0.65" fill="currentColor" opacity="0.45" />
          <g className="s-tour__gold">
            <path
              d="M20.5 13.5c2.6-3.6 7.4-3.6 10 0-2.6 3.6-7.4 3.6-10 0z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <circle cx="25.5" cy="13.5" r="1.5" fill="currentColor" />
            <path d="M19 7.5h9m0 0-2.6-2.6M28 7.5l-2.6 2.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </>
      );
    // COLLECTIONS: shelves with a mark on each.
    case "collections":
      return (
        <>
          {[1.5, 13.5].map((y) => (
            <g key={y}>
              <rect x="1" y={y} width="30" height="9" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="9" y={y + 2.4} width="13" height="1.5" rx="0.75" fill="currentColor" opacity="0.75" />
              <rect x="9" y={y + 5.4} width="8" height="1.2" rx="0.6" fill="currentColor" opacity="0.45" />
            </g>
          ))}
          <g className="s-tour__gold">
            <rect x="3.4" y="3.6" width="4" height="4" rx="1.2" fill="currentColor" />
            <rect x="3.4" y="15.6" width="4" height="4" rx="1.2" fill="currentColor" opacity="0.6" />
          </g>
        </>
      );
    // TRACKERS: the card, with its bar part-filled.
    case "trackers":
      return (
        <>
          <rect x="1" y="2.5" width="30" height="19" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <rect x="3.5" y="5.5" width="8" height="10" rx="1.2" fill="currentColor" opacity="0.3" />
          <rect x="14" y="6" width="12" height="1.6" rx="0.8" fill="currentColor" opacity="0.8" />
          <rect x="14" y="9.6" width="7" height="1.2" rx="0.6" fill="currentColor" opacity="0.45" />
          <rect x="14" y="13.5" width="14" height="2.6" rx="1.3" fill="currentColor" opacity="0.22" />
          <g className="s-tour__gold">
            <rect x="14" y="13.5" width="8.5" height="2.6" rx="1.3" fill="currentColor" />
            <circle cx="27.5" cy="18.6" r="1.4" fill="currentColor" opacity="0.85" />
          </g>
        </>
      );
    // NOTE HISTORY: the spine of commits beside the page.
    case "history":
      return (
        <>
          <path d="M6 2v20" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
          {[4, 10.5, 17].map((cy, i) => (
            <circle
              key={cy}
              cx="6"
              cy={cy}
              r={i === 0 ? 2.4 : 2}
              fill={i === 0 ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.3"
              className={i === 0 ? "s-tour__gold" : undefined}
            />
          ))}
          <circle cx="6" cy="22" r="1.2" fill="currentColor" opacity="0.4" />
          <rect x="12" y="1.5" width="19" height="21" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <rect x="14.5" y="5" width="14" height="1.4" rx="0.7" fill="currentColor" opacity="0.75" />
          <rect x="14.5" y="9" width="14" height="1.2" rx="0.6" fill="currentColor" opacity="0.45" />
          <rect x="14.5" y="12.6" width="10" height="1.2" rx="0.6" fill="currentColor" opacity="0.45" />
          <rect x="14.5" y="16.2" width="12" height="1.2" rx="0.6" fill="currentColor" opacity="0.45" />
        </>
      );
    // SEARCH: the lens over the lines, and one operator chip.
    case "search":
      return (
        <>
          <rect x="1" y="3" width="16" height="1.4" rx="0.7" fill="currentColor" opacity="0.5" />
          <rect x="1" y="7" width="12" height="1.4" rx="0.7" fill="currentColor" opacity="0.5" />
          <rect x="1" y="19.5" width="14" height="1.4" rx="0.7" fill="currentColor" opacity="0.5" />
          <g className="s-tour__gold">
            <rect x="1" y="11" width="10.5" height="4.4" rx="2.2" fill="currentColor" opacity="0.55" />
          </g>
          <circle cx="22" cy="10.5" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M27.2 15.7 30.8 19.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
    // TEMPLATES: the stamp, and the page it fills.
    case "templates":
      return (
        <>
          <rect x="1" y="4.5" width="16" height="18" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
          <rect x="6" y="1.5" width="16" height="18" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <g className="s-tour__gold">
            <rect x="8.4" y="4" width="11" height="3.4" rx="1" fill="currentColor" opacity="0.6" />
          </g>
          <rect x="8.4" y="9.4" width="11" height="1.3" rx="0.65" fill="currentColor" opacity="0.55" />
          <rect x="8.4" y="12.6" width="7" height="1.3" rx="0.65" fill="currentColor" opacity="0.4" />
          <rect x="8.4" y="15.8" width="9" height="1.3" rx="0.65" fill="currentColor" opacity="0.4" />
          <path d="M25 6.5v11m-3.4-5.5h6.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
        </>
      );
    // LATEX: the page, a radical, and a rule of maths.
    case "tex":
      return (
        <>
          <rect x="4" y="1.5" width="24" height="21" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <rect x="7" y="4.5" width="12" height="1.4" rx="0.7" fill="currentColor" opacity="0.6" />
          <rect x="7" y="7.8" width="18" height="1.2" rx="0.6" fill="currentColor" opacity="0.4" />
          <g className="s-tour__gold">
            <path
              d="M7 15.5h2.2l2 4.4 3.4-8.6h9.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <rect x="7" y="18.9" width="7" height="1.2" rx="0.6" fill="currentColor" opacity="0.35" />
        </>
      );
    // BOOKS: spines on a shelf, one of them open.
    case "books":
      return (
        <>
          <rect x="1" y="3" width="5" height="16" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <rect x="7.5" y="5" width="4.5" height="14" rx="1.2" fill="currentColor" opacity="0.28" />
          <g className="s-tour__gold">
            <path
              d="M15 6.5c2.4-1.4 4.6-1.4 7 0v13c-2.4-1.4-4.6-1.4-7 0z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </g>
          <path
            d="M22 6.5c2.4-1.4 4.6-1.4 7 0v13c-2.4-1.4-4.6-1.4-7 0z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M0.5 21.5h31" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.45" strokeLinecap="round" />
        </>
      );
    // SPLIT PANES: two panes, each with its own tabs.
    case "panes":
      return (
        <>
          <rect x="1" y="2" width="14" height="20" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <rect x="17" y="2" width="14" height="20" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <g className="s-tour__gold">
            <rect x="2.6" y="3.6" width="6" height="2.6" rx="0.9" fill="currentColor" opacity="0.75" />
          </g>
          <rect x="9.4" y="3.6" width="4" height="2.6" rx="0.9" fill="currentColor" opacity="0.3" />
          <rect x="18.6" y="3.6" width="5" height="2.6" rx="0.9" fill="currentColor" opacity="0.3" />
          {[9.5, 13, 16.5].map((y) => (
            <g key={y}>
              <rect x="2.6" y={y} width="10.8" height="1.2" rx="0.6" fill="currentColor" opacity="0.45" />
              <rect x="18.6" y={y} width="10.8" height="1.2" rx="0.6" fill="currentColor" opacity="0.45" />
            </g>
          ))}
        </>
      );
    // THE GRAPH: discs and the threads between them.
    case "graph":
      return (
        <>
          <path
            d="M16 12 6 5.5M16 12l10-6M16 12 8 19M16 12l9 6M16 12v-9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            opacity="0.45"
          />
          <circle cx="6" cy="5.5" r="2.4" fill="currentColor" opacity="0.55" />
          <circle cx="26" cy="6" r="2" fill="currentColor" opacity="0.4" />
          <circle cx="8" cy="19" r="2" fill="currentColor" opacity="0.4" />
          <circle cx="25" cy="18" r="2.6" fill="currentColor" opacity="0.55" />
          <circle cx="16" cy="3" r="1.8" fill="currentColor" opacity="0.35" />
          <g className="s-tour__gold">
            <circle cx="16" cy="12" r="3.6" fill="currentColor" opacity="0.85" />
            <circle cx="16" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
          </g>
        </>
      );
    // BACKUP: the vault's box, and the arc that carries it away and back.
    case "sync":
      return (
        <>
          <rect x="2" y="8" width="14" height="13" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <rect x="5" y="11.5" width="8" height="1.3" rx="0.65" fill="currentColor" opacity="0.55" />
          <rect x="5" y="15" width="5.5" height="1.3" rx="0.65" fill="currentColor" opacity="0.4" />
          <g className="s-tour__gold">
            <path
              d="M9 6.5A8 8 0 0 1 24.5 4.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path d="M25.4 1.4 25 5.2l-3.7-.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
          <circle cx="24" cy="14" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.75" />
          <path d="M24 10.8v3.4l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
        </>
      );
    // THE PHONE: the drawer, mid-gesture, following a finger.
    case "phone":
      return (
        <>
          <rect x="7" y="0.8" width="18" height="22.4" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <rect x="13" y="2.6" width="6" height="1" rx="0.5" fill="currentColor" opacity="0.5" />
          <g className="s-tour__gold">
            <rect x="8.4" y="4.8" width="7" height="16.6" rx="1.2" fill="currentColor" opacity="0.4" />
          </g>
          <rect x="17" y="6.5" width="6.6" height="1.2" rx="0.6" fill="currentColor" opacity="0.45" />
          <rect x="17" y="10" width="6.6" height="1.2" rx="0.6" fill="currentColor" opacity="0.3" />
          <path
            d="M25.5 13.5h5m0 0-2-2m2 2-2 2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.6"
          />
        </>
      );
    // THE SHEET: three keycaps.
    case "keys":
      return (
        <>
          <rect x="1" y="4" width="11" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <rect x="14" y="4" width="8" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <g className="s-tour__gold">
            <rect x="24" y="4" width="7" height="9" rx="2" fill="currentColor" opacity="0.55" />
          </g>
          <rect x="3.4" y="8" width="6" height="1.2" rx="0.6" fill="currentColor" opacity="0.6" />
          <rect x="16.4" y="8" width="3" height="1.2" rx="0.6" fill="currentColor" opacity="0.6" />
          <rect x="1" y="16.5" width="21" height="1.4" rx="0.7" fill="currentColor" opacity="0.4" />
          <rect x="1" y="20.2" width="14" height="1.4" rx="0.7" fill="currentColor" opacity="0.3" />
        </>
      );
    default:
      return (
        <rect x="2" y="3" width="28" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      );
  }
}

/** The miniature for one folio. Decoration: the card's name is always beside
 *  it, and the deck's live region announces that name, not this. */
export default function TourGlyph({ id }: { id: string }) {
  return (
    <svg
      className="s-tour__glyph"
      viewBox="0 0 32 24"
      width="64"
      height="48"
      aria-hidden="true"
      focusable="false"
    >
      <Shape id={id} />
    </svg>
  );
}
