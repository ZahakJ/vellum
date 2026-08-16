// A STATIC PAGE — About, Contact, Colophon.
//
// The whole point of the page layout is what it does NOT render. An article
// carries a date, a reading time, tag chips, prev/next by date, related posts
// and comments, because those answer "when was this written and what else is
// like it". None of those questions are asked of a Contact page, and the
// stock article layout answers them anyway — "3 min read · 14 August 2026"
// over an address is a small absurdity that tells the reader the site does
// not know what its own pages are.
//
// So: the title, the prose, and nothing else. It is the same note, rendered
// by the same reading renderer, at the same measure as everything else on the
// designed site.

import { useEffect, useRef, useState } from "react";
import { stripBidiControls } from "../../shared/bidi.ts";
import { getNote, isNotPublishedError } from "../api.ts";
import { t } from "../i18n.ts";
import { renderMarkdown } from "../reading/render.ts";
import { useStore } from "../state.ts";
import { NavLink } from "../blog/util.tsx";
import "../reading/reading.css";

/** Notes usually open with "# <their own title>", which the page already
 *  prints as its heading. Same rule the article page applies. */
function dropDuplicateTitle(root: HTMLElement, title: string): void {
  const h1 = root.querySelector(".s-rv-h1");
  if (h1 && (h1.textContent ?? "").trim().toLowerCase() === title.trim().toLowerCase()) {
    h1.remove();
  }
}

export default function PageView({ path }: { path: string }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const tree = useStore((s) => s.tree);
  const language = useStore((s) => s.language);
  const [failed, setFailed] = useState(false);
  const title = stripBidiControls(path.split("/").pop()!.replace(/\.md$/i, ""));

  // Keep the store's notion of "the open note" in step — same-note heading
  // links and the hover cards read it.
  useEffect(() => {
    useStore.setState({ openPath: path });
  }, [path]);

  useEffect(() => {
    const host = bodyRef.current;
    if (!host) return;
    let disposed = false;
    setFailed(false);
    getNote(path)
      .then((note) => {
        if (disposed || !bodyRef.current) return;
        const el = renderMarkdown(note.content, {
          notePath: path,
          tree: useStore.getState().tree,
          // A public page gets no broken-link furniture, exactly like an
          // article: unresolvable wikilinks read as plain text.
          brokenLinks: "plain",
          missingImages: "card",
          // A page is not in the feed, so it has no server-filtered tag list
          // to allowlist against — and a page's inline #tags are notes to
          // self, not topics. None of them become pills.
          visibleTags: new Set<string>(),
        });
        el.classList.add("s-reading__content");
        dropDuplicateTitle(el, title);
        bodyRef.current.replaceChildren(el);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        // A 404 while previewing as a visitor is the CORRECT answer (the page
        // is not published) and must not be dressed as a fault — the same
        // rule the reading view follows.
        if (!isNotPublishedError(err)) console.error("vellum: page load failed", err);
        setFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, [path, tree, language, title]);

  if (failed) {
    return (
      <div className="s-blog-page s-blog-locked">
        <div className="s-blog-locked__glyph" aria-hidden="true">
          ✦
        </div>
        <p className="s-blog-locked__title">{t("blogNoPage")}</p>
        <NavLink url="/" className="s-blog-locked__home">
          <span className="s-blog-backarrow" aria-hidden="true">
            ←
          </span>
          {t("blogBackToWritings")}
        </NavLink>
      </div>
    );
  }

  return (
    <article className="s-blog-page s-dsg-page">
      <h1 className="s-dsg-page__title" dir="auto">
        {title}
      </h1>
      <div ref={bodyRef} />
    </article>
  );
}
