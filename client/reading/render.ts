// Reading view renderer: whole-note markdown → DOM. Shares the editor's
// parse/resolve logic instead of duplicating it: wikilink parsing + resolution
// (editor/links.ts), embed classification + attachment resolution
// (editor/widgets.ts), callout detection + icons (editor/callouts.ts), the
// frontmatter properties parser and tag regex (editor/livePreview.ts), and the
// same KaTeX + @lezer highlighting stack the live preview uses.
//
// Output is a self-contained element tree with `s-rv-*` classes (styled in
// reading.css). A single delegated click listener on the root handles plain
// click wikilink navigation, tag search, footnote hops and callout folding.
// ![[Note]] transclusions fetch + render at depth 1, cycle-safe.

import type { TreeNode } from "../../shared/types.ts";
import { activateOnKey, scrollBehavior } from "../a11y.ts";
import { getNote } from "../api.ts";
import { getKatex, loadKatex } from "../katex.ts";
import { t, tf } from "../i18n.ts";
import { label as tagLabel } from "../tagLabels.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { parseWikilink, resolveLink } from "../editor/links.ts";
import { parseBookAnchor } from "../../shared/bookAnchor.ts";
import {
  brokenEmbed,
  embedKnownBroken,
  fileUrl,
  isNoiseImageName,
  markEmbedBroken,
  missingImageCard,
  parseEmbed,
  resolveAttachment,
  resolveRelative,
} from "../editor/embeds.ts";
import {
  CALLOUT_TITLE_RE,
  calloutGroup,
  calloutIconSvg,
} from "../editor/calloutDefs.ts";
import { bannerFromYaml } from "../banner.ts";
import { buildBannerEl, buildPropsCard, TAG_RE } from "../editor/noteMeta.ts";
import { htmlBlockStart, sanitizeHtml, sanitizeInlineTag } from "./rawHtml.ts";
import { Slugger, stripInline } from "./toc.ts";
import { isNotePath, isTexPath, noteTitleOf } from "../../shared/noteFormat.ts";
import { findAnchor, noteAnchors } from "../../shared/anchors.ts";
import { renderNoteContent, renderNoteSlice } from "./renderNote.ts";

export interface RenderOptions {
  notePath: string;
  tree: TreeNode | null;
  /** Render as embedded (transclusion-card) content: nested note embeds
   *  become link chips, headings get no TOC ids, frontmatter and the
   *  footnote section are dropped. */
  embedded?: boolean;
  /** Notes already on the embed path (cycle guard for embedded renders). */
  ancestors?: Set<string>;
  /** Unresolvable [[wikilinks]]: "dashed" (default) keeps the broken-link
   *  affordance; "plain" renders the label as plain text — blog readers
   *  should never see broken-link furniture or dead-end clicks. */
  brokenLinks?: "dashed" | "plain";
  /** Missing ![[image]] embeds: "placeholder" (default) is the ⌀ chip;
   *  "card" is a faint minimal "missing image" card, hidden entirely when
   *  the filename is machine noise ("Pasted image 2026…"). */
  missingImages?: "placeholder" | "card";
  /** Lowercased tag names that may render as clickable pills. When set
   *  (blog surfaces), an inline #tag outside this set renders as plain
   *  text — EXCLUDE_TAGS-hidden workflow tags must not become styled
   *  pills linking toward topics the public nav hides. Absent (the app
   *  shell) every tag stays a pill. */
  visibleTags?: Set<string>;
}

interface Ctx extends RenderOptions {
  depth: number; // transclusion depth (0 = the open note)
  ancestors: Set<string>; // embed cycle guard
  slugger: Slugger;
  footnotes: { label: string; text: string }[];
  assignIds: boolean; // only top-level headings get TOC ids
}

// ── Escaping helpers ────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unesc(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function katexHtml(tex: string, display: boolean): string {
  const katex = getKatex();
  if (!katex) {
    // KaTeX still downloading: emit the source in a pending span that
    // hydrateMath() swaps for rendered math once the module arrives.
    return `<span class="s-rv-math-pending" data-tex="${esc(tex)}" data-display="${display ? "1" : "0"}">${esc(tex)}</span>`;
  }
  try {
    return katex.renderToString(tex, {
      throwOnError: false,
      displayMode: display,
      output: "htmlAndMathml",
    });
  } catch {
    return `<code>${esc(tex)}</code>`;
  }
}

/** Swap pending math spans for rendered KaTeX once the lazy module lands. */
function hydrateMath(root: HTMLElement): void {
  const pending = root.querySelectorAll<HTMLElement>(".s-rv-math-pending");
  if (pending.length === 0) return;
  void loadKatex().then(() => {
    for (const el of pending) {
      const display = el.dataset.display === "1";
      el.innerHTML = katexHtml(el.dataset.tex ?? "", display);
      el.className = display ? "s-rv-math-live" : "s-rv-math s-rv-math-live";
    }
  });
}

// ── Inline rendering ────────────────────────────────────────────────────────
// Escape first, then run feature regexes over the escaped text. Finished HTML
// is protected behind \x00N\x00 tokens so later passes can't touch it.

