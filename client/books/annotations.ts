// WHERE A HIGHLIGHT IS ON THE SCREEN, GIVEN WHERE IT IS ON THE PAGE.
//
// A highlight is stored as fractions of the UNROTATED page (0..1) — see
// shared/bookAnchor.ts for why that and not pixels. The page on screen is that
// page scaled by whatever fit the reader chose and turned by whatever `r` they
// pressed, so exactly one transform stands between the two, and it lives here
// so that the four places which need it (painting a ribbon, painting a
// citation's pulse, turning a fresh selection into a stored rectangle, and the
// tests) cannot each get it slightly wrong.
//
// The rotation is CLOCKWISE quarter turns, which is what `r` applies and what
// pdf.js takes. Deriving the mapping once, for 90°: the page's own axes are x
// to the right and y DOWN, so a clockwise turn sends the top-left corner to
// the top-right. A point (x, y) therefore lands at (1 - y, x) in the turned
// frame — whose width is the old height, which is why w and h swap. The other
// two quarters follow, and 270 is the inverse of 90, which is the property
// `unrotateRect` relies on and tests/books.test.ts asserts.
//
// Pure arithmetic: no DOM, no React.

import type { BookRect, BookRotation } from "../../shared/bookAnchor.ts";
import { cleanRect, roundFrac } from "../../shared/bookAnchor.ts";

/** A page-space rectangle as the ROTATED page shows it.
 *
 *  Rounded to the same four places the store keeps, and not as a tidiness:
 *  `1 - 0.2 - 0.05` is 0.7500000000000001 in binary floating point, so an
 *  unrounded turn-and-turn-back does not return the rectangle it was given —
 *  and a passage marked at 90 degrees would drift by a hair every time the
 *  page was rotated. Four places is a third of a millimetre on A4; the drift
 *  is what has to be zero. */
export function rotateRect(rect: BookRect, rotation: BookRotation): BookRect {
  const { x, y, w, h } = rect;
  const at = (a: number, b: number, c: number, d: number): BookRect => ({
    x: roundFrac(a),
    y: roundFrac(b),
    w: roundFrac(c),
    h: roundFrac(d),
  });
  if (rotation === 90) return at(1 - y - h, x, h, w);
  if (rotation === 180) return at(1 - x - w, 1 - y - h, w, h);
  if (rotation === 270) return at(y, 1 - x - w, h, w);
  return at(x, y, w, h);
}

/** The inverse — a rectangle measured off the rotated page, put back into the
 *  page's own coordinates so it can be STORED. A highlight made while the page
 *  was turned must land in the same place when it is turned back. */
export function unrotateRect(rect: BookRect, rotation: BookRotation): BookRect {
  return rotateRect(rect, (((360 - rotation) % 360) as BookRotation));
}

/** The CSS a ribbon is painted with, as percentages of the page box.
 *
 *  PHYSICAL `left`/`top`, and that is not an oversight in a codebase whose
 *  stylesheet gate bans them. `.s-book__doc` carries the BOOK's direction, so
 *  an Arabic volume mirrors its spreads — and a page's pixels do not mirror
 *  with it. A ribbon placed with `inset-inline-start` would jump to the other
 *  side of the page the moment the book was right-to-left, which is precisely
 *  the reader this feature was asked for. */
export function inkStyle(rect: BookRect, rotation: BookRotation): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  const r = rotateRect(rect, rotation);
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
  };
}

/** A box measured in CSS pixels against a page element, as a page fraction.
 *  Null when the page has no size yet — a selection made in the frame before
 *  layout settled is not a selection anyone can store. */
export function rectWithin(
  box: { left: number; top: number; width: number; height: number },
  page: { left: number; top: number; width: number; height: number },
): BookRect | null {
  if (page.width <= 0 || page.height <= 0) return null;
  return cleanRect({
    x: (box.left - page.left) / page.width,
    y: (box.top - page.top) / page.height,
    w: box.width / page.width,
    h: box.height / page.height,
  });
}
