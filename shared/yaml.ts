// Where a YAML scalar ends and its `# comment` begins — one implementation.
//
// Three places in the product have to answer this question about the same
// bytes: the frontmatter WRITER (server/frontmatterEdit.ts), which puts the
// comment back after rewriting the value; the tag INDEX (server/indexer.ts),
// which must not file a note under a tag named "alpha # why this one"; and the
// properties CARD (client/editor/noteMeta.ts), which shows the value and — as
// of v1.8 — hands it back to the writer when the reader edits a sibling key.
//
// Only the writer had it right. The other two used a regex, and a regex cannot
// see quotes: `title: "a # b"` has no comment in it, and `title: "A"  # note`
// has one that a `^["']`-shaped guard declines to look for. The v1.8 browser
// verification found both halves of that on one screen — a properties card
// printing `Props Surgery"    # trailing comment` as the title, and a sidebar
// tag pill reading `alpha # a comment inside a block list`. A card that
// DISPLAYS a comment as part of the value will write it back as part of the
// value the moment somebody edits that row, and the release's central claim is
// that this writer never eats a comment.
//
// So the scan lives here, once, and the three callers import it.

/** Split a YAML scalar into `[value, comment]`.
 *
 *  A `#` opens a comment only at the start of the run or after whitespace, and
 *  only outside quotes and outside a flow `[…]` / `{…}` — the same three rules
 *  a YAML parser applies. The whitespace in FRONT of the `#` belongs to the
 *  comment half: it is the reader's own alignment, and putting it back is the
 *  difference between `title: New        # note` and `title: New# note`.
 *  Returns `[value, ""]` when there is no comment. */
export function splitYamlComment(value: string): [string, string] {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote !== null) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    else if (ch === "#" && depth === 0 && (i === 0 || /\s/.test(value[i - 1]))) {
      const cut = value.slice(0, i).replace(/\s+$/, "").length;
      return [value.slice(0, cut), value.slice(cut)];
    }
  }
  return [value, ""];
}

/** The scalar with its trailing comment taken off. */
export function uncomment(value: string): string {
  return splitYamlComment(value)[0];
}