function renderInline(raw: string, ctx: Ctx, multiline = false): string {
  const tokens: string[] = [];
  const keep = (html: string): string => `\x00${tokens.push(html) - 1}\x00`;
  let s = esc(raw);

  // `inline code`
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    keep(`<code class="s-rv-code">${code}</code>`),
  );

  // Mid-line $$display$$ math (line-initial $$ blocks are consumed at block
  // level before paragraphs form; this catches the in-sentence form).
  s = s.replace(/\$\$([^$]+?)\$\$/g, (_m, tex: string) =>
    keep(
      `<span class="s-rv-math s-rv-math--display">${katexHtml(unesc(tex).trim(), true)}</span>`,
    ),
  );

  // $inline math$ — same pandoc-ish guards as editor/math.ts.
  s = s.replace(
    /\$([^$\n]+?)\$/g,
    (m: string, tex: string, off: number, whole: string) => {
      const prev = off > 0 ? whole[off - 1] : "";
      const next = whole[off + m.length] ?? "";
      if (
        prev === "$" ||
        prev === "\\" ||
        next === "$" ||
        /\d/.test(next) ||
        /^\s/.test(tex) ||
        /\s$/.test(tex)
      ) {
        return m;
      }
      return keep(`<span class="s-rv-math">${katexHtml(unesc(tex), false)}</span>`);
    },
  );

  // %%comments%% never render in reading view.
  s = s.replace(/%%[^%\n]*%%/g, "");

  // Raw inline HTML (Obsidian renders it): allowed tags pass through,
  // sanitized; script-ish tags are swallowed; anything else stays escaped.
  // Runs after the code pass, so `code spans` keep their literal source.
  s = s.replace(
    /&lt;(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:(?!&gt;|&lt;).)*?)(\/?)&gt;/g,
    (m, close: string, name: string, attrText: string, selfClose: string) => {
      const safe = sanitizeInlineTag(close, name, unesc(attrText), selfClose);
      if (safe === null) return m; // not an inline tag — leave escaped
      return safe === "" ? "" : keep(safe);
    },
  );

  // ![[embeds]] — inline images; other kinds read as quiet chips inline
  // (block-level embeds are handled before paragraphs form).
  s = s.replace(/!\[\[([^[\]]+?)\]\]/g, (_m, inner: string) => {
    const embed = parseEmbed(unesc(inner));
    if (embed.kind === "image") {
      const w = embed.width ? ` style="width:${embed.width}px"` : "";
      return keep(
        `<img class="s-rv-img" data-embed-name="${esc(embed.target)}" alt="${esc(embed.target)}"${w}>`,
      );
    }
    return keep(`<span class="s-rv-embed-chip">${esc(embed.target)}</span>`);
  });

  // ![alt](src) images (vault-relative resolved against the note dir).
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g,
    (_m, alt: string, src: string) => {
      const url = resolveRelative(unesc(src), ctx.notePath);
      return keep(`<img class="s-rv-img" src="${esc(url)}" alt="${alt}">`);
    },
  );

  // [[wikilinks]] — plain click navigates (handled by the root listener).
  s = s.replace(/\[\[([^[\]]+?)\]\]/g, (_m, inner: string) => {
    const { target, heading, alias } = parseWikilink(unesc(inner));
    // A CITATION INTO A BOOK: `[[Ihya.pdf#page=42&rect=…&id=…|Ihya, p. 42]]`.
    // It is a wikilink and nothing else — `parseWikilink` split it without
    // being taught anything, which is exactly why the anchor was given this
    // shape — but `resolveLink` answers about NOTES, so a PDF would otherwise
    // render dashed and a click on it would offer to create "Ihya.pdf.md".
    // The click is answered by the reader's own door (onRootClick below); the
    // note it was clicked FROM travels on the element, because that is what a
    // repaired link has to be written back into.
    const cite = heading === null ? null : parseBookAnchor(heading);
    if (cite !== null && /\.pdf$/i.test(target)) {
      const shown = alias ?? `${target} › ${cite.page}`;
      // On a published page a citation is not a link: a visitor has no library
      // to open and no business enumerating one. It reads as the words the
      // owner wrote, which is what `brokenLinks: "plain"` already means here.
      if (ctx.brokenLinks === "plain") return keep(esc(shown));
      return keep(
        `<a class="s-rv-wikilink s-rv-cite" data-book="${esc(target)}" data-anchor="${esc(heading ?? "")}"` +
          ` data-cite-note="${esc(ctx.notePath)}" role="link" tabindex="0">${esc(shown)}</a>`,
      );
    }
    const resolved = target ? resolveLink(target, ctx.tree) : null;
    const label =
      alias ?? (heading ? (target ? `${target} › ${heading}` : heading) : target);
    const broken = target !== "" && resolved === null;
    // Blog surfaces: an unresolvable link is just its text — no dashed
    // styling, no dead-end click target.
    if (broken && ctx.brokenLinks === "plain") return keep(esc(label));
    const cls = broken ? "s-rv-wikilink s-rv-wikilink--broken" : "s-rv-wikilink";
    const headingAttr = heading ? ` data-heading="${esc(heading)}"` : "";
    return keep(
      // See the footnote-ref note: an <a> with no href is inert to a keyboard.
      // A broken link keeps the same treatment — it still DOES something
      // (creates the note for an admin, explains itself to a visitor).
      `<a class="${cls}" data-target="${esc(target)}"${headingAttr} role="link" tabindex="0">${esc(label)}</a>`,
    );
  });

  // [text](url) external links.
  s = s.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    (_m, text: string, url: string) =>
      keep(
        `<a class="s-rv-ext" href="${esc(unesc(url))}" target="_blank" rel="noopener noreferrer">${text}</a>`,
      ),
  );

  // <autolinks> and bare urls.
  s = s.replace(/&lt;(https?:\/\/[^\s]+?)&gt;/g, (_m, url: string) =>
    keep(
      `<a class="s-rv-ext" href="${esc(unesc(url))}" target="_blank" rel="noopener noreferrer">${url}</a>`,
    ),
  );
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<>()\x00]+)/g,
    (_m, pre: string, url: string) => {
      const trimmed = url.replace(/[.,;:!?]+$/, "");
      const tail = url.slice(trimmed.length);
      return (
        pre +
        keep(
          `<a class="s-rv-ext" href="${esc(unesc(trimmed))}" target="_blank" rel="noopener noreferrer">${trimmed}</a>`,
        ) +
        tail
      );
    },
  );

  // Footnote refs [^label] (definitions are consumed at block level).
  s = s.replace(/\[\^([^\]\s]+)\]/g, (_m, label: string) =>
    keep(
      // role+tabindex, not bare <a>: an anchor WITHOUT href is not a link to
      // the browser — no focus, no Enter, nothing. The delegated keydown on
      // the root turns Enter/Space back into the click these already handle.
      `<sup class="s-rv-fnref"><a data-fn="${esc(label)}" id="fnref-${esc(label)}" role="link" tabindex="0">${esc(label)}</a></sup>`,
    ),
  );

  // ==highlight==, **bold**, *italic*, ~~strike~~.
  s = s.replace(/==([^=\n]+?)==/g, '<mark class="s-rv-mark">$1</mark>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  // #tags → search pills. Tags hidden from the surface (EXCLUDE_TAGS on
  // blog renders) stay plain text — no pill styling, no dead-end topic link.
  //
  // THE PILL SAYS THE LABEL AND MEANS THE TAG, exactly as the DOM builder
  // below (`s-rv-tag`, ~line 650) and the editor's properties card already do.
  // This one was the copy that did not: `renderInline` is what paragraphs,
  // headings, table cells, list items, callouts and footnotes all go through,
  // so an Arabic instance labelled its sidebar cloud, its properties cards and
  // its blog nav «التعمية» while every tag in the PROSE — and every tag in a
  // hover card, which renders through here — still read `#cryptography`. One
  // pill, two builders, one of them localised: the drift this codebase keeps
  // writing down, in the surface a reader looks at most.
  //
  // `data-tag` stays canonical (it is what the delegated click searches on),
  // the title names the canonical value so a reader can always learn what to
  // type, and `dir="auto"` is not optional — `#` is bidi-neutral, so under an
  // RTL base direction a chip without it reads «التعمية#».
  s = s.replace(TAG_RE, (_m, pre: string, name: string) => {
    if (ctx.visibleTags && !ctx.visibleTags.has(name.toLowerCase())) return `${pre}#${name}`;
    return (
      pre +
      keep(
        `<button type="button" class="s-rv-tag" data-tag="${esc(name)}" dir="auto"` +
          ` title="${esc(tf("searchTag", { tag: name }))}">#${esc(tagLabel(name))}</button>`,
      )
    );
  });

  // Hard-wrapped paragraph lines become <br> — but only in the plain text,
  // never inside protected tokens (a <br> dropped into raw SVG path data or
  // KaTeX markup breaks the DOM).
  if (multiline) s = s.replace(/\n/g, "<br>");

  // Restore protected HTML (loop: tokens may nest inside tokens).
  for (let guard = 0; guard < 10 && s.includes("\x00"); guard++) {
    s = s.replace(/\x00(\d+)\x00/g, (_m, i: string) => tokens[Number(i)] ?? "");
  }
  return s;
}

