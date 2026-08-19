// THE SHELF. Every PDF in the vault, as a wall of books.
//
// THE DEFAULT CARD IS A TYPOGRAPHIC PLATE, NOT A SPINNER. A four-hundred-book
// shelf cannot render four hundred covers before it paints, and the two usual
// answers to that are both wrong: a grid of spinners tells the reader their
// library is broken, and a grid of grey rectangles tells them nothing at all.
// So the resting state of a card is a designed object in its own right — the
// title set in the serif on `--bg-raised`, which is exactly what the spine of a
// book without a dust jacket looks like — and the cover, when it arrives,
// replaces it. A shelf whose covers never rendered would still be a usable,
// readable, unembarrassing shelf. That is the bar.
//
// Covers are requested as cards SCROLL INTO VIEW and cancelled as they leave
// (covers.ts holds the three-at-a-time queue and destroys every document the
// moment its bitmap exists). A reader who jumps to the bottom of a long shelf
// therefore gets the covers in front of them, not the four hundred they flew
// past.

import { useEffect, useMemo, useRef, useState } from "react";
import { boundingRect, progressOf, type BookAnchor, type BookState } from "../../shared/bookAnchor.ts";
import type { BookEntry, BookHighlightHit } from "../../shared/types.ts";
import { localeNum, t, tf } from "../i18n.ts";
import { shortcutKey } from "../keys.ts";
import { formatSize } from "../components/AttachmentViewer.tsx";
import { getAllHighlights, getBooks } from "./api.ts";
import { cachedCover, requestCover, type Cover } from "./covers.ts";
import { foldQuery } from "./search.ts";

/** The name a book is filed under when the file itself offers nothing: its
 *  own filename without the extension. Chosen by the person who put it in the
 *  vault, and therefore better than most /Title fields. */
function displayTitle(entry: BookEntry, cover: Cover | null): string {
  const fromState = entry.state?.title ?? "";
  const fromCover = cover?.title ?? "";
  return fromState || fromCover || entry.name.replace(/\.pdf$/i, "");
}

function displayAuthor(entry: BookEntry, cover: Cover | null): string {
  return entry.state?.author || cover?.author || "";
}

/** The folder a book sits in, for the second line of a card — the answer to
 *  "which of my three copies of this is this one". */
function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}

interface CardProps {
  entry: BookEntry;
  onOpen(path: string): void;
}

function BookCard({ entry, onOpen }: CardProps) {
  const [cover, setCover] = useState<Cover | null>(() => cachedCover(entry.key) ?? null);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (cover) return;
    const node = ref.current;
    if (!node) return;
    let cancelCover: (() => void) | null = null;
    // Cover work starts when the card is within a screen of the viewport, not
    // when it mounts: a shelf is a scroll container and mounting is not
    // looking. `rootMargin` buys one screenful of lead time so a steady scroll
    // meets finished covers rather than plates that pop.
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        cancelCover = requestCover(entry.key, entry.path, (result) => {
          if (result) setCover(result);
        });
      },
      { rootMargin: "600px" },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      cancelCover?.();
    };
  }, [cover, entry.key, entry.path]);

  const title = displayTitle(entry, cover);
  const author = displayAuthor(entry, cover);
  const state: BookState | null = entry.state;
  const pages = state?.pages || cover?.pages || 0;
  const progress = state ? progressOf({ ...state, pages: pages || state.pages }) : 0;
  const started = state !== null && progress > 0;

  const meta = [folderOf(entry.path), formatSize(entry.size)].filter(Boolean).join(" · ");

  return (
    <button
      ref={ref}
      type="button"
      className="s-shelf__card"
      onClick={() => onOpen(entry.path)}
      // The whole card is one control, so its accessible name has to carry
      // what a sighted reader gets from three lines of type at once.
      aria-label={
        started
          ? `${title}. ${tf("bookProgress", { percent: localeNum(Math.round(progress * 100)) })}`
          : title
      }
    >
      <span className="s-shelf__plate">
        {cover ? (
          <img className="s-shelf__cover" src={cover.src} alt="" loading="lazy" />
        ) : (
          <span className="s-shelf__spine" dir="auto">
            {title}
          </span>
        )}
        {started && (
          <span
            className="s-shelf__progress"
            style={{ inlineSize: `${Math.max(2, Math.round(progress * 100))}%` }}
            aria-hidden="true"
          />
        )}
      </span>
      <span className="s-shelf__title" dir="auto">
        {title}
      </span>
      {author !== "" && (
        <span className="s-shelf__author" dir="auto">
          {author}
        </span>
      )}
      <span className="s-shelf__meta" dir="auto">
        {pages > 0 ? `${tf("bookPages", { count: localeNum(pages) })} · ${meta}` : meta}
      </span>
    </button>
  );
}

interface Props {
  /** Open a book. The anchor is present when what was clicked was a marked
   *  PASSAGE rather than a cover: the reader jumps to its page and pulses it. */
  onOpen(path: string, anchor?: BookAnchor | null): void;
  onClose(): void;
  /** Whether this shelf's pane holds the keyboard (client/components/Pane.tsx).
   *  The `/` and Escape listeners are on `window`, so an inactive shelf must
   *  stand down or a `/` typed toward another pane would steal focus here. */
  active?: boolean;
}

/** How many marked passages the shelf shows for one query. A search is a way
 *  back to a passage you remember, not a concordance; past a screenful the
 *  answer is "type another word". */
const PASSAGE_RESULTS_MAX = 40;

