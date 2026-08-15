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
 * Set (or remove, with `line === null`) one `key:` line with a surgical edit —
 * never re-stringify YAML. Preserves every other byte of the file (ids, odd
 * formatting, key order). `key` must be a plain identifier (the callers
 * allowlist it); `line` is the full replacement line, e.g. `banner: "x.png"`.
 */
export function setFrontmatterLine(src: string, key: string, line: string | null): string {
  // Locate a leading frontmatter block: file starts with ---\n ... \n---(\n|EOF)
  if (src.startsWith("---\n") || src.startsWith("---\r\n")) {
    const nl = src.startsWith("---\r\n") ? "\r\n" : "\n";
    const open = 3 + nl.length;
    const closeToken = `${nl}---`;
    const closeIdx = src.indexOf(closeToken, open);
    if (closeIdx !== -1) {
      const fmBlock = src.slice(open, closeIdx);
      const keyLine = new RegExp(`^${key}:.*$`, "m");
      if (keyLine.test(fmBlock)) {
        if (line === null) {
          // Remove the line together with ONE adjacent newline.
          const m = keyLine.exec(fmBlock)!;
          const before = fmBlock.slice(0, m.index);
          let after = fmBlock.slice(m.index + m[0].length);
          if (after.startsWith(nl)) after = after.slice(nl.length);
          else if (before.endsWith(nl)) {
            return src.slice(0, open) + before.slice(0, -nl.length) + after + src.slice(closeIdx);
          }
          return src.slice(0, open) + before + after + src.slice(closeIdx);
        }
        const newBlock = fmBlock.replace(keyLine, line.replace(/\$/g, "$$$$"));
        return src.slice(0, open) + newBlock + src.slice(closeIdx);
      }
      if (line === null) return src; // nothing to remove
      // Insert as the last frontmatter line.
      const newBlock = fmBlock + (fmBlock.endsWith(nl) ? "" : nl) + line;
      return src.slice(0, open) + newBlock + src.slice(closeIdx);
    }
  }

  if (line === null) return src; // no frontmatter, nothing to remove
  // No frontmatter at all: prepend a minimal block.
  return `---\n${line}\n---\n${src}`;
}

/**
 * Toggle `publish:` with a surgical line edit — never re-stringify YAML.
 * Preserves every other byte of the file (ids, odd formatting, key order).
 */
export function setPublishFlag(src: string, publish: boolean): string {
  return setFrontmatterLine(src, "publish", `publish: ${publish}`);
}

/** YAML double-quoted scalar for a single-line string value. */
export function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
