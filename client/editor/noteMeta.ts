// Pure note-metadata helpers (tag regex, frontmatter properties parser)
// shared by the live-preview plugin (editor chunk) and the reading-view
// renderer (first-paint chunk). No CodeMirror imports here.

/** Inline #tag matcher (unicode letters, digits, _, /, -). */
export const TAG_RE = /(^|[\s([{])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** Parse simple `key: value` / list frontmatter into display rows. */
export function parseProps(yaml: string): { key: string; values: string[] }[] {
  const rows: { key: string; values: string[] }[] = [];
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[2].trim();
    const values: string[] = [];
    const clean = (s: string) => s.trim().replace(/^["'#]+|["']+$/g, "");
    if (inline.startsWith("[")) {
      for (const part of inline.replace(/^\[|\]$/g, "").split(",")) {
        if (clean(part)) values.push(clean(part));
      }
    } else if (inline) {
      values.push(clean(inline));
    } else {
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^[ \t]*-[ \t]+(.+)$/.exec(lines[j]);
        if (!item) break;
        if (clean(item[1])) values.push(clean(item[1]));
      }
    }
    rows.push({ key: m[1], values });
  }
  return rows;
}