// ── Block-level patterns ────────────────────────────────────────────────────

const FENCE_OPEN_RE = /^(\s*)(```+|~~~+)\s*([^\s`~]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FOOTDEF_RE = /^\[\^([^\]\s]+)\]:\s?(.*)$/;
const BLOCK_EMBED_RE = /^\s*!\[\[([^[\]]+?)\]\]\s*$/;

function isTableSep(line: string | undefined): boolean {
  if (!line || !line.includes("-") || !line.includes("|")) return false;
  const cells = line.trim().replace(/^\||\|$/g, "").split("|");
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

function startsBlock(line: string, next: string | undefined): boolean {
  const t = line.trim();
  return (
    HEADING_RE.test(line) ||
    FENCE_OPEN_RE.test(line) ||
    HR_RE.test(t) ||
    /^\s*>/.test(line) ||
    LIST_ITEM_RE.test(line) ||
    FOOTDEF_RE.test(line) ||
    BLOCK_EMBED_RE.test(line) ||
    htmlBlockStart(line) !== null ||
    t.startsWith("$$") ||
    (line.includes("|") && isTableSep(next))
  );
}

// ── Code fence highlighting (async, shared CM language registry) ────────────

async function highlightCode(
  el: HTMLElement,
  source: string,
  lang: string,
): Promise<void> {
  try {
    // Loaded on demand: the CodeMirror language registry (and the language
    // package itself) stay out of the first-paint bundle.
    const [{ LanguageDescription }, { languages }, { classHighlighter, highlightTree }] =
      await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/language-data"),
        import("@lezer/highlight"),
      ]);
    const desc = LanguageDescription.matchLanguageName(languages, lang, true);
    if (!desc) return;
    const support = await desc.load();
    const tree = support.language.parser.parse(source);
    const frag = document.createDocumentFragment();
    let pos = 0;
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      if (from > pos) frag.appendChild(document.createTextNode(source.slice(pos, from)));
      const span = document.createElement("span");
      span.className = classes;
      span.textContent = source.slice(from, to);
      frag.appendChild(span);
      pos = to;
    });
    if (pos < source.length) {
      frag.appendChild(document.createTextNode(source.slice(pos)));
    }
    if (el.isConnected || el.ownerDocument) el.replaceChildren(frag);
  } catch {
    /* leave the plain text */
  }
}

