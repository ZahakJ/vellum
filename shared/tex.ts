// A self-contained LaTeX reader: source text → a small document model that the
// server indexes and the client renders. No external binary (no pandoc, no
// latexmk), no shell, no filesystem — the product stays one `npm install`, and
// a `.tex` note is data, never a program.
//
// This is a SUBSET parser, and it says so out loud: README lists what renders,
// what passes through and what is ignored. An honest boundary beats a leaky
// claim of "full LaTeX" — the whole point of the model below is that anything
// it does not know becomes a quiet marker instead of raw source or an
// exception.
//
// Three properties the rest of the feature leans on:
//
//   1. It never executes anything. `\newcommand` is expanded by substitution
//      with a hard depth and length budget; no other macro programming exists.
//   2. It never reaches outside the vault. `\input{...}` and `\includegraphics`
//      yield NAMES; resolving them to files is the caller's job, through the
//      same vault resolver wikilinks use.
//   3. It never produces HTML. Every string in the model is plain text, and the
//      renderers build DOM nodes, so there is no injection path through TeX.

// ── Model ───────────────────────────────────────────────────────────────────

export type Inline =
  | { t: "text"; v: string }
  /** Emphasis and friends. `s` maps onto the same marks markdown produces, so
   *  the two reading views share one visual language. */
  | { t: "style"; s: "em" | "strong" | "tt" | "sc" | "u" | "sf"; c: Inline[] }
  | { t: "math"; tex: string; display?: boolean }
  /** `\note{Target}` / `\note[alias]{Target}` and `%% [[Target]] %%` — Vellum's
   *  own link syntax in TeX. `anchor` is the part after `#`. */
  | { t: "link"; target: string; anchor: string | null; label: string | null; via: "note" | "comment" }
  /** `\ref` / `\eqref` / `\autoref` / `\cref` / `\pageref`. Resolved
   *  local-first: a label defined in this document never looks at the vault. */
  | { t: "ref"; key: string; eq: boolean }
  | { t: "cite"; keys: string[]; note: string | null }
  | { t: "url"; href: string; label: string | null }
  | { t: "footnote"; n: number }
  /** An explicit `\label{...}` sitting in running text: still an anchor. */
  | { t: "anchor"; id: string }
  /** `\includegraphics` ANYWHERE that is not a `figure` float — bare in a
   *  paragraph, or inside `center` / `minipage` / `wrapfigure` / a table
   *  cell. It is the same picture with no caption and no number, so it is an
   *  inline node rather than a second float; `name` is as written, and
   *  resolving it is the caller's job exactly as it is for the float. */
  | { t: "graphic"; name: string; width: string | null }
  | { t: "br" }
  /** A control sequence this reader does not implement. Renders as a quiet
   *  inline marker — never the raw source, never a crash. */
  | { t: "unknown"; name: string };

export interface TableCell {
  c: Inline[];
  /** `\multicolumn{n}` span. */
  span: number;
}

export type Block =
  | { t: "section"; level: number; title: Inline[]; id: string; number: string | null; line: number }
  | { t: "para"; c: Inline[]; line: number }
  | { t: "list"; ordered: boolean; items: { term: Inline[] | null; c: Block[] }[]; line: number }
  | { t: "quote"; c: Block[]; line: number }
  | { t: "code"; text: string; lang: string | null; line: number }
  | { t: "math"; tex: string; number: string | null; id: string | null; line: number }
  | {
      t: "figure";
      graphic: string | null;
      width: string | null;
      caption: Inline[] | null;
      id: string | null;
      number: string | null;
      line: number;
    }
  | {
      t: "table";
      head: TableCell[] | null;
      rows: TableCell[][];
      align: ("l" | "c" | "r")[];
      caption: Inline[] | null;
      id: string | null;
      number: string | null;
      line: number;
    }
  | {
      t: "theorem";
      env: string;
      title: Inline[] | null;
      number: string | null;
      id: string | null;
      c: Block[];
      line: number;
    }
  | { t: "abstract"; c: Block[]; line: number }
  | { t: "titleblock"; title: Inline[]; author: Inline[] | null; date: Inline[] | null; line: number }
  | { t: "bib"; items: { key: string; label: string | null; c: Inline[] }[]; line: number }
  /** `\input{...}` / `\include{...}` — an edge in the graph and a transclusion
   *  card in reading view. The NAME only; resolution belongs to the caller. */
  | { t: "transclude"; target: string; line: number }
  | { t: "center"; c: Block[]; line: number }
  | { t: "rule"; line: number }
  | { t: "toc"; line: number }
  /** An environment this reader does not implement: its BODY is still read as
   *  blocks, so a `\begin{multicols}` never swallows a chapter. */
  | { t: "unknownEnv"; name: string; c: Block[]; line: number };

/** One named anchor inside a note. THE point of the design: a markdown heading
 *  and a LaTeX `\label` are the same kind of thing, so `[[Note#anchor]]` and
 *  `\ref{Note#anchor}` are one lookup regardless of the target's format. */
export interface NoteAnchor {
  /** Address: a slugified heading, or a `\label{...}` value verbatim. */
  id: string;
  kind: "heading" | "label" | "equation" | "figure" | "table" | "section" | "theorem";
  /** What a reader would call it: heading text, caption, or "Equation (3)". */
  title: string;
  /** 1-based source line. */
  line: number;
  /** Printed number when the thing carries one ("3", "1.2", "A.1"). */
  number?: string;
}

export type TexLinkKind = "note" | "comment" | "input" | "cite" | "ref";

export interface TexLink {
  kind: TexLinkKind;
  /** Note name / file stem / citekey / label, as written. */
  target: string;
  /** `#anchor` part for `note`/`comment` links. */
  anchor: string | null;
  line: number;
  /** The source line, for the backlinks card. */
  context: string;
}

export interface TexDocument {
  /** YAML text from a leading `%--- … ---%` block (empty when absent). */
  frontmatter: string;
  /** `\vellum{key=value, …}` pairs, merged UNDER the YAML block (the block
   *  wins — one frontmatter, two spellings, one precedence rule). */
  vellum: Record<string, string>;
  blocks: Block[];
  anchors: NoteAnchor[];
  links: TexLink[];
  /** `\bibitem{key}` keys this document defines — what makes a note findable
   *  by `\cite{key}` from elsewhere in the vault. */
  citekeys: string[];
  /** `\includegraphics` targets, as written. */
  graphics: string[];
  footnotes: Inline[][];
  /** `\newcommand` bodies in KaTeX's `macros` shape, so MATH sees the author's
   *  own macros without this parser ever expanding math itself. */
  macros: Record<string, string>;
  /** `\title{...}` as plain text, when the document declares one. */
  title: string | null;
  /** Labels defined anywhere in this document — the local-first half of `\ref`
   *  resolution. A key in here never looks at the vault. */
  labels: Set<string>;
}

// ── Budgets ─────────────────────────────────────────────────────────────────
// Every one of these exists so a hostile or merely enormous `.tex` file cannot
// turn a page render into a hang. A document that exceeds one is truncated,
// never rejected: the note still opens.

const MAX_MACRO_DEPTH = 8;
const MAX_MACRO_EXPANSIONS = 4000;
const MAX_ENV_DEPTH = 24;
/** Unknown-command markers per document. Enough that a paper using one
 *  unimplemented package still shows where its commands were, few enough that
 *  a runaway macro cannot paint the page with them. */
const MAX_UNKNOWN_MARKERS = 200;
const MAX_BLOCKS = 20000;

// ── Scanner primitives ──────────────────────────────────────────────────────

/** Environments whose body is literal text: comments, braces and control
 *  sequences inside them mean nothing. */
const VERBATIM_ENVS = new Set(["verbatim", "Verbatim", "lstlisting", "minted", "alltt", "comment"]);

export interface MaskResult {
  /** Same length as the input, with every comment character replaced by a
   *  space, so every offset and line number computed on it is valid against
   *  the original. */
  code: string;
  /** `%% [[Target]] %%` links, in source order — invisible to `pdflatex`,
   *  meaningful here. The same token markdown already uses for a hidden
   *  comment, so one spelling means one thing in both formats. */
  hidden: { target: string; line: number; text: string }[];
  /** A leading `%--- … ---%` frontmatter block, verbatim (YAML). */
  frontmatter: string;
  /** Offset just past the frontmatter block (0 when there is none). */
  bodyStart: number;
}

const HIDDEN_LINK_RE = /%%\s*\[\[([^[\]]+?)\]\]\s*%%/g;

/** Blank out LaTeX comments, harvesting the two comment forms Vellum reads:
 *  the `%--- … ---%` frontmatter block and `%% [[Note]] %%` hidden links. */
