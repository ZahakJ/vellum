// Publish flag: read + surgically toggle `publish:` in a note's frontmatter.
// A note is public iff frontmatter `publish` is exactly true or "true".

import matter from "gray-matter";

/** Read frontmatter data without touching the body. Tolerates bad YAML. */
export function readFrontmatter(src: string): Record<string, unknown> {
  try {
    return (matter(src).data as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/** Publish check on already-parsed frontmatter (callers that need other
 *  frontmatter fields too parse once and reuse). */
export function publishFlag(fm: Record<string, unknown>): boolean {
  return fm.publish === true || fm.publish === "true";
}

export function isPublished(src: string): boolean {
  return publishFlag(readFrontmatter(src));
}

/**
 * Toggle `publish:` with a surgical line edit — never re-stringify YAML.
 * Preserves every other byte of the file (ids, odd formatting, key order).
 */
export function setPublishFlag(src: string, publish: boolean): string {
  const line = `publish: ${publish}`;

  // Locate a leading frontmatter block: file starts with ---\n ... \n---(\n|EOF)
  if (src.startsWith("---\n") || src.startsWith("---\r\n")) {
    const nl = src.startsWith("---\r\n") ? "\r\n" : "\n";
    const open = 3 + nl.length;
    const closeToken = `${nl}---`;
    const closeIdx = src.indexOf(closeToken, open);
    if (closeIdx !== -1) {
      const fmBlock = src.slice(open, closeIdx);
      const publishLine = /^publish:.*$/m;
      if (publishLine.test(fmBlock)) {
        const newBlock = fmBlock.replace(publishLine, line);
        return src.slice(0, open) + newBlock + src.slice(closeIdx);
      }
      // Insert as the last frontmatter line.
      const newBlock = fmBlock + (fmBlock.endsWith(nl) ? "" : nl) + line;
      return src.slice(0, open) + newBlock + src.slice(closeIdx);
    }
  }

  // No frontmatter at all: prepend a minimal block.
  return `---\n${line}\n---\n${src}`;
}