// ── Embed blocks (image figures, file cards, transclusions) ─────────────────

function attachEmbedSrc(
  img: HTMLImageElement,
  name: string,
  missing: "placeholder" | "card" = "placeholder",
): void {
  // What a miss becomes: the editor-style ⌀ placeholder, or (blog article)
  // a faint "missing image" card — dropped entirely for machine-noise names
  // like "Pasted image 2026…" that tell a reader nothing.
  const fail = (): void => {
    if (missing === "card") {
      // Replace the whole figure when it is attached; a sync miss (cached)
      // happens while the figure is still parentless, where replaceWith is
      // a no-op — operate on the img inside it instead (an emptied figure
      // is display:none'd by CSS).
      const figure = img.closest(".s-rv-figure");
      const target = figure?.parentNode ? figure : img;
      if (isNoiseImageName(name)) target.remove();
      else target.replaceWith(missingImageCard(name));
      return;
    }
    img.replaceWith(brokenEmbed(name));
  };
  if (embedKnownBroken(name)) {
    fail();
    return;
  }
  img.onerror = () => {
    markEmbedBroken(name); // don't re-request a known-404 on every rebuild
    fail();
  };
  const r = resolveAttachment(name);
  if (typeof r === "string") img.src = fileUrl(r);
  else if (r === null) fail();
  else {
    void r.then((path) => {
      if (path) img.src = fileUrl(path);
      else fail();
    });
  }
}

function fileCard(name: string): HTMLElement {
  const a = document.createElement("a");
  a.className = "s-rv-file";
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toUpperCase()
    : "FILE";
  a.innerHTML =
    '<span class="s-rv-file__icon"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>' +
    `<span class="s-rv-file__name">${esc(name)}</span>` +
    `<span class="s-rv-file__badge">${esc(ext)}</span>`;
  const r = resolveAttachment(name);
  const setHref = (path: string | null): void => {
    if (path) a.href = fileUrl(path);
  };
  if (typeof r === "string" || r === null) setHref(r);
  else void r.then(setHref);
  return a;
}

/** After (re)rendering a height-capped transclusion body, add a bottom fade
 *  plus an "Open note" footer when the content actually overflows the cap.
 *  Shared by the reading view and the editor's live-preview card. */
export function markTransclusionOverflow(
  card: HTMLElement,
  body: HTMLElement,
  overflowClass: string,
  moreClass: string,
  open: () => void,
): void {
  requestAnimationFrame(() => {
    if (!card.isConnected) return;
    const overflowing = body.scrollHeight > body.clientHeight + 1;
    card.classList.toggle(overflowClass, overflowing);
    let more = card.querySelector<HTMLElement>(`.${moreClass}`);
    if (overflowing && !more) {
      more = document.createElement("button");
      more.setAttribute("type", "button");
      more.className = moreClass;
      more.textContent = t("openNoteArrow");
      more.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        open();
      });
      card.appendChild(more);
    } else if (!overflowing && more) {
      more.remove();
    }
  });
}

