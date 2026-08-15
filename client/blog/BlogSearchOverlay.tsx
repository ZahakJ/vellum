// Centered search overlay for the blog shell, opened with Ctrl/Cmd+K (App
// dispatches "vellum:quicksearch"; whichever shell is mounted owns it).
// Styled like the app's command palette — same s-palette classes — but it is
// pure search: results are the visitor's published hits (the server scopes
// /api/search by session), Enter navigates, Esc or a backdrop click closes.

import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "../../shared/types.ts";
import { search } from "../api.ts";
import { renderSnippet, snippetIsEmpty } from "../components/snippet.tsx";
import { notePathToUrl } from "../router.ts";
import { go } from "./nav.ts";

const DEBOUNCE_MS = 150;

export default function BlogSearchOverlay() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
        className="s-palette"
        role="dialog"
        aria-label="Search"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="s-palette-input"
          type="text"
          value={q}
          dir="auto"
          placeholder="Search the writings…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        {q.trim() !== "" && (
          <div className="s-palette-list" ref={listRef}>
            {hits.length > 0 && <div className="s-palette-section">Writings</div>}
            {hits.map((hit, i) => (
              <div
                key={hit.path}
                className={`s-palette-item${i === active ? " s-palette-item--active" : ""}`}
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
            {hits.length === 0 && <div className="s-palette-empty">No matches</div>}
          </div>
        )}
      </div>
    </div>
  );
}
