// Note banners: shared client helpers. A banner value is either an https URL
// or a reference to a file in the vault (served by /api/file). Notes without a
// banner get a deterministic generated gradient in the blog surfaces — built
// from the note title's hash, mixed with theme tokens so it stays subtle and
// harmonious in every theme.
//
// FOUR ACCEPTED FORMS, and the last two are the whole point of this module.
// `banner:` used to mean "an https URL or a path from the vault root, and
// nothing else": a BARE FILENAME — which is what an Obsidian user writes, and
// the only form with no autocomplete behind it — was sent straight to
// /api/file?path=cover.png and 404'd unless the image happened to sit at the
// vault root. Every OTHER link form in the product (wikilinks, ![[embeds]],
// `![](Media/x.png)`) resolves a bare name from anywhere in the vault. So the
// banner climbs the same ladder now, server-side (GET /api/banner):
//
//   1. an `https://` URL                        → used as-is
//   2. an exact vault-relative path             → Media/cover.png
//   3. that path relative to the NOTE'S FOLDER  → cover.png beside the note
//   4. the basename, resolved like an embed     → case-insensitive, shortest
//                                                 path wins, vault-wide
//
// Resolutions are cached exactly as the embed layer caches its own (a
// definitive miss is cached too — a broken banner must stay quiet), and the
// cache is dropped whenever a file appears or is renamed.

import { withPreview } from "./api.ts";
import type { BannerResolution } from "../shared/types.ts";

/** A RESOLVED banner value → <img src>: https URLs pass through (https ONLY —
 *  an http:// banner would be mixed content), vault paths via /api/file.
 *
 *  Callers holding a value that came from the SERVER already resolved (a
 *  PostMeta.banner, an /api/banner answer) use this directly. Callers holding
 *  a raw authored value — frontmatter, a settings field — go through
 *  `resolveBanner()` below first, or they are back to form 2 only. */