export function maskComments(src: string): MaskResult {
  const chars = src.split("");
  const hidden: MaskResult["hidden"] = [];
  let frontmatter = "";
  let bodyStart = 0;

  // Frontmatter first, so its own '%' characters are never read as comments.
  const fm = findTexFrontmatter(src);
  if (fm) {
    frontmatter = fm.yaml;
    bodyStart = fm.end;
    for (let i = 0; i < bodyStart; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  }

  let i = bodyStart;
  let line = 1;
  for (let k = 0; k < bodyStart; k++) if (src[k] === "\n") line++;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === "\\") {
      // Verbatim environments come first: everything to their \end{…} is
      // literal, `%` included. Reaching them through the generic escape branch
      // below would have blanked out half of every listing that used a comment
      // character — and `%` is a comment character in most of the languages
      // people paste into `lstlisting`.
      if (src.startsWith("\\begin{", i)) {
        const close = src.indexOf("}", i + 7);
        const name = close === -1 ? "" : src.slice(i + 7, close);
        if (VERBATIM_ENVS.has(name)) {
          const endTok = `\\end{${name}}`;
          const end = src.indexOf(endTok, close);
          const stop = end === -1 ? src.length : end + endTok.length;
          for (let k = i; k < stop; k++) if (src[k] === "\n") line++;
          i = stop;
          continue;
        }
      }
      // `\verb|…|` and `\verb*|…|`: the delimiter is whatever follows.
      const verb = /^\\verb\*?(.)/.exec(src.slice(i, i + 8));
      if (verb) {
        const delim = verb[1];
        const end = src.indexOf(delim, i + verb[0].length);
        i = end === -1 ? src.length : end + 1;
        continue;
      }
      i += 2; // an escaped character is never a comment opener
      continue;
    }
    if (ch === "%") {
      let end = src.indexOf("\n", i);
      if (end === -1) end = src.length;
      const text = src.slice(i, end);
      HIDDEN_LINK_RE.lastIndex = 0;
      for (let m = HIDDEN_LINK_RE.exec(text); m !== null; m = HIDDEN_LINK_RE.exec(text)) {
        hidden.push({ target: m[1].trim(), line, text: text.replace(/^%+\s*|\s*%*$/g, "").trim() });
      }
      for (let k = i; k < end; k++) chars[k] = " ";
      i = end;
      continue;
    }
    i++;
  }
  return { code: chars.join(""), hidden, frontmatter, bodyStart };
}

/** The leading frontmatter block of a `.tex` source, or null.
 *
 *  Canonical form is `%---` … `%---%`: BOTH fences are LaTeX comments, so the
 *  block is invisible to `pdflatex` — that is the whole point, and it is the
 *  same bargain `%% [[Note]] %%` strikes for links. A bare `---%` close is
 *  accepted (some snippets write it that way) and each inner line may or may
 *  not carry its own leading `%`. The block must open on line 1, exactly as
 *  markdown's `---` fence must. */
export function findTexFrontmatter(
  src: string,
): { yaml: string; raw: string; end: number } | null {
  const fm = /^%-{3,}%?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*%?-{3,}%?[ \t]*(?:\r?\n|$)/.exec(src);
  if (!fm || !looksLikeYaml(fm[1])) return null;
  return {
    yaml: fm[1].replace(/^[ \t]*%[ \t]?/gm, ""),
    raw: fm[1],
    end: fm[0].length,
  };
}

/** Guard against reading a decorative `%------` rule as a frontmatter fence.
 *  Every non-empty line of a real block is a `key:` or a `- item`; anything
 *  else means those two comment lines were a ruler with a paragraph between
 *  them, and blanking that paragraph would delete the top of the document. */
function looksLikeYaml(block: string): boolean {
  const lines = block.split("\n").map((l) => l.replace(/^[ \t]*%[ \t]?/, "").trim()).filter((l) => l !== "");
  if (lines.length === 0 || lines.length > 60) return false;
  return lines.every((l) => /^[A-Za-z_][\w.-]*\s*:/.test(l) || /^[-*]\s/.test(l) || /^#/.test(l));
}

/** Read a `{…}` group starting at `i` (which must point at `{`). Returns the
 *  body and the offset just past the closing brace; an unclosed group runs to
 *  the end of the input rather than throwing. */
function readGroup(s: string, i: number): { body: string; end: number } {
  if (s[i] !== "{") return { body: "", end: i };
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { body: s.slice(i + 1, k), end: k + 1 };
    }
  }
  return { body: s.slice(i + 1), end: s.length };
}

/** Read a `[…]` optional argument at `i`, or null when there is none. */
function readOptional(s: string, i: number): { body: string; end: number } | null {
  if (s[i] !== "[") return null;
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return { body: s.slice(i + 1, k), end: k + 1 };
    }
  }
  return null;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && (s[i] === " " || s[i] === "\t" || s[i] === "\n" || s[i] === "\r")) i++;
  return i;
}

/** Read `n` brace arguments (with optional args skipped/collected) after `i`. */
function readArgs(
  s: string,
  i: number,
  n: number,
): { args: string[]; opt: string | null; end: number } {
  let k = skipWs(s, i);
  let opt: string | null = null;
  const o = readOptional(s, k);
  if (o) {
    opt = o.body;
    k = skipWs(s, o.end);
  }
  const args: string[] = [];
  for (let a = 0; a < n; a++) {
    k = skipWs(s, k);
    if (s[k] !== "{") break;
    const g = readGroup(s, k);
    args.push(g.body);
    k = g.end;
  }
  return { args, opt, end: k };
}

/** The control sequence at `i` (which must point at a backslash), or null.
 *
 *  `end` points just past the name. TeX also SWALLOWS the whitespace after a
 *  control WORD — `\textbackslash input` is `\input`, not `\ input` — which is
 *  why `csEnd()` exists beside this: any caller that consumes a control word
 *  without reading an argument must use it, or the rendered prose disagrees
 *  with what `pdflatex` would set. */
function readCs(s: string, i: number): { name: string; end: number } | null {
  if (s[i] !== "\\") return null;
  const m = /^\\([a-zA-Z@]+\*?|.)/s.exec(s.slice(i, i + 40));
  if (!m) return null;
  return { name: m[1], end: i + m[0].length };
}

/** Where a control sequence really ends: past its name, and past the run of
 *  spaces TeX eats after a control WORD (never after `\%`, `\&` or `\ `). */
function csEnd(s: string, cs: { name: string; end: number }): number {
  if (!/^[a-zA-Z@]/.test(cs.name)) return cs.end;
  let k = cs.end;
  while (k < s.length && (s[k] === " " || s[k] === "\t")) k++;
  return k;
}

/** 1-based line number of an offset — computed against a prefix table so a
 *  long document does not re-scan for every block. */
