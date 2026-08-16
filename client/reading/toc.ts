// The fence scanner is `shared/fences.ts` — the SAME one `shared/anchors.ts`
// reads, so the outline's idea of what is code and the anchor table's cannot
// drift. See that file for what a marker-blind toggle cost.
import { closesFence, fenceOpener, sourceLines, type Fence } from "../../shared/fences.ts";
import { isTexPath } from "../../shared/noteFormat.ts";
import { inlineText as texInlineText, parseTex } from "../../shared/tex.ts";

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
  const lines = sourceLines(md);
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
  let fence: Fence | null = null;
  let current: Heading | null = null;
  let sawContent = false;
  let allLinkLists = true;
  const finalize = (): void => {
    if (current && sawContent && allLinkLists) current.furniture = true;
  };
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      // Inside a block, only its OWN closer ends it — every other line,
      // fence-shaped or not, is code.
      if (line.trim()) {
        sawContent = true;
        allLinkLists = false;
      }
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opened = fenceOpener(line);
    if (opened) {
      fence = opened;
      sawContent = true;
      allLinkLists = false; // code is real content
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

// ── LaTeX outlines ──────────────────────────────────────────────────────────

/** The outline of a `.tex` note: its `\section` hierarchy, with the printed
 *  number ahead of the title exactly as the reading view sets it.
 *
 *  The slug is the element id the LaTeX renderer assigns (`tex-<label or
 *  slug>`), so clicking an entry lands on the same element — the outline never
 *  needs to know which format it is looking at, which is the same bargain the
 *  anchor table makes for `[[Note#anchor]]`. */
export function texHeadings(src: string): Heading[] {
  const out: Heading[] = [];
  for (const block of parseTex(src).blocks) {
    if (block.t !== "section") continue;
    const text = texInlineText(block.title);
    out.push({
      // \part and \chapter fold into the six levels the panel styles, the same
      // way the renderer maps them onto h1…h6.
      level: Math.min(6, Math.max(1, block.level)),
      text: block.number ? `${block.number}  ${text}` : text,
      slug: `tex-${block.id}`,
      line: block.line,
    });
  }
  return out;
}

/** The outline of a note in EITHER format — the one call the panel makes. */
export function noteHeadings(relPath: string, content: string): Heading[] {
  return isTexPath(relPath) ? texHeadings(content) : extractHeadings(content);
}
