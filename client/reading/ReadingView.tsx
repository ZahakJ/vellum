// Reading view: the open note rendered to HTML (Ctrl/Cmd+E toggles it against
// the editor). Same typography column as the editor — the live preview minus
// the cursor affordances. Publishes the active heading while scrolling and
// answers "vellum:goto-heading" requests from the outline panel.

import { useEffect, useRef } from "react";
import { scrollBehavior } from "../a11y.ts";
import { getNote, isNotPublishedError } from "../api.ts";
import Marginalia from "../components/Marginalia.tsx";
import { t, tf } from "../i18n.ts";
import { Lru } from "../lru.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { numberRendered, useHeadingNumberTick } from "./headingNumbers.ts";
import { noteAnchors } from "../../shared/anchors.ts";
import { flashElement, takePendingLine } from "../landing.ts";
import { renderNoteContent } from "./renderNote.ts";
import { liveNoteText } from "../editor/bufferBridge.ts";
import { applyNoteLayoutTo } from "../textLayout.ts";
// Side-effect import — see the twin in components/Editor.tsx: `beforeprint`
// fires synchronously, so the handler has to be resident before the reader
// reaches for the print dialog, not fetched once they have.
import "../print.ts";
import "./reading.css";

/** Scroll positions survive tab switches; module-level so remounts keep them.
 *  Bounded because "every note read this session" is the whole vault on a
 *  long day — 256 is far more history than a reader ever walks back through. */
const scrollPositions = new Lru<number>({ max: 256 });

/** The rendered element a source line lands on: the nearest heading
 *  at-or-above the line, found through the note's own anchor table
 *  (shared/anchors.ts — the same table `[[Note#anchor]]` resolves against, so
 *  the two kinds of landing cannot disagree about where a section starts).
 *  Null when no preceding anchor renders an element — the caller falls back
 *  to the note top. Section-level precision is the honest ceiling here: this
 *  renderer keeps no per-block source map (CONTRACTS — "Landing on a line").
 *  Lives HERE and not in client/landing.ts because the anchor table drags the
 *  TeX parser with it, and the reading chunk already carries both. */
function readingLineTarget(
  host: HTMLElement,
  path: string,
  content: string,
  line: number,
): HTMLElement | null {
  const anchors = noteAnchors(path, content).filter((a) => a.line <= line);
  // Walk backward: the nearest anchor may be one the renderer assigns no id
  // to (a LaTeX label inside a paragraph) — the section above it still lands.
  for (let i = anchors.length - 1; i >= 0; i--) {
    const a = anchors[i];
    const el =
      host.querySelector<HTMLElement>(`#${CSS.escape(`tex-${a.id}`)}`) ??
      host.querySelector<HTMLElement>(`#${CSS.escape(a.id)}`);
    if (el !== null) return el;
    const want = a.title.trim().toLowerCase();
    const byText = [...host.querySelectorAll<HTMLElement>(".s-rv-h")].find(
      (h) => (h.textContent ?? "").trim().toLowerCase() === want,
    );
    if (byText !== undefined) return byText;
  }
  return null;
}

function publishActive(host: HTMLElement): void {
  const heads = host.querySelectorAll<HTMLElement>(".s-rv-h[id]");
  const top = host.getBoundingClientRect().top;
  let active: string | null = null;
  for (const h of heads) {
    if (h.getBoundingClientRect().top - top <= 96) active = h.id;
    else break;
  }
  // At the very top nothing has crossed the line yet — light the first section.
  if (active === null && heads.length > 0) active = heads[0].id;
  window.dispatchEvent(new CustomEvent("vellum:active-heading", { detail: active }));
}