function lineCounter(src: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// ── Text-mode substitutions ─────────────────────────────────────────────────

/** Control sequences that stand for one character. */
const SYMBOLS: Record<string, string> = {
  "%": "%", "&": "&", "_": "_", "#": "#", "$": "$", "{": "{", "}": "}",
  " ": " ", ",": " ", ";": " ", "!": "", "@": "",
  textbackslash: "\\", textasciitilde: "~", textasciicircum: "^",
  ldots: "…", dots: "…", textellipsis: "…",
  LaTeX: "LaTeX", TeX: "TeX", LaTeXe: "LaTeX2ε",
  copyright: "©", textcopyright: "©", textregistered: "®", texttrademark: "™",
  S: "§", P: "¶", dag: "†", ddag: "‡", pounds: "£", textsterling: "£",
  texteuro: "€", euro: "€", textdegree: "°", degree: "°",
  textbullet: "•", textperiodcentered: "·", textquotedblleft: "“",
  textquotedblright: "”", textquoteleft: "‘", textquoteright: "’",
  textendash: "–", textemdash: "—", slash: "/", newline: "\n",
  ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å", o: "ø", O: "Ø",
  ss: "ß", i: "ı", j: "ȷ", l: "ł", L: "Ł",
};

/** `\'e` → "é": accent command → combining codepoint, applied then normalized. */
const ACCENTS: Record<string, string> = {
  "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃",
  "=": "̄", ".": "̇", u: "̆", v: "̌", H: "̋",
  c: "̧", k: "̨", r: "̊", b: "̱", d: "̣", t: "͡",
};

/** Ligatures and quotes, applied to plain runs only (never inside verbatim,
 *  math or `\texttt`). */
function typography(text: string): string {
  return text
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/``/g, "“")
    .replace(/''/g, "”")
    .replace(/`/g, "‘")
    .replace(/~/g, " ")
    .replace(/!`/g, "¡")
    .replace(/\?`/g, "¿");
}

// ── Macros (`\newcommand`) ──────────────────────────────────────────────────

interface Macro {
  argc: number;
  body: string;
  opt: string | null;
}

const NEWCOMMAND_RE = /\\(?:re)?newcommand\*?\s*(?:\{\s*\\([a-zA-Z@]+)\s*\}|\\([a-zA-Z@]+))/g;

/** Harvest `\newcommand`/`\renewcommand` definitions. The bodies are kept as
 *  SOURCE: text-mode uses expand them by substitution, and math-mode hands the
 *  same table to KaTeX, which does its own (sandboxed) expansion. */
function collectMacros(code: string): Map<string, Macro> {
  const out = new Map<string, Macro>();
  NEWCOMMAND_RE.lastIndex = 0;
  for (let m = NEWCOMMAND_RE.exec(code); m !== null; m = NEWCOMMAND_RE.exec(code)) {
    const name = m[1] ?? m[2];
    let k = skipWs(code, m.index + m[0].length);
    let argc = 0;
    let opt: string | null = null;
    const nArg = readOptional(code, k);
    if (nArg) {
      argc = Math.min(9, Math.max(0, Number.parseInt(nArg.body.trim(), 10) || 0));
      k = skipWs(code, nArg.end);
      const dflt = readOptional(code, k);
      if (dflt) {
        opt = dflt.body;
        k = skipWs(code, dflt.end);
      }
    }
    if (code[k] !== "{") continue;
    const body = readGroup(code, k);
    out.set(name, { argc, body: body.body, opt });
    NEWCOMMAND_RE.lastIndex = body.end;
  }
  return out;
}

/** KaTeX's `macros` option shape: `{"\\R": "\\mathbb{R}"}`. Only the
 *  zero-through-nine-argument forms this parser collected, so math sees exactly
 *  the definitions the author wrote. */
function katexMacros(macros: Map<string, Macro>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, macro] of macros) out[`\\${name}`] = macro.body;
  return out;
}

// ── Numbering ───────────────────────────────────────────────────────────────

const SECTION_LEVELS: Record<string, number> = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4,
  paragraph: 5, subparagraph: 6,
};

/** Article-style counters: sections 1 / 1.1 / 1.1.1, and one flat sequence
 *  each for equations, figures and tables. Documented as such — matching every
 *  class's numbering scheme is not a promise this reader makes. */
class Counters {
  private section = [0, 0, 0, 0, 0, 0, 0];
  private appendix = false;
  equation = 0;
  figure = 0;
  table = 0;
  private theorem = new Map<string, number>();

  startAppendix(): void {
    this.appendix = true;
    this.section[2] = 0;
  }

  /** Bump the counter for `level` and return the printed number, or null for
   *  the unnumbered levels (part, paragraph, subparagraph, and every starred
   *  form — the caller passes `numbered: false` for those). */
  nextSection(level: number): string | null {
    if (level < 2 || level > 4) return null;
    this.section[level]++;
    for (let l = level + 1; l < this.section.length; l++) this.section[l] = 0;
    const parts: string[] = [];
    for (let l = 2; l <= level; l++) {
      parts.push(l === 2 && this.appendix ? alpha(this.section[2]) : String(this.section[l]));
    }
    return parts.join(".");
  }

  nextEquation(): string {
    this.equation++;
    return String(this.equation);
  }

  nextFigure(): string {
    this.figure++;
    return String(this.figure);
  }

  nextTable(): string {
    this.table++;
    return String(this.table);
  }

  nextTheorem(env: string): string {
    const n = (this.theorem.get(env) ?? 0) + 1;
    this.theorem.set(env, n);
    return String(n);
  }
}

function alpha(n: number): string {
  let out = "";
  let k = n;
  while (k > 0) {
    out = String.fromCharCode(64 + ((k - 1) % 26) + 1) + out;
    k = Math.floor((k - 1) / 26);
  }
  return out || "A";
}

// ── Environment tables ──────────────────────────────────────────────────────

const DISPLAY_MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "aligned", "alignat", "alignat*",
  "gather", "gather*", "gathered", "multline", "multline*", "displaymath",
  "eqnarray", "eqnarray*", "flalign", "flalign*", "split", "cases", "array",
  "IEEEeqnarray", "IEEEeqnarray*", "dmath", "dmath*",
]);

/** Display-math environments KaTeX understands as an OUTER environment: the
 *  rest are wrapped in `\begin{aligned}`-free plain display math. */
const KATEX_ENVS = new Set([
  "align", "align*", "aligned", "alignat", "alignat*", "gather", "gather*",
  "gathered", "multline", "multline*", "split", "cases", "array", "matrix",
  "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "Bmatrix", "smallmatrix", "darray",
  "dcases", "rcases", "equation", "equation*", "CD", "subarray",
]);

const QUOTE_ENVS = new Set(["quote", "quotation", "verse", "displayquote", "epigraph"]);
const CENTER_ENVS = new Set(["center", "centering"]);
const THEOREM_ENVS = new Set([
  "theorem", "lemma", "proposition", "corollary", "definition", "remark",
  "example", "proof", "claim", "conjecture", "axiom", "exercise", "problem",
  "solution", "note", "observation", "fact", "notation", "assumption", "case",
]);
const LIST_ENVS = new Set([
  "itemize", "enumerate", "description", "compactitem", "compactenum",
  "itemize*", "enumerate*",
]);

/** Environments whose entire content is deliberately dropped: they carry no
 *  reading-view meaning, and printing their source would be worse than
 *  printing nothing. */
const DROPPED_ENVS = new Set(["comment", "titlepage"]);

// ── Parser ──────────────────────────────────────────────────────────────────

interface Ctx {
  code: string;
  lineAt: (offset: number) => number;
  macros: Map<string, Macro>;
  counters: Counters;
  doc: TexDocument;
  /** Recursion budget for `\newcommand` substitution. */
  expansions: { n: number };
  blocks: { n: number };
  /** How many "this reader does not implement that" markers have been
   *  emitted. See MAX_UNKNOWN_MARKERS. */
  unknowns: { n: number };
}

/** Parse a LaTeX source into the document model. Never throws: a malformed
 *  document yields whatever was readable plus quiet markers. */
export function parseTex(src: string): TexDocument {
  const normalized = src.replace(/\r\n/g, "\n");
  const masked = maskComments(normalized);
  const lineAt = lineCounter(normalized);
  const macros = collectMacros(masked.code);

  const doc: TexDocument = emptyDocument();
  doc.frontmatter = masked.frontmatter;
  doc.macros = katexMacros(macros);

  const ctx: Ctx = {
    code: masked.code,
    lineAt,
    macros,
    counters: new Counters(),
    doc,
    expansions: { n: 0 },
    blocks: { n: 0 },
    unknowns: { n: 0 },
  };

  // `\vellum{key=value, …}`: frontmatter for people who would rather write a
  // macro than a comment block. The YAML block wins on any shared key.
  collectVellum(masked.code, doc);

  // Preamble is not content. When the document declares one, only what is
  // between \begin{document} and \end{document} is read as prose — everything
  // above it is class options, package loads and macro definitions.
  const bodyRange = documentBody(masked.code);
  // \title/\author/\date are read from the WHOLE source, not just the
  // preamble: a fragment meant to be \input has no preamble, and plenty of
  // real documents declare their title after \begin{document}.
  const titleMeta = readTitleMeta(masked.code, ctx);
  doc.title = titleMeta.title;

  doc.blocks = parseBlocks(masked.code, bodyRange.from, bodyRange.to, ctx, titleMeta);

  // Hidden `%% [[Note]] %%` links ride outside the block tree by construction —
  // they were blanked out of `code` before parsing, precisely so `pdflatex`
  // and this reader agree that they are comments.
  for (const h of masked.hidden) {
    const hash = h.target.indexOf("#");
    doc.links.push({
      kind: "comment",
      target: (hash >= 0 ? h.target.slice(0, hash) : h.target).trim(),
      anchor: hash >= 0 ? h.target.slice(hash + 1).trim() : null,
      line: h.line,
      context: h.text,
    });
  }

  collectLinks(doc);
  doc.anchors.sort((a, b) => a.line - b.line);
  doc.links.sort((a, b) => a.line - b.line);
  return doc;
}

/** Walk the parsed blocks and register every `\note`, `\ref` and `\cite` as a
 *  link, with the block's line and its PROSE as the backlink context (a
 *  backlink card printing `\emph{see }\note{X}` would be raw source in a
 *  surface CONTRACTS says never shows raw syntax).
 *
 *  `\input` links were registered during the block walk, because a transclude
 *  block is the only place they can appear. */
function collectLinks(doc: TexDocument): void {
  const seen = new Set<string>();
  const add = (link: TexLink): void => {
    // The separator is a WRITTEN escape, not a literal NUL byte. Three raw
    // NULs used to sit in this template literal, which made file(1) report
    // this source as `data` and made a plain grep return nothing for the
    // whole file - a tooling trap that costs the next reader an hour.
    const key = `${link.kind}\u0000${link.target}\u0000${link.anchor ?? ""}\u0000${link.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    doc.links.push(link);
  };
  const walkInline = (nodes: Inline[], line: number, context: string): void => {
    for (const n of nodes) {
      switch (n.t) {
        case "link":
          add({ kind: "note", target: n.target, anchor: n.anchor, line, context });
          break;
        case "ref":
          add({ kind: "ref", target: n.key, anchor: null, line, context });
          break;
        case "cite":
          for (const key of n.keys) add({ kind: "cite", target: key, anchor: null, line, context });
          break;
        case "style":
          walkInline(n.c, line, context);
          break;
        default:
          break;
      }
    }
  };
  const walkBlocks = (blocks: Block[]): void => {
    for (const b of blocks) {
      switch (b.t) {
        case "para":
          walkInline(b.c, b.line, inlineText(b.c));
          break;
        case "section":
          walkInline(b.title, b.line, inlineText(b.title));
          break;
        case "list":
          for (const item of b.items) {
            if (item.term) walkInline(item.term, b.line, inlineText(item.term));
            walkBlocks(item.c);
          }
          break;
        case "quote":
        case "center":
        case "abstract":
        case "theorem":
        case "unknownEnv":
          walkBlocks(b.c);
          break;
        case "figure":
        case "table":
          if (b.caption) walkInline(b.caption, b.line, inlineText(b.caption));
          break;
        case "bib":
          for (const item of b.items) walkInline(item.c, b.line, inlineText(item.c));
          break;
        default:
          break;
      }
    }
  };
  walkBlocks(doc.blocks);
  for (const fn of doc.footnotes) walkInline(fn, 1, inlineText(fn));
}

/** `\begin{document}` … `\end{document}`, or the whole file when the note is a
 *  fragment (a chapter meant to be `\input`, which is the common vault case). */
function documentBody(code: string): { from: number; to: number } {
  const begin = code.indexOf("\\begin{document}");
  if (begin === -1) return { from: 0, to: code.length };
  const from = begin + "\\begin{document}".length;
  const end = code.indexOf("\\end{document}", from);
  return { from, to: end === -1 ? code.length : end };
}

function collectVellum(code: string, doc: TexDocument): void {
  const re = /\\vellum\s*\{/g;
  for (let m = re.exec(code); m !== null; m = re.exec(code)) {
    const g = readGroup(code, m.index + m[0].length - 1);
    for (const pair of splitTopLevel(g.body, ",")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim().replace(/^\{|\}$/g, "").trim();
      if (key) doc.vellum[key] = value;
    }
    re.lastIndex = g.end;
  }
}

/** Split on a separator that is not inside braces or brackets. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim()).filter((p) => p !== "");
}

interface TitleMeta {
  title: string | null;
  titleInline: Inline[] | null;
  author: Inline[] | null;
  date: Inline[] | null;
}

function readTitleMeta(preamble: string, ctx: Ctx): TitleMeta {
  const grab = (name: string): string | null => {
    const re = new RegExp(`\\\\${name}\\s*\\{`);
    const m = re.exec(preamble);
    if (!m) return null;
    return readGroup(preamble, m.index + m[0].length - 1).body;
  };
  const rawTitle = grab("title");
  const author = grab("author");
  const date = grab("date");
  return {
    title: rawTitle === null ? null : inlineText(parseInline(rawTitle, ctx)),
    titleInline: rawTitle === null ? null : parseInline(rawTitle, ctx),
    author: author === null ? null : parseInline(author, ctx),
    date: date === null ? null : parseInline(date, ctx),
  };
}

// ── Block parsing ───────────────────────────────────────────────────────────

/** Sectioning, environments and paragraphs between `from` and `to`. */
function parseBlocks(
  code: string,
  from: number,
  to: number,
  ctx: Ctx,
  titleMeta?: TitleMeta,
  depth = 0,
): Block[] {
  const out: Block[] = [];
  let i = from;
  let paraStart = from;
  let paraBuf = "";

  const flushPara = (): void => {
    const text = paraBuf;
    paraBuf = "";
    if (text.trim() === "") return;
    if (ctx.blocks.n++ > MAX_BLOCKS) return;
    const c = parseInline(text, ctx);
    // A paragraph that is nothing but a label carries no prose; its anchor was
    // already registered, so dropping it here avoids an empty <p>.
    if (c.some((n) => n.t !== "anchor" && !(n.t === "text" && n.v.trim() === ""))) {
      out.push({ t: "para", c, line: ctx.lineAt(paraStart) });
    }
  };

  /** Anything that ends the paragraph in progress. */
  const breakPara = (): void => flushPara();

  while (i < to) {
    const ch = code[i];

    // Blank line: paragraph break.
    if (ch === "\n") {
      const nl = /^\n[ \t]*\n/.exec(code.slice(i, i + 200));
      if (nl) {
        breakPara();
        i += nl[0].length;
        paraStart = i;
        continue;
      }
      paraBuf += "\n";
      i++;
      continue;
    }

    // `$$…$$` opening a block of its own is display math, exactly as `\[…\]`
    // is. Mid-sentence it stays inline — the same rule the markdown renderer
    // applies to the same two dollars.
    if (ch === "$" && code[i + 1] === "$" && paraBuf.trim() === "") {
      breakPara();
      const close = findDollar(code, i + 2, true);
      out.push(mathBlock(code.slice(i + 2, Math.min(close.at, to)).trim(), null, ctx, ctx.lineAt(i)));
      i = Math.min(close.end, to);
      paraStart = i;
      continue;
    }

    if (ch !== "\\") {
      if (paraBuf === "") paraStart = i;
      paraBuf += ch;
      i++;
      continue;
    }

    const cs = readCs(code, i);
    if (!cs) {
      paraBuf += ch;
      i++;
      continue;
    }

    // ── \begin{env} ────────────────────────────────────────────────────────
    if (cs.name === "begin") {
      const nameArg = readArgs(code, cs.end, 1);
      const env = nameArg.args[0]?.trim() ?? "";
      const span = envSpan(code, nameArg.end, env, to);
      breakPara();
      if (depth < MAX_ENV_DEPTH) {
        const block = parseEnvironment(env, code, nameArg.end, span.inner, span.outer, ctx, depth);
        if (block) out.push(...block);
      }
      i = span.outer;
      paraStart = i;
      continue;
    }

    if (cs.name === "end") {
      // A stray \end: skip its argument and carry on rather than derailing.
      const nameArg = readArgs(code, cs.end, 1);
      i = nameArg.end;
      continue;
    }

    // ── sectioning ─────────────────────────────────────────────────────────
    const starless = cs.name.replace(/\*$/, "");
    if (starless in SECTION_LEVELS) {
      breakPara();
      const starred = cs.name.endsWith("*");
      const level = SECTION_LEVELS[starless];
      const args = readArgs(code, cs.end, 1);
      const titleSrc = args.args[0] ?? args.opt ?? "";
      const number = starred ? null : ctx.counters.nextSection(level);
      const line = ctx.lineAt(i);
      const title = parseInline(titleSrc, ctx);
      const text = inlineText(title);
      // A \label immediately after the heading names THIS section — the
      // idiom every LaTeX document uses.
      const trailing = readTrailingLabel(code, args.end, to);
      const id = trailing ?? slugAnchor(text);
      out.push({ t: "section", level, title, id, number, line });
      ctx.doc.anchors.push({
        id,
        kind: trailing ? "label" : "section",
        title: text,
        line,
        ...(number ? { number } : {}),
      });
      if (trailing) ctx.doc.labels.add(trailing);
      // The slug is ALWAYS addressable too, so `[[Paper#introduction]]` works
      // whether or not the author wrote a \label. Same anchor space, two names.
      if (trailing && slugAnchor(text) !== trailing) {
        ctx.doc.anchors.push({
          id: slugAnchor(text),
          kind: "section",
          title: text,
          line,
          ...(number ? { number } : {}),
        });
      }
      i = trailing === null ? args.end : skipPastLabel(code, args.end, to);
      paraStart = i;
      continue;
    }

    // ── block-level commands ───────────────────────────────────────────────
    if (cs.name === "appendix") {
      breakPara();
      ctx.counters.startAppendix();
      i = cs.end;
      continue;
    }
    if (cs.name === "maketitle") {
      breakPara();
      if (titleMeta?.titleInline) {
        out.push({
          t: "titleblock",
          title: titleMeta.titleInline,
          author: titleMeta.author,
          date: titleMeta.date,
          line: ctx.lineAt(i),
        });
      }
      i = cs.end;
      continue;
    }
    if (cs.name === "tableofcontents") {
      breakPara();
      out.push({ t: "toc", line: ctx.lineAt(i) });
      i = cs.end;
      continue;
    }
    if (cs.name === "hrule" || cs.name === "rule") {
      breakPara();
      const args = readArgs(code, cs.end, cs.name === "rule" ? 2 : 0);
      out.push({ t: "rule", line: ctx.lineAt(i) });
      i = args.end;
      continue;
    }
    if (cs.name === "input" || cs.name === "include" || cs.name === "subfile") {
      breakPara();
      const args = readArgs(code, cs.end, 1);
      const target = (args.args[0] ?? "").trim();
      const line = ctx.lineAt(i);
      if (target) {
        out.push({ t: "transclude", target, line });
        // The CONTEXT is the target, not the source line: a backlinks card is
        // one of the surfaces CONTRACTS forbids raw syntax in, and
        // `\input{chapters/intro}` is raw syntax.
        ctx.doc.links.push({ kind: "input", target, anchor: null, line, context: target });
      }
      i = args.end;
      paraStart = i;
      continue;
    }
    if (cs.name === "bibliography" || cs.name === "printbibliography" || cs.name === "bibliographystyle") {
      breakPara();
      const args = readArgs(code, cs.end, cs.name === "printbibliography" ? 0 : 1);
      i = args.end;
      continue;
    }
    if (
      cs.name === "newcommand" || cs.name === "renewcommand" || cs.name === "providecommand" ||
      cs.name === "newcommand*" || cs.name === "renewcommand*" ||
      cs.name === "def" || cs.name === "newtheorem" || cs.name === "newenvironment" ||
      cs.name === "usepackage" || cs.name === "documentclass" || cs.name === "vellum" ||
      cs.name === "title" || cs.name === "author" || cs.name === "date" ||
      cs.name === "setlength" || cs.name === "geometry" || cs.name === "pagestyle" ||
      cs.name === "bibliographystyle" || cs.name === "hypersetup" || cs.name === "graphicspath"
    ) {
      // Preamble furniture that can legitimately appear in the body: consumed
      // silently, never printed. (`\newcommand` was already harvested.)
      i = skipCommandArgs(code, cs, to);
      continue;
    }

    // Display math openers.
    if (cs.name === "[") {
      breakPara();
      const close = findDelim(code, cs.end, "\\]", to);
      const tex = code.slice(cs.end, close.at).trim();
      out.push(mathBlock(tex, null, ctx, ctx.lineAt(i)));
      i = close.end;
      paraStart = i;
      continue;
    }

    // Everything else joins the paragraph and is dealt with inline.
    if (paraBuf === "") paraStart = i;
    paraBuf += code.slice(i, cs.end);
    i = cs.end;
  }
  flushPara();
  return out;
}

/** Consume a command's optional and brace arguments without interpreting them. */
function skipCommandArgs(code: string, cs: { name: string; end: number }, to: number): number {
  let k = cs.end;
  // `\def\foo{...}` starts with a control sequence, not a group.
  if (cs.name === "def") {
    const next = readCs(code, skipWs(code, k));
    if (next) k = next.end;
  }
  for (;;) {
    const ws = skipWs(code, k);
    if (ws >= to) return Math.min(ws, to);
    if (code[ws] === "[") {
      const o = readOptional(code, ws);
      if (!o) return k;
      k = o.end;
      continue;
    }
    if (code[ws] === "{") {
      k = readGroup(code, ws).end;
      continue;
    }
    return k;
  }
}

/** A `\label{...}` sitting immediately after a heading (whitespace only in
 *  between), or null. */
function readTrailingLabel(code: string, from: number, to: number): string | null {
  const k = skipWs(code, from);
  if (k >= to || !code.startsWith("\\label", k)) return null;
  const args = readArgs(code, k + 6, 1);
  const label = (args.args[0] ?? "").trim();
  return label || null;
}

function skipPastLabel(code: string, from: number, to: number): number {
  const k = skipWs(code, from);
  if (k >= to || !code.startsWith("\\label", k)) return from;
  return readArgs(code, k + 6, 1).end;
}

/** Find the matching `\end{env}`, honoring nesting. Returns the inner span and
 *  the offset just past the closing tag. */
function envSpan(code: string, from: number, env: string, to: number): { inner: number; outer: number } {
  const beginTok = `\\begin{${env}}`;
  const endTok = `\\end{${env}}`;
  let depth = 1;
  let i = from;
  while (i < to) {
    const nextEnd = code.indexOf(endTok, i);
    if (nextEnd === -1 || nextEnd >= to) break;
    const nextBegin = code.indexOf(beginTok, i);
    if (nextBegin !== -1 && nextBegin < nextEnd) {
      depth++;
      i = nextBegin + beginTok.length;
      continue;
    }
    depth--;
    if (depth === 0) return { inner: nextEnd, outer: nextEnd + endTok.length };
    i = nextEnd + endTok.length;
  }
  return { inner: to, outer: to };
}

/** Turn a display-math environment into ONE renderable block.
 *
 *  Numbering is Vellum's, not KaTeX's, and that is not a preference: KaTeX
 *  restarts its counter at 1 for every `renderToString` call, so a paper with
 *  four numbered equations rendered block-by-block would print "(1)" four
 *  times and every `\eqref` would point at the wrong one. So the counter lives
 *  in this parser, and the number is handed to KaTeX as an explicit `\tag{n}`
 *  — which KaTeX places exactly where amsmath does, per row inside `align*`
 *  and `gather*` included.
 *
 *  Unstarred `align`/`gather` therefore render through their STARRED form with
 *  one injected tag per row: same layout, our numbers. */
function mathBlock(tex: string, envName: string | null, ctx: Ctx, line: number): Block {
  const bare = envName === null ? null : envName.replace(/\*$/, "");
  const starred = envName !== null && envName.endsWith("*");
  const unnumbered =
    envName === null || starred || bare === "displaymath" || bare === "aligned" ||
    bare === "gathered" || bare === "split" || bare === "cases" || bare === "array" ||
    NEVER_NUMBERED.has(bare ?? "");

  // Row-numbered families: one number per line of the environment.
  const rowNumbered = bare !== null && ROW_NUMBERED.has(bare);
  let body = tex;
  let number: string | null = null;
  const labels: { id: string; number: string }[] = [];

  if (rowNumbered) {
    const rows = splitMathRows(tex);
    const tagged: string[] = [];
    for (const row of rows) {
      const rowLabels = allLabels(row);
      const skip = unnumbered || /\\(?:nonumber|notag)\b/.test(row);
      const n = skip ? null : ctx.counters.nextEquation();
      if (n !== null) {
        for (const id of rowLabels) labels.push({ id, number: n });
        if (number === null) number = n;
      }
      const clean = stripMathMarkup(row);
      tagged.push(n === null ? clean : `${clean}\\tag{${n}}`);
    }
    // The starred form never numbers on its own, so our tags are the only
    // numbers in the output — no double "(1)" beside "(1)".
    const target = starredForm(bare ?? "align");
    body = `\\begin{${target}}${tagged.join("\\\\")}\\end{${target}}`;
    if (labels.length === 0 && !unnumbered && number !== null) {
      for (const id of allLabels(tex)) labels.push({ id, number });
    }
  } else {
    const skip = unnumbered || /\\(?:nonumber|notag)\b/.test(tex);
    number = skip ? null : ctx.counters.nextEquation();
    for (const id of allLabels(tex)) {
      if (number !== null) labels.push({ id, number });
    }
    const inner = stripMathMarkup(tex);
    // Sub-environments (aligned, cases, matrices…) written at top level keep
    // their wrapper; equation/displaymath do not need one at all.
    const keepEnv = bare !== null && KATEX_SUBENVS.has(bare) ? envName : null;
    const wrapped = keepEnv === null ? inner : `\\begin{${keepEnv}}${inner}\\end{${keepEnv}}`;
    body = number === null ? wrapped : `${wrapped}\\tag{${number}}`;
  }

  // Register every label this block defines, each with ITS OWN number — an
  // `align` with three labelled rows is three anchors, not one.
  const seen = new Set<string>();
  for (const { id, number: n } of labels) {
    if (seen.has(id)) continue;
    seen.add(id);
    ctx.doc.labels.add(id);
    ctx.doc.anchors.push({ id, kind: "equation", title: `(${n})`, line, number: n });
  }
  // An unlabelled numbered equation is still addressable, by its number.
  const id = labels[0]?.id ?? (number !== null ? `eq-${number}` : null);
  if (id !== null && !seen.has(id) && number !== null) {
    ctx.doc.anchors.push({ id, kind: "equation", title: `(${number})`, line, number });
  }
  return { t: "math", tex: body.trim(), number, id, line };
}

/** Environments amsmath numbers per ROW. */
const ROW_NUMBERED = new Set(["align", "gather", "flalign", "alignat", "eqnarray", "IEEEeqnarray"]);

/** Environments that never carry a number, whatever the star. */
const NEVER_NUMBERED = new Set(["matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "Bmatrix", "smallmatrix", "subarray", "CD"]);

/** Sub-environments KaTeX must keep as a wrapper (they are layout, not a
 *  numbered display). */
const KATEX_SUBENVS = new Set(["aligned", "gathered", "split", "cases", "dcases", "rcases", "array", "darray", "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "Bmatrix", "smallmatrix", "subarray", "CD", "multline", "alignat"]);

/** The starred twin of a numbered environment — the form KaTeX renders WITHOUT
 *  adding numbers of its own. */
function starredForm(env: string): string {
  if (env === "eqnarray" || env === "IEEEeqnarray") return "aligned";
  return `${env}*`;
}

/** Split display math on top-level `\\`, the row separator. */
function splitMathRows(tex: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "\\" && tex[i + 1] === "\\" && depth === 0) {
      out.push(tex.slice(start, i));
      i++;
      const o = readOptional(tex, i + 1);
      if (o) i = o.end - 1;
      start = i + 1;
    } else if (c === "\\") i++;
  }
  const tail = tex.slice(start);
  if (tail.trim() !== "" || out.length === 0) out.push(tail);
  return out;
}

/** Markup that belongs to the DOCUMENT rather than to the formula: labels are
 *  anchors (already harvested), `\nonumber` is a numbering instruction, and
 *  KaTeX understands neither. */
function stripMathMarkup(tex: string): string {
  return tex
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\\(?:nonumber|notag)\b/g, "")
    .trim();
}

function firstLabel(tex: string): string | null {
  const m = /\\label\s*\{([^}]*)\}/.exec(tex);
  return m ? m[1].trim() || null : null;
}

/** All `\label{…}` values in a span, in order. */
function allLabels(tex: string): string[] {
  const out: string[] = [];
  const re = /\\label\s*\{([^}]*)\}/g;
  for (let m = re.exec(tex); m !== null; m = re.exec(tex)) {
    const v = m[1].trim();
    if (v) out.push(v);
  }
  return out;
}

function parseEnvironment(
  env: string,
  code: string,
  argsFrom: number,
  inner: number,
  _outer: number,
  ctx: Ctx,
  depth: number,
): Block[] | null {
  const line = ctx.lineAt(argsFrom);
  const bare = env.replace(/\*$/, "");

  if (DROPPED_ENVS.has(bare)) return [];

  if (VERBATIM_ENVS.has(env) || VERBATIM_ENVS.has(bare)) {
    const opt = readOptional(code, skipWs(code, argsFrom));
    const langArg = readArgs(code, argsFrom, bare === "minted" ? 1 : 0);
    const bodyFrom = bare === "minted" ? langArg.end : (opt?.end ?? argsFrom);
    const lang =
      bare === "minted"
        ? (langArg.args[0] ?? "").trim() || null
        : /language\s*=\s*\{?([A-Za-z+#-]+)/.exec(opt?.body ?? "")?.[1] ?? null;
    return [{ t: "code", text: stripLeadingNewline(code.slice(bodyFrom, inner)), lang, line }];
  }

  if (DISPLAY_MATH_ENVS.has(env)) {
    return [mathBlock(code.slice(argsFrom, inner), env, ctx, line)];
  }

  if (LIST_ENVS.has(env)) {
    const opt = readOptional(code, skipWs(code, argsFrom));
    return [parseList(code, opt?.end ?? argsFrom, inner, bare, ctx, depth, line)];
  }

  if (QUOTE_ENVS.has(bare)) {
    return [{ t: "quote", c: parseBlocks(code, argsFrom, inner, ctx, undefined, depth + 1), line }];
  }

  if (CENTER_ENVS.has(bare)) {
    return [{ t: "center", c: parseBlocks(code, argsFrom, inner, ctx, undefined, depth + 1), line }];
  }

  if (bare === "abstract") {
    return [{ t: "abstract", c: parseBlocks(code, argsFrom, inner, ctx, undefined, depth + 1), line }];
  }

  if (bare === "figure" || bare === "subfigure" || bare === "wrapfigure" || bare === "SCfigure") {
    return [parseFigure(code, argsFrom, inner, ctx, line)];
  }

  if (bare === "table" || bare === "sidewaystable") {
    return [parseTableFloat(code, argsFrom, inner, ctx, depth, line)];
  }

  if (bare === "tabular" || bare === "tabularx" || bare === "longtable" || bare === "tabulary") {
    const spec = readArgs(code, argsFrom, bare === "tabularx" ? 2 : 1);
    return [parseTabular(code, spec.end, inner, spec.args[spec.args.length - 1] ?? "", ctx, line)];
  }

  if (bare === "thebibliography") {
    const args = readArgs(code, argsFrom, 1);
    return [parseBibliography(code, args.end, inner, ctx, line)];
  }

  if (THEOREM_ENVS.has(bare)) {
    const opt = readOptional(code, skipWs(code, argsFrom));
    const bodyFrom = opt?.end ?? argsFrom;
    const body = code.slice(bodyFrom, inner);
    const label = firstLabel(body);
    const numbered = bare !== "proof";
    const number = numbered ? ctx.counters.nextTheorem(bare) : null;
    const id = label ?? null;
    if (id) {
      ctx.doc.labels.add(id);
      ctx.doc.anchors.push({
        id,
        kind: "theorem",
        title: opt ? inlineText(parseInline(opt.body, ctx)) : bare,
        line,
        ...(number ? { number } : {}),
      });
    }
    return [
      {
        t: "theorem",
        env: bare,
        title: opt ? parseInline(opt.body, ctx) : null,
        number,
        id,
        c: parseBlocks(code, bodyFrom, inner, ctx, undefined, depth + 1),
        line,
      },
    ];
  }

  if (bare === "document") {
    return parseBlocks(code, argsFrom, inner, ctx, undefined, depth + 1);
  }

  // Unknown environment: its BODY still reads as blocks. Swallowing it would
  // hide real writing behind one unrecognized wrapper.
  return [
    {
      t: "unknownEnv",
      name: bare,
      c: parseBlocks(code, argsFrom, inner, ctx, undefined, depth + 1),
      line,
    },
  ];
}

function stripLeadingNewline(text: string): string {
  return text.replace(/^\n/, "").replace(/\n[ \t]*$/, "");
}

function parseList(
  code: string,
  from: number,
  to: number,
  env: string,
  ctx: Ctx,
  depth: number,
  line: number,
): Block {
  const ordered = env.startsWith("enumerate") || env === "compactenum";
  const description = env === "description";
  const items: { term: Inline[] | null; c: Block[] }[] = [];
  // Split on top-level \item, skipping any nested environment's own items.
  const points: { at: number; term: string | null; bodyFrom: number }[] = [];
  let i = from;
  let envDepth = 0;
  while (i < to) {
    if (code[i] === "\\") {
      if (code.startsWith("\\begin{", i)) {
        envDepth++;
        i += 7;
        continue;
      }
      if (code.startsWith("\\end{", i)) {
        envDepth--;
        i += 5;
        continue;
      }
      if (envDepth === 0 && code.startsWith("\\item", i) && !/^[a-zA-Z]/.test(code[i + 5] ?? "")) {
        const after = i + 5;
        const opt = description ? readOptional(code, skipWs(code, after)) : readOptional(code, after);
        points.push({ at: i, term: opt?.body ?? null, bodyFrom: opt?.end ?? after });
        i = opt?.end ?? after;
        continue;
      }
      i += 2;
      continue;
    }
    i++;
  }
  for (let k = 0; k < points.length; k++) {
    const stop = k + 1 < points.length ? points[k + 1].at : to;
    items.push({
      term: points[k].term === null ? null : parseInline(points[k].term ?? "", ctx),
      c: parseBlocks(code, points[k].bodyFrom, stop, ctx, undefined, depth + 1),
    });
  }
  return { t: "list", ordered, items, line };
}

/** `[width=0.8\linewidth]` → a CSS width. One implementation, because the
 *  float and the bare `\includegraphics` are the same command. */
function graphicWidth(opts: string | null | undefined): string | null {
  const wm = /width\s*=\s*([0-9.]+)\s*\\(?:line|text|column)width/.exec(opts ?? "");
  if (wm) return `${Math.min(100, Math.round(Number(wm[1]) * 100))}%`;
  const px = /width\s*=\s*([0-9.]+)\s*(cm|mm|in|pt|px)/.exec(opts ?? "");
  return px ? `${px[1]}${px[2] === "px" ? "px" : px[2]}` : null;
}

function parseFigure(code: string, from: number, to: number, ctx: Ctx, line: number): Block {
  const body = code.slice(from, to);
  const gm = /\\includegraphics\s*(\[[^\]]*\])?\s*\{/.exec(body);
  let graphic: string | null = null;
  let width: string | null = null;
  if (gm) {
    const g = readGroup(body, gm.index + gm[0].length - 1);
    graphic = g.body.trim() || null;
    width = graphicWidth(gm[1]);
  }
  if (graphic) ctx.doc.graphics.push(graphic);
  const cap = /\\caption\s*(\[[^\]]*\])?\s*\{/.exec(body);
  const caption = cap ? parseInline(readGroup(body, cap.index + cap[0].length - 1).body, ctx) : null;
  const label = firstLabel(body);
  const number = ctx.counters.nextFigure();
  const id = label ?? `fig-${number}`;
  if (label) ctx.doc.labels.add(label);
  ctx.doc.anchors.push({
    id,
    kind: "figure",
    title: caption ? inlineText(caption) : `${number}`,
    line,
    number,
  });
  return { t: "figure", graphic, width, caption, id, number, line };
}

function parseTableFloat(
  code: string,
  from: number,
  to: number,
  ctx: Ctx,
  depth: number,
  line: number,
): Block {
  const body = code.slice(from, to);
  const cap = /\\caption\s*(\[[^\]]*\])?\s*\{/.exec(body);
  const caption = cap ? parseInline(readGroup(body, cap.index + cap[0].length - 1).body, ctx) : null;
  const label = firstLabel(body);
  const number = ctx.counters.nextTable();
  const id = label ?? `tab-${number}`;
  if (label) ctx.doc.labels.add(label);
  ctx.doc.anchors.push({
    id,
    kind: "table",
    title: caption ? inlineText(caption) : `${number}`,
    line,
    number,
  });
  // The float's own tabular becomes the table's rows; anything else in the
  // float (a \centering, a note) is dropped — a float is a caption plus a grid.
  const tabStart = body.search(/\\begin\{tabular[xy]?\*?\}|\\begin\{longtable\}/);
  if (tabStart === -1) {
    return { t: "table", head: null, rows: [], align: [], caption, id, number, line };
  }
  const absStart = from + tabStart;
  const nameEnd = code.indexOf("}", absStart + 7);
  const env = code.slice(absStart + 7, nameEnd);
  const span = envSpan(code, nameEnd + 1, env, to);
  const spec = readArgs(code, nameEnd + 1, env === "tabularx" ? 2 : 1);
  const inner = parseTabular(code, spec.end, span.inner, spec.args[spec.args.length - 1] ?? "", ctx, line);
  if (inner.t !== "table") return { t: "table", head: null, rows: [], align: [], caption, id, number, line };
  return { ...inner, caption, id, number, line };
}

function parseTabular(
  code: string,
  from: number,
  to: number,
  spec: string,
  ctx: Ctx,
  line: number,
): Block {
  const align: ("l" | "c" | "r")[] = [];
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    if (c === "l" || c === "c" || c === "r") align.push(c);
    else if (c === "p" || c === "m" || c === "b" || c === "X") {
      align.push("l");
      if (spec[i + 1] === "{") i = readGroup(spec, i + 1).end - 1;
    } else if (c === "{") i = readGroup(spec, i).end - 1;
  }

  const body = code.slice(from, to);
  // Rules are structure, not content.
  const cleaned = body
    .replace(/\\(?:hline|toprule|midrule|bottomrule|endhead|endfoot|endfirsthead|endlastfoot)\b/g, "")
    .replace(/\\cline\s*\{[^}]*\}/g, "")
    .replace(/\\cmidrule\s*(?:\([^)]*\))?\s*\{[^}]*\}/g, "");
  const rawRows = splitRows(cleaned);
  const rows: TableCell[][] = [];
  for (const raw of rawRows) {
    if (raw.trim() === "") continue;
    const cells: TableCell[] = [];
    for (const cell of splitTopLevel(raw, "&")) {
      const mc = /^\s*\\multicolumn\s*\{(\d+)\}/.exec(cell);
      if (mc) {
        const args = readArgs(cell, mc.index + mc[0].length, 2);
        cells.push({ c: parseInline(args.args[1] ?? "", ctx), span: Number(mc[1]) || 1 });
      } else {
        cells.push({ c: parseInline(cell, ctx), span: 1 });
      }
    }
    if (cells.length > 0) rows.push(cells);
  }
  // A `\hline` under the first row is the usual header cue, but plenty of
  // tables have none; the first row reads as the header either way, which is
  // what a reader expects from a grid.
  const head = rows.length > 1 ? rows[0] : null;
  return {
    t: "table",
    head,
    rows: head ? rows.slice(1) : rows,
    align,
    caption: null,
    id: null,
    number: null,
    line,
  };
}

