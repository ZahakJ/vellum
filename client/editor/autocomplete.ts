// Wikilink autocomplete: typing "[[" offers every note title in the vault,
// read live from the zustand store's tree.

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useStore } from "../state.ts";
import { collectNotes } from "./links.ts";

function applyWikilink(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
): void {
  // If closeBrackets (or the author) already supplied "]]", reuse it.
  const alreadyClosed = view.state.sliceDoc(to, to + 2) === "]]";
  const insert = completion.label + (alreadyClosed ? "" : "]]");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + completion.label.length + 2 },
    userEvent: "input.complete",
  });
}

function wikilinkSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^[\]]*$/);
  if (!match) return null;

  const notes = collectNotes(useStore.getState().tree);
  if (notes.length === 0) return null;

  const options: Completion[] = notes.map((note) => ({
    label: note.title,
    detail: note.path === `${note.title}.md` ? undefined : note.path,
    type: "text",
    apply: applyWikilink,
  }));

  return {
    from: match.from + 2, // just past "[["
    options,
    validFor: /^[^[\]]*$/,
  };
}

export function wikilinkAutocomplete(): Extension {
  return autocompletion({
    override: [wikilinkSource],
    icons: false,
    activateOnTyping: true,
  });
}
