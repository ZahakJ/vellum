// Heading extraction + slug generation, shared by the reading-view renderer
// (heading element ids) and the outline panel (TOC entries). Both walk the
// top-level headings in document order with a fresh Slugger, so the slugs the
// TOC navigates to always agree with the ids the renderer assigned.

export interface Heading {
  level: number; // 1–6
  text: string; // display text with inline markdown stripped
  slug: string; // element id in the reading view
  line: number; // 1-based source line (editor scroll target)
  /** True when the section under this heading holds nothing but link/tag
   *  lists (a trailing "Tags:" block, a MOC index…). The renderer still
   *  assigns its id (so anchors work); the outline panel filters these,
   *  since they read as furniture in a TOC rather than structure. */
  furniture?: boolean;
}

/** Deterministic, collision-free slugs for heading ids. */
export class Slugger {
  private seen = new Map<string, number>();

  slug(text: string): string {
    let base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    if (!base) base = "section";
    const n = this.seen.get(base) ?? 0;
    this.seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  }
}

/** Strip inline markdown from heading text for display + slugging. */
export function stripInline(text: string): string {
  return text
    .replace(/!\[\[([^[\]]+?)\]\]/g, "$1")
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, t: string, a?: string) =>
      (a ?? t).trim(),
    )
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*|__|~~|==/g, "")
    .replace(/(^|\s)[*_]|[*_](\s|$)/g, "$1$2")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** True when a body line is only wikilinks/tags/markdown links plus list
 *  furniture (bullets, commas, separators) — no prose of its own. */
function isLinkListLine(line: string): boolean {
  return (
    line
      .replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "") // list marker
      .replace(/!?\[\[[^[\]]*\]\]/g, "") // wikilinks + embeds
      .replace(/\[[^\]]*\]\([^)]*\)/g, "") // markdown links
      .replace(/#[\p{L}\p{N}][\p{L}\p{N}/_-]*/gu, "") // bare #tags
      .replace(/[\s,;|·•–—-]+/g, "") === ""
  );
}

/** Top-level headings of a note (skips YAML frontmatter and code fences). */
export function extractHeadings(md: string): Heading[] {
  const out: Heading[] = [];
  const slugger = new Slugger();
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let start = 0;
  if (lines[0]?.trim() === "---") {
    for (let j = 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "---" || t === "...") {
        start = j + 1;
        break;
      }
    }
  }
  let inFence = false;
  let current: Heading | null = null;
  let sawContent = false;
  let allLinkLists = true;
  const finalize = (): void => {
    if (current && sawContent && allLinkLists) current.furniture = true;
  };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      sawContent = true;
      allLinkLists = false; // code is real content
      continue;
    }
    if (inFence) {
      if (line.trim()) {
        sawContent = true;
        allLinkLists = false;
      }
      continue;
    }
    const m = HEADING_RE.exec(line);
    if (!m) {
      if (line.trim()) {
        sawContent = true;
        if (!isLinkListLine(line)) allLinkLists = false;
      }
      continue;
    }
    finalize();
    const text = stripInline(m[2]);
    current = { level: m[1].length, text, slug: slugger.slug(text), line: i + 1 };
    out.push(current);
    sawContent = false;
    allLinkLists = true;
  }
  finalize();
  return out;
}