/** Split tabular rows on `\\` that is not inside a group. */
function splitRows(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "\\" && s[i + 1] === "\\" && depth === 0) {
      out.push(s.slice(start, i));
      i++;
      // `\\[2ex]` spacing argument
      const o = readOptional(s, i + 1);
      if (o) i = o.end - 1;
      start = i + 1;
    } else if (c === "\\") i++;
  }
  out.push(s.slice(start));
  return out;
}

function parseBibliography(code: string, from: number, to: number, ctx: Ctx, line: number): Block {
  const items: { key: string; label: string | null; c: Inline[] }[] = [];
  const re = /\\bibitem\s*(\[[^\]]*\])?\s*\{([^}]*)\}/g;
  const body = code.slice(from, to);
  const marks: { at: number; end: number; key: string; label: string | null }[] = [];
  for (let m = re.exec(body); m !== null; m = re.exec(body)) {
    marks.push({
      at: m.index,
      end: m.index + m[0].length,
      key: m[2].trim(),
      label: m[1] ? m[1].slice(1, -1) : null,
    });
  }
  for (let k = 0; k < marks.length; k++) {
    const stop = k + 1 < marks.length ? marks[k + 1].at : body.length;
    items.push({
      key: marks[k].key,
      label: marks[k].label,
      c: parseInline(body.slice(marks[k].end, stop), ctx),
    });
    if (marks[k].key) ctx.doc.citekeys.push(marks[k].key);
  }
  return { t: "bib", items, line };
}

