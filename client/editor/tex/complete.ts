// Autocomplete for `.tex` notes.
//
// Markdown's `[[` completion is not the right affordance here: a LaTeX file
// that must still compile links with `\note{…}`, and its own vocabulary —
// `\ref`, `\cite`, `\begin` — is exactly what an author is reaching for. So
// the four sources below complete what a `.tex` note actually contains, and
// the two that answer with KEYS answer from the DOCUMENT, never the vault:
// local-first is the rule that keeps an imported project compiling the way it
// always did, and a completion list that offered another note's labels would
// quietly teach authors to break it.

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseTex } from "../../../shared/tex.ts";
import { stripNoteExt } from "../../../shared/noteFormat.ts";
import { useStore } from "../../state.ts";
import { collectNotes } from "../links.ts";

/** Above this, the document is scanned with a regex instead of parsed.
 *  Completion runs on every keystroke inside the braces, and a full parse of a
 *  100 KB thesis on each of them is 40 ms of latency in the one place a writer
 *  is typing fastest. The regex loses the anchor's title, not its id. */
const PARSE_BUDGET_BYTES = 64 * 1024;

/** The labels a document defines: parsed when it is small enough to afford it
 *  (so each completion carries what it points at), scanned otherwise. */
function localLabels(src: string): { id: string; detail?: string }[] {
  if (src.length <= PARSE_BUDGET_BYTES) {
    const out: { id: string; detail?: string }[] = [];
    const seen = new Set<string>();
    for (const anchor of parseTex(src).anchors) {
      if (anchor.kind === "heading" || anchor.kind === "section") continue; // slugs are not \labels
      if (seen.has(anchor.id)) continue;
      seen.add(anchor.id);
      // An equation's "title" IS its number, so the naive
      // `${title} (${number})` printed "(1) (1)" beside every one of them.
      const detail =
        anchor.number && anchor.title !== `(${anchor.number})`
          ? `${anchor.title} (${anchor.number})`
          : anchor.title;
      out.push({ id: anchor.id, detail });
    }
    return out;
  }
  const out: { id: string }[] = [];
  const seen = new Set<string>();
  const re = /\\label\s*\{([^}]*)\}/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const id = m[1].trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id });
  }
  return out;
}

/** The citation keys a document defines, under the same budget. */
function localCitekeys(src: string): string[] {
  if (src.length <= PARSE_BUDGET_BYTES) return parseTex(src).citekeys;
  const out: string[] = [];
  const re = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const key = m[1].trim();
    if (key) out.push(key);
  }
  return out;
}

/** Insert the label and close the brace unless the author already typed one. */
function applyInBrace(view: EditorView, completion: Completion, from: number, to: number): void {
  const alreadyClosed = view.state.sliceDoc(to, to + 1) === "}";
  const insert = completion.label + (alreadyClosed ? "" : "}");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + completion.label.length + 1 },
    userEvent: "input.complete",
  });
}

/** `\note{…` / `\note[alias]{…` → every note in the vault, of either format. */
function noteSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\\note(?:\[[^\]]*\])?\{[^{}]*$/);
  if (!match) return null;
  const notes = collectNotes(useStore.getState().tree);
  if (notes.length === 0) return null;
  return {
    from: match.from + match.text.lastIndexOf("{") + 1,
    options: notes.map((note) => ({
      label: note.title,
      detail: stripNoteExt(note.path) === note.title ? undefined : note.path,
      type: "text",
      apply: applyInBrace,
    })),
    validFor: /^[^{}]*$/,
  };
}

/** `\ref{…` / `\eqref{…` → the labels THIS document defines. */
function refSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref)\{[^{}]*$/);
  if (!match) return null;
  const options: Completion[] = localLabels(context.state.doc.toString()).map((label) => ({
    label: label.id,
    detail: label.detail,
    type: "text",
    apply: applyInBrace,
  }));
  if (options.length === 0) return null;
  return { from: match.from + match.text.lastIndexOf("{") + 1, options, validFor: /^[^{}]*$/ };
}

/** `\cite{…` → the keys THIS document's bibliography defines. */
function citeSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(
    /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|parencite|textcite|autocite|footcite)(?:\[[^\]]*\])?\{[^{}]*$/,
  );
  if (!match) return null;
  const keys = localCitekeys(context.state.doc.toString());
  if (keys.length === 0) return null;
  const seen = new Set<string>();
  const options: Completion[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ label: key, type: "text", apply: applyInBrace });
  }
  return { from: match.from + match.text.lastIndexOf("{") + 1, options, validFor: /^[^{}]*$/ };
}

/** The environments this reader renders. Offering only these is deliberate: a
 *  list of every environment in TeX Live would be a list of things Vellum
 *  shows as raw source. */
const ENVIRONMENTS = [
  "abstract", "align", "align*", "center", "description", "enumerate",
  "equation", "equation*", "figure", "gather", "gather*", "itemize",
  "lstlisting", "multline", "proof", "quote", "quotation", "table", "tabular",
  "thebibliography", "theorem", "lemma", "proposition", "corollary",
  "definition", "remark", "example", "verbatim",
];

/** `\begin{…` → an environment, closed with its matching `\end`. */
function environmentSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\\begin\{[^{}]*$/);
  if (!match) return null;
  return {
    from: match.from + match.text.lastIndexOf("{") + 1,
    options: ENVIRONMENTS.map((env) => ({
      label: env,
      type: "keyword",
      apply: (view: EditorView, completion: Completion, from: number, to: number) => {
        // A `\begin` without its `\end` is the single most common way to break
        // a LaTeX file, so the completion writes both and parks the caret
        // between them.
        const closed = view.state.sliceDoc(to, to + 1) === "}";
        const head = completion.label + (closed ? "" : "}");
        const insert = `${head}\n\n\\end{${completion.label}}`;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + head.length + 1 },
          userEvent: "input.complete",
        });
      },
    })),
    validFor: /^[^{}]*$/,
  };
}

const SOURCES: CompletionSource[] = [noteSource, refSource, citeSource, environmentSource];

export function texAutocomplete(): Extension {
  return autocompletion({
    override: SOURCES,
    icons: false,
    activateOnTyping: true,
  });
}
