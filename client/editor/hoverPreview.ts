// Hover previews: resting the pointer on a [[wikilink]] (300ms) floats a
// small card with the target note's rendered opening lines — via the reading
// renderer, so callouts/math/embeds look exactly like the real thing. A
// [[Note#Heading]] link previews from that heading. Footnote refs ([^1])
// preview their definition text.

import type { Extension } from "@codemirror/state";
import {
  EditorView,
  hoverTooltip,
  repositionTooltips,
  type Tooltip,
} from "@codemirror/view";
import { getNote } from "../api.ts";
import { t } from "../i18n.ts";
import { Lru } from "../lru.ts";
import { useStore } from "../state.ts";
import { renderMarkdown } from "../reading/render.ts";
import { findHeadingLine, parseWikilink, resolveLink, WIKILINK_RE } from "./links.ts";
import { notePathFacet } from "./livePreview.ts";

const FOOTNOTE_RE = /\[\^([^\]\s]+)\]/g;

/** Read-through cache of note SOURCE for the hover card.
 *
 *  The TTL is what stops it serving text the author has since edited; the
 *  `max` is what stops it retaining the whole vault. It previously had only
 *  the former — a Map that expired entries but never removed them, so an
 *  evening of skimming wikilinks on a 1,388-note vault ended with every note
 *  hovered still held in full, and a 10k-note vault would have held ten
 *  thousand. Thirty is well past the working set of "notes glanced at while
 *  writing one note", which is all a hover card is for. */
const cache = new Lru<string>({ max: 30, ttlMs: 15_000 });

async function noteContent(path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;
  try {
    const note = await getNote(path);
    cache.set(path, note.content);
    return note.content;
  } catch {
    return null;
  }
}

/** Strip frontmatter, optionally start at a heading, cap the excerpt. */
function excerpt(content: string, heading: string | null, title?: string): string {
  let body = content.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/, "");
  if (heading) {
    const line = findHeadingLine(body, heading);
    if (line !== null) body = body.split("\n").slice(line - 1).join("\n");
  } else if (title) {
    // An opening H1 that just repeats the note title would double the card
    // header an inch above it — drop that one line from the preview body.
    // (Checked within the first dozen lines: templates often put a timestamp
    // or a "Status:" line before the H1.)
    const lines = body.split("\n");
    const limit = Math.min(lines.length, 12);
    for (let i = 0; i < limit; i++) {
      const m = /^\s{0,3}#\s+(.+?)\s*$/.exec(lines[i]);
      if (!m) continue;
      if (m[1].trim().toLowerCase() === title.trim().toLowerCase()) {
        lines.splice(i, 1);
        body = lines.join("\n");
      }
      break; // only the first heading is a candidate
    }
  }
  const lines = body.split("\n");
  let out: string[] = [];
  let chars = 0;
  for (const line of lines) {
    out.push(line);
    chars += line.length + 1;
    if (out.length >= 30 || chars > 1400) break;
  }
  // Don't leave a dangling half code-fence open at the cut.
  const fences = out.filter((l) => /^\s*(```|~~~)/.test(l)).length;
  if (fences % 2 === 1) out.push("```");
  return out.join("\n").trim();
}

function card(title: string): {
  dom: HTMLElement;
  body: HTMLElement;
} {
  const dom = document.createElement("div");
  dom.className = "cm-s-hovercard";
  const head = document.createElement("div");
  head.className = "cm-s-hovercard__title";
  head.textContent = title;
  const body = document.createElement("div");
  body.className = "cm-s-hovercard__body";
  body.textContent = "…";
  dom.append(head, body);
  return { dom, body };
}

function noteTooltip(
  view: EditorView,
  from: number,
  to: number,
  target: string,
  heading: string | null,
): Tooltip {
  const hostPath = view.state.facet(notePathFacet);
  const path = resolveLink(target, useStore.getState().tree);
  return {
    pos: from,
    end: to,
    above: true,
    create: () => {
      const title = path
        ? (path.split("/").pop() ?? path).replace(/\.md$/i, "")
        : target;
      const { dom, body } = card(title);
      if (!path) {
        dom.classList.add("cm-s-hovercard--missing");
        body.textContent = t("embedNotCreated");
        return { dom };
      }
      void noteContent(path).then((content) => {
        if (!dom.isConnected) return;
        if (content === null) {
          body.textContent = t("noteLoadFailed");
          return;
        }
        const md = excerpt(content, heading, title);
        body.replaceChildren(
          md
            ? renderMarkdown(md, {
                notePath: path,
                tree: useStore.getState().tree,
                embedded: true,
                ancestors: new Set([hostPath]),
              })
            : document.createTextNode(t("noteEmpty")),
        );
        repositionTooltips(view);
      });
      return { dom };
    },
  };
}

/** The `[^label]:` definition text: its line plus indented continuations. */
function footnoteDef(docText: string, label: string): string | null {
  const lines = docText.split("\n");
  const prefix = `[^${label}]:`;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(prefix)) continue;
    const out = [lines[i].slice(prefix.length).trim()];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^(\t| {2,})\S/.test(lines[j])) out.push(lines[j].trim());
      else break;
    }
    const text = out.join("\n").trim();
    return text || null;
  }
  return null;
}

function footnoteTooltip(
  view: EditorView,
  from: number,
  to: number,
  label: string,
): Tooltip | null {
  const def = footnoteDef(view.state.doc.toString(), label);
  if (!def) return null;
  const hostPath = view.state.facet(notePathFacet);
  return {
    pos: from,
    end: to,
    above: true,
    create: () => {
      const { dom, body } = card(`Footnote ${label}`);
      dom.classList.add("cm-s-hovercard--footnote");
      body.replaceChildren(
        renderMarkdown(def, {
          notePath: hostPath,
          tree: useStore.getState().tree,
          embedded: true,
          ancestors: new Set([hostPath]),
        }),
      );
      return { dom };
    },
  };
}

function source(view: EditorView, pos: number): Tooltip | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;

  WIKILINK_RE.lastIndex = 0;
  for (let m = WIKILINK_RE.exec(text); m; m = WIKILINK_RE.exec(text)) {
    if (m.index > 0 && text[m.index - 1] === "!") continue; // embeds render already
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (pos < from || pos >= to) continue;
    const { target, heading } = parseWikilink(m[1]);
    if (!target && !heading) return null;
    if (!target && heading) {
      // [[#Heading]] — same note; preview from that heading.
      const hostPath = view.state.facet(notePathFacet);
      return noteTooltip(view, from, to, hostPath.replace(/\.md$/i, ""), heading);
    }
    return noteTooltip(view, from, to, target, heading);
  }

  FOOTNOTE_RE.lastIndex = 0;
  for (let m = FOOTNOTE_RE.exec(text); m; m = FOOTNOTE_RE.exec(text)) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    const isDef = m.index === 0 && text[m[0].length] === ":";
    if (isDef || pos < from || pos >= to) continue;
    return footnoteTooltip(view, from, to, m[1]);
  }

  return null;
}

export function hoverPreviews(): Extension {
  return hoverTooltip(source, { hoverTime: 300 });
}
