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
 * garish, and automatically harmonious in all fifteen themes (the tokens carry
 * the theme; only the hue angles come from the hash, and they are floored into
 * the accent's own family — see `hue()`).
 *
 * `variant` is a SIZE, not a look: "thumb" nudges the mix strengths up by a
 * third because 130px of anything reads flatter than 780px of it. Everything
 * else — saturation, the accent floor, the base layer, the grain — is shared,
 * so a post's card and its own hero are one picture at two sizes.
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
  // ONE SYSTEM AT BOTH SIZES. The thumb used to run at 85% saturation and
  // 2.1× strength while the hero ran at 62% and 1×, so the SAME post rendered
  // as a saturated blue→mauve→olive diagonal on the home page and a near-flat
  // brown wash at the top of its own article — two pictures that shared
  // nothing but a hash. The small size still gets a nudge, because 130px of
  // anything reads flatter than 780px of it, but a nudge is not a second look.
  const sat = 52;
  const boost = thumb ? 1.35 : 1;
  // EVERY BLOB IS IN THE ROOM'S OWN FAMILY. `--banner-tint` alone let a theme
  // opt out entirely (parchment sat at 0%), and a hash hue with no floor is
  // how iron-gall's gold-and-brown page ended up carrying a green→yellow card:
  // clip-art, in a product whose identity is one palette per theme. The outer
  // mix puts a HARD FLOOR of accent under every hue, so the hash still tells
  // two posts apart — by where the warmth sits and how the field is ruled —
  // and never by importing a colour the theme does not own. `--banner-tint`
  // still tunes how far past that floor a theme goes, and still resolves at
  // the element, so a theme switch repaints live.
  const hue = (deg: number): string =>
    "color-mix(in oklab, var(--accent) 55%, " +
    `color-mix(in oklab, var(--accent) var(--banner-tint, 0%), hsl(${deg} ${sat}% 52%)))`;
  const c = (deg: number, strength: number): string =>
    `color-mix(in oklab, ${hue(deg)} ${Math.round(strength * boost)}%, var(--bg-raised))`;
  // The base layer is tinted at BOTH sizes: an untinted raised-bg corner reads
  // as a gray smudge at 130px on the dark themes, and a hero whose base was
  // untinted is exactly what made the two sizes look like two systems.
  const baseLayer = `linear-gradient(${angle}deg, ${c(h1, thumb ? 9 : 6)}, ${c(h3, thumb ? 7 : 5)})`;
  // RULED VELLUM, over the mesh. Three soft radial blobs and nothing else read
  // as an image that failed to load — a 783×166 field with no edge anywhere in
  // it. One deterministic hairline rule pattern (the note's own hash picks its
  // angle and spacing) gives the field a grain, so it reads as a made thing at
  // hero size and as texture rather than mush at 130px. Painted from --text, so
  // it is the theme's own ink at 7–9% and cannot fight any of the fifteen
  // grounds; the accent stays where the accent belongs.
  const ruleAngle = 20 + ((h >>> 19) % 50); // 20–69deg — never level, never steep
  const gap = thumb ? 7 : 11;
  const ink = thumb ? 9 : 7;
  const grain =
    `repeating-linear-gradient(${ruleAngle}deg, ` +
    `color-mix(in oklab, var(--text) ${ink}%, transparent) 0 1px, ` +
    `transparent 1px ${gap}px)`;
  return [
    grain,
    `radial-gradient(115% 160% at ${x1}% ${y1}%, ${c(h1, 34)} 0%, transparent 58%)`,
    `radial-gradient(105% 150% at ${x2}% ${y2}%, ${c(h2, 26)} 0%, transparent 62%)`,
    `radial-gradient(130% 170% at ${x3}% 105%, ${c(h3, 18)} 0%, transparent 66%)`,
    baseLayer,
  ].join(", ");
}
