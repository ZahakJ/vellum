// The ambient layer's one line of JavaScript.
//
// Everything this feature DOES is in client/styles/ambient.css — the three
// airs, which room gets which, the opacities, and the `prefers-reduced-motion`
// rule that deletes all of it. The whole argument for that split is in the
// header of that file; the short version is that a theme is a set of static
// tokens by architecture and the right place to add motion is a decoration
// layer behind the words, not the values the contrast gate measures.
//
// So this module exists to answer exactly one question — is the div in the DOM
// — and it reads the store rather than taking a prop, because both call sites
// (the stock blog's masthead and the designed site's header) are renderers the
// owner's setting reaches through /api/me in the same way everything else on
// the public shell does.
//
// The stylesheet is imported HERE rather than linked from index.html on
// purpose: the two importers are lazy chunks (the blog shell, the design
// engine), so an admin who never opens the public site — and, more to the
// point, the entry bundle every audience downloads — pays nothing for it. See
// scripts/check-bundle.mjs.

import { useStore } from "./state.ts";
import "./styles/ambient.css";

/** The atmosphere behind a masthead, or nothing at all.
 *
 *  It is `aria-hidden` and empty, and its host gives it `pointer-events:
 *  none`: this is decoration in the 1.4.3 sense — no content of its own, no
 *  affordance, nothing to read — which is the only footing on which a moving
 *  thing is allowed anywhere near a page of prose. */
export default function Ambient() {
  const on = useStore((s) => s.ambient);
  if (!on) return null;
  return <div className="s-amb" aria-hidden="true" />;
}