function transclusion(target: string, ctx: Ctx, anchor: string | null = null): HTMLElement {
  const path = resolveLink(target, ctx.tree);
  const card = document.createElement("div");
  card.className = "s-rv-transclude";
  const header = document.createElement("div");
  header.className = "s-rv-transclude__title";
  header.textContent = path ? noteTitleOf(path) : target;
  if (anchor) {
    const suffix = document.createElement("span");
    suffix.className = "s-rv-transclude__anchor";
    suffix.textContent = ` › ${anchor}`;
    header.appendChild(suffix);
  }
  card.appendChild(header);
  const body = document.createElement("div");
  body.className = "s-rv-transclude__body";
  card.appendChild(body);

  if (!path) {
    card.classList.add("s-rv-transclude--broken");
    body.textContent = tf("noNoteNamed", { name: target });
    return card;
  }
  if (ctx.ancestors.has(path)) {
    body.textContent = t("noteEmbedsItself");
    body.classList.add("s-rv-transclude__note");
    return card;
  }
  header.classList.add("s-rv-transclude__title--link");
  header.title = tf("openNote", { path: header.textContent ?? "" });
  header.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    useStore.getState().openNote(path);
  });
  body.textContent = "…";
  getNote(path)
    .then((note) => {
      if (!body.isConnected && !card.isConnected) return;
      const inner: Ctx = {
        notePath: path,
        tree: ctx.tree,
        brokenLinks: ctx.brokenLinks,
        missingImages: ctx.missingImages,
        depth: ctx.depth + 1,
        ancestors: new Set([...ctx.ancestors, path]),
        slugger: new Slugger(),
        footnotes: [],
        assignIds: false,
      };
      body.replaceChildren();
      // The target may be a `.tex` note — a vault is not obliged to be all one
      // format — and it may name an ANCHOR, in which case only that block is
      // pulled in: `![[Paper#eq:fourier]]` is one equation, rendered by KaTeX,
      // inside a markdown note. Both are one dispatch through renderNote.ts.
      const part = anchor === null ? null : anchorSlice(note.content, path, anchor, inner);
      if (part) {
        body.appendChild(part);
      } else if (isTexPath(path)) {
        body.appendChild(
          renderNoteContent(note.content, {
            notePath: path,
            tree: ctx.tree,
            embedded: true,
            ancestors: new Set([...ctx.ancestors, path]),
            brokenLinks: ctx.brokenLinks,
            missingImages: ctx.missingImages,
            visibleTags: ctx.visibleTags,
          }),
        );
      } else {
        renderNote(note.content, inner, body);
      }
      markTransclusionOverflow(
        card,
        body,
        "s-rv-transclude--overflow",
        "s-rv-transclude__more",
        () => useStore.getState().openNote(path),
      );
    })
    .catch(() => {
      body.textContent = t("noteLoadFailed");
    });
  return card;
}

function renderEmbedBlock(inner: string, ctx: Ctx): HTMLElement {
  const embed = parseEmbed(inner);
  if (embed.kind === "image") {
    const fig = document.createElement("figure");
    fig.className = "s-rv-figure";
    const img = document.createElement("img");
    img.className = "s-rv-img";
    img.alt = embed.target;
    if (embed.width) img.style.width = `${embed.width}px`;
    fig.appendChild(img); // append first: a miss may replace/remove the figure
    attachEmbedSrc(img, embed.target, ctx.missingImages ?? "placeholder");
    return fig;
  }
  if (embed.kind === "file") return fileCard(embed.target);
  if (ctx.depth >= 1) {
    // Depth limit: embeds inside an embedded note read as link chips.
    const chip = document.createElement("div");
    chip.innerHTML = renderInline(`[[${inner}]]`, ctx);
    return chip;
  }
  return transclusion(embed.target, ctx, embed.anchor);
}

/** Just the block an `#anchor` names, when the target carries one. Markdown
 *  headings and LaTeX labels resolve through the same table (shared/anchors.ts),
 *  so this is one lookup for both formats; a miss returns null and the caller
 *  transcludes the whole note, which is what `![[Note#missing]]` did before
 *  anchors existed. */
function anchorSlice(
  content: string,
  path: string,
  anchor: string,
  inner: Ctx,
): HTMLElement | null {
  // A hit is required HERE rather than delegated blind, because a miss has to
  // fall through to this function's own caller (which then transcludes the
  // whole note through the ctx it is already holding).
  if (!findAnchor(noteAnchors(path, content), anchor)) return null;
  return renderNoteSlice(
    content,
    {
      notePath: path,
      tree: inner.tree,
      embedded: true,
      ancestors: inner.ancestors,
      brokenLinks: inner.brokenLinks,
      missingImages: inner.missingImages,
      visibleTags: inner.visibleTags,
    },
    anchor,
  );
}

/** The lines a markdown heading owns: the heading itself plus everything under
 *  it until the next heading at the same or a shallower level.
 *
 *  Exported for renderNote.ts's `renderNoteSlice`, which is the ONE answer to
 *  "render the block this `#anchor` names" — the reading view, the blog and
 *  the editor's transclusion widget all go through it, so a partial
 *  transclusion cannot mean one thing on one surface and another somewhere
 *  else (it did: the editor pulled in the whole note and dropped the anchor
 *  from the card's title while the reading view sliced it correctly). */