// ── Inline parsing ──────────────────────────────────────────────────────────

const STYLE_COMMANDS: Record<string, "em" | "strong" | "tt" | "sc" | "u" | "sf"> = {
  emph: "em", textit: "em", textsl: "em", itshape: "em", em: "em",
  textbf: "strong", bfseries: "strong", strong: "strong",
  texttt: "tt", ttfamily: "tt", verb: "tt", lstinline: "tt",
  textsc: "sc", scshape: "sc",
  underline: "u", uline: "u",
  textsf: "sf", sffamily: "sf",
};

const TRANSPARENT_COMMANDS = new Set([
  "text", "textnormal", "textrm", "mbox", "hbox", "textup", "textmd",
  "mathrm", "normalfont", "protect", "relax", "noindent", "indent",
  "centering", "raggedright", "raggedleft", "small", "footnotesize",
  "scriptsize", "tiny", "large", "Large", "LARGE", "huge", "Huge",
  "normalsize", "boldmath", "unboldmath", "sloppy", "frenchspacing",
  "ensuremath", "phantom", "hphantom", "vphantom", "makeatletter", "makeatother",
]);

/** Commands whose arguments are layout instructions, not prose. */
const SWALLOWED_COMMANDS: Record<string, number> = {
  vspace: 1, hspace: 1, vskip: 0, hskip: 0, hfill: 0, vfill: 0, hrulefill: 0,
  clearpage: 0, newpage: 0, pagebreak: 0, linebreak: 0, nolinebreak: 0,
  bigskip: 0, medskip: 0, smallskip: 0, noalign: 1, setcounter: 2,
  addtocounter: 2, label: 1, index: 1, nocite: 1, addcontentsline: 3,
  markboth: 2, markright: 1, thispagestyle: 1, captionsetup: 1, caption: 1,
  // `includegraphics` is NOT here. It was, and the cost was silent: the
  // command was consumed with its argument, so a picture outside a `figure`
  // rendered as nothing at all AND never reached `doc.graphics`, which is
  // what the publish allowlist is built from — so every reader of the
  // published note got a 404 for a file the author could see.
  centerline: 1, allowbreak: 0, sloppypar: 0, par: 0,
};

