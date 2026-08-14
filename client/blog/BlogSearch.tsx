// Inline expanding search for the blog nav. The magnifier expands into an
// input; results (server /api/search — published notes only for visitors)
// drop down as a list. ↑/↓ + Enter navigate, Escape or an outside click closes.

import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "../../shared/types.ts";
import { search } from "../api.ts";
import { renderSnippet, snippetIsEmpty } from "../components/snippet.tsx";
import { notePathToUrl } from "../router.ts";
import { go } from "./nav.ts";

const DEBOUNCE_MS = 180;

export default function BlogSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const close = (): void => {
    setOpen(false);
    setQ("");
    setHits([]);
    setActive(0);
  };

  const pick = (hit: SearchHit | undefined): void => {
    if (!hit) return;
    go(notePathToUrl(hit.path));
    close();
  };

  // Debounced server search while typing.
  useEffect(() => {
    if (!open || q.trim() === "") {
      setHits([]);
      setActive(0);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      search(q, controller.signal)
        .then((list) => {
          setHits(list.slice(0, 8));
          setActive(0);
        })
        .catch(() => {
          // aborted or offline — keep what we have
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, open]);

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[active]);
    }
  };

  return (
    <div className={`s-blog-search${open ? " s-blog-search--open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="s-blog-iconbtn"
        aria-label={open ? "Close search" : "Search"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </button>
      {open && (
        <>
          <input
            ref={inputRef}
            className="s-blog-search__input"
            type="search"
            placeholder="Search writings…"
            value={q}
            dir="auto"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {q.trim() !== "" && (
            <ul className="s-blog-search__results" role="listbox">
              {hits.length === 0 ? (
                <li className="s-blog-search__none">No matches</li>
              ) : (
                hits.map((hit, i) => (
                  <li key={hit.path}>
                    <button
                      type="button"
                      className={`s-blog-search__hit${i === active ? " s-blog-search__hit--active" : ""}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(hit)}
                    >
                      <span className="s-blog-search__title" dir="auto">
                        {hit.title}
                      </span>
                      {!snippetIsEmpty(hit.snippet) && (
                        <span className="s-blog-search__snippet" dir="auto">
                          {renderSnippet(hit.snippet)}
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
