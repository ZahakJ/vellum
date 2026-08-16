// Centered search overlay for the blog shell, opened with Ctrl/Cmd+K (App
// dispatches "vellum:quicksearch"; whichever shell is mounted owns it).
// Styled like the app's command palette — same s-palette classes — but it is
// pure search: results are the visitor's published hits (the server scopes
// /api/search by session), Enter navigates, Esc or a backdrop click closes.

import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "../../shared/types.ts";
import { useDialog } from "../a11y.ts";
import { search } from "../api.ts";
import { localeNum, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { renderSnippet, snippetIsEmpty } from "../components/snippet.tsx";
import { notePathToUrl } from "../router.ts";
import { go } from "./nav.ts";

const DEBOUNCE_MS = 150;

export default function BlogSearchOverlay() {
  useStore((s) => s.language); // re-render chrome strings on a live language switch
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Tab stays in the overlay; closing puts focus back on whatever the reader
  // was on when they pressed Ctrl+K. (The input focuses itself below, and the
  // overlay's own onKeyDown owns Escape.)
  useDialog(panelRef, { active: open, manualFocus: true });

  useEffect(() => {
    const onQuick = () => {
      setOpen(true);
      // Already open: a repeat press just refocuses the input.
      inputRef.current?.focus();
    };
    window.addEventListener("vellum:quicksearch", onQuick);
    return () => window.removeEventListener("vellum:quicksearch", onQuick);
  }, []);

  // Focus lands after the overlay has actually rendered.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = (): void => {
    setOpen(false);
    setQ("");
    setHits([]);
    setActive(0);
  };

  // Debounced server search while typing.
  useEffect(() => {
    if (!open || q.trim() === "") {
      setHits([]);
      setActive(0);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      search(q, ctrl.signal)
        .then((list) => {
          setHits(list);
          setActive(0);
        })
        .catch(() => {
          // aborted or offline — keep what we have
        });
    }, DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [q, open]);

  // Keep the selected row visible while arrowing through results.
  useEffect(() => {
    listRef.current
      ?.querySelector(".s-palette-item--active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active, hits]);

  if (!open) return null;

  const pick = (hit: SearchHit | undefined): void => {
    if (!hit) return;
    go(notePathToUrl(hit.path));
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(0, hits.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[active]);
    }
  };

  return (
    <div className="s-palette-overlay" onMouseDown={close}>
      <div
        ref={panelRef}
        className="s-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("blogSearchOpen")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Same shape as the app palette: a combobox whose options live in a
            sibling listbox, named by aria-activedescendant as the arrows move. */}
        <input
          ref={inputRef}
          className="s-palette-input"
          type="text"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls="s-blogsearch-list"
          aria-autocomplete="list"
          aria-activedescendant={hits[active] ? `s-blogsearch-opt-${active}` : undefined}
          aria-label={t("blogSearchOpen")}
          value={q}
          dir="auto"
          placeholder={t("blogSearchPlaceholder")}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {q.trim() !== "" && (
          <>
            <p className="s-sr-only" role="status">
              {hits.length === 0
                ? t("noResultsAria")
                : tf("resultCount", { count: localeNum(hits.length) })}
            </p>
          <div
            className="s-palette-list"
            id="s-blogsearch-list"
            role="listbox"
            aria-label={t("blogWritings")}
            ref={listRef}
          >
            {hits.length > 0 && (
              <div className="s-palette-section" role="presentation">
                {t("blogWritings")}
              </div>
            )}
            {hits.map((hit, i) => (
              <div
                key={hit.path}
                id={`s-blogsearch-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`s-palette-item${i === active ? " s-palette-item--active" : ""}`}
                data-preview-path={hit.path}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(hit)}
              >
                <span className="s-palette-item-title" dir="auto">
                  {hit.title}
                </span>
                {!snippetIsEmpty(hit.snippet) && (
                  <span className="s-palette-item-snippet" dir="auto">
                    {renderSnippet(hit.snippet)}
                  </span>
                )}
              </div>
            ))}
            {hits.length === 0 && (
              <div className="s-palette-empty" role="presentation">
                {t("paletteNoMatches")}
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}
