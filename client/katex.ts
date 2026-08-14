// Lazy KaTeX. The library (~280 kB minified) plus its stylesheet load only
// once a note actually contains math, keeping them out of the first-paint
// bundle that anonymous visitors download.

import type katexType from "katex";

let mod: typeof katexType | null = null;
let pending: Promise<typeof katexType> | null = null;

/** The KaTeX module when it has already loaded, else null (kick off
 *  loadKatex() and re-render when it resolves). */
export function getKatex(): typeof katexType | null {
  return mod;
}

export function loadKatex(): Promise<typeof katexType> {
  if (mod) return Promise.resolve(mod);
  pending ??= Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]).then(([m]) => {
    mod = m.default;
    return mod;
  });
  return pending;
}
