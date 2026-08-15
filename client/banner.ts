// Note banners: shared client helpers. A banner value is either an https URL
// or a vault-relative attachment path (served by /api/file). Notes without a
// banner get a deterministic generated gradient in the blog surfaces — built
// from the note title's hash, mixed with theme tokens so it stays subtle and
// harmonious in every theme.

/** Banner value → <img src>: https URLs pass through (https ONLY — an http://
 *  banner would be mixed content), vault paths via /api/file. */
export function bannerSrc(value: string): string {
  if (/^https:\/\//i.test(value)) return value;
  return `/api/file?path=${encodeURIComponent(value)}`;
}

/** Extract the frontmatter `banner:` value from raw note content, or null.
 *  Mirrors the server: leading --- block, single `banner:` line, quotes
 *  stripped (the /api/frontmatter setter writes double-quoted scalars). */
export function bannerFromContent(src: string): string | null {
  if (!src.startsWith("---\n") && !src.startsWith("---\r\n")) return null;
  const nl = src.startsWith("---\r\n") ? "\r\n" : "\n";
  const open = 3 + nl.length;
  const close = src.indexOf(`${nl}---`, open);
  if (close === -1) return null;
  return bannerFromYaml(src.slice(open, close));
}

/** Same, over the inner frontmatter text (what the props-card builders hold). */
export function bannerFromYaml(yaml: string): string | null {
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^banner:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[1];
    const quoted = /^(["']).*\1$/.exec(value);
    if (quoted) {
      value = value.slice(1, -1);
      if (quoted[1] === '"') value = value.replace(/\\(["\\])/g, "$1");
    }
    value = value.trim();
    return value === "" ? null : value;
  }
  return null;
}

// ── Generated fallback (blog list + article hero only) ──────────────────────

/** FNV-1a over the title — stable across sessions and machines. */
function hashTitle(title: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) {
    h ^= title.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic abstract mesh gradient for a banner-less post. Two-three hues
 * derived from the title hash, each mixed well into the theme's raised
 * background via color-mix — colorful enough to tell posts apart, never
 * garish, and automatically harmonious in all four themes (the tokens carry
 * the theme; only the hue angles come from the hash).
 *
 * `variant`: "hero" (default) keeps the subtle mix strengths that read well
 * at full width; "thumb" bumps strength + saturation — at ~130px the hero
 * strengths collapse into a gray smudge on the dark themes.
 */
export function generatedBannerCss(title: string, variant: "hero" | "thumb" = "hero"): string {
  const h = hashTitle(title);
  const h1 = h % 360;
  const h2 = (h1 + 50 + ((h >>> 7) % 90)) % 360;
  const h3 = (h1 + 180 + ((h >>> 13) % 70)) % 360;
  const x1 = 12 + ((h >>> 3) % 30); //  12–41%
  const y1 = 15 + ((h >>> 9) % 35); //  15–49%
  const x2 = 62 + ((h >>> 11) % 30); // 62–91%
  const y2 = (h >>> 15) % 45; //         0–44%
  const x3 = 20 + ((h >>> 17) % 55); // 20–74%
  const angle = 100 + (h % 140); //     100–239deg
  const thumb = variant === "thumb";
  const sat = thumb ? 85 : 62;
  const boost = thumb ? 2.1 : 1;
  // Hash hue clamped toward the theme accent by --banner-tint (tokens.css:
  // strong pull on the dark themes, where raw saturated purple/magenta/lime
  // fights the gold/manuscript identity; 0% on parchment, whose pastel mixes
  // already read right). The var resolves at the element, so theme switches
  // apply live.
  const hue = (deg: number): string =>
    `color-mix(in oklab, var(--accent) var(--banner-tint, 0%), hsl(${deg} ${sat}% 52%))`;
  const c = (deg: number, strength: number): string =>
    `color-mix(in oklab, ${hue(deg)} ${Math.round(strength * boost)}%, var(--bg-raised))`;
  // Thumbs also tint the base layer: at ~130px an untinted raised-bg corner
  // reads as a gray smudge on the dark themes, so no pixel stays uncolored.
  const baseLayer = thumb
    ? `linear-gradient(${angle}deg, ${c(h1, 9)}, ${c(h3, 7)})`
    : `linear-gradient(${angle}deg, var(--bg-raised), var(--bg-hover))`;
  return [
    `radial-gradient(115% 160% at ${x1}% ${y1}%, ${c(h1, 34)} 0%, transparent 58%)`,
    `radial-gradient(105% 150% at ${x2}% ${y2}%, ${c(h2, 26)} 0%, transparent 62%)`,
    `radial-gradient(130% 170% at ${x3}% 105%, ${c(h3, 18)} 0%, transparent 66%)`,
    baseLayer,
  ].join(", ");
}