export default function BookLibrary({ onOpen, onClose, active = true }: Props) {
  const [books, setBooks] = useState<BookEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [passages, setPassages] = useState<BookHighlightHit[] | null>(null);
  const [passagesCut, setPassagesCut] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    getBooks()
      .then((res) => {
        if (!live) return;
        setBooks(res.books);
        setTruncated(res.truncated);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // THE PASSAGES ARE FETCHED ON THE FIRST KEYSTROKE, NEVER ON OPEN.
  //
  // "Type a word and find the passage you marked in a book whose title you
  // forgot" is the reason the shelf has a search box at all now — but a shelf
  // that paints instantly is a promise this file already made, and a decade of
  // marginalia arriving before the first cover would break it for a search
  // most visits never run. So the request is made when the reader starts
  // typing, once, and the answers are matched here.
  useEffect(() => {
    if (query.trim() === "" || passages !== null) return;
    let live = true;
    getAllHighlights()
      .then((res) => {
        if (!live) return;
        setPassages(res.hits);
        setPassagesCut(res.truncated);
      })
      .catch(() => {
        // A passage search that will not load leaves the book search working,
        // which is the half that was always here.
        if (live) setPassages([]);
      });
    return () => {
      live = false;
    };
  }, [query, passages]);

  // `/` focuses the shelf search, the same key that searches inside a book —
  // one gesture, two scopes, which is the whole point of a keyboard product.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return; // another pane holds the keyboard
      const target = e.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) {
        if (e.key === "Escape") (target as HTMLElement).blur();
        return;
      }
      // Resolved through shortcutKey, not read off e.key: on an Arabic
      // keyboard the physical `/` types "ـ" and a bare comparison finds
      // nothing (client/keys.ts).
      if (shortcutKey(e) === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, active]);

  const shown = useMemo(() => {
    if (!books) return [];
    // The same fold the in-book search uses: an Arabic title typed without its
    // harakat has to find the book that carries them, or the shelf search is
    // only a search for people reading in English.
    const needle = foldQuery(query);
    if (needle === "") return books;
    return books.filter((b) => {
      const hay = `${b.name} ${b.path} ${b.state?.title ?? ""} ${b.state?.author ?? ""}`;
      return foldQuery(hay).includes(needle);
    });
  }, [books, query]);

  /** Marked passages matching the query. The SAME fold the books above are
   *  filtered by and the same one `/` uses inside a book: an Arabic passage
   *  marked with its harakat has to be found by somebody typing it without
   *  them, and there is one implementation of that rule in this product. The
   *  margin note counts as part of the passage, because "the thing I wrote
   *  about it" is exactly what a person remembers. */
  const foundPassages = useMemo(() => {
    const needle = foldQuery(query);
    if (needle === "" || passages === null) return [];
    return passages
      .filter((hit) => foldQuery(`${hit.highlight.text} ${hit.highlight.note}`).includes(needle))
      .slice(0, PASSAGE_RESULTS_MAX);
  }, [passages, query]);

  return (
    <div className="s-shelf">
      <header className="s-shelf__bar">
        <h1 className="s-shelf__heading">{t("bookLibrary")}</h1>
        <input
          ref={searchRef}
          className="s-shelf__search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("bookShelfSearch")}
          aria-label={t("bookShelfSearch")}
          dir="auto"
        />
        <button type="button" className="s-shelf__close" onClick={onClose} aria-label={t("bookCloseLibrary")}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>

      {failed && <p className="s-shelf__note">{t("bookShelfFailed")}</p>}
      {books !== null && books.length === 0 && !failed && <p className="s-shelf__note">{t("bookShelfEmpty")}</p>}
      {books !== null && books.length > 0 && shown.length === 0 && (
        <p className="s-shelf__note">{t("noMatchesDot")}</p>
      )}
      {truncated && (
        <p className="s-shelf__note">{tf("bookShelfTruncated", { count: localeNum(books?.length ?? 0) })}</p>
      )}

      {foundPassages.length > 0 && (
        <section className="s-shelf__passages" aria-label={t("bookPassages")}>
          <h2 className="s-shelf__passages-head">{t("bookPassages")}</h2>
          {/* The shelf search caps its hits; saying so is the difference between
              "these are your passages" and "these are the first of them". */}
          {passagesCut && <p className="s-shelf__note">{t("bookPassagesTruncated")}</p>}
          <ol className="s-shelf__passage-list">
            {foundPassages.map((hit) => (
              <li key={hit.highlight.id}>
                <button
                  type="button"
                  className="s-shelf__passage"
                  dir="auto"
                  onClick={() =>
                    onOpen(hit.path, {
                      page: hit.highlight.page,
                      rect: boundingRect(hit.highlight.rects),
                      id: hit.highlight.id,
                    })
                  }
                >
                  <span className="s-shelf__passage-ink" data-ink={hit.highlight.ink} aria-hidden="true" />
                  <span className="s-shelf__passage-text">{hit.highlight.text}</span>
                  {hit.highlight.note !== "" && (
                    <span className="s-shelf__passage-note">{hit.highlight.note}</span>
                  )}
                  <span className="s-shelf__passage-where">
                    {tf("bookMarkSet", {
                      name: hit.title || hit.path.slice(hit.path.lastIndexOf("/") + 1),
                      page: localeNum(hit.highlight.page),
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="s-shelf__grid">
        {shown.map((entry) => (
          <BookCard key={entry.key + entry.path} entry={entry} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