const CITE_COMMANDS = new Set([
  "cite", "citep", "citet", "citealp", "citealt", "citeauthor", "citeyear",
  "citeyearpar", "parencite", "textcite", "autocite", "footcite", "supercite",
  "Citep", "Citet", "Cite",
]);

const REF_COMMANDS = new Set([
  "ref", "eqref", "pageref", "autoref", "cref", "Cref", "cpageref", "vref",
  "nameref", "labelcref",
]);

/** Parse a run of TeX in text mode. */
function parseInline(src: string, ctx: Ctx, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = (): void => {
    if (buf === "") return;
    out.push({ t: "text", v: typography(buf) });
    buf = "";
  };
  const push = (node: Inline): void => {
    flush();
    out.push(node);
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "$") {
      const display = src[i + 1] === "$";
      const delim = display ? "$$" : "$";
      const close = findDollar(src, i + delim.length, display);
      const tex = src.slice(i + delim.length, close.at);
      push(display ? { t: "math", tex: tex.trim(), display: true } : { t: "math", tex: tex.trim() });
      i = close.end;
      continue;
    }

    if (ch === "{") {
      // A bare group: usually a scope for a declaration like {\bf …}.
      const g = readGroup(src, i);
      const inner = depth < MAX_ENV_DEPTH ? parseInline(g.body, ctx, depth + 1) : [];
      for (const n of inner) push(n);
      i = g.end;
      continue;
    }
    if (ch === "}") {
      i++;
      continue;
    }

    if (ch === "\n") {
      buf += " ";
      i++;
      continue;
    }

    if (ch !== "\\") {
      buf += ch;
      i++;
      continue;
    }

    const cs = readCs(src, i);
    if (!cs) {
      buf += ch;
      i++;
      continue;
    }
    const name = cs.name;

    // `\\` — a hard line break.
    if (name === "\\") {
      const o = readOptional(src, cs.end);
      push({ t: "br" });
      i = o?.end ?? cs.end;
      continue;
    }
    // `\(` … `\)` inline math.
    if (name === "(") {
      const close = findDelim(src, cs.end, "\\)", src.length);
      push({ t: "math", tex: src.slice(cs.end, close.at).trim() });
      i = close.end;
      continue;
    }
    // `\[` … `\]` inside a paragraph still reads as math.
    if (name === "[") {
      const close = findDelim(src, cs.end, "\\]", src.length);
      push({ t: "math", tex: src.slice(cs.end, close.at).trim() });
      i = close.end;
      continue;
    }

    // Vellum's own link macro.
    if (name === "note") {
      const args = readArgs(src, cs.end, 1);
      // `#` is a macro-parameter character in TeX, so the anchor separator has
      // to be written `\#` for the file to compile — unescape FIRST, then
      // split, so `\note{Paper\#eq:fourier}` and `\note{Paper#eq:fourier}`
      // mean the same thing and neither leaves a stray backslash on the title.
      const raw = unescapeTex(args.args[0] ?? "").trim();
      if (raw) {
        const hash = raw.indexOf("#");
        push({
          t: "link",
          target: (hash >= 0 ? raw.slice(0, hash) : raw).trim(),
          anchor: hash >= 0 ? raw.slice(hash + 1).trim() : null,
          label: args.opt === null ? null : inlineText(parseInline(args.opt, ctx, depth + 1)),
          via: "note",
        });
      }
      i = args.end;
      continue;
    }

    if (CITE_COMMANDS.has(name)) {
      const args = readArgs(src, cs.end, 1);
      const keys = splitTopLevel(args.args[0] ?? "", ",");
      push({ t: "cite", keys, note: args.opt });
      i = args.end;
      continue;
    }

    if (REF_COMMANDS.has(name)) {
      const args = readArgs(src, cs.end, 1);
      const key = (args.args[0] ?? "").trim();
      if (key) push({ t: "ref", key, eq: name === "eqref" });
      i = args.end;
      continue;
    }

    if (name === "url") {
      const args = readArgs(src, cs.end, 1);
      push({ t: "url", href: (args.args[0] ?? "").trim(), label: null });
      i = args.end;
      continue;
    }
    if (name === "href") {
      const args = readArgs(src, cs.end, 2);
      push({
        t: "url",
        href: (args.args[0] ?? "").trim(),
        label: inlineText(parseInline(args.args[1] ?? "", ctx, depth + 1)),
      });
      i = args.end;
      continue;
    }

    if (name === "footnote" || name === "footnotetext") {
      const args = readArgs(src, cs.end, 1);
      const c = parseInline(args.args[0] ?? "", ctx, depth + 1);
      ctx.doc.footnotes.push(c);
      push({ t: "footnote", n: ctx.doc.footnotes.length });
      i = args.end;
      continue;
    }

    if (name === "label") {
      const args = readArgs(src, cs.end, 1);
      const id = (args.args[0] ?? "").trim();
      if (id) {
        ctx.doc.labels.add(id);
        push({ t: "anchor", id });
      }
      i = args.end;
      continue;
    }

    if (name in STYLE_COMMANDS) {
      const style = STYLE_COMMANDS[name];
      if (name === "verb" || name === "lstinline") {
        const delim = src[cs.end];
        const end = src.indexOf(delim, cs.end + 1);
        push({ t: "style", s: "tt", c: [{ t: "text", v: src.slice(cs.end + 1, end === -1 ? src.length : end) }] });
        i = end === -1 ? src.length : end + 1;
        continue;
      }
      const args = readArgs(src, cs.end, 1);
      if (args.args.length === 0) {
        // A declaration form (`{\bfseries …}`): style the rest of this group.
        const rest = parseInline(src.slice(args.end), ctx, depth + 1);
        push({ t: "style", s: style, c: rest });
        i = src.length;
        continue;
      }
      push({ t: "style", s: style, c: parseInline(args.args[0], ctx, depth + 1) });
      i = args.end;
      continue;
    }

    if (TRANSPARENT_COMMANDS.has(name)) {
      const args = readArgs(src, cs.end, 1);
      if (args.args.length > 0) {
        for (const n of parseInline(args.args[0], ctx, depth + 1)) push(n);
        i = args.end;
      } else {
        i = csEnd(src, cs);
      }
      continue;
    }

    // A picture that is not a float. `parseFigure` handles the one inside
    // `\begin{figure}`; every other place graphicx is legal — bare in a
    // paragraph, in `center`, `minipage`, `wrapfigure`, a table cell — lands
    // here, and both halves matter: the NAME goes into `doc.graphics` so the
    // caller can allowlist the file, and the node renders so the reader sees
    // the picture instead of a gap.
    if (name === "includegraphics") {
      const args = readArgs(src, cs.end, 1);
      const target = (args.args[0] ?? "").trim();
      if (target) {
        ctx.doc.graphics.push(target);
        push({ t: "graphic", name: target, width: graphicWidth(args.opt) });
      }
      i = args.end;
      continue;
    }

    if (name in SWALLOWED_COMMANDS) {
      const args = readArgs(src, cs.end, SWALLOWED_COMMANDS[name]);
      i = args.end;
      continue;
    }

    if (name in SYMBOLS) {
      buf += SYMBOLS[name];
      i = csEnd(src, cs);
      continue;
    }

    if (name in ACCENTS) {
      let k = skipWs(src, cs.end);
      let base = "";
      if (src[k] === "{") {
        const g = readGroup(src, k);
        base = g.body;
        k = g.end;
      } else if (k < src.length) {
        // `\i` / `\j` lose their dot under an accent, exactly as in TeX.
        const nested = readCs(src, k);
        if (nested && (nested.name === "i" || nested.name === "j")) {
          base = nested.name === "i" ? "i" : "j";
          k = nested.end;
        } else {
          base = src[k];
          k++;
        }
      }
      buf += (base + ACCENTS[name]).normalize("NFC");
      i = k;
      continue;
    }

    // A user macro: substitute its body and re-read. Budgeted, so a macro that
    // expands to itself stops instead of hanging the tab.
    const macro = ctx.macros.get(name.replace(/\*$/, ""));
    if (macro && depth < MAX_MACRO_DEPTH && ctx.expansions.n < MAX_MACRO_EXPANSIONS) {
      ctx.expansions.n++;
      const args = readArgs(src, cs.end, macro.argc);
      let body = macro.body;
      const actual = [macro.opt !== null ? (args.opt ?? macro.opt) : null, ...args.args].filter(
        (a): a is string => a !== null,
      );
      for (let a = actual.length; a >= 1; a--) {
        body = body.split(`#${a}`).join(actual[a - 1] ?? "");
      }
      for (const n of parseInline(body, ctx, depth + 1)) push(n);
      i = args.end;
      continue;
    }

    // Unimplemented. A quiet marker — never the raw source, and never more
    // than MAX_UNKNOWN_MARKERS of them: `\newcommand{\boom}{\boom\boom}`
    // terminates correctly on the expansion budget and used to leave ~4,000
    // `·` markers behind in the rendered page. The budget stopped the hang; it
    // did not stop the garbage, and a page of dots is not a more honest answer
    // than a page with the first few.
    if (ctx.unknowns.n < MAX_UNKNOWN_MARKERS) {
      ctx.unknowns.n++;
      push({ t: "unknown", name });
    }
    const consumed = skipCommandArgs(src, cs, src.length);
    i = consumed === cs.end ? csEnd(src, cs) : consumed;
  }
  flush();
  return out;
}

