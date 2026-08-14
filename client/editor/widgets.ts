// Embed widgets for live preview: ![[image.png]] / ![[image.png|300]] inline
// images, standard ![alt](src) images, ![[file.pdf]] (and other attachment)
// card links, and ![[Note]] transclusion cards (depth 1, cycle-safe).
//
// Attachment names resolve through GET /api/resolve?name= (B1) with an
// in-memory cache; when the endpoint is unavailable or the name is unknown the
// name itself is tried as a vault path and the <img> onerror fallback shows a
// dashed broken-embed placeholder. Notes resolve client-side against the tree.
//
// Transclusion cards render their body with the reading-view renderer
// (client/reading/render.ts, embedded mode), so callouts, math, footnotes and
// code highlighting look identical in live preview and reading view.

import { WidgetType, type EditorView } from "@codemirror/view";
import { getNote } from "../api.ts";
import { useStore } from "../state.ts";
import {
  markTransclusionOverflow,
  renderMarkdown,
} from "../reading/render.ts";
import "../reading/reading.css";

// ── Embed classification & resolution: shared, CM-free helpers ──────────────
// (extracted to embeds.ts so the reading view can use them without pulling
// the CodeMirror bundle; re-exported here for existing imports)

import {
  brokenEmbed,
  embedKnownBroken,
  fileUrl,
  markEmbedBroken,
  parseEmbed,
  resolveAttachment,
  resolveRelative,
} from "./embeds.ts";
export type { EmbedParts } from "./embeds.ts";
export { brokenEmbed, fileUrl, parseEmbed, resolveAttachment, resolveRelative };

// ── Image widget ────────────────────────────────────────────────────────────

export class ImageWidget extends WidgetType {
  constructor(
    readonly name: string, // display name for the broken placeholder
    readonly src: string | null, // final URL, or null → resolve name first
    readonly width: number | null,
  ) {
    super();
  }
  override eq(other: ImageWidget): boolean {
    return (
      other.name === this.name &&
      other.src === this.src &&
      other.width === this.width
    );
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-s-embed-image";
    const mount = (url: string): void => {
      // Known-404s render the placeholder straight away — decoration rebuilds
      // must not re-request a missing file over and over.
      if (embedKnownBroken(url) || embedKnownBroken(this.name)) {
        wrap.replaceChildren(brokenEmbed(this.name));
        return;
      }
      const img = document.createElement("img");
      img.alt = this.name;
      img.draggable = false;
      if (this.width) img.style.width = `${this.width}px`;
      img.onerror = () => {
        markEmbedBroken(url);
        wrap.replaceChildren(brokenEmbed(this.name));
      };
      img.src = url;
      wrap.replaceChildren(img);
    };
    if (this.src !== null) {
      mount(this.src);
    } else {
      const resolved = resolveAttachment(this.name);
      if (typeof resolved === "string") mount(fileUrl(resolved));
      else if (resolved === null) wrap.replaceChildren(brokenEmbed(this.name));
      else {
        wrap.appendChild(brokenEmbed(this.name)); // interim, swapped on resolve
        void resolved.then((path) => {
          if (wrap.isConnected && path) mount(fileUrl(path));
        });
      }
    }
    return wrap;
  }
  override ignoreEvent(): boolean {
    return false; // clicks land in the editor → cursor moves next to the embed
  }
}

// ── Attachment card (pdf & friends): opens /api/file in a new tab ───────────

export class FileCardWidget extends WidgetType {
  constructor(readonly name: string) {
    super();
  }
  override eq(other: FileCardWidget): boolean {
    return other.name === this.name;
  }
  toDOM(): HTMLElement {
    const a = document.createElement("a");
    a.className = "cm-s-embed-file";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const icon = document.createElement("span");
    icon.className = "cm-s-embed-file__icon";
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
    const label = document.createElement("span");
    label.className = "cm-s-embed-file__name";
    label.textContent = this.name;
    const ext = this.name.includes(".")
      ? this.name.slice(this.name.lastIndexOf(".") + 1).toUpperCase()
      : "FILE";
    const badge = document.createElement("span");
    badge.className = "cm-s-embed-file__badge";
    badge.textContent = ext;
    a.append(icon, label, badge);
    const resolved = resolveAttachment(this.name);
    const setHref = (path: string | null): void => {
      if (path) a.href = fileUrl(path);
    };
    if (typeof resolved === "string" || resolved === null) setHref(resolved);
    else void resolved.then((path) => setHref(path));
    return a;
  }
  // default ignoreEvent() → true: the browser handles the <a> click itself
}

// ── Note transclusion card ──────────────────────────────────────────────────

const noteCache = new Map<string, { content: string; at: number }>();
const NOTE_CACHE_MS = 15_000;

export class TransclusionWidget extends WidgetType {
  constructor(
    readonly target: string, // raw wikilink target (display)
    readonly path: string | null, // resolved vault path, null → broken
    readonly hostPath: string, // note the embed appears in (cycle guard)
  ) {
    super();
  }
  override eq(other: TransclusionWidget): boolean {
    return (
      other.target === this.target &&
      other.path === this.path &&
      other.hostPath === this.hostPath
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("span");
    card.className = "cm-s-transclude";

    const title = this.path
      ? this.path.split("/").pop()!.replace(/\.md$/i, "")
      : this.target;
    const header = document.createElement("span");
    header.className = "cm-s-transclude__title";
    header.textContent = title;
    header.title = this.path ? `Open ${title}` : "";
    card.appendChild(header);

    const body = document.createElement("span");
    body.className = "cm-s-transclude__body";
    card.appendChild(body);

    if (!this.path) {
      card.classList.add("cm-s-transclude--broken");
      body.textContent = `No note named “${this.target}”`;
      return card;
    }
    if (this.path === this.hostPath) {
      body.textContent = "This note embeds itself.";
      body.classList.add("cm-s-transclude__note");
      return card;
    }

    const path = this.path;
    header.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      useStore.getState().openNote(path);
    });

    const hostPath = this.hostPath;
    const render = (content: string): void => {
      // Full-fidelity body via the reading-view renderer (embedded mode:
      // nested note embeds render as chips, cycle-safe via ancestors).
      body.replaceChildren(
        renderMarkdown(content, {
          notePath: path,
          tree: useStore.getState().tree,
          embedded: true,
          ancestors: new Set([hostPath]),
        }),
      );
      markTransclusionOverflow(
        card,
        body,
        "cm-s-transclude--overflow",
        "cm-s-transclude__more",
        () => useStore.getState().openNote(path),
      );
      // widget height changed after async render — tell CM to re-measure
      view.requestMeasure();
    };
    const cached = noteCache.get(path);
    if (cached && Date.now() - cached.at < NOTE_CACHE_MS) {
      render(cached.content);
    } else {
      body.textContent = "…";
      getNote(path)
        .then((note) => {
          noteCache.set(path, { content: note.content, at: Date.now() });
          if (card.isConnected) render(note.content);
        })
        .catch(() => {
          if (card.isConnected) body.textContent = "Could not load note.";
        });
    }
    return card;
  }
}
