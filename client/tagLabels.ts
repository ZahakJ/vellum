// Localised tag labels, client side — a plain module with subscribers, like
// i18n.ts and sync.ts, for the same three reasons: every tag surface in both
// shells needs it (the sidebar cloud, the properties card, the hover card, the
// blog nav, the topic page, the post chips, the dashboard), several of those
// surfaces are imperative DOM with no React context to reach into, and the map
// is one instance-wide fact rather than per-component state.
//
// THE CANONICAL TAG IS STILL THE VALUE. Nothing here rewrites a note, a URL,
// an EXCLUDE_TAGS match or a search index key: `label()` answers what a chip
// SAYS, `canonical()` answers what a chip MEANS, and every caller keeps
// storing, routing and filtering on the second one.

import { useSyncExternalStore } from "react";
import { canonicalForLabel, tagLabel, type TagLabelMap } from "../shared/tagLabels.ts";
import { getTagLabels } from "./api.ts";
import { getLang } from "./i18n.ts";

let map: TagLabelMap | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to map changes (a fetch landing, or a settings save). React
 *  components use `useTagLabels()` below; imperative DOM re-renders itself. */
export function onTagLabelsChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** A version counter, not the map: React's `useSyncExternalStore` compares
 *  snapshots by identity, and the map object is replaced wholesale on every
 *  load — so the number is the cheap, stable thing to hand it. */
let version = 0;

export function tagLabelsVersion(): number {
  return version;
}

function emit(): void {
  version += 1;
  for (const cb of listeners) cb();
}

/** Load (or reload) the map. Failures are SILENT and leave the previous map in
 *  place: a chip falling back to its canonical tag is a correct chip, and a
 *  toast per tag surface would be noise about a cosmetic feature. */
export async function loadTagLabels(): Promise<void> {
  try {
    const response = await getTagLabels();
    map = response.labels;
  } catch {
    // keep whatever we had — the canonical tag is always a valid label
    return;
  }
  emit();
}

/** What a chip for `tag` should SAY, in the chrome language in force. Falls
 *  back to the canonical tag, which is what every unlabelled tag renders as
 *  and what the whole feature degrades to. */
export function label(tag: string): string {
  return tagLabel(tag, getLang(), map);
}

/** True when the label differs from the canonical tag — the test a surface
 *  asks before putting the canonical value in a `title`, so a reader can
 *  always learn what a chip really is without a round trip. */
export function isLabelled(tag: string): boolean {
  return label(tag) !== tag.replace(/^#/, "");
}

/** `#tag` → `#label` inside a run of PLAIN TEXT, for the surfaces that show
 *  note text as text rather than as pills — today that is the outline.
 *
 *  The outline indexes the RENDERED document: a row that reads
 *  "Notes on #cryptography" pointing at a heading that reads «Notes on
 *  #التعمية» is the same disagreement the heading NUMBERS were made one
 *  computation to avoid. Display only, and deliberately not applied to
 *  `Section.text` — that value is written into files (`[[Note#Heading]]`, the
 *  stub an extraction leaves behind) and into anchors, and all three have to
 *  stay canonical. Callers keep the original for their `title`. */
export function labelTagsInText(text: string): string {
  if (map === null || !text.includes("#")) return text;
  return text.replace(TAG_IN_TEXT, (_m, pre: string, name: string) => `${pre}#${label(name)}`);
}

/** The tag shape, mirrored from `client/editor/noteMeta.ts`'s TAG_RE. Copied
 *  rather than imported: that module pulls in the banner layer and the whole
 *  properties card, and this file is imported by the blog shell's first
 *  paint. */
const TAG_IN_TEXT = /(^|[\s([{])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** The canonical tag a value names, whether it arrived canonical or localised
 *  (a URL segment a reader copied off a chip), or null when nothing matches. */
export function canonical(value: string): string | null {
  return canonicalForLabel(value, map);
}

/** React's door onto the same module. It returns the VERSION, not the map:
 *  `useSyncExternalStore` compares snapshots by identity and the map object is
 *  replaced wholesale on every load, so a number is the stable thing to hand
 *  it. Components use the value as a memo dependency — "the labels moved" —
 *  and read the labels themselves through `label()`. */
export function useTagLabels(): number {
  return useSyncExternalStore(onTagLabelsChange, tagLabelsVersion, tagLabelsVersion);
}

/** The whole map, for the rare caller that needs to enumerate it (the search
 *  overlay's own matching). Null until the first load lands. */
export function tagLabelMap(): TagLabelMap | null {
  return map;
}
