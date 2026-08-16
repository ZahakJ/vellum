// Frontmatter, one operation per format.
//
// A `.md` note keeps its YAML `---` block (server/publish.ts, untouched). A
// `.tex` note keeps a `%--- … %---%` COMMENT block, so the same file still
// compiles: `pdflatex` sees two comment lines, Vellum sees `publish: true`.
// Every route that toggles publish or writes a `banner:` goes through here, so
// neither of them has to know which kind of note it is holding.

import matter from "gray-matter";
import { isTexPath } from "../shared/noteFormat.ts";
import { findTexFrontmatter } from "../shared/tex.ts";
import { publishFlag, readFrontmatter, setFrontmatterLine, setPublishFlag } from "./publish.ts";

/** The comment fences a `.tex` frontmatter block is WRITTEN with (reading
 *  tolerates the variants; writing picks one and sticks to it). */
const TEX_OPEN = "%---";
const TEX_CLOSE = "%---%";

/** Frontmatter data for a note of either format. */
export function readNoteFrontmatter(relPath: string, src: string): Record<string, unknown> {
  if (!isTexPath(relPath)) return readFrontmatter(src);
  const block = findTexFrontmatter(src);
  if (!block) return {};
  try {
    return (matter(`---\n${block.yaml}\n---\n`).data as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export function noteIsPublished(relPath: string, src: string): boolean {
  return publishFlag(readNoteFrontmatter(relPath, src));
}

/** Set (or remove, with `line === null`) one `key:` line, preserving every
 *  other byte of the file — the same surgical contract publish.ts states for
 *  markdown, extended to the comment block. */
export function setNoteFrontmatterLine(
  relPath: string,
  src: string,
  key: string,
  line: string | null,
): string {
  if (!isTexPath(relPath)) return setFrontmatterLine(src, key, line);
  return setTexFrontmatterLine(src, key, line);
}

export function setNotePublishFlag(relPath: string, src: string, publish: boolean): string {
  if (!isTexPath(relPath)) return setPublishFlag(src, publish);
  return setTexFrontmatterLine(src, "publish", `publish: ${publish}`);
}

function setTexFrontmatterLine(src: string, key: string, line: string | null): string {
  const block = findTexFrontmatter(src);
  const keyLine = new RegExp(`^([ \\t]*%[ \\t]?)?${key}:.*$`, "m");

  if (block) {
    const rawLines = block.raw.split("\n");
    const idx = rawLines.findIndex((l) => keyLine.test(l));
    if (idx >= 0) {
      if (line === null) rawLines.splice(idx, 1);
      else rawLines[idx] = `% ${line}`;
    } else {
      if (line === null) return src; // nothing to remove
      rawLines.push(`% ${line}`);
    }
    // A block emptied of every key would leave two bare fences behind; drop it.
    const body = rawLines.filter((l) => l.trim() !== "" && l.trim() !== "%");
    const rebuilt =
      body.length === 0 ? "" : `${TEX_OPEN}\n${body.join("\n")}\n${TEX_CLOSE}\n`;
    return rebuilt + src.slice(block.end);
  }

  if (line === null) return src;
  // No block yet: prepend one. A leading comment block is legal above
  // \documentclass, so the file still compiles unchanged.
  return `${TEX_OPEN}\n% ${line}\n${TEX_CLOSE}\n${src}`;
}