/** LaTeX escapes → the characters they stand for. A note title is ordinary
 *  text, but TeX makes seven of its characters special, so `\note{Wikilinks \&
 *  Backlinks}` is how you WRITE that title in a file that must compile — and
 *  the ampersand has to come back before the name is resolved, or the link
 *  points at a note called "Wikilinks \& Backlinks" that does not exist. */
export function unescapeTex(text: string): string {
  return text.replace(/\\([&%$#_{}])/g, "$1");
}

/** Closing `$`/`$$` that is not escaped. */
function findDollar(s: string, from: number, display: boolean): { at: number; end: number } {
  for (let i = from; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "$") {
      if (display) {
        if (s[i + 1] === "$") return { at: i, end: i + 2 };
        continue;
      }
      return { at: i, end: i + 1 };
    }
  }
  return { at: s.length, end: s.length };
}

function findDelim(s: string, from: number, delim: string, to: number): { at: number; end: number } {
  const at = s.indexOf(delim, from);
  if (at === -1 || at > to) return { at: Math.min(to, s.length), end: Math.min(to, s.length) };
  return { at, end: at + delim.length };
}

/** Parse a fragment of TeX in text mode, standalone — for callers that hold a
 *  string rather than a document (the editor's live preview renders one line
 *  at a time). Anchors, footnotes and links found inside are discarded: a
 *  fragment has no document to register them against. */
export function parseTexInline(src: string, macros: Record<string, string> = {}): Inline[] {
  const table = new Map<string, Macro>();
  for (const [name, body] of Object.entries(macros)) {
    table.set(name.replace(/^\\/, ""), { argc: 0, body, opt: null });
  }
  const doc = emptyDocument();
  const ctx: Ctx = {
    code: src,
    lineAt: () => 1,
    macros: table,
    counters: new Counters(),
    doc,
    expansions: { n: 0 },
    blocks: { n: 0 },
    unknowns: { n: 0 },
  };
  return parseInline(src, ctx);
}

function emptyDocument(): TexDocument {
  return {
    frontmatter: "",
    vellum: {},
    blocks: [],
    anchors: [],
    links: [],
    citekeys: [],
    graphics: [],
    footnotes: [],
    macros: {},
    title: null,
    labels: new Set(),
  };
}

// ── Derived views ───────────────────────────────────────────────────────────

/** Inline nodes → plain text (titles, captions, anchor titles, alt text). */
export function inlineText(nodes: Inline[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        out += n.v;
        break;
      case "style":
        out += inlineText(n.c);
        break;
      case "math":
        // Math is not prose; its control sequences would poison a search index
        // and a language guess alike. Only the literal words inside it survive.
        out += ` ${n.tex.replace(/\\[a-zA-Z@]+/g, " ").replace(/[{}^_$&#\\]/g, " ")} `;
        break;
      case "link":
        out += n.label ?? n.target;
        break;
      case "url":
        out += n.label ?? "";
        break;
      case "cite":
      case "ref":
      case "footnote":
      case "anchor":
      case "graphic":
      case "unknown":
        break;
      case "br":
        out += " ";
        break;
    }
  }
  // Citations, refs and labels leave holes ("following \cite{x}." → "following
  // ."). Closing the gap before the punctuation is the difference between an
  // excerpt that reads and one that reads as damage.
  return out
    .replace(/\s+/g, " ")
    // Only TERMINAL punctuation: a period that starts a word is part of it
    // ("a .tex file"), and collapsing that space glued filenames to the word
    // before them in every excerpt that mentioned one.
    .replace(/\s+([.,;:!?])(?=\s|$)/g, "$1")
    .replace(/\s+([)\]}»”’])/g, "$1")
    .replace(/([([{«“‘])\s+/g, "$1")
    // "the maximum principle, \ref{thm:max}." collapses to ",." once the ref
    // is gone; a stranded separator reads as damage, so it goes with it.
    .replace(/[,;:]+([.!?])/g, "$1")
    .replace(/([,;:])\1+/g, "$1")
    .trim();
}

/** A parsed document → the prose a reader reads: no control sequences, no
 *  math markup, no labels, no citation keys. This is what the search index,
 *  the excerpt builder and the language detector see, and it is why a `.tex`
 *  note matches on its words instead of on `\textbf`. */
export function texProse(doc: TexDocument): string {
  const parts: string[] = [];
  const walkBlocks = (blocks: Block[]): void => {
    for (const b of blocks) {
      switch (b.t) {
        case "section":
          parts.push(`${inlineText(b.title)} —`);
          break;
        case "para":
          parts.push(inlineText(b.c));
          break;
        case "list":
          for (const item of b.items) {
            if (item.term) parts.push(inlineText(item.term));
            walkBlocks(item.c);
          }
          break;
        case "quote":
        case "center":
        case "abstract":
        case "theorem":
        case "unknownEnv":
          walkBlocks(b.c);
          break;
        case "figure":
        case "table":
          if (b.caption) parts.push(inlineText(b.caption));
          break;
        case "titleblock":
          parts.push(inlineText(b.title));
          if (b.author) parts.push(inlineText(b.author));
          break;
        case "bib":
          for (const item of b.items) parts.push(inlineText(item.c));
          break;
        case "code":
        case "math":
        case "transclude":
        case "rule":
        case "toc":
          break;
      }
    }
  };
  walkBlocks(doc.blocks);
  for (const fn of doc.footnotes) parts.push(inlineText(fn));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** The first real paragraph of a TeX document, as plain prose — the excerpt
 *  source. Abstract first when the document has one: that is what an abstract
 *  IS, and a paper whose excerpt reads "1 Introduction" helps nobody. */
export function texFirstParagraph(doc: TexDocument): string {
  const fromBlocks = (blocks: Block[]): string | null => {
    for (const b of blocks) {
      if (b.t === "para") {
        const text = inlineText(b.c);
        if (text.trim() !== "") return text;
      } else if (b.t === "abstract" || b.t === "quote" || b.t === "center" || b.t === "theorem") {
        const inner = fromBlocks(b.c);
        if (inner) return inner;
      }
    }
    return null;
  };
  for (const b of doc.blocks) {
    if (b.t === "abstract") {
      const inner = fromBlocks(b.c);
      if (inner) return inner;
    }
  }
  return fromBlocks(doc.blocks) ?? "";
}

// ── Anchors ─────────────────────────────────────────────────────────────────

/** Slug for an anchor id derived from a heading or section title. Kept
 *  byte-for-byte in step with client/reading/toc.ts's Slugger so that
 *  `[[Note#some-heading]]` addresses the same element the reading view assigns
 *  the id to — the two live apart only because this file must stay free of
 *  DOM and CodeMirror imports. */
export function slugAnchor(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
  return base || "section";
}

/** Case-insensitive anchor lookup inside a note. Matches an id first (a
 *  `\label` value, a heading slug), then an anchor's human TITLE — so
 *  `\ref{Notes on Diffusion#Derivation}` and `[[Paper#eq:fourier]]` are the
 *  same operation from opposite sides. Unresolved returns null; every caller
 *  renders that quietly. */
export function findAnchor(anchors: NoteAnchor[], want: string): NoteAnchor | null {
  const key = want.trim().toLowerCase();
  if (!key) return null;
  for (const a of anchors) if (a.id.toLowerCase() === key) return a;
  const slug = slugAnchor(want);
  for (const a of anchors) if (a.id.toLowerCase() === slug) return a;
  for (const a of anchors) if (a.title.trim().toLowerCase() === key) return a;
  return null;
}
