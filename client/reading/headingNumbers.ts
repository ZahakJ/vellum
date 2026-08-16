// AUTO-NUMBERED HEADINGS — "1.", "2.3", "4.1.2" — in the reading view and on
// the blog, off unless someone asks for it.
//
// A long note read from the top is a document, and a document's sections have
// numbers; a note read in the editor is a working surface, and numbers there
// would be furniture the author has to mentally subtract from every heading
// they are editing. So numbering is a READING affordance and never touches the
// source: nothing is written into the markdown, so a note can be numbered
// today, unnumbered tomorrow, and pushed to git unchanged either way.
//
// TWO SWITCHES, AND THE NOTE'S OWN ONE WINS.
//   · a device preference (localStorage, off by default) — the outline
//     panel's "1." toggle, for the reader who wants numbering everywhere;
//   · frontmatter `numbered: true` / `numbered: false` on the note itself,
//     which OVERRIDES the preference in both directions. That is what makes
//     numbering publishable: a blog visitor has no preference of ours, so a
//     numbered post has to be numbered by the post, and an author who wants
//     one paper numbered and their notebook plain says so once, in the file.
//
// The H1 rule: a note whose FIRST heading is its only `#` is a note whose h1
// is its title, not its first section — numbering it "1." and then numbering
// its real sections "1.1, 1.2" is how a table of contents that should read
// "1, 2, 3" ends up one level deeper than the document it describes. In that
// shape numbering starts at the h2s.

import { useEffect, useState } from "react";
import { parseProps } from "../editor/noteMeta.ts";
import { getNumerals } from "../i18n.ts";
import { toNumerals } from "../../shared/numerals.ts";
import { extractHeadings } from "./toc.ts";

const PREF_KEY = "vellum.headingNumbers";

/** The device preference (off unless the reader turned it on). */
export function headingNumbersPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "on";
  } catch {
    return false;
  }
}

export function setHeadingNumbersPref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // A blocked localStorage costs the preference, never the render.
  }
  window.dispatchEvent(new CustomEvent("vellum:heading-numbers", { detail: on }));
}

/** Frontmatter's answer for this note: true, false, or "did not say". */
export function frontmatterNumbering(content: string): boolean | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let close = -1;
  for (let j = 1; j < lines.length; j++) {
    const trimmed = lines[j].trim();
    if (trimmed === "---" || trimmed === "...") {
      close = j;
      break;
    }
  }
  if (close < 1) return null;
  const row = parseProps(lines.slice(1, close).join("\n")).find(
    (r) => r.key.toLowerCase() === "numbered",
  );
  if (!row) return null;
  const value = (row.values[0] ?? "true").toLowerCase();
  if (["false", "no", "off", "0"].includes(value)) return false;
  return true;
}

/** Should THIS note's headings carry numbers? The note's own answer, or the
 *  device preference when it did not give one. */
export function numberingFor(content: string): boolean {
  return frontmatterNumbering(content) ?? headingNumbersPref();
}

/**
 * The number each heading carries, in document order.
 *
 * Depth is relative to the SHALLOWEST heading in the note (a note whose
 * headings start at `##` numbers 1, 2, 3 — not nothing), and a level that
 * skips a step still advances only one counter, so a stray `#####` under an
 * `##` reads "2.1" rather than "2.0.0.1".
 */
export function headingNumbers(headings: { level: number; slug: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  if (headings.length === 0) return out;
  const h1s = headings.filter((h) => h.level === 1);
  const titleIsH1 = h1s.length === 1 && headings[0].level === 1;
  const body = titleIsH1 ? headings.slice(1) : headings;
  if (body.length === 0) return out;
  const base = Math.min(...body.map((h) => h.level));
  const counters: number[] = [];
  for (const h of body) {
    // Depth counted through the levels actually USED, so a jump from ## to
    // #### is one step down, not two.
    const depth = Math.max(1, Math.min(h.level - base + 1, counters.length + 1));
    counters.length = depth;
    counters[depth - 1] = (counters[depth - 1] ?? 0) + 1;
    out.set(h.slug, counters.map((n) => n ?? 1).join("."));
  }
  return out;
}

/** A heading number in the instance's own numbering system — "٢٫١" on an
 *  Arabic instance, "2.1" on an English one. The same rule `localeNum()`
 *  states for every count in the chrome, and for the same reason: an outline
 *  row printing "1.1" in a panel whose tag counts read "١١٤" is the mismatch
 *  that rule exists to prevent. Applied at RENDER time, not inside
 *  `headingNumbers()`, so the map itself stays language-free and one live
 *  language flip repaints both surfaces from it. */
export function numeralize(number: string): string {
  return toNumerals(number, getNumerals());
}

/** The number AS IT PRINTS: "1." at the top level, "2.3" and "4.1.2" below
 *  it — the three spellings this module's own header names, and the label on
 *  the outline's toggle. The rows printed a bare "1 2 3" against a button
 *  promising "1.", and the CSS beside them already talks about a column of
 *  "9." / "10." / "11."; a compound number needs no terminator because its
 *  own dots already say it is one. */
export function numberLabel(number: string): string {
  const shown = numeralize(number);
  return number.includes(".") ? shown : `${shown}.`;
}

/** Paint the numbers into a rendered note (`.s-rv` tree). Idempotent: it
 *  removes whatever it wrote last time before writing again, so a language
 *  flip or a re-render never stacks "1.1.1.1" onto a heading. */
export function applyHeadingNumbers(root: HTMLElement, numbers: Map<string, string> | null): void {
  for (const old of root.querySelectorAll(".s-rv-hnum")) old.remove();
  if (!numbers || numbers.size === 0) return;
  for (const h of root.querySelectorAll<HTMLElement>(".s-rv-h[id]")) {
    const num = numbers.get(h.id);
    if (!num) continue;
    const chip = document.createElement("span");
    chip.className = "s-rv-hnum";
    // Not read aloud: a screen reader announcing "one point two Derivation"
    // for every heading is worse than the heading alone, and the number is a
    // presentation of the outline the reader already has.
    chip.setAttribute("aria-hidden", "true");
    chip.textContent = numberLabel(num);
    h.prepend(chip);
  }
}

/**
 * THE ONE CALL EVERY READING SURFACE MAKES, right after it has replaced its
 * body with a freshly rendered note. Reading view and the blog article each
 * add a single line rather than each deciding for themselves what "numbered"
 * means — the argument `renderNoteContent` makes one layer down.
 *
 * `frontmatterOnly` is the blog: a visitor has no preference of ours to read,
 * so a published post is numbered because its AUTHOR said so in the file, and
 * an admin whose own device preference is on must not see a preview that no
 * visitor will get.
 */
export function numberRendered(
  root: HTMLElement,
  content: string,
  opts: { frontmatterOnly?: boolean } = {},
): void {
  const on = opts.frontmatterOnly
    ? frontmatterNumbering(content) === true
    : numberingFor(content);
  applyHeadingNumbers(root, on ? headingNumbers(extractHeadings(content)) : null);
}

/** A counter that changes whenever the device preference is toggled, so a
 *  surface can list it in its render effect's dependencies and repaint. */
export function useHeadingNumberTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((n) => n + 1);
    window.addEventListener("vellum:heading-numbers", bump);
    return () => window.removeEventListener("vellum:heading-numbers", bump);
  }, []);
  return tick;
}
