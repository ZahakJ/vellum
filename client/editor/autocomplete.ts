// Wikilink autocomplete: typing "[[" offers every note title in the vault,
// read live from the zustand store's tree; typing "#" inside the brackets
// offers the headings of the target note ([[Note#…]] / [[#…]] for the
// current note).

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getNote } from "../api.ts";
import { Lru } from "../lru.ts";
import { useStore } from "../state.ts";
import { collectNotes, extractHeadings, resolveLink } from "./links.ts";
import {
  calloutIconRender,
  calloutTypeSource,
  fenceLanguageSource,
  slashSource,
} from "./slashMenu.ts";

/** Insert `label`, then "]]" unless the brackets are already closed. */
function applyInner(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
): void {
  const alreadyClosed = view.state.sliceDoc(to, to + 2) === "]]";
  const insert = completion.label + (alreadyClosed ? "" : "]]");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + completion.label.length + 2 },
    userEvent: "input.complete",
  });
}

// Tiny read-through cache so heading completion doesn't refetch the target
// note on every keystroke. Bounded (client/lru.ts) as well as expiring: the
// 5-second window makes the text fresh, it never made the Map small, and this
// one is keyed by whatever the author types inside `[[…#`, so its ceiling was
// the vault.
const noteCache = new Lru<string>({ max: 16, ttlMs: 5000 });

async function noteContent(path: string): Promise<string | null> {
  const cached = noteCache.get(path);
  if (cached !== undefined) return cached;
  try {
    const note = await getNote(path);
    noteCache.set(path, note.content);
    return note.content;
  } catch {
    return null;
  }
}

/** Headings of the wikilink's target note, offered after "#" inside [[ ]]. */
async function headingOptions(
  context: CompletionContext,
  target: string,
): Promise<string[] | null> {
  if (!target.trim()) {
    // [[#…]] — the note being edited.
    return extractHeadings(context.state.doc.toString());
  }
  const path = resolveLink(target, useStore.getState().tree);
  if (!path) return null;
  const content = await noteContent(path);
  return content === null ? null : extractHeadings(content);
}

async function wikilinkSource(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  // Heading mode: "[[Target#… " (cursor after the #).
  const headingMatch = context.matchBefore(/\[\[([^[\]#|]*)#[^[\]#|]*$/);
  if (headingMatch) {
    const target = /^\[\[([^[\]#|]*)#/.exec(headingMatch.text)?.[1] ?? "";
    const headings = await headingOptions(context, target);
    if (!headings || headings.length === 0) return null;
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const heading of headings) {
      if (seen.has(heading)) continue;
      seen.add(heading);
      options.push({ label: heading, type: "text", apply: applyInner });
    }
    return {
      from: headingMatch.from + headingMatch.text.lastIndexOf("#") + 1,
      options,
      validFor: /^[^[\]#|]*$/,
    };
  }

  // Note-title mode: "[[…".
  const match = context.matchBefore(/\[\[[^[\]]*$/);
  if (!match) return null;

  const notes = collectNotes(useStore.getState().tree);
  if (notes.length === 0) return null;

  const options: Completion[] = notes.map((note) => ({
    label: note.title,
    detail: note.path === `${note.title}.md` ? undefined : note.path,
    type: "text",
    apply: applyInner,
  }));

  return {
    from: match.from + 2, // just past "[["
    options,
    validFor: /^[^[\]#|]*$/,
  };
}

export function wikilinkAutocomplete(): Extension {
  return autocompletion({
    override: [
      wikilinkSource,
      calloutTypeSource,
      fenceLanguageSource,
      slashSource,
    ],
    icons: false,
    activateOnTyping: true,
    addToOptions: [{ render: calloutIconRender, position: 20 }],
  });
}
