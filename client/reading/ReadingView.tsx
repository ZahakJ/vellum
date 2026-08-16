// Reading view: the open note rendered to HTML (Ctrl/Cmd+E toggles it against
// the editor). Same typography column as the editor — the live preview minus
// the cursor affordances. Publishes the active heading while scrolling and
// answers "vellum:goto-heading" requests from the outline panel.

import { useEffect, useRef } from "react";
import { scrollBehavior } from "../a11y.ts";
import { getNote } from "../api.ts";
import Marginalia from "../components/Marginalia.tsx";
import { t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { renderMarkdown } from "./render.ts";
import "./reading.css";

/** Scroll positions survive tab switches; module-level so remounts keep them. */
const scrollPositions = new Map<string, number>();

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
  const tree = useStore((s) => s.tree);
  const isDirty = useStore((s) => !!s.dirty[path]);
  // The rendered body carries t() chrome (properties card, transclusion cards,
  // the empty-note hint), and it is imperative DOM — so this component's own
  // subscription to `language` is what re-renders it on a live settings flip.
  const language = useStore((s) => s.language);

  // Load + render (re-runs when the tree resolves or a pending save lands).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    getNote(path)
      .then((note) => {
        if (disposed || !hostRef.current) return;
        const el = renderMarkdown(note.content, {
          notePath: path,
          tree: useStore.getState().tree,
        });
        el.classList.add("s-reading__content");
        if (note.content.trim() === "") {
          const hint = document.createElement("p");
          hint.className = "s-reading__empty";
          hint.textContent = t(
            useStore.getState().admin ? "emptyNoteAdmin" : "emptyNoteVisitor",
          );
          el.appendChild(hint);
        }
        bodyRef.current?.replaceChildren(el);
        // [[Note#Heading]] navigation: land on the requested heading.
        const pending = useStore.getState().pendingHeading;
        if (pending !== null) {
          useStore.getState().setPendingHeading(null);
          const want = pending.trim().toLowerCase();
          const target = [
            ...hostRef.current.querySelectorAll<HTMLElement>(".s-rv-h"),
          ].find((h) => (h.textContent ?? "").trim().toLowerCase() === want);
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
        const saved = scrollPositions.get(path);
        if (saved !== undefined) hostRef.current.scrollTop = saved;
        publishActive(hostRef.current);
      })
      .catch((err: unknown) => {
        console.error(`vellum: failed to open ${path} for reading`, err);
        toast(tf("openFailed", { path }));
      });
    return () => {
      disposed = true;
      scrollPositions.set(path, host.scrollTop);
    };
  }, [path, tree, isDirty, language]);

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
        (ev as CustomEvent<{ slug?: string; text?: string }>).detail ?? {};
      let el: HTMLElement | null = null;
      if (detail.slug) {
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