export function markdownSection(md: string, line: number): string | null {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const start = line - 1;
  const head = HEADING_RE.exec(lines[start] ?? "");
  if (!head) return null;
  const level = head[1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// ── Frontmatter properties card ─────────────────────────────────────────────

function propsCard(yaml: string): HTMLElement | null {
  return buildPropsCard(yaml, {
    prefix: "s-rv-props",
    makeTag: (value) => {
      // Clicks are handled by the reading view's delegated .s-rv-tag handler.
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "s-rv-tag";
      pill.dataset.tag = value;
      // dir="auto", not "ltr": the chip is its own content and the tag can be
      // Arabic. Without the isolate the neutral `#` is swept to the display
      // end by an RTL base direction and the chip reads `matrix#`.
      pill.dir = "auto";
      // Display only: `data-tag` above keeps the canonical tag, which is what
      // the reading view's delegated handler searches on.
      pill.textContent = `#${tagLabel(value)}`;
      pill.title = tf("searchTag", { tag: value });
      return pill;
    },
  });
}

// ── Block renderer ──────────────────────────────────────────────────────────

function renderBlocks(lines: string[], ctx: Ctx, root: HTMLElement): void {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (t === "") {
      i++;
      continue;
    }

    // ``` fenced code
    const fm = FENCE_OPEN_RE.exec(line);
    if (fm) {
      const fence = fm[2].slice(0, 3);
      const lang = fm[3];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        buf.push(lines[i]);
        i++;
      }
      i++; // past the closing fence (or the end)
      const pre = document.createElement("pre");
      pre.className = "s-rv-pre";
      const code = document.createElement("code");
      const source = buf.join("\n");
      code.textContent = source;
      pre.appendChild(code);
      if (lang) void highlightCode(code, source, lang);
      root.appendChild(pre);
      continue;
    }

    // Raw HTML blocks (<figure>, <svg>, <div>…): consumed to the next blank
    // line, sanitized, injected as real DOM — Obsidian renders inline HTML
    // and real vaults (dg-publish, Excalidraw exports) depend on it.
    if (htmlBlockStart(line) !== null) {
      const buf: string[] = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== "") {
        buf.push(lines[i]);
        i++;
      }
      const wrap = document.createElement("div");
      wrap.className = "s-rv-html";
      wrap.appendChild(sanitizeHtml(buf.join("\n")));
      if (wrap.childNodes.length > 0) root.appendChild(wrap);
      continue;
    }

    // $$ display math (same shape rules as editor/math.ts)
    if (t.startsWith("$$")) {
      let tex: string | null = null;
      if (t.length > 4 && t.endsWith("$$")) {
        tex = t.slice(2, -2).trim();
        i++;
      } else {
        let closing = -1;
        for (let k = i + 1; k < lines.length; k++) {
          if (lines[k].trim().endsWith("$$")) {
            closing = k;
            break;
          }
        }
        if (closing >= 0) {
          const parts: string[] = [t.slice(2)];
          for (let k = i + 1; k < closing; k++) parts.push(lines[k]);
          const lastText = lines[closing].trim();
          parts.push(lastText.slice(0, -2));
          tex = parts.join("\n").trim();
          i = closing + 1;
        }
      }
      if (tex !== null) {
        if (tex !== "") {
          const div = document.createElement("div");
          div.className = "s-rv-mathblock";
          div.innerHTML = katexHtml(tex, true);
          root.appendChild(div);
        }
        continue;
      }
      // unterminated: fall through to paragraph
    }

    // # headings
    const hm = HEADING_RE.exec(line);
    if (hm) {
      const level = hm[1].length;
      const el = document.createElement(`h${level}`);
      el.className = `s-rv-h s-rv-h${level}`;
      el.dir = "auto"; // RTL headings (Arabic/Hebrew) align to their script
      el.innerHTML = renderInline(hm[2].replace(/\s+#+\s*$/, ""), ctx);
      if (ctx.assignIds) el.id = ctx.slugger.slug(stripInline(hm[2]));
      root.appendChild(el);
      i++;
      continue;
    }

    // horizontal rule. `***` draws the ORNAMENTAL divider, `---` and `___` the
    // plain one — markdown's three spellings of a thematic break are one thing
    // to a parser and have always been two things to a typesetter.
    if (HR_RE.test(t)) {
      const hr = document.createElement("hr");
      hr.className = t.trim().startsWith("*") ? "s-rv-hr s-rv-hr--orn" : "s-rv-hr";
      root.appendChild(hr);
      i++;
      continue;
    }

    // > blockquotes and > [!type] callouts
    if (/^\s*>/.test(line)) {
      const qlines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        qlines.push(lines[i]);
        i++;
      }
      const stripQuote = (l: string): string => l.replace(/^\s*>\s?/, "");
      const cm = CALLOUT_TITLE_RE.exec(qlines[0]);
      const nested: Ctx = { ...ctx, assignIds: false };
      if (cm) {
        const type = cm[2].toLowerCase();
        const group = calloutGroup(type);
        const marker = cm[3];
        const title = cm[4].trim() || cm[2][0].toUpperCase() + type.slice(1);
        const box = document.createElement("div");
        box.className = `s-rv-callout s-rv-callout--${group}${marker === "-" ? " s-rv-callout--folded" : ""}`;
        const bar = document.createElement("div");
        bar.className =
          "s-rv-callout__title" +
          (marker !== "" ? " s-rv-callout__title--foldable" : "");
        bar.innerHTML =
          `<span class="s-rv-callout__icon"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${calloutIconSvg(group)}</svg></span>` +
          `<span class="s-rv-callout__text" dir="auto">${renderInline(title, nested)}</span>` +
          (marker !== ""
            ? '<span class="s-rv-callout__chevron"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>'
            : "");
        box.appendChild(bar);
        const body = document.createElement("div");
        body.className = "s-rv-callout__body";
        renderBlocks(qlines.slice(1).map(stripQuote), nested, body);
        box.appendChild(body);
        if (marker !== "") {
          bar.addEventListener("click", () =>
            box.classList.toggle("s-rv-callout--folded"),
          );
        }
        root.appendChild(box);
      } else {
        const bq = document.createElement("blockquote");
        bq.className = "s-rv-quote";
        renderBlocks(qlines.map(stripQuote), nested, bq);
        root.appendChild(bq);
      }
      continue;
    }

    // lists (nested via indentation; task items get read-only checkboxes)
    if (LIST_ITEM_RE.test(line)) {
      const stack: { indent: number; el: HTMLElement }[] = [];
      let firstList: HTMLElement | null = null;
      while (i < lines.length) {
        const m = LIST_ITEM_RE.exec(lines[i]);
        if (!m) break;
        const indent = m[1].replace(/\t/g, "  ").length;
        const ordered = /\d/.test(m[2][0]);
        while (stack.length > 1 && indent < stack[stack.length - 1].indent) {
          stack.pop();
        }
        let top = stack[stack.length - 1];
        if (!top || indent > top.indent) {
          const el = document.createElement(ordered ? "ol" : "ul");
          el.className = "s-rv-list";
          if (top) (top.el.lastElementChild ?? top.el).appendChild(el);
          else firstList = el;
          stack.push({ indent, el });
          top = stack[stack.length - 1];
        }
        const li = document.createElement("li");
        li.dir = "auto";
        const task = /^\[([ xX])\]\s?(.*)$/.exec(m[3]);
        if (task) {
          const done = /x/i.test(task[1]);
          li.className = `s-rv-task${done ? " s-rv-task--done" : ""}`;
          li.innerHTML = `<input type="checkbox" disabled${done ? " checked" : ""}><span>${renderInline(task[2], ctx)}</span>`;
        } else {
          li.innerHTML = renderInline(m[3], ctx);
        }
        top.el.appendChild(li);
        i++;
      }
      if (firstList) root.appendChild(firstList);
      continue;
    }

    // | tables |
    if (line.includes("|") && isTableSep(lines[i + 1])) {
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":")
          ? "center"
          : c.endsWith(":")
            ? "right"
            : "",
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const wrap = document.createElement("div");
      wrap.className = "s-rv-tablewrap";
      const table = document.createElement("table");
      table.className = "s-rv-table";
      // COLUMN ORDER IS CONTENT, so the table takes its direction from its own
      // text, exactly as every other rendered block does. The cells already
      // carried `dir="auto"` and the table did not, so it inherited the SHELL:
      // an English table on an Arabic instance came out with its columns
      // reversed — "Column | Another" read "Another | Column" — while each
      // cell's own text sat the right way round inside it. An Arabic table
      // still reads right to left, because its own first strong character
      // says so.
      table.dir = "auto";
      const alignCls = (j: number): string =>
        aligns[j] ? ` class="s-rv-al-${aligns[j] === "center" ? "c" : "r"}"` : "";
      table.innerHTML =
        `<thead><tr>${header.map((c, j) => `<th${alignCls(j)} dir="auto">${renderInline(c, ctx)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows
          .map(
            (r) =>
              `<tr>${header.map((_c, j) => `<td${alignCls(j)} dir="auto">${renderInline(r[j] ?? "", ctx)}</td>`).join("")}</tr>`,
          )
          .join("")}</tbody>`;
      wrap.appendChild(table);
      root.appendChild(wrap);
      continue;
    }

    // [^label]: footnote definitions collect for the end-of-note section.
    const fd = FOOTDEF_RE.exec(line);
    if (fd) {
      const note = { label: fd[1], text: fd[2] };
      i++;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
        note.text += ` ${lines[i].trim()}`;
        i++;
      }
      ctx.footnotes.push(note);
      continue;
    }

    // standalone ![[embed]] lines become block embeds
    const be = BLOCK_EMBED_RE.exec(line);
    if (be) {
      root.appendChild(renderEmbedBlock(be[1], ctx));
      i++;
      continue;
    }

    // paragraph
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !startsBlock(lines[i], lines[i + 1])
    ) {
      para.push(lines[i]);
      i++;
    }
    const p = document.createElement("p");
    p.className = "s-rv-p";
    p.dir = "auto"; // Arabic/Hebrew paragraphs read right-to-left
    p.innerHTML = renderInline(para.join("\n"), ctx, true);
    root.appendChild(p);
  }
}

// ── Note-level rendering ────────────────────────────────────────────────────

function renderNote(md: string, ctx: Ctx, root: HTMLElement): void {
  let lines = md.replace(/\r\n/g, "\n").split("\n");

  // YAML frontmatter → properties card (top-level note only).
  if (lines[0]?.trim() === "---") {
    let close = -1;
    for (let j = 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "---" || t === "...") {
        close = j;
        break;
      }
    }
    if (close > 0) {
      if (ctx.depth === 0) {
        const yaml = lines.slice(1, close).join("\n");
        // Banner hero above the properties card (the blog shell hides this
        // and renders its own full-width hero instead).
        const banner = bannerFromYaml(yaml);
        if (banner) {
          // The note's own path is the relative base ("cover.png" beside it),
          // and `admin` decides whether an unresolvable value shows the
          // missing-image card or nothing at all. `admin` is already false
          // while previewing as a visitor, which is the answer this wants.
          root.appendChild(
            buildBannerEl(banner, "s-rv-banner", {
              notePath: ctx.notePath,
              admin: useStore.getState().admin,
            }),
          );
        }
        const card = propsCard(yaml);
        if (card) root.appendChild(card);
      }
      lines = lines.slice(close + 1);
    }
  }

  renderBlocks(lines, ctx, root);

  // Footnote definitions render as a hairline section at the end.
  if (ctx.footnotes.length > 0 && ctx.depth === 0) {
    const sec = document.createElement("section");
    sec.className = "s-rv-footnotes";
    const ol = document.createElement("ol");
    for (const f of ctx.footnotes) {
      const li = document.createElement("li");
      li.id = `fn-${f.label}`;
      li.innerHTML = `${renderInline(f.text, ctx)} <a class="s-rv-fnback" data-fnback="${esc(f.label)}" role="link" tabindex="0" title="${esc(t("backToReference"))}" aria-label="${esc(t("backToReference"))}">↩</a>`;
      ol.appendChild(li);
    }
    sec.appendChild(ol);
    root.appendChild(sec);
  }

  // Hydrate ![[image]] embeds that came through innerHTML.
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-embed-name]")) {
    const name = img.dataset.embedName;
    if (name) {
      delete img.dataset.embedName;
      attachEmbedSrc(img, name, ctx.missingImages ?? "placeholder");
    }
  }

  // Swap any pending math for rendered KaTeX once the lazy module lands.
  hydrateMath(root);
}

// ── Root click delegation ───────────────────────────────────────────────────

/** Exported so the LaTeX renderer (reading/texRender.ts) can attach the SAME
 *  delegated handler: a `\note{…}` link, a `#tag` pill and a footnote hop must
 *  behave identically no matter which format the note was written in. */
export function onRootClick(ev: MouseEvent): void {
  if (ev.button !== 0) return;
  const target = ev.target as HTMLElement;
  const scope = (target.closest(".s-rv") as HTMLElement | null) ?? document.body;

  const wl = target.closest<HTMLElement>(".s-rv-wikilink");
  if (wl) {
    ev.preventDefault();
    // A citation into a book. The opener is loaded on the click rather than
    // imported here: this module renders the blog's articles as well as the
    // vault's, and a reader of one published essay must not download the book
    // reader's door to find out they never clicked a citation.
    const book = wl.dataset.book;
    const anchorText = wl.dataset.anchor;
    if (book !== undefined && anchorText !== undefined) {
      const anchor = parseBookAnchor(anchorText);
      const store = useStore.getState();
      if (anchor !== null && store.admin) {
        const from = wl.dataset.citeNote ?? "";
        void import("../books/door.ts").then((mod) =>
          mod.openBookCitation(book, anchor, store.tree, from),
        );
      } else if (anchor !== null) {
        toast(tf("linkNotPublished", { name: book }));
      }
      return;
    }
    const name = wl.dataset.target ?? "";
    const heading = wl.dataset.heading;
    if (!name && heading) {
      // [[#Heading]] within the same note.
      window.dispatchEvent(
        new CustomEvent("vellum:goto-heading", { detail: { text: heading } }),
      );
      return;
    }
    const store = useStore.getState();
    const path = resolveLink(name, store.tree);
    if (path) {
      if (heading) store.setPendingHeading(heading);
      store.openNote(path);
    } else if (!store.admin) {
      // Visitors can't create the missing note — and on a curated published
      // site the target usually exists but is private, so say that (with the
      // display label, never a raw internal vault path).
      const rendered = wl.textContent?.trim();
      const display =
        rendered && !rendered.includes("/")
          ? rendered
          : noteTitleOf(name);
      toast(tf("linkNotPublished", { name: display }));
    } else {
      // Unresolved link: clicking it creates the note (Obsidian behavior).
      const notePath = isNotePath(name) ? name : `${name}.md`;
      toast(tf("creatingNote", { name }));
      void store.createNote(notePath);
    }
    return;
  }

  const tag = target.closest<HTMLElement>(".s-rv-tag");
  if (tag?.dataset.tag) {
    ev.preventDefault();
    window.dispatchEvent(
      new CustomEvent("vellum:search", { detail: `#${tag.dataset.tag}` }),
    );
    return;
  }

  const ref = target.closest<HTMLElement>("[data-fn]");
  if (ref?.dataset.fn) {
    ev.preventDefault();
    scope
      .querySelector(`#fn-${CSS.escape(ref.dataset.fn)}`)
      ?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    return;
  }
  const back = target.closest<HTMLElement>("[data-fnback]");
  if (back?.dataset.fnback) {
    ev.preventDefault();
    scope
      .querySelector(`#fnref-${CSS.escape(back.dataset.fnback)}`)
      ?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Render a whole note to a detached element tree (class "s-rv"). */
export function renderMarkdown(md: string, opts: RenderOptions): HTMLElement {
  const ctx: Ctx = {
    ...opts,
    depth: opts.embedded ? 1 : 0,
    ancestors: new Set([...(opts.ancestors ?? []), opts.notePath]),
    slugger: new Slugger(),
    footnotes: [],
    assignIds: !opts.embedded,
  };
  const root = document.createElement("div");
  root.className = "s-rv";
  renderNote(md, ctx, root);
  root.addEventListener("click", onRootClick);
  // Keyboard twin of the click delegation: the wikilinks, footnote refs and
  // back-refs above are href-less anchors, so nothing but this makes Enter
  // and Space do what a pointer does.
  root.addEventListener("keydown", (ev) => {
    activateOnKey(ev, ".s-rv-wikilink, [data-fn], [data-fnback]");
  });
  return root;
}