export function bannerSrc(value: string): string {
  if (/^https:\/\//i.test(value)) return value;
  return `/api/file?path=${encodeURIComponent(value)}`;
}

// ── Resolution (server /api/banner, cached) ─────────────────────────────────

/** Cache key: the value and the note it was written in resolve together —
 *  `cover.png` in `Trips/Kyoto.md` and `cover.png` in `Recipes/Miso.md` are
 *  two different images. JSON-encoded rather than concatenated: any separator
 *  a filename could itself contain would collide two different lookups. */
function cacheKey(value: string, notePath: string | null): string {
  return JSON.stringify([notePath, value]);
}

const resolved = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

/** Resolve a banner value to an https URL or a vault path — synchronously
 *  when the answer is already known, otherwise a promise. `null` is a
 *  DEFINITIVE miss (no file of that name anywhere the caller may see), and it
 *  is cached as such: an admin surface renders the missing-image placeholder,
 *  a visitor surface renders nothing.
 *
 *  Mirrors resolveAttachment() in editor/embeds.ts deliberately — same shape,
 *  same caching rule, same "the endpoint is missing on an older server" escape
 *  hatch (fall back to treating the value as a literal path, which is exactly
 *  the old behaviour). */
export function resolveBanner(
  value: string,
  notePath: string | null = null,
): string | null | Promise<string | null> {
  const key = cacheKey(value, notePath);
  if (resolved.has(key)) return resolved.get(key) ?? null;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const params = new URLSearchParams({ value });
  if (notePath) params.set("note", notePath);
  const p = fetch(`/api/banner?${params.toString()}`, withPreview())
    .then(async (res) => {
      let hit: string | null;
      if (res.ok) {
        const body = (await res.json()) as Partial<BannerResolution>;
        hit = typeof body.path === "string" ? body.path : null; // null = known miss
      } else {
        hit = literalFallback(value); // older server: the pre-ladder behaviour
      }
      resolved.set(key, hit);
      pending.delete(key);
      return hit;
    })
    .catch(() => {
      const hit = literalFallback(value);
      resolved.set(key, hit);
      pending.delete(key);
      return hit;
    });
  pending.set(key, p);
  return p;
}

/** What a banner value meant before the ladder existed: an https URL, or the
 *  value as a vault path. Used only when /api/banner cannot be reached. */
function literalFallback(value: string): string | null {
  if (/^https:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null; // http:, data:, javascript:
  return value;
}

/** A file appeared or was renamed in the vault: every cached resolution
 *  (misses included) may now be wrong. Called from the same place the embed
 *  layer clears its own caches. */
export function clearBannerCache(): void {
  resolved.clear();
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
  // EVERY BLOB IS IN THE ROOM'S OWN FAMILY. A hash hue with no floor is how
  // iron-gall's gold-and-brown page ended up carrying a green→yellow card:
  // clip-art, in a product whose identity is one palette per theme. So the
  // outer mix puts a HARD FLOOR of accent under every hue, and the inner mix
  // starts FROM the accent and lets `--banner-tint` say how far the hash may
  // pull it away — the accent is the base colour, never the correction.
  //
  // That order is the whole fix, and it is not a rephrasing. Written the other
  // way round (`accent var(--banner-tint), hsl(…)`) the token read as "how
  // much accent to add back", so its floor value — 0%, which four light themes
  // set and which is also what any theme that never declares the token gets —
  // meant FORTY-FIVE PERCENT RAW HUE, the maximum, and the dark themes that
  // clamped hardest at 45% were the ones importing least. Parchment, the theme
  // the rule was written for, shipped a pink card and a green card on a
  // gold-and-cream page. Now 0% is pure accent, which is what a floor should
  // mean, and a theme that forgets the token is safe rather than maximally
  // foreign. The hash still tells two posts apart — by where the warmth sits,
  // how the field is ruled, and (where a theme allows it) a swing of hue — and
  // never by importing a colour the theme does not own. `--banner-tint`
  // resolves at the element, so a theme switch still repaints live.
  //
  // On a room that allows NO swing (`--banner-tint: 0%` — the four light
  // themes) every blob is then the same accent and the hash speaks through
  // POSITION, the base gradient's angle and the ruling alone. That is the
  // honest trade and it was measured, not assumed: carrying the base a
  // deterministic 3–15% toward `--text` as a second lever was tried here and
  // removed, because a blob is only mixed a quarter to a half of the way into
  // `--bg-raised` and the ink shift disappears into that — invisible variation
  // is complexity, not variation.
  const hue = (deg: number): string =>
    "color-mix(in oklab, var(--accent) 55%, " +
    `color-mix(in oklab, hsl(${deg} ${sat}% 52%) var(--banner-tint, 0%), var(--accent)))`;
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
  // ON A ROOM WITH NO HUE TO SPEND, THE HASH SPENDS VALUE AND TEXTURE.
  //
  // Four light themes ship `--banner-tint: 0%` (parchment, sandstone, linen,
  // solar), and there `hue()` collapses to pure `--accent` for all three
  // blobs. What was left to tell two posts apart was blob POSITION — invisible
  // under a 55% accent floor, because three blobs of the same colour on the
  // same ground is one wash wherever you put them — the base gradient's angle,
  // and a rule angle hashed over 20–69°: ONE QUADRANT, with a constant gap.
  // Four consecutive parchment thumbs came out the same beige hatched sticker,
  // and a topic page of them read as one image repeated — which is exactly the
  // "an image that failed to load" outcome the grain was added to prevent.
  //
  // So the three levers below are hashed too, and every one of them survives a
  // zero tint because none of them is a colour:
  //   · the rule angle now takes TWO bands (15–75° and 105–165°), so two posts
  //     can be hatched in mirrored directions rather than 50° apart;
  //   · the rule SPACING is hashed, in the 0.64 ratio the two sizes already
  //     hold, so a fine hatch and a wide one are different fields at both
  //     sizes and still one picture across them;
  //   · the blobs carry a per-post STRENGTH, so the warmth is deep on one post
  //     and barely there on the next. On a tinted theme that rides along under
  //     the hue swing; on an untinted one it is the whole difference, and it
  //     stays inside `--accent` and `--bg-raised` — the theme's own two
  //     colours, never an imported one.
  const band = (h >>> 19) % 122;
  const ruleAngle = band < 61 ? 15 + band : 105 + (band - 61); // never level, never steep
  const gapBase = 6 + ((h >>> 23) % 8); // 6–13px at hero size
  const gap = thumb ? Math.max(4, Math.round(gapBase * 0.64)) : gapBase; // the shipped 7:11
  const ink = thumb ? 9 : 7;
  // 0.72–1.32 — a blob half again as deep on one post as on another.
  const lift = 0.72 + (((h >>> 5) % 13) * 5) / 100;
  const spread = 54 + ((h >>> 25) % 14); // 54–67% — how far the warmth reaches
  const grain =
    `repeating-linear-gradient(${ruleAngle}deg, ` +
    `color-mix(in oklab, var(--text) ${ink}%, transparent) 0 1px, ` +
    `transparent 1px ${gap}px)`;
  return [
    grain,
    `radial-gradient(115% 160% at ${x1}% ${y1}%, ${c(h1, 34 * lift)} 0%, transparent ${spread}%)`,
    `radial-gradient(105% 150% at ${x2}% ${y2}%, ${c(h2, 26 * lift)} 0%, transparent ${spread + 4}%)`,
    `radial-gradient(130% 170% at ${x3}% 105%, ${c(h3, 18 * lift)} 0%, transparent ${spread + 8}%)`,
    baseLayer,
  ].join(", ");
}
