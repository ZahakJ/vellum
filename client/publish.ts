// Client-side mirror of the server's publish-flag check (server/publish.ts):
// a note is published iff frontmatter `publish` is exactly true or "true".
// Used by the status bar / palette to know the OPEN note's state without an
// extra endpoint — the note content is already fetched for word counts.

/** Extract the leading frontmatter block's inner text, or null. */
function frontmatterBlock(src: string): string | null {
  if (!src.startsWith("---\n") && !src.startsWith("---\r\n")) return null;
  const nl = src.startsWith("---\r\n") ? "\r\n" : "\n";
  const open = 3 + nl.length;
  const close = src.indexOf(`${nl}---`, open);
  return close === -1 ? null : src.slice(open, close);
}

/** True when the raw note content carries `publish: true` (or "true"). */
export function isPublishedContent(src: string): boolean {
  const block = frontmatterBlock(src);
  if (block === null) return false;
  for (const line of block.split(/\r?\n/)) {
    const m = /^publish:\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const raw = m[1];
    const quoted = /^(["']).*\1$/.test(raw);
    const value = quoted ? raw.slice(1, -1) : raw;
    // Mirror the server exactly (fm.publish === true || fm.publish === "true"):
    // unquoted true/True/TRUE are YAML booleans → true; a QUOTED value is a
    // string, and only the exact string "true" counts — "True"/"TRUE" do not.
    if (quoted) return value === "true";
    return value === "true" || value === "True" || value === "TRUE";
  }
  return false;
}
