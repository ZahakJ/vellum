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

/** FNV-1a over the title — stable across sessions and machines.
 *
 *  `basis` is the FNV offset basis, and the second value it makes possible is
 *  not a nicety: this generator now hashes NINE independent things out of one
 *  title (three hue offsets, chroma, value, three blob positions, an angle,
 *  a ruling, its spacing, its weight, a strength, a reach), and a 32-bit word
 *  cut into that many fields hands overlapping bits to fields that then move
 *  together — two posts whose grain and whose warmth happen to agree, which is
 *  precisely the "identical rectangles" this file exists to prevent. Two
 *  words, two purposes: colour and position from one, texture and strength
 *  from the other. */
function hashTitle(title: string, basis = 0x811c9dc5): number {
  let h = basis;
  for (let i = 0; i < title.length; i++) {
    h ^= title.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic abstract mesh gradient for a banner-less post. Three blobs on
 * a ruled field, every one of them mixed into the theme's raised background
 * via color-mix — colorful enough to tell posts apart, never garish, and
 * automatically harmonious in all fifteen themes (the tokens carry the theme;
 * the hash names a SWING around the theme's own accent hue, never a point on
 * the wheel — see `hue()`).
 *
 * `variant` is a SIZE, not a look: "thumb" nudges the mix strengths up by a
 * third because 130px of anything reads flatter than 780px of it. Everything
 * else — saturation, the accent floor, the base layer, the grain — is shared,
 * so a post's card and its own hero are one picture at two sizes.
 */
export function generatedBannerCss(title: string, variant: "hero" | "thumb" = "hero"): string {
  const h = hashTitle(title);
  // The texture word (see hashTitle) — everything the grain and the depth of
  // the warmth are made of, so it cannot move in step with the colour.
  const g = hashTitle(title, 0x9e3779b9);
  // THE HASH NAMES AN OFFSET, NOT A POINT ON THE WHEEL (v1.8 UX audit F42,
  // WORST-06: "four identical olive rectangles").
  //
  // It used to name an absolute hue — anywhere in 360° — which is a colour the
  // theme does not own, so the code below it had to spend everything it had
  // clamping the hue back toward `--accent`: a 55% accent floor over a 45%
  // tint left roughly a quarter of the blob's colour to the hash, and about
  // eight percent of the finished pixel. Four consecutive cards on iron-gall
  // measured as the same olive rectangle, and on the four light themes — which
  // set `--banner-tint: 0%` precisely because a paper ground shows a foreign
  // hue at any strength — they were the same rectangle by construction.
  //
  // Every theme now declares its accent's own hue (`--banner-hue`, tokens.css)
  // and the hash picks a swing AROUND it: ±48°, which is the analogous
  // neighbourhood — a room's own family of colours rather than a wheel of
  // strangers. Because a swung hue can no longer BE a stranger, the clamps
  // that were holding the wheel back can come off: the accent floor drops from
  // 55% to 16%, and the light themes go from "no swing at all" to a real one.
  // Same rule, more of it: the theme still decides how far the hash may pull,
  // and 0% is still pure accent for a theme that wants that.
  //
  // MEASURED, not asserted. Eight titles rendered in five themes, mean OKLab
  // distance between two cards (×100): the shipped generator managed 3.4–4.1,
  // with its worst neighbouring pair at 0.12 on parchment and 0.24 on linen —
  // two cards a reader cannot tell apart at all, which is WORST-06 in one
  // number. This one measures 5.0–7.5, worst neighbouring pair 1.70.
  const off1 = -48 + (h % 97); //           −48…+48 from the accent's own hue
  const off2 = off1 + 26 + ((h >>> 7) % 40); // a second blob, 26–65 round from it
  const off3 = off1 - (26 + ((h >>> 13) % 40)); // and a third, the other way
  // …and the hash spends CHROMA and VALUE as well, which cost a theme nothing
  // — they never import a colour, they only say how deep this post's warmth
  // sits — and which are the whole difference on a room that allows no swing.
  const sat = 42 + ((h >>> 21) % 30); //    42–71%
  const light = 40 + ((h >>> 25) % 26); //  40–65%
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
  const boost = thumb ? 1.35 : 1;
  // EVERY BLOB IS STILL IN THE ROOM'S OWN FAMILY — the offsets above are what
  // guarantees it now, so the FLOOR does not have to. The outer mix keeps a
  // floor of accent under every blob and the inner mix starts FROM the accent
  // and lets `--banner-tint` say how far the hash may pull it away: the accent
  // is the base colour, never the correction.
  //
  // That order is not a rephrasing. Written the other way round (`accent
  // var(--banner-tint), hsl(…)`) the token would read as "how much accent to
  // add back", so its floor value — 0% — would mean the MAXIMUM of raw hue,
  // and a theme that never declares the token would be the most foreign of
  // all. This way 0% is pure accent, which is what a floor should mean.
  // `--banner-tint` resolves at the element, so a theme switch repaints live.
  //
  // The floor is 16% and not the 55% it shipped at. 55% was the price of an
  // unbounded hue: with the wheel out of the picture the same clamp only
  // flattened the swing the token had already authorised, and the measured
  // result was WORST-06 — a column of identical rectangles.
  const hue = (off: number): string =>
    "color-mix(in oklab, var(--accent) 16%, " +
    `color-mix(in oklab, hsl(calc((var(--banner-hue, 46) + ${off}) * 1deg) ${sat}% ${light}%)` +
    " var(--banner-tint, 0%), var(--accent)))";
  // The clamp is a GUARD, not a shape: `strength * boost` reaches 96.8 at the
  // top of the lift range and a percentage over 100 is not a large mix — it is
  // an invalid color-mix(), which invalidates the whole `background` shorthand
  // and paints NOTHING. Measured that way once while tuning this file, and a
  // card that renders as a hole is the loudest possible version of the bug
  // this generator exists to avoid.
  const c = (off: number, strength: number): string =>
    `color-mix(in oklab, ${hue(off)} ${Math.min(100, Math.round(strength * boost))}%, var(--bg-raised))`;
  // The base layer is tinted at BOTH sizes: an untinted raised-bg corner reads
  // as a gray smudge at 130px on the dark themes, and a hero whose base was
  // untinted is exactly what made the two sizes look like two systems.
  const baseLayer = `linear-gradient(${angle}deg, ${c(off1, thumb ? 9 : 6)}, ${c(off3, thumb ? 7 : 5)})`;
  // RULED VELLUM, over the mesh. Three soft radial blobs and nothing else read
  // as an image that failed to load — a 783×166 field with no edge anywhere in
  // it. A deterministic hairline rule pattern (the note's own hash picks its
  // angle, its spacing and whether it is hatched once or crossed) gives the
  // field a grain, so it reads as a made thing at hero size and as texture
  // rather than mush at 130px. Painted from --text, so it is the theme's own
  // ink at 6–12% and cannot fight any of the fifteen grounds; the accent stays
  // where the accent belongs.
  //
  // ON A ROOM WITH LITTLE HUE TO SPEND, THE HASH SPENDS TEXTURE. Four light
  // themes hold their swing well below the dark rooms', because a paper ground
  // shows a foreign hue at half the strength a dark one does. Every lever
  // below survives that, because none of them is a colour:
  //   · the rule angle takes TWO bands (15–75° and 105–165°), so two posts can
  //     be hatched in mirrored directions rather than 50° apart;
  //   · the rule SPACING is hashed, in the 0.64 ratio the two sizes already
  //     hold, so a fine hatch and a wide one are different fields at both sizes
  //     and still one picture across them;
  //   · the ruling is single or CROSSED — the one lever that changes the shape
  //     of the grain rather than its parameters, and the one a reader sees at
  //     130px without comparing two cards side by side;
  //   · the ink WEIGHT is hashed, so one post is ruled in a fine hand and the
  //     next in a heavier one;
  //   · the blobs carry a per-post STRENGTH, so the warmth is deep on one post
  //     and barely there on the next. It stays inside `--accent` and
  //     `--bg-raised` — the theme's own two colours, never an imported one.
  const band = g % 122;
  const ruleAngle = band < 61 ? 15 + band : 105 + (band - 61); // never level, never steep
  const gapBase = 6 + ((g >>> 7) % 8); // 6–13px at hero size
  const gap = thumb ? Math.max(4, Math.round(gapBase * 0.64)) : gapBase; // the shipped 7:11
  const ink = (thumb ? 8 : 6) + ((g >>> 11) % 6); // 6–11 hero / 8–13 thumb
  const crossed = ((g >>> 15) & 1) === 1;
  // 0.55–1.63 — THE LEVER THAT DOES THE WORK. It was 0.72–1.32, a ±29% swing
  // on a blob that is itself a third of the picture; measured across eight
  // titles in five themes, widening it here moved the mean colour distance
  // between two cards further than widening the hue window did, and it cannot
  // import a colour, because depth is not a hue. A post is now painted in a
  // hand three times as heavy as its neighbour's, or three times as light.
  const lift = 0.55 + (((g >>> 17) % 13) * 9) / 100;
  const spread = 54 + ((g >>> 23) % 14); // 54–67% — how far the warmth reaches
  const rule = (deg: number, weight: number, step: number): string =>
    `repeating-linear-gradient(${deg}deg, ` +
    `color-mix(in oklab, var(--text) ${weight}%, transparent) 0 1px, ` +
    `transparent 1px ${step}px)`;
  return [
    rule(ruleAngle, ink, gap),
    // The crossing hand is lighter and wider: two rules at equal weight is a
    // net, and a net is a pattern the eye reads instead of the title beside it.
    ...(crossed ? [rule(ruleAngle + 90, Math.max(4, ink - 3), gap + 4)] : []),
    `radial-gradient(115% 160% at ${x1}% ${y1}%, ${c(off1, 44 * lift)} 0%, transparent ${spread}%)`,
    `radial-gradient(105% 150% at ${x2}% ${y2}%, ${c(off2, 34 * lift)} 0%, transparent ${spread + 4}%)`,
    `radial-gradient(130% 170% at ${x3}% 105%, ${c(off3, 24 * lift)} 0%, transparent ${spread + 8}%)`,
    baseLayer,
  ].join(", ");
}
