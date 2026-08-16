// Canvas colors read out of the CSS theme tokens, shared by both graphs.
//
// This lives apart from GraphView.tsx for a bundling reason, not a tidiness
// one. `LocalGraph` (which the backlinks panel renders on every app open)
// needs exactly two functions from here — and importing them from
// GraphView.tsx made the ENTIRE force-directed simulation a static dependency
// of the app shell, so every admin first paint downloaded the graph view in
// order to pick two colors. `scripts/check-bundle.mjs` fails the build if
// that edge ever comes back.
//
// Both graphs draw on a canvas, which has no CSS: every color has to be
// resolved from the tokens by hand (getComputedStyle on <html>), and re-read
// when `data-theme` changes.

export interface ThemeColors {
  text: string;
  muted: string;
  faint: string;
  accent: string;
  border: string;
  bg: string;
  fontUI: string;
  /** Idle (non-hover) edge stroke — lifted above --border in both themes
   *  so the web is visible at rest, still well below hover brightness. */
  idleEdge: string;
  idleEdgeAlpha: number;
}

export function readThemeColors(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  const border = token("--border", "#333");
  const muted = token("--text-muted", "#999");
  const dark =
    document.documentElement.getAttribute("data-theme") !== "parchment";
  return {
    text: token("--text", "#ddd"),
    muted,
    faint: token("--text-faint", "#666"),
    accent: token("--accent", "#c9a227"),
    border,
    bg: token("--bg", "#16130e"),
    fontUI: token("--font-ui", "system-ui, sans-serif"),
    idleEdge: dark ? mixColors(border, muted, 0.35) : mixColors(border, muted, 0.3),
    idleEdgeAlpha: dark ? 0.6 : 0.62,
  };
}

/** Parse #rgb/#rrggbb to [r,g,b]; null for anything else. */
function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Blend a → b by t (0..1). Falls back to `a` when a color isn't hex.
 *
 *  Not cheap: two parses, two allocations and a template string. Callers that
 *  need it per node per frame build a small lookup table instead — see the
 *  shade tables in GraphView/LocalGraph. */
export function mixColors(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const ch = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}
