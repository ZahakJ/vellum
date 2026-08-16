// Shell-aware `<link rel="modulepreload">` for the served HTML.
//
// Splitting the client into per-surface chunks (build/chunks.ts, the lazy
// imports in client/App.tsx) removed 330 kB from an anonymous blog reader's
// download — and added a round trip: the browser cannot know it needs the
// blog chunk until the entry chunk has been fetched, parsed and run far
// enough to learn from `/api/me` which shell it is. Measured on the fixture,
// the cold blog home's first contentful paint went 260 ms → 336 ms on
// localhost, where a round trip is nearly free; over a real connection that
// gap is a whole RTT, and it lands on the public surface.
//
// The server, however, already knows the answer before it writes a byte: the
// instance's layout is configuration and the session is a cookie it is
// reading anyway. So it names the chunks that shell will need, and the
// browser fetches them in parallel with the entry instead of after it.
//
// This is a HINT, not a contract. A wrong guess costs one unused preload and
// nothing else — which is why the guess is made conservatively (see
// `preloadTags`), and why a missing or unreadable manifest silently produces
// no tags at all rather than failing a page load.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

interface ManifestEntry {
  file: string;
  css?: string[];
  imports?: string[];
}

type Manifest = Record<string, ManifestEntry>;

let manifest: Manifest | null = null;
/** size+mtime of the manifest the cache was built from; null while unread.
 *  A once-only latch here is what turned a rebuilt `dist/` into a page of
 *  `<link>`s pointing at chunks that no longer exist: the SPA fallback answers
 *  those URLs with index.html, and the browser refuses a module script served
 *  as text/html. `server/assets.ts` keys its own cache the same way and for
 *  the same reason — a stale HINT is not free once it names a dead file. */
let stamp: string | null = null;

function load(distDir: string): Manifest | null {
  const file = path.join(distDir, ".vite", "manifest.json");
  let current: string;
  try {
    const st = statSync(file);
    current = `${st.size} ${st.mtimeMs}`;
  } catch {
    stamp = "missing";
    manifest = null; // no manifest (dev, or an older build) — hints are optional
    return null;
  }
  if (stamp === current) return manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch {
    manifest = null; // unreadable or half-written — hints are optional
  }
  stamp = current;
  return manifest;
}

/** Collect a chunk and everything it STATICALLY imports, transitively.
 *  The HTML entry is skipped: the page already carries it as a `<script>`
 *  tag and its own `<link>`s, and re-announcing it would only add noise. */
function closure(m: Manifest, key: string, seen: Set<string>): void {
  if (seen.has(key) || key === "index.html") return;
  seen.add(key);
  for (const dep of m[key]?.imports ?? []) closure(m, dep, seen);
}

/**
 * `<link>` tags for the shell this request will actually mount.
 *
 * `blog` — the visitor shell of a PUBLIC_LAYOUT=blog instance.
 * `app`  — the vault shell (sidebar, tabs, status bar, backlinks panel).
 *
 * Only the SHELL is hinted. The editor, the graph engine, KaTeX and the
 * language grammars stay unhinted on purpose: they are loaded by an action,
 * not by a page, and preloading them here would quietly undo the split.
 */
export function preloadTags(distDir: string, shell: "blog" | "app"): string {
  const m = load(distDir);
  if (!m) return "";
  const roots =
    shell === "blog"
      ? ["blog/BlogShell.tsx"]
      : [
          "components/Sidebar.tsx",
          "components/Tabs.tsx",
          "components/StatusBar.tsx",
          "components/BacklinksPanel.tsx",
        ];
  const keys = new Set<string>();
  for (const root of roots) if (m[root]) closure(m, root, keys);
  if (keys.size === 0) return "";

  const out: string[] = [];
  const cssSeen = new Set<string>();
  for (const key of keys) {
    const entry = m[key];
    if (!entry) continue;
    out.push(`<link rel="modulepreload" crossorigin href="/${entry.file}" />`);
    // A shell's stylesheet is render-blocking for its first paint, so it is
    // a `stylesheet`, not a `preload` — fetching it early is only half the
    // job if the page then has to wait for a second discovery to apply it.
    for (const css of entry.css ?? []) {
      if (cssSeen.has(css)) continue;
      cssSeen.add(css);
      out.push(`<link rel="stylesheet" crossorigin href="/${css}" />`);
    }
  }
  return out.join("\n    ");
}

/** Splice the tags in just before `</head>`. No `</head>` → unchanged. */
export function injectPreloads(html: string, tags: string): string {
  if (!tags) return html;
  const at = html.indexOf("</head>");
  if (at < 0) return html;
  return `${html.slice(0, at)}    ${tags}\n  ${html.slice(at)}`;
}
