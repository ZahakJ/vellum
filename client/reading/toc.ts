// Heading extraction + slug generation, shared by the reading-view renderer
// (heading element ids) and the outline panel (TOC entries). Both walk the
// top-level headings in document order with a fresh Slugger, so the slugs the
// TOC navigates to always agree with the ids the renderer assigned.

export interface Heading {
  level: number; // 1–6
  text: string; // display text with inline markdown stripped
  slug: string; // element id in the reading view
  line: number; // 1-based source line (editor scroll target)
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
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(line);
    if (!m) continue;
    const text = stripInline(m[2]);
    out.push({ level: m[1].length, text, slug: slugger.slug(text), line: i + 1 });
  }
  return out;
}
