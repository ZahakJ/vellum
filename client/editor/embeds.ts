// Pure embed helpers shared by the live-preview widgets (editor chunk) and
// the reading-view renderer (first-paint chunk). No CodeMirror imports here —
// this file is what lets the reading view ship without the editor bundle.

import { withPreview } from "../api.ts";
import { clearBannerCache } from "../banner.ts";
import { t } from "../i18n.ts";
import { Lru } from "../lru.ts";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const ATTACHMENT_EXT = /\.(pdf|mp4|webm|mp3|ogg|wav|flac|zip|canvas|json|csv|txt)$/i;

export interface EmbedParts {
  target: string; // file/note name, may include a path and #heading
  alias: string | null;
  width: number | null; // parsed from a numeric alias like |300
  kind: "image" | "file" | "note";
  /** The `#…` suffix, kept rather than only stripped. A transclusion that
   *  names an anchor pulls in JUST that block — `![[Paper#eq:fourier]]` is one
   *  equation, rendered by KaTeX, inside a markdown note — and the anchor may
   *  be a markdown heading or a LaTeX `\label`, because they are the same kind
   *  of thing (shared/anchors.ts). null when the embed names none. */
  anchor: string | null;
}

/** Split the inner text of a ![[...]] embed. */
export function parseEmbed(inner: string): EmbedParts {
  const pipe = inner.indexOf("|");
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : null;
  let target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  // strip #heading / #^block suffix for resolution — but keep it: the anchor
  // is what makes a partial transclusion possible.
  const hash = target.indexOf("#");
  const anchor = hash > 0 ? target.slice(hash + 1).trim() || null : null;
  if (hash > 0) target = target.slice(0, hash).trim();
  const width = alias && /^\d{2,4}$/.test(alias) ? parseInt(alias, 10) : null;
  const kind = IMAGE_EXT.test(target)
    ? "image"
    : ATTACHMENT_EXT.test(target)
      ? "file"
      : "note";
  return { target, alias, width, kind, anchor };
}

export function fileUrl(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

// ── Attachment resolution (server /api/resolve, cached) ─────────────────────

/** name → vault path (or null for a definitive miss). Bounded: the key space
 *  is "every attachment name any open note embeds", which on the measured
 *  fixture is 1,158 images and on a real photo-heavy vault is unbounded in
 *  practice. Eviction only costs a repeat `/api/resolve`, and 512 is far past
 *  the number of distinct embeds on screen at once. */
const resolveCache = new Lru<string | null>({ max: 512 });
const resolvePending = new Map<string, Promise<string | null>>();

/** Resolve an attachment basename to a vault path. Returns the cached value
 *  synchronously when known; otherwise kicks off a fetch and returns the
 *  promise. The server answers 200 `{ path: string | null }` — null is a
 *  DEFINITIVE miss and is cached as such (no follow-up /api/file guess, no
 *  repeat lookups: broken embeds are expected and must stay quiet). Only when
 *  the endpoint itself is unavailable (older server) does the name fall back
 *  to a literal vault path, letting <img> onerror paint the placeholder. */
export function resolveAttachment(
  name: string,
): string | null | Promise<string | null> {
  if (resolveCache.has(name)) return resolveCache.get(name) ?? null;
  const pending = resolvePending.get(name);
  if (pending) return pending;
  const p = fetch(`/api/resolve?name=${encodeURIComponent(name)}`, withPreview())
    .then(async (res) => {
      let path: string | null;
      if (res.ok) {
        const body = (await res.json()) as { path?: string | null };
        path = typeof body.path === "string" ? body.path : null; // null = known miss
      } else {
        path = name; // endpoint missing: try the name as a literal path
      }
      resolveCache.set(name, path);
      resolvePending.delete(name);
      return path;
    })
    .catch(() => {
      resolveCache.set(name, name);
      resolvePending.delete(name);
      return name;
    });
  resolvePending.set(name, p);
  return p;
}

/** Resolve a standard-markdown image src against the open note's directory. */
export function resolveRelative(src: string, notePath: string): string {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  const clean = decodeURIComponent(src.replace(/[?#].*$/, ""));
  const base = notePath.includes("/")
    ? notePath.slice(0, notePath.lastIndexOf("/")).split("/")
    : [];
  const parts = clean.startsWith("/") ? [] : [...base];
  for (const seg of clean.replace(/^\//, "").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return fileUrl(parts.join("/"));
}

// ── Failed-embed cache ──────────────────────────────────────────────────────
// Widget/decoration rebuilds recreate <img> elements; without this, a note
// with two missing images produces dozens of /api/file 404s per visit. Keys
// are embed names or resolved URLs — whatever the <img> was loaded from.

const brokenKeys = new Set<string>();

export function embedKnownBroken(key: string): boolean {
  return brokenKeys.has(key.toLowerCase());
}

export function markEmbedBroken(key: string): void {
  brokenKeys.add(key.toLowerCase());
}

/** A file appeared/renamed in the vault: give failed embeds another chance.
 *  Cached resolves (including definitive misses) are dropped too — the new
 *  file may be exactly the one an embed was waiting for.
 *
 *  BANNERS RIDE ALONG. A banner resolves through the same vault-wide index an
 *  embed does (client/banner.ts), so it goes stale on exactly the same events
 *  — including the visitor-preview toggle, where resolution is scope-dependent
 *  and a cached admin answer would paint a hero a visitor cannot fetch. */
export function clearBrokenEmbeds(): void {
  brokenKeys.clear();
  resolveCache.clear();
  clearBannerCache();
}

// ── Broken-embed placeholder ────────────────────────────────────────────────

export function brokenEmbed(name: string): HTMLElement {
  const box = document.createElement("span");
  box.className = "cm-s-embed-broken";
  const icon = document.createElement("span");
  icon.className = "cm-s-embed-broken__icon";
  icon.textContent = "⌀";
  icon.setAttribute("aria-hidden", "true");
  box.append(icon, document.createTextNode(name));
  return box;
}

/** True for machine-generated image names that mean nothing to a reader —
 *  "Pasted image 20260101123456.png", "Screenshot 2026-01-01 at 12.00.00",
 *  "IMG_0421" — i.e. nothing letter-shaped survives once a generic prefix
 *  and the digits/punctuation are set aside. */
export function isNoiseImageName(name: string): boolean {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  const rest = base.replace(
    /^\s*(pasted[\s_-]*image|screen[\s_-]*shot|clipboard|image|img|photo|untitled)/i,
    "",
  ).replace(/\bat\b/gi, ""); // "Screenshot … at 12.00.00"
  return !/\p{L}/u.test(rest);
}

/** Faint minimal "missing image" card for reader-facing surfaces (the blog
 *  article view) where the editor's ⌀-placeholder would read as clutter. */
export function missingImageCard(name: string): HTMLElement {
  const box = document.createElement("span");
  box.className = "s-rv-imgmissing";
  const icon = document.createElement("span");
  icon.className = "s-rv-imgmissing__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  const label = document.createElement("span");
  label.className = "s-rv-imgmissing__label";
  label.textContent = t("missingImage");
  box.append(icon, label);
  if (!isNoiseImageName(name)) {
    const which = document.createElement("span");
    which.className = "s-rv-imgmissing__name";
    which.textContent = name;
    box.append(which);
  }
  return box;
}
