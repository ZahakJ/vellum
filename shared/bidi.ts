// Bidi control characters in UNTRUSTED text.
//
// The chrome isolates every value it splices into a sentence (i18n.ts tf() →
// FSI…PDI, <bdi> in the DOM), and that isolation works: an override inside a
// name can no longer reorder the sentence around it. What isolation cannot do
// is stop the value from lying about ITSELF — a comment author of
// "Ali‮rotartsinimd" renders, cleanly and entirely inside its own span,
// as "AliAdministrator". On the public page that reads as a genuine byline.
//
// So untrusted text is stripped of the characters that reorder it before it is
// stored or displayed:
//   U+202A–U+202E  LRE, RLE, PDF, LRO, RLO   (embeddings + overrides)
//   U+2066–U+2069  LRI, RLI, FSI, PDI        (isolates)
// Not stripped: U+200E/U+200F (LRM/RLM) and U+061C (ALM) are direction MARKS,
// zero-width and non-reordering — the dictionary itself uses them to punctuate
// mixed-script strings, and Arabic text carries ALM legitimately.

const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;

/** `text` with every bidi embedding/override/isolate removed. */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, "");
}
