// SEARCH OPERATORS — the seventh-most-asked-for thing in the forums, and the
// one that turns a search box into a query language.
//
// `tag:recipes after:2024 -is:published` is a question a note-taker has all the
// time and could not previously ask: "what did I write about cooking last year
// and never publish". minisearch cannot answer it — it ranks TERMS, it knows
// nothing about frontmatter, dates or the link graph — so the operators are
// peeled OFF the query here and answered by the index's own tables, and what is
// left over goes to minisearch as words. That split is the whole design:
//
//   · this module is PURE and lives in `shared/`. It takes a string and returns
//     a shape — no vault, no records, no settings — which is why tests can
//     drive every edge of the grammar without a fixture vault, and why the
//     CLIENT imports it too: the help popover lists the operator names from
//     here, and the replace panel pre-fills its Find field with the free-text
//     half of whatever is in the search box. A second parser on the client
//     would eventually disagree with this one about what the reader typed, in
//     a panel that is about to rewrite four hundred files.
//   · `server/indexer.ts` evaluates the shape against note records, because
//     that is where the records are.
//
// It sits beside `expandTagQuery` (server/tagLabels.ts) rather than inside it:
// that one rewrites a query so an Arabic label finds its canonical tag, which
// is a vocabulary question. This one is a grammar.
//
// THREE RULES, chosen and worth stating because none of them is forced:
//
//   1. EVERYTHING IS AND. `tag:a tag:b` is notes carrying both, and the free
//      words are ANDed with the filters too. OR is not offered: a reader who
//      wants either runs two searches, and a query language whose default is
//      OR quietly returns the whole vault the moment somebody adds a term.
//   2. AN OPERATOR THAT DOES NOT PARSE IS NOT AN OPERATOR. `before:soon`,
//      `is:blue`, a bare `tag:` — all of them fall back to being ordinary
//      words. The alternative is a query that silently matches nothing, and a
//      search box that answers "no results" for a typo the reader cannot see is
//      the worst failure this surface has.
//   3. `-` NEGATES, and only at the front of an operator. `-tag:draft` is what
//      people reach for immediately after they learn `tag:`; a minus in front
//      of a plain word is left alone, because negating free text is a
//      minisearch question this layer has no business answering.

/** What an operator narrows by. `value` is the raw text after the colon,
 *  lowercased and unquoted; `ms` is filled in only for the date operators,
 *  which parse at the boundary so the index never sees a string date. */
export interface QueryFilter {
  kind: "tag" | "path" | "is" | "before" | "after" | "linkto" | "linkfrom";
  value: string;
  /** Epoch ms — `before`/`after` only. */
  ms: number;
  /** `-tag:draft`: keep the notes this filter does NOT match. */
  negated: boolean;
}

export interface ParsedQuery {
  /** What is left for minisearch: the words, in the order they were typed. */
  text: string;
  filters: QueryFilter[];
}

/** The operator names, in the order the help popover lists them. Exported so
 *  the popover, the docs test and the parser cannot drift — a help card naming
 *  an operator the parser does not know is worse than no help card. */
export const SEARCH_OPERATORS = [
  "tag",
  "path",
  "is",
  "before",
  "after",
  "linkto",
  "linkfrom",
] as const;

/** The two values `is:` accepts. Anything else is a word. */
const IS_VALUES = new Set(["published", "page"]);

/** `2024`, `2024-06`, `2024-06-15` → the epoch ms of the START of that period,
 *  in UTC. Null for anything else, which sends the token back to the text.
 *
 *  UTC RATHER THAN LOCAL, deliberately: a date filter that answers differently
 *  depending on which side of midnight the reader's machine is on is a filter
 *  whose results cannot be reproduced, and `dateMs` on a record is itself a
 *  frontmatter date parsed the same way. The cost is that a note written at
 *  23:00 in Riyadh belongs to the next day for `before:`, which is a rounding
 *  nobody notices; the benefit is that the same query always answers the same. */
function dayStartMs(value: string): number | null {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] === undefined ? 1 : Number(m[2]);
  const day = m[3] === undefined ? 1 : Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  // Date.UTC rolls 2024-02-31 forward into March rather than refusing it. A
  // date the reader can see is wrong must not silently become a different one.
  const back = new Date(ms);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return ms;
}

/** Split on whitespace, keeping `"quoted runs"` whole. Quotes are what make
 *  `path:"Reading notes"` and `linkto:"Machine Learning"` possible at all —
 *  a folder with a space in its name is the common case, not the exotic one. */
function tokenize(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of raw) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (current !== "") out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current !== "") out.push(current);
  return out;
}

/** One token → a filter, or null when it is just a word. */
function asFilter(token: string): QueryFilter | null {
  const negated = token.startsWith("-");
  const body = negated ? token.slice(1) : token;
  const colon = body.indexOf(":");
  if (colon < 1) return null;
  const kind = body.slice(0, colon).toLowerCase();
  const value = body.slice(colon + 1).trim();
  if (value === "") return null; // a bare `tag:` narrows nothing
  switch (kind) {
    case "tag":
      // The leading `#` is optional — a reader who copies a pill writes it.
      return { kind, value: value.replace(/^#/, "").toLowerCase(), ms: 0, negated };
    case "path":
    case "linkto":
    case "linkfrom":
      return { kind, value: value.toLowerCase(), ms: 0, negated };
    case "is":
      return IS_VALUES.has(value.toLowerCase())
        ? { kind, value: value.toLowerCase(), ms: 0, negated }
        : null;
    case "before":
    case "after": {
      const ms = dayStartMs(value);
      return ms === null ? null : { kind, value, ms, negated };
    }
    default:
      return null;
  }
}

/** Peel the operators off a raw query.
 *
 *  A query that is ONLY operators comes back with empty `text`, and the caller
 *  must treat that as "every note, narrowed" rather than as "no query" — a
 *  lone `tag:recipes` listing nothing would be the most confusing possible
 *  answer to the most obvious possible query. */
export function parseSearchQuery(raw: string): ParsedQuery {
  const filters: QueryFilter[] = [];
  const words: string[] = [];
  for (const token of tokenize(raw)) {
    const filter = asFilter(token);
    if (filter === null) words.push(token);
    else filters.push(filter);
  }
  return { text: words.join(" "), filters };
}
