// Outline (TOC) section for the right panel, shown above Backlinks: the open
// note's headings, click-to-scroll (the reading view smooth-scrolls; the
// editor jumps its CM view), with the active heading highlighted while the
// reading view scrolls.

import { useEffect, useState } from "react";
import { getNote } from "../api.ts";
import { useStore } from "../state.ts";
import { extractHeadings, type Heading } from "./toc.ts";

export default function TocPanel() {
  const openPath = useStore((s) => s.openPath);
  const isDirty = useStore((s) => (s.openPath ? !!s.dirty[s.openPath] : false));
  const reloadTick = useStore((s) => s.reloadTick);
  const readingMode = useStore((s) => s.readingMode);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!openPath) {
      setHeadings([]);
      return;
    }
    if (isDirty) return; // recount once the autosave lands
    let cancelled = false;
    getNote(openPath)
      .then((note) => {
        if (!cancelled) setHeadings(extractHeadings(note.content));
      })
      .catch((err: unknown) => {
        console.error("vellum: loading note for outline failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [openPath, isDirty, reloadTick]);

  useEffect(() => {
    const onActive = (ev: Event): void => {
      setActive((ev as CustomEvent<string | null>).detail);
    };
    window.addEventListener("vellum:active-heading", onActive);
    return () => window.removeEventListener("vellum:active-heading", onActive);
  }, []);

  useEffect(() => {
    if (!readingMode) setActive(null);
  }, [readingMode]);
  useEffect(() => {
    setActive(null);
  }, [openPath]);

  if (!openPath || headings.length === 0) return null;

  return (
    <section className="s-toc">
      <header className="s-panel-header s-toc__header">
        <span className="s-panel-title">Outline</span>
        <span className="s-panel-count">{headings.length}</span>
      </header>
      <nav className="s-toc__list">
        {headings.map((h) => (
          <button
            key={`${h.slug}:${h.line}`}
            type="button"
            className={`s-toc__item s-toc__item--l${h.level}${
              active === h.slug ? " s-toc__item--active" : ""
            }`}
            title={h.text}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("vellum:goto-heading", {
                  detail: { slug: h.slug, line: h.line, text: h.text },
                }),
              )
            }
          >
            {h.text}
          </button>
        ))}
      </nav>
    </section>
  );
}
