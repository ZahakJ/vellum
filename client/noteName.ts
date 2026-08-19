// ONE naming rule for everything that offers a filename a `[[stub]]` must
// later spell — sectionActions' "Extract section" and the composer's
// "Extract selection" both read it, so the two dialogs can never offer names
// by different laws.
//
// A module of one function, ON PURPOSE: sectionActions.ts is in the admin's
// first paint and the composer's text arithmetic (editor/composeText.ts) is
// editor-chunk code. Importing the rule FROM composeText dragged the whole
// footnote/case/callout module into the first paint (measured: +3.2 kB in
// the sectionActions chunk) for four lines of regex. The seam sits here so
// each side pays only for what it reads — the same argument calloutDefs.ts
// makes against the live-preview plugin.

/** `text` as a note filename. The forbidden set is the filesystem's plus the
 *  three the VAULT forbids (`[`, `]`, `#`): the stub an extraction leaves
 *  behind is `[[<this name>]]`, and a name those characters break is a name
 *  no wikilink can spell — the link would stop at the first `]]` and point
 *  at something else. */
export function noteFileName(text: string, fallback: string): string {
  const base = text
    .replace(/[\\/:*?"<>|[\]#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || fallback}.md`;
}
