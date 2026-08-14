// Pure embed helpers shared by the live-preview widgets (editor chunk) and
// the reading-view renderer (first-paint chunk). No CodeMirror imports here —
// this file is what lets the reading view ship without the editor bundle.

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const ATTACHMENT_EXT = /\.(pdf|mp4|webm|mp3|ogg|wav|flac|zip|canvas|json|csv|txt)$/i;

export interface EmbedParts {
  target: string; // file/note name, may include a path and #heading
  alias: string | null;
  width: number | null; // parsed from a numeric alias like |300
  kind: "image" | "file" | "note";
}

/** Split the inner text of a ![[...]] embed. */
export function parseEmbed(inner: string): EmbedParts {
  const pipe = inner.indexOf("|");
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : null;
  let target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  // strip #heading / #^block suffix for resolution
  const hash = target.indexOf("#");
  if (hash > 0) target = target.slice(0, hash).trim();
  const width = alias && /^\d{2,4}$/.test(alias) ? parseInt(alias, 10) : null;
  const kind = IMAGE_EXT.test(target)
    ? "image"
    : ATTACHMENT_EXT.test(target)
      ? "file"
      : "note";
  return { target, alias, width, kind };
}

export function fileUrl(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

// ── Attachment resolution (server /api/resolve, cached) ─────────────────────

const resolveCache = new Map<string, string | null>();
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
  const p = fetch(`/api/resolve?name=${encodeURIComponent(name)}`)
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
 *  file may be exactly the one an embed was waiting for. */
export function clearBrokenEmbeds(): void {
  brokenKeys.clear();
  resolveCache.clear();
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
