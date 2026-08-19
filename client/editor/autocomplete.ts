// Wikilink autocomplete: typing "[[" offers every note title in the vault,
// read live from the zustand store's tree, plus every frontmatter ALIAS those
// notes declare; typing "#" inside the brackets offers the headings of the
// target note ([[Note#…]] / [[#…]] for the current note).

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
import { aliasCompletions, collectNotes, resolveLink } from "./links.ts";
import { noteAnchors } from "../../shared/anchors.ts";
import { stripNoteExt } from "../../shared/noteFormat.ts";
import { notePathFacet } from "./livePreview.ts";
import { tf } from "../i18n.ts";
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

/** ANCHORS of the wikilink's target note, offered after "#" inside [[ ]].
 *
 *  Anchors, not headings: a markdown heading and a LaTeX `\label` are the same
 *  kind of thing, so `[[Heat Equation#` completes `eq:fourier` and `fig:bar`
 *  exactly as `[[Notes#` completes `Derivation`. Without this the `#` half of
 *  autocomplete was silently markdown-only, and the one link form the whole
 *  cross-format design turns on was the one you could not complete. */
async function headingOptions(
  context: CompletionContext,
  target: string,
): Promise<string[] | null> {
  if (!target.trim()) {
    // [[#…]] — the note being edited.
    return noteAnchors(hostPath(context), context.state.doc.toString()).map((a) => a.id);
  }
  const path = resolveLink(target, useStore.getState().tree);
  if (!path) return null;
  const content = await noteContent(path);
  return content === null ? null : noteAnchors(path, content).map((a) => a.id);
}

/** The path of the note being edited, for anchor extraction on the open doc. */
function hostPath(context: CompletionContext): string {
  return context.state.facet(notePathFacet);
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
  // The alias table travels with the tree (state.loadTree), so this is a read,
  // not a fetch: the popup opens at the same speed it always did.
  const aliases = aliasCompletions();
  if (notes.length === 0 && aliases.length === 0) return null;

  const options: Completion[] = notes.map((note) => ({
    label: note.title,
    detail: stripNoteExt(note.path) === note.title ? undefined : note.path,
    type: "text",
    apply: applyInner,
  }));
  // …and the note's OTHER names. An alias that merely repeats a filename is
  // dropped: it would complete to the same link twice, and the second row
  // would say something different about where it goes.
  const titles = new Set(notes.map((note) => note.title.toLowerCase()));
  for (const entry of aliases) {
    if (titles.has(entry.alias.toLowerCase())) continue;
    options.push({
      // The detail says whose alias it is, because the label alone is a name
      // the reader may not recognise as belonging to that note yet — and if two
      // notes claim it, this row is the only place that difference is visible.
      label: entry.alias,
      detail: tf("aliasCompletionDetail", { title: entry.title }),
      type: "text",
      apply: applyInner,
    });
  }

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
