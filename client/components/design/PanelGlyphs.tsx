// The rail's eight glyphs.
//
// A rail of eight words is a menu; a rail of eight small pictures with the
// words beside them is a place. The panel's tabs are not commands and they are
// not files — they are the PARTS OF A SITE, and a part of a site has a shape.
//
// Same rules as `SectionGlyph`: `currentColor` only, so the rail is right in
// every theme and on every ground without a colour of its own; the
// glyph is `aria-hidden` decoration beside a name that is always present; and
// nothing here is the sole carrier of any fact.

const PATHS: Record<string, JSX.Element> = {
  // Designs: sheets in a stack — the store, not one document.
  designs: (
    <>
      <rect x="2.5" y="5.5" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 3.5h8.5A1.5 1.5 0 0 1 15 5v7" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
    </>
  ),
  // Presets: a grid of finished shapes.
  presets: (
    <>
      <rect x="2" y="2.5" width="6" height="6" rx="1" fill="currentColor" opacity="0.75" />
      <rect x="10" y="2.5" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="10.5" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10" y="10.5" width="6" height="6" rx="1" fill="currentColor" opacity="0.75" />
    </>
  ),
  // Sections: the page as a stack of blocks.
  sections: (
    <>
      <rect x="2" y="2.5" width="14" height="4" rx="1" fill="currentColor" opacity="0.75" />
      <rect x="2" y="8" width="14" height="3" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="12.5" width="14" height="3" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  // Navigation: a menu bar over a page.
  nav: (
    <>
      <rect x="2" y="3" width="5" height="2" rx="1" fill="currentColor" />
      <rect x="8.5" y="3" width="3.5" height="2" rx="1" fill="currentColor" opacity="0.6" />
      <rect x="13.5" y="3" width="2.5" height="2" rx="1" fill="currentColor" opacity="0.6" />
      <rect x="2" y="7.5" width="14" height="8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  // Pages: a document with its own address.
  pages: (
    <>
      <path
        d="M4 2.5h6l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M10 2.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="5.5" y="9.5" width="7" height="1.2" rx="0.6" fill="currentColor" opacity="0.7" />
      <rect x="5.5" y="12" width="4.5" height="1.2" rx="0.6" fill="currentColor" opacity="0.5" />
    </>
  ),
  // Typography: the letter itself, over a baseline.
  type: (
    <>
      <path d="M3.5 13.5 8.2 3.5h1.6l4.7 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5.6 10.2h6.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M2.5 16h13" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.55" strokeLinecap="round" />
    </>
  ),
  // Header & footer: the frame around everything else.
  chrome: (
    <>
      <rect x="2" y="2.5" width="14" height="13" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="2.5" width="14" height="3.4" rx="1.4" fill="currentColor" opacity="0.6" />
      <rect x="2" y="12.6" width="14" height="2.9" rx="1.4" fill="currentColor" opacity="0.35" />
    </>
  ),
  // The file: what leaves and what arrives.
  file: (
    <>
      <path
        d="M4 2.5h6l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M9 8.5v5M6.6 11.1 9 13.5l2.4-2.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

/** One rail glyph. Unknown tabs draw nothing rather than a placeholder: the
 *  rail's label is the control, and a stray box beside it is noise. */
export function TabGlyph({ tab }: { tab: string }) {
  const shape = PATHS[tab];
  if (!shape) return null;
  return (
    <svg className="s-dsgr__tabglyph" viewBox="0 0 18 18" width="16" height="16" aria-hidden="true" focusable="false">
      {shape}
    </svg>
  );
}

export default TabGlyph;