export default function ReadingView({ path }: { path: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The rendered markdown lives in its own child div so React siblings
  // (Marginalia) survive the imperative replaceChildren below.
  const bodyRef = useRef<HTMLElement | null>(null);
  // The raw source of what is on screen, for the line-based landings below:
  // mapping a SOURCE line to a rendered element needs the note's own anchor
  // table, and the goto handler runs outside the load effect's closure.
  const contentRef = useRef<string | null>(null);
  const tree = useStore((s) => s.tree);
  const isDirty = useStore((s) => !!s.dirty[path]);
  // The rendered body carries t() chrome (properties card, transclusion cards,
  // the empty-note hint), and it is imperative DOM — so this component's own
  // subscription to `language` is what re-renders it on a live settings flip.
  const language = useStore((s) => s.language);
  const siteTextDirection = useStore((s) => s.textDirection);
  const siteTextAlign = useStore((s) => s.textAlign);
  // Auto-numbered headings: a reading affordance, off by default, overridden
  // per note by frontmatter `numbered:`. The tick repaints when the outline
  // panel's "1." toggle flips the device preference (reading/headingNumbers.ts).
  const numberTick = useHeadingNumberTick();

  // Load + render (re-runs when the tree resolves or a pending save lands).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    // THE OPEN DOCUMENT OUTRANKS THE DISK. If this note is open in an editor
    // (the reader just pressed Ctrl+E on it), its buffer is the truth, and the
    // server's copy may be an autosave behind — which is how a freshly typed
    // note read as empty the moment reading mode was entered.
    const live = liveNoteText(path);
    const load = live !== null ? Promise.resolve({ content: live }) : getNote(path);
    load
      .then((note) => {
        if (disposed || !hostRef.current) return;
        const el = renderNoteContent(note.content, {
          notePath: path,
          tree: useStore.getState().tree,
        });
        el.classList.add("s-reading__content");
        // The site's direction/alignment, or whatever this note's own
        // frontmatter `dir:`/`align:` asks for instead. The SAME call the blog
        // article makes on the SAME element, which is what makes "identical in
        // the editor, the reading view and the blog" true by construction.
        applyNoteLayoutTo(el, note.content);
        if (note.content.trim() === "") {
          const hint = document.createElement("p");
          hint.className = "s-reading__empty";
          hint.textContent = t(
            useStore.getState().admin ? "emptyNoteAdmin" : "emptyNoteVisitor",
          );
          el.appendChild(hint);
        }
        numberRendered(el, note.content);
        contentRef.current = note.content;
        bodyRef.current?.replaceChildren(el);
        // [[Note#Heading]] navigation: land on the requested heading.
        const pending = useStore.getState().pendingHeading;
        if (pending !== null) {
          useStore.getState().setPendingHeading(null);
          const want = pending.trim().toLowerCase();
          // A LaTeX anchor is a \label, not a heading's text, so the id is
          // tried first — `[[Paper#eq:fourier]]` lands on the equation, not on
          // nothing. Heading-text matching stays as the markdown fallback.
          const byId =
            hostRef.current.querySelector<HTMLElement>(
              `#${CSS.escape(`tex-${pending.trim()}`)}`,
            ) ?? hostRef.current.querySelector<HTMLElement>(`#${CSS.escape(pending.trim())}`);
          const target =
            byId ??
            [...hostRef.current.querySelectorAll<HTMLElement>(".s-rv-h")].find(
              (h) => (h.textContent ?? "").trim().toLowerCase() === want,
            );
          if (target) {
            const hostTop = hostRef.current.getBoundingClientRect().top;
            hostRef.current.scrollTop =
              target.getBoundingClientRect().top -
              hostTop +
              hostRef.current.scrollTop -
              28;
            publishActive(hostRef.current);
            return;
          }
        }
        // Line-based landing (a backlink's mention, a search match): the same
        // one-shot-at-mount shape pendingHeading has, from client/landing.ts.
        // SECTION precision, honestly: the renderer keeps no per-block source
        // map, so the landing is the nearest heading at-or-above the line —
        // and the note TOP when nothing precedes it (CONTRACTS, "Landing on
        // a line"). The mark makes the imprecision legible: the reader sees
        // which section they were put in, not a silent almost-right scroll.
        const pendingLine = takePendingLine(path);
        if (pendingLine !== null) {
          const target = readingLineTarget(hostRef.current, path, note.content, pendingLine);
          if (target !== null) {
            const hostTop = hostRef.current.getBoundingClientRect().top;
            hostRef.current.scrollTop =
              target.getBoundingClientRect().top - hostTop + hostRef.current.scrollTop - 28;
            flashElement(target);
          } else {
            hostRef.current.scrollTop = 0;
          }
          publishActive(hostRef.current);
          return;
        }
        const saved = scrollPositions.get(path);
        if (saved !== undefined) hostRef.current.scrollTop = saved;
        publishActive(hostRef.current);
      })
      .catch((err: unknown) => {
        // Previewing as a visitor, the server 404s an unpublished note
        // because that is the RIGHT answer for a visitor. Reporting it as
        // "Failed to open <path>" made the eye button — the feature whose
        // whole job is letting the owner inspect his own site — open with a
        // fault report about a site that is fine.
        if (isNotPublishedError(err)) {
          toast(t("previewNotPublished"));
          return;
        }
        console.error(`vellum: failed to open ${path} for reading`, err);
        toast(tf("openFailed", { path }), "error");
      });
    return () => {
      disposed = true;
      scrollPositions.set(path, host.scrollTop);
    };
    // The site's note-layout defaults are dependencies for the same reason
    // `language` is: they are half of what `applyNoteLayoutTo` resolves, and a
    // settings save has to repaint the open note rather than waiting for it to
    // be reopened.
  }, [path, tree, isDirty, language, numberTick, siteTextDirection, siteTextAlign]);

  // Active-heading tracking while scrolling.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => publishActive(host));
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      host.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      window.dispatchEvent(
        new CustomEvent("vellum:active-heading", { detail: null }),
      );
    };
  }, []);

  // Outline clicks: smooth-scroll to the heading.
  useEffect(() => {
    const onGoto = (ev: Event): void => {
      const host = hostRef.current;
      if (!host) return;
      const detail =
        (ev as CustomEvent<{ slug?: string; text?: string; line?: number; path?: string }>)
          .detail ?? {};
      // A goto that names a note is for that note's pane only — without this,
      // a line-goto raised for one pane would scroll every reading pane on
      // screen. Untargeted gotos (the outline's, unchanged) behave as before.
      if (detail.path !== undefined && detail.path !== path) return;
      let el: HTMLElement | null = null;
      if (typeof detail.line === "number" && contentRef.current !== null) {
        // Same section-precision mapping the mount-time landing uses.
        el = readingLineTarget(host, path, contentRef.current, detail.line);
        if (el === null) {
          host.scrollTo({ top: 0, behavior: scrollBehavior() });
          return;
        }
        flashElement(el);
      }
      if (!el && detail.slug) {
        el = host.querySelector<HTMLElement>(`#${CSS.escape(detail.slug)}`);
      }
      if (!el && detail.text) {
        const want = detail.text.trim().toLowerCase();
        el =
          [...host.querySelectorAll<HTMLElement>(".s-rv-h")].find(
            (h) => (h.textContent ?? "").trim().toLowerCase() === want,
          ) ?? null;
      }
      if (!el) return;
      const top =
        el.getBoundingClientRect().top -
        host.getBoundingClientRect().top +
        host.scrollTop -
        28;
      host.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() });
    };
    window.addEventListener("vellum:goto-heading", onGoto);
    return () => window.removeEventListener("vellum:goto-heading", onGoto);
  }, []);

  return (
    // The prose column is its own scroll container, and a scroll container
    // that nothing can focus cannot be scrolled with the keyboard at all —
    // PageDown does nothing, the note is unreadable without a mouse. The tab
    // stop is the fix, and it needs a name so the stop is not a mystery.
    <div
      className="s-reading"
      ref={hostRef}
      tabIndex={0}
      role="region"
      aria-label={t("articleContent")}
    >
      <article className="s-reading__body" ref={bodyRef} />
      <Marginalia path={path} />
    </div>
  );
}
