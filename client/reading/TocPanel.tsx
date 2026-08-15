// Outline (TOC) section for the right panel, shown above Backlinks: the open
// note's headings, click-to-scroll (the reading view smooth-scrolls; the
// editor jumps its CM view), with the active heading highlighted while the
// reading view scrolls.

import { useEffect, useState } from "react";
import { getNote } from "../api.ts";
import { localeNum, t } from "../i18n.ts";
import { useStore } from "../state.ts";
import { extractHeadings, type Heading } from "./toc.ts";

export default function TocPanel() {
  const openPath = useStore((s) => s.openPath);
  const isDirty = useStore((s) => (s.openPath ? !!s.dirty[s.openPath] : false));
  const reloadTick = useStore((s) => s.reloadTick);
  const readingMode = useStore((s) => s.readingMode);
  useStore((s) => s.language); // re-render the chrome strings on language change
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
        // Furniture headings (sections that are only link/tag lists, e.g. a
        // trailing "Tags:") stay out of the outline; their ids still exist
        // in the reading view so in-page anchors keep working.
        if (!cancelled) setHeadings(extractHeadings(note.content).filter((h) => !h.furniture));
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
        <span className="s-panel-title">{t("outline")}</span>
        <span className="s-panel-count">{localeNum(headings.length)}</span>
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
            {/* The ROW is chrome: it keeps the shell's direction, so every
                entry aligns to the same edge as the panel header, the indent
                levels step inward from that edge and the active-row accent bar
                stays attached to the row it marks. Only the LABEL is note
                content, and it is isolated so an English heading in an Arabic
                vault still reads "Tags:" rather than ":Tags". `dir="auto"` on
                the row itself did both jobs at once and got the first one
                wrong — a Latin heading dragged its whole row to the far side
                of the panel. */}
            <bdi>{h.text}</bdi>
          </button>
        ))}
      </nav>
    </section>
  );
}
