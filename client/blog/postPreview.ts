// What a hover preview shows, and which links get one.
//
// Both halves are deliberately conservative. `previewPath` reads a note path
// off a link the page ALREADY rendered — never off a guess — so the set of
// previewable notes is exactly the set the visitor's own surfaces listed; and
// the fetch that follows goes through the ordinary visitor-scoped /api/note,
// so a hidden note cannot appear in a card even if a stale link named it.
//
// One invariant this leans on, written down because it is not local to this
// file: `/api/note` is deliberately NOT language-filtered (CONTRACTS.md —
// permalinks must keep working), so a link naming a published-but-
// languageFilter-hidden note WOULD build a card. No surface mints such a link
// today — reading-view wikilinks render with `data-target` and no href, and
// post lists, related, prev/next and search all come from filtered sources —
// which is precisely why `previewPath` reads a path off a link the page
// already rendered and never guesses one. Anything that starts minting hrefs
// from an unfiltered source owes this paragraph a second look.

import { urlToNoteGuess } from "../router.ts";

/** Strip YAML frontmatter — and ONLY frontmatter. `---` is also a thematic
 *  break, so a note that opens with a rule and closes the section with
 *  another one used to lose everything between them from its preview. Real
 *  frontmatter is a mapping: at least one `key:` line inside the block. */
function stripFrontmatter(content: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
  if (!m) return content;
  if (!/^[ \t]*[\w.$-]+[ \t]*:/m.test(m[1])) return content;
  return content.slice(m[0].length);
}

/** The note path a hovered element names, or null when it names none.
 *
 *  Two channels: an explicit `data-preview-path` (search results, which are
 *  buttons rather than links) and an internal href that spells a note. Both
 *  reject the decorative duplicates — a card's thumbnail is an aria-hidden
 *  link to the same post whose title link sits an inch away, and previewing
 *  it would fire the card from under the reader's pointer twice. */
export function previewPath(el: Element): string | null {
  const explicit = el.closest<HTMLElement>("[data-preview-path]");
  if (explicit) return explicit.dataset.previewPath || null;

  const a = el.closest<HTMLAnchorElement>("a[href]");
  if (!a || a.getAttribute("aria-hidden") === "true") return null;
  if (a.target === "_blank") return null;
  const href = a.getAttribute("href") ?? "";
  // Site-relative only: "//host" is another origin, and the reserved routes
  // are pages, not notes.
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const pathname = href.split(/[?#]/)[0];
  if (pathname === "/" || pathname === "/graph") return null;
  if (pathname.startsWith("/topic/") || pathname.startsWith("/folder/") || pathname.startsWith("/api/")) return null;
  if (pathname.startsWith("/feed")) return null;
  return urlToNoteGuess(pathname);
}

/** True for the template furniture a note opens with: a bare timestamp, or a
 *  short "Label:" line whose content is only #tags ("Status: #draft", "Tags:
 *  #a #b"). Deliberately the SAME test the server's excerpt builder uses
 *  (`isFurnitureLine` in server/indexer.ts) — the card and the post-list
 *  excerpt beside it must not disagree about where a note begins. Kept as a
 *  copy rather than a shared import because the server's version works on a
 *  full body and this one only ever looks at the opening lines. */
function isFurnitureLine(raw: string): boolean {
  const line = raw.trim();
  // No letters AND no digits is punctuation, not metadata: a `---` rule, a
  // `>` quote mark, a bare bullet. Those are content and stay.
  if (!/[\p{L}\p{N}]/u.test(line)) return false;
  const noTags = line.replace(/(?:^|[\s(])#[\p{L}\p{N}_][\p{L}\p{N}_/-]*/gu, " ");
  const rest = noTags.replace(/^[\p{L} ]{1,24}:\s*/u, "");
  return (rest.match(/\p{L}/gu) ?? []).length === 0;
}

/** The opening of a note, as markdown, for the card body.
 *
 *  Generous on purpose — the card scrolls, so a reader who wants to skim
 *  further should find something under the fold rather than a hard stop
 *  three paragraphs in. */
export function previewExcerpt(content: string, title: string): string {
  let body = stripFrontmatter(content);
  let lines = body.split("\n");

  // Drop the note's own header block. A card that opens "2026-03-07 19:28 /
  // Status: #adult / Tags: #software #statistics" while the post-list excerpt
  // an inch away opens "There are generally three main factors…" is showing
  // the reader the template, not the note. Leading furniture only, capped, and
  // only when there is something left after it.
  const SCAN = 12;
  let start = 0;
  while (start < Math.min(lines.length, SCAN)) {
    const line = lines[start];
    if (!line.trim() || isFurnitureLine(line)) start++;
    else break;
  }
  if (start > 0 && lines.slice(start).some((l) => l.trim())) {
    lines = lines.slice(start);
    body = lines.join("\n");
  }

  // An opening H1 that merely repeats the note title would sit an inch under
  // the card's own title header. Same trim the article page does.
  const limit = Math.min(lines.length, 12);
  for (let i = 0; i < limit; i++) {
    const m = /^\s{0,3}#\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    if (m[1].trim().toLowerCase() === title.trim().toLowerCase()) {
      lines.splice(i, 1);
      body = lines.join("\n");
    }
    break; // only the first heading is a candidate
  }

  const out: string[] = [];
  let chars = 0;
  for (const line of body.split("\n")) {
    out.push(line);
    chars += line.length + 1;
    if (out.length >= 80 || chars > 3200) break;
  }
  // Never leave a code fence hanging open at the cut.
  if (out.filter((l) => /^\s*(```|~~~)/.test(l)).length % 2 === 1) out.push("```");
  return out.join("\n").trim();
}
