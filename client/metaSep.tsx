// THE SEPARATOR BETWEEN TWO FACTS ON ONE LINE — and why it cannot be a `·`
// in every language.
//
// The blog's meta line, the article header and the app's status bar all print
// two or three counts side by side and mark the boundary with U+00B7. At the
// 12–13px those lines are set in, in the Arabic face this product ships, that
// glyph is INDISTINGUISHABLE FROM `٠` — and it sits flush against a run of
// Eastern Arabic digits. Measured on an Arabic instance: the status bar's DOM
// reads "١٤١ كلمة · ٧٨٦ حرفًا" and PAINTS as ٧٨٦٠ — 786 characters read as
// 7,860. The one surface the Hijri work exists to make legible was handing the
// reader an order-of-magnitude misread, on every card, in every count.
//
// So the tick is kept where it is a tick and replaced where it is a digit. The
// switch is on the NUMBERING SYSTEM, not on the language: an Arabic instance
// configured `ar-EG-u-nu-latn` prints Latin digits and a `·` is safe there,
// while the default `arab` numerals are the case that breaks. What replaces it
// is not another character — a character next to digits is how we got here —
// but the HAIRLINE the status bar already uses to mark its own groups
// (1px `--border`), which is the product's existing vocabulary for "these are
// two separate facts" and cannot be read as anything at all.

import type { ReactElement } from "react";
import { getNumerals } from "./i18n.ts";

/** True when a `·` beside a count would paint as a zero. */
export function separatorReadsAsDigit(): boolean {
  return getNumerals() === "arab";
}

/** The same separator as a STRING, for the places an element cannot go — a
 *  joined caption, a `title` attribute. A hairline needs a box, so here the
 *  Arabic case takes `،`, which is the punctuation the language already uses
 *  for this and is not a digit in any face. */
export function metaSepText(): string {
  return separatorReadsAsDigit() ? "، " : " · ";
}

/** The mark between two counts: `·` where that is a tick, a hairline where it
 *  would be a zero. `className` rides along for per-surface spacing. */
export function MetaSep({ className = "" }: { className?: string }): ReactElement {
  const rule = separatorReadsAsDigit();
  return (
    <span
      className={`s-metasep${rule ? " s-metasep--rule" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {rule ? "" : "·"}
    </span>
  );
}
