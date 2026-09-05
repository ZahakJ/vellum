// What the served shell told us before a byte of JavaScript ran.
//
// `server/boot.ts` inlines `window.__vellum` for sessions that are shown the
// public site: the layout, the theme the page has already been painted in,
// and — on a designed site — the design document, scrubbed and scoped exactly
// as /api/design/public would scope it. Read ONCE, here, defensively: every
// field is optional, every consumer treats it as a hint that /api/me and the
// shared validator confirm, and an admin's shell carries nothing at all.
//
// The alternative was the page the owner reported — a store that boots as an
// app, paints the stock blog, and swaps in the real site a fetch later.

export interface Boot {
  layout?: "blog" | "designed";
  lang?: string;
  theme?: string;
  design?: unknown;
}

function read(): Boot {
  // A JSON block, not a global: the site is served under `script-src 'self'`
  // and an inline script that SET a global was refused by every browser —
  // `server/boot.ts` says how that was found. `getElementById` runs here at
  // module evaluation, which is after the document has parsed the head.
  let raw: unknown;
  try {
    raw = JSON.parse(document.getElementById("vellum-boot")?.textContent ?? "null");
  } catch {
    raw = null; // a half-written or foreign block is no block
  }
  if (!raw || typeof raw !== "object") return {};
  const b = raw as Record<string, unknown>;
  const out: Boot = {};
  if (b.layout === "blog" || b.layout === "designed") out.layout = b.layout;
  if (typeof b.lang === "string") out.lang = b.lang;
  if (typeof b.theme === "string" && b.theme !== "") out.theme = b.theme;
  if (b.design && typeof b.design === "object") out.design = b.design;
  return out;
}

export const boot: Boot = read();
