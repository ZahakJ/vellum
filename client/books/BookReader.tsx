// THE READER. A zathura in a browser tab.
//
// The shape of this component follows three commitments, and everything
// awkward in it is one of them being kept:
//
// 1. CHROME-FREE. What a reader opens a book for is the book. There is no
//    permanent toolbar: a title bar and a status line appear on pointer
//    movement or on a keystroke and fade out again, and the reader who never
//    moves the mouse never sees them. Everything they do is reachable from the
//    keyboard, and everything the keyboard does is reachable from `:` — which
//    is what makes "no visible controls" a design rather than an omission.
//
// 2. EVERY KEY GOES THROUGH shortcutKey(). `e.key === "j"` is false on an
//    Arabic keyboard, on a Russian one and on a Greek one — see client/keys.ts,
//    which was written because five of this product's seven global shortcuts
//    were dead under a non-Latin layout. A reader whose system keyboard is
//    Arabic is exactly the reader this feature was asked for.
//
// 3. THE PAGES MIRROR WITH THE BOOK, THE CHROME WITH THE INTERFACE. Two
//    different questions with two different answers: the panel around a book
//    follows the UI language, and the SPREAD follows the volume's own binding
//    (layout.ts::spreadsOf). A bilingual owner reading an English monograph
//    inside an Arabic interface gets an Arabic panel around a left-to-right
//    book, which is the only correct answer and the one almost every reader
//    gets wrong.
//
// Virtualization: layout.ts. Rendering and the dark composite: render.ts.
// Search matching: search.ts. The `:` grammar: commands.ts. Annotating and
// citing: columns.ts (how a passage becomes a quote), selection.ts (how the
// DOM becomes pieces), annotations.ts (where a rectangle is on screen) and
// cite.ts (the note it lands in). This file is the state machine that joins
// them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  boundingRect,
  DEFAULT_BOOK_STATE,
  INK_COUNT,
  newHighlightId,
  sortHighlights,
  ZOOM_MAX,
  ZOOM_MIN,
  type BookAnchor,
  type BookHighlight,
  type BookInvert,
  type BookRect,
  type BookRotation,
  type BookState,
} from "../../shared/bookAnchor.ts";
import type { BookOpenResponse } from "../../shared/types.ts";
import { scrollBehavior } from "../a11y.ts";
import { localeNum, t, tf, type I18nKey } from "../i18n.ts";
import { shortcutKey } from "../keys.ts";
import { toast } from "../toast.ts";
import { actionToast } from "../undoToast.ts";
import {
  beaconBookState,
  deleteHighlight,
  getBookHighlights,
  openBookByPath,
  forgetBookState,
  saveBookState,
  saveHighlight,
} from "./api.ts";
import { inkStyle } from "./annotations.ts";
import { assembleSelection, joinFragments } from "./columns.ts";
import { parseCommand, type BookCommand } from "./commands.ts";
import { citationMarkdown, citeIntoNote, citeTargets, currentCiteTarget, type CiteTarget } from "./cite.ts";
import { detectRtl } from "./direction.ts";
import { clearSelection, hasSelection, selectionByPage, unionOf } from "./selection.ts";
import {
  fitPageScale,
  fitWidthScale,
  pageOfSpread,
  renderWindow,
  spreadOfPage,
  spreadsOf,
} from "./layout.ts";
import { bookMetadata, closeDocument, openDocument, type PdfDocument } from "./pdfjs.ts";
import { pageSize, renderPage } from "./render.ts";
import { findMatches } from "./search.ts";

/** How far `j`/`k` move, in CSS pixels. Zathura's default is 40; at a fit-width
 *  page on a modern display that is a twitch, so this is four lines of body
 *  type instead — small enough to place a line at the top of the screen, large
 *  enough that holding the key travels. */
const SCROLL_STEP = 72;

/** Gap between and around pages, in CSS pixels. Also the number fitWidth
 *  subtracts, so it lives here and not only in the stylesheet. */
const PAGE_GAP = 24;

/** How long the chrome lingers after the last pointer movement or keystroke. */
const CHROME_MS = 2200;

/** Debounce on the position write. Long enough that a continuous scroll is one
 *  request rather than sixty, short enough that a browser crash costs seconds
 *  of reading rather than a chapter. */
const SAVE_MS = 900;

/** Hits collected before the background scan stops. A reader searching a
 *  900-page book for "the" does not want 40,000 of anything. */
const SEARCH_MAX = 500;

type Overlay = "none" | "command" | "search" | "outline" | "help" | "cite" | "annotations" | "note";

/** How long a citation's arrival pulses the passage it names. Long enough to
 *  find with the eye on a dense page, short enough that it is gone before the
 *  reader starts reading — a permanent ring around a sentence is a defacement
 *  of somebody's book. Under `prefers-reduced-motion` the ring is held still
 *  for the same span instead of breathing. */
const PULSE_MS = 2400;

/** What `doc.getOutline()` hands back. Named rather than written inline at the
 *  use site: a nested generic inside a .tsx line reads to `check-i18n`'s
 *  bare-English scan as `>…text…<`, i.e. as untranslated copy in JSX. */
type OutlineItems = Awaited<ReturnType<PdfDocument["getOutline"]>>;

interface OutlineRow {
  title: string;
  page: number;
  depth: number;
}

interface Hit {
  page: number;
  /** The k-th match ON that page — how the DOM pass re-finds it. */
  nth: number;
}

interface Props {
  /** Vault path of the book. Changing it opens a different book in place. */
  path: string;
  /** The passage a citation named, when a `[[Book.pdf#page=…]]` is what opened
   *  this reader. The page is jumped to and the rectangle pulsed once. */
  citation?: BookAnchor | null;
  /** Whether this reader's pane holds the keyboard (client/components/Pane.tsx).
   *  Every zathura key listens on `window`; a reader whose pane is not focused
   *  must stand down, or `j` typed toward the note beside it turns the page. */
  active?: boolean;
  /** The citation has been landed on — the pane may clear its one-shot target. */
  onLanded?(): void;
  /** Leave the reader entirely (back to the app). */
  onClose(): void;
  /** Leave the reader for the shelf. */
  onLibrary(): void;
}

/** A citation the reader has assembled and not yet written. Held rather than
 *  written straight through because the confirmation's quote field is
 *  EDITABLE, and because the highlights are only saved if the reader goes
 *  ahead — a cancelled citation must not leave ink on the page. */
interface PendingCite {
  /** One per page the selection crossed, already assembled by column geometry
   *  and carrying the id its citation link will name. */
  marks: BookHighlight[];
  /** The quotation as it will be written — the reader's to edit. */
  quote: string;
  target: string | null;
  /** Open with the note picker focused (`Shift+C`) rather than the quote. */
  picking: boolean;
}

export default function BookReader({ path, citation = null, active = true, onLanded, onClose, onLibrary }: Props) {
  const [entry, setEntry] = useState<BookOpenResponse | null>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<BookState>(DEFAULT_BOOK_STATE);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [sizes, setSizes] = useState<Map<number, { w: number; h: number }>>(new Map());
  const [view, setView] = useState({ width: 0, height: 0 });
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [commandText, setCommandText] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitAt, setHitAt] = useState(0);
  const [outline, setOutline] = useState<OutlineRow[] | null>(null);
  const [chromeShown, setChromeShown] = useState(true);
  const [highlights, setHighlights] = useState<BookHighlight[]>([]);
  /** Which of the six page inks the next `h` uses. Not stored per book: a
   *  reader's colour scheme is a habit of theirs, not a property of the
   *  volume, and re-choosing it in every book is the kind of small friction
   *  that stops people marking anything at all. */
  const [ink, setInk] = useState(1);
  const [pendingCite, setPendingCite] = useState<PendingCite | null>(null);
  /** The highlight whose margin note is being written. */
  const [noting, setNoting] = useState<BookHighlight | null>(null);
  const [pulse, setPulse] = useState<{ page: number; rects: BookRect[] } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const spreadEls = useRef(new Map<number, HTMLElement>());
  const stateRef = useRef(state);
  const restoredRef = useRef(false);
  const keyRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const chromeTimer = useRef<number | null>(null);
  /** The highlights as of THIS keystroke. A keyboard handler must see what the
   *  last one left, not what the last render did — the same argument the vi
   *  prefix below makes. */
  const highlightsRef = useRef<BookHighlight[]>([]);
  const inkRef = useRef(1);
  /** The Range of the search hit `n` last landed on.
   *
   *  THIS IS THE KEYBOARD'S DOOR TO MARKING. Dragging a selection over a page
   *  is a pointer gesture, and no browser gives a keyboard reader one without
   *  caret browsing turned on — so without this, `h` and `c` would be keys
   *  that only work if you also own a mouse, in a reader whose entire premise
   *  is the opposite. `/phrase` then `h` marks that phrase; `n` steps to the
   *  next occurrence and marks that one. */
  const hitRange = useRef<Range | null>(null);
  /** A pending vi-style prefix: digits, and the operator waiting for its
   *  argument (`g`, `m`, `'`). Kept in a ref because a keystroke must see what
   *  the PREVIOUS keystroke left, not what the last render did. */
  const pending = useRef<{ digits: string; op: "g" | "m" | "'" | null }>({ digits: "", op: null });

  stateRef.current = state;
  highlightsRef.current = highlights;
  inkRef.current = ink;

  // ── Open ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setEntry(null);
    setDoc(null);
    setFailed(false);
    setSizes(new Map());
    setHits([]);
    restoredRef.current = false;
    keyRef.current = null;

    void (async () => {
      try {
        // The position comes back BEFORE the engine is even downloaded, so the
        // first page rendered is the page the reader left off on. Opening at
        // page 1 and jumping is a different, worse experience, and it is what
        // every reader that stores position client-side does.
        const opened = await openBookByPath(path);
        if (!live) return;
        setEntry(opened);
        keyRef.current = opened.key;
        const restored = opened.state ?? { ...DEFAULT_BOOK_STATE, path: opened.path };
        setState(restored);
        setSpreadIndex(spreadOfPage(restored.page, restored.dual));

        const pdf = await openDocument(opened.path, { signal: controller.signal });
        if (!live) {
          closeDocument(pdf);
          return;
        }
        setDoc(pdf);
        const first = await pageSize(pdf, 1, 1, 0);
        if (!live) return;
        setSizes((prev) => new Map(prev).set(1, { w: first.width, h: first.height }));

        // Metadata and binding direction, once per book. Both are stored, so a
        // second open costs neither — and the reader's own `:rtl` outranks the
        // detection forever after (it is written into `rtl` and this only ever
        // runs when the book has never been opened).
        const meta = await bookMetadata(pdf);
        const patch: Partial<BookState> = {
          pages: pdf.numPages,
          path: opened.path,
          title: meta.title,
          author: meta.author,
        };
        if (opened.state === null) patch.rtl = await sampleDirection(pdf);
        if (!live) return;
        setState((prev) => ({ ...prev, ...patch }));
        void saveBookState(opened.key, patch).catch(() => {
          // A position that cannot be saved is not worth interrupting reading
          // over; the next write will try again.
        });
      } catch {
        if (live) setFailed(true);
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [path]);

  // The document is a worker-side heap, not a handle: it has to be destroyed
  // or a session of opening books is a session of leaking them.
  useEffect(() => {
    if (!doc) return;
    return () => closeDocument(doc);
  }, [doc]);

  // ── Geometry ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setView({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  const spreads = useMemo(
    () => spreadsOf(state.pages, state.dual),
    [state.pages, state.dual, state.rtl],
  );

  /** A page's size at scale 1, rotated. Pages not yet measured borrow page
   *  one's shape — the honest estimate, and the reason the scrollbar is
   *  roughly right from the first frame in a book whose pages differ. */
  const sizeOf = useCallback(
    (page: number): { w: number; h: number } => {
      const base = sizes.get(page) ?? sizes.get(1) ?? { w: 612, h: 792 };
      return state.rotation % 180 === 0 ? base : { w: base.h, h: base.w };
    },
    [sizes, state.rotation],
  );

  const scale = useMemo(() => {
    if (view.width === 0) return state.zoom;
    const across = state.dual && spreads[spreadIndex]?.pages.length === 2 ? 2 : 1;
    const page = spreads[spreadIndex]?.pages[0] ?? 1;
    const { w, h } = sizeOf(page);
    const input = {
      pageWidth: w,
      pageHeight: h,
      viewWidth: view.width,
      viewHeight: view.height,
      across,
      gap: PAGE_GAP,
    };
    if (state.fit === "width") return fitWidthScale(input);
    if (state.fit === "page") return fitPageScale(input);
    return state.zoom;
  }, [state.fit, state.zoom, state.dual, view, spreads, spreadIndex, sizeOf]);

  const windowed = useMemo(() => new Set(renderWindow(spreadIndex, spreads.length)), [spreadIndex, spreads.length]);

  // Measure the pages in the window so their slots stop guessing. `asked`
  // is a ref rather than a dependency: measuring writes `sizes`, and a `sizes`
  // dependency would re-enter this effect once per measured page.
  const asked = useRef(new Set<number>());
  useEffect(() => {
    if (!doc) return;
    let live = true;
    void (async () => {
      for (const index of windowed) {
        for (const page of spreads[index]?.pages ?? []) {
          if (!live || asked.current.has(page)) continue;
          asked.current.add(page);
          try {
            const measured = await pageSize(doc, page, 1, 0);
            if (!live) return;
            setSizes((prev) =>
              prev.has(page) ? prev : new Map(prev).set(page, { w: measured.width, h: measured.height }),
            );
          } catch {
            // A page that will not measure keeps page one's shape.
          }
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [doc, windowed, spreads]);

  // ── Position: restore, track, save ────────────────────────────────────────
  //
  // TWO RULES SHAPE THIS SECTION AND BOTH ARE ABOUT A 900-PAGE BOOK.
  //
  // The offset within a page changes on every scroll event, and the page does
  // not. So the OFFSET lives in a ref and the PAGE lives in state: React
  // re-renders once per page turn instead of sixty times a second across nine
  // hundred slot elements, which is the difference between a reader that
  // scrolls and one that stutters.
  //
  // And the search for "which spread am I in" is a binary search rather than a
  // walk, because `offsetTop` is monotonic in spread index and a walk is nine
  // hundred DOM reads per scroll event for an answer that needs ten.

  /** Where the reader is, at scroll resolution — the value the debounced write
   *  and the pagehide beacon both read at the moment they fire. */
  const anchor = useRef({ page: 1, offset: 0 });
  /** Set while the component is scrolling the container itself (restore,
   *  re-anchor after a zoom): the resulting scroll event is ours, not the
   *  reader's, and must not be mistaken for them moving. */
  const selfScroll = useRef(false);

  const spreadAt = useCallback((top: number): { index: number; el: HTMLElement } | null => {
    const els = spreadEls.current;
    let lo = 0;
    let hi = spreads.length - 1;
    let best: { index: number; el: HTMLElement } | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const el = els.get(mid);
      if (!el) break;
      if (el.offsetTop <= top + 4) {
        best = { index: mid, el };
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best ?? (els.get(0) ? { index: 0, el: els.get(0) as HTMLElement } : null);
  }, [spreads.length]);

  /** Put the reader back where `anchor` says they are. Used for the initial
   *  restore and after anything that changes page geometry. */
  const reanchor = useCallback(() => {
    const scroller = scrollRef.current;
    const el = spreadEls.current.get(spreadOfPage(anchor.current.page, stateRef.current.dual));
    if (!scroller || !el) return;
    selfScroll.current = true;
    scroller.scrollTop = el.offsetTop + anchor.current.offset * el.offsetHeight;
    requestAnimationFrame(() => {
      selfScroll.current = false;
    });
  }, []);

  useEffect(() => {
    if (restoredRef.current || !doc || spreads.length === 0 || view.height === 0) return;
    if (!spreadEls.current.get(spreadOfPage(state.page, state.dual))) return;
    anchor.current = { page: state.page, offset: state.offset };
    restoredRef.current = true;
    reanchor();
    scrollRef.current?.focus({ preventScroll: true });
  }, [doc, spreads.length, view.height, state.page, state.dual, state.offset, reanchor]);

  // A zoom, a rotation or the dual-page toggle changes every page's height, so
  // the browser's own scrollTop now points at a different part of the book.
  // Without this the commonest gesture in the reader — zoom in to read a
  // footnote — throws away your place.
  useEffect(() => {
    if (!restoredRef.current) return;
    reanchor();
  }, [scale, state.dual, state.rotation, reanchor]);

  /** The debounced position write. It takes no argument: what gets sent is
   *  whatever `anchor` holds when the timer fires, so sixty scroll events
   *  collapse into one request carrying the LAST position rather than an old
   *  one. */
  const queuePositionSave = useCallback(() => {
    const key = keyRef.current;
    if (!key) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveBookState(key, { page: anchor.current.page, offset: anchor.current.offset }).catch(() => {
        // A position that will not save is not worth interrupting reading for;
        // the next scroll tries again, and pagehide tries once more.
      });
    }, SAVE_MS);
  }, []);

  const onScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || !restoredRef.current || selfScroll.current) return;
    const best = spreadAt(scroller.scrollTop);
    if (!best) return;
    const offset =
      best.el.offsetHeight > 0
        ? Math.min(1, Math.max(0, (scroller.scrollTop - best.el.offsetTop) / best.el.offsetHeight))
        : 0;
    const page = pageOfSpread(best.index, stateRef.current.dual);
    anchor.current = { page, offset };
    queuePositionSave();
    // State — and therefore a render — only when the PAGE changed.
    if (page !== stateRef.current.page) {
      setSpreadIndex(best.index);
      setState((prev) => ({ ...prev, page, offset }));
    }
  }, [queuePositionSave, spreadAt]);

  // The last write of a session. A reader who closes the tab — the commonest
  // way a session ends — never fires anything a normal fetch could survive.
  useEffect(() => {
    const flush = () => {
      const key = keyRef.current;
      if (!key || !restoredRef.current) return;
      beaconBookState(key, { page: anchor.current.page, offset: anchor.current.offset });
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, []);

  // ── Mutating the view ─────────────────────────────────────────────────────
  /** Change a view setting and remember it. Written straight through rather
   *  than debounced: these are deliberate acts (a zoom, a rotation, a mark),
   *  they happen at human speed, and a reader who sets one and closes the tab
   *  a second later must not lose it. */
  const update = useCallback((patch: Partial<BookState>) => {
    setState((prev) => ({ ...prev, ...patch }));
    const key = keyRef.current;
    if (key) void saveBookState(key, patch).catch(() => {});
  }, []);

  const goToPage = useCallback(
    (page: number, behavior: ScrollBehavior = "auto") => {
      const total = stateRef.current.pages;
      const target = Math.min(Math.max(1, Math.round(page)), Math.max(1, total));
      const index = spreadOfPage(target, stateRef.current.dual);
      setSpreadIndex(index);
      // The element may not exist yet (the target is outside the window that
      // is currently rendered), so the scroll is deferred one frame — by then
      // the slot is in the DOM, because every slot exists at all times and
      // only its CANVAS is virtualized.
      anchor.current = { page: target, offset: 0 };
      requestAnimationFrame(() => {
        const el = spreadEls.current.get(index);
        const scroller = scrollRef.current;
        if (el && scroller) scroller.scrollTo({ top: el.offsetTop, behavior });
      });
      update({ page: target, offset: 0 });
    },
    [update],
  );

  const scrollBy = useCallback((dy: number) => {
    scrollRef.current?.scrollBy({ top: dy, behavior: "auto" });
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const current = stateRef.current.fit === "free" ? stateRef.current.zoom : scale;
      update({ fit: "free", zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor)) });
    },
    [scale, update],
  );

  const cycleInvert = useCallback(() => {
    const order: BookInvert[] = ["off", "night", "flip"];
    const next = order[(order.indexOf(stateRef.current.invert) + 1) % order.length];
    update({ invert: next });
    toast(t(next === "off" ? "bookInvertOff" : next === "night" ? "bookInvertNight" : "bookInvertFlip"));
  }, [update]);

  const rotateBy = useCallback(
    (quarters: number) => {
      const next = (((stateRef.current.rotation / 90 + quarters) % 4) + 4) % 4;
      update({ rotation: (next * 90) as BookRotation });
    },
    [update],
  );

  // ── Annotations ───────────────────────────────────────────────────────────
  //
  // A highlight is a rectangle on a page and the words under it, stored in
  // VELLUM_DATA against the content key. THE PDF IS NEVER WRITTEN TO — that is
  // the promise the whole vault rests on, it is why this is a rectangle in a
  // JSON file rather than a /Annots entry, and tests/books.test.ts checks the
  // file's bytes and mtime after a passage has been marked.

  useEffect(() => {
    const key = entry?.key;
    if (key === undefined) return;
    let live = true;
    void getBookHighlights(key)
      .then((res) => {
        if (live) setHighlights(res.highlights);
      })
      .catch(() => {
        // Annotations that will not load cost the ribbons, not the book. A
        // reader who came here to read must still be able to read.
      });
    return () => {
      live = false;
    };
  }, [entry?.key]);

  /** Store one highlight, painting it first.
   *
   *  Optimistic, and re-read from the server on failure rather than silently
   *  rolled back: the ribbon appearing under the reader's hand is what tells
   *  them the keystroke worked, and a highlight that vanishes a second later
   *  with no explanation is worse than one that never appeared. */
  const commitHighlight = useCallback(async (mark: BookHighlight): Promise<void> => {
    const key = keyRef.current;
    setHighlights((prev) => sortHighlights([...prev.filter((h) => h.id !== mark.id), mark]));
    if (key === null) return;
    try {
      await saveHighlight(key, mark);
    } catch {
      toast(t("bookHighlightFailed"), "error");
      const fresh = await getBookHighlights(key).catch(() => null);
      if (fresh) setHighlights(fresh.highlights);
    }
  }, []);

  const forgetHighlight = useCallback(async (mark: BookHighlight): Promise<void> => {
    const key = keyRef.current;
    setHighlights((prev) => prev.filter((h) => h.id !== mark.id));
    if (key === null) return;
    await deleteHighlight(key, mark.id).catch(() => {
      toast(t("bookHighlightFailed"), "error");
    });
  }, []);

  /**
   * The current selection as highlights — one per page it crosses, NOT saved.
   *
   * The assembly is `client/books/columns.ts`, and that is the load-bearing
   * call in this component: pdf.js hands back text in the order the content
   * stream wrote it, which on a two-column paper interleaves the columns, and
   * a quote built from that order is alternating half-sentences that read
   * perfectly and say something the author never wrote.
   *
   * One highlight per page because a rectangle has to be ON something, while a
   * sentence that runs over a page break is one sentence. The caller joins the
   * text; the page keeps its own ink.
   */
  const takeSelection = useCallback((): BookHighlight[] => {
    // Nothing dragged, but a search hit is painted: mark THAT. See `hitRange`
    // for why this is the difference between a keyboard-complete reader and
    // one whose two most important keys need a mouse.
    if (!hasSelection(scrollRef.current) && hitRange.current !== null) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      try {
        selection?.addRange(hitRange.current);
      } catch {
        // The page was re-rendered under it and the Range is stale — the
        // reader gets "select a passage first", which is true.
      }
    }
    const pages = selectionByPage(scrollRef.current, stateRef.current.rotation);
    const now = Date.now();
    const marks: BookHighlight[] = [];
    for (const page of pages) {
      const { text, rects } = assembleSelection(page.pieces, stateRef.current.rtl);
      if (rects.length === 0 || text.trim() === "") continue;
      marks.push({
        id: newHighlightId(),
        page: page.page,
        rects,
        ink: inkRef.current,
        text,
        note: "",
        createdAt: now,
        updatedAt: now,
      });
    }
    return marks;
  }, []);

  /** `h` — ink the selection and leave it at that. */
  const markSelection = useCallback((): BookHighlight[] => {
    const marks = takeSelection();
    if (marks.length === 0) {
      toast(t("bookNoSelection"), "error");
      return [];
    }
    for (const mark of marks) void commitHighlight(mark);
    clearSelection();
    return marks;
  }, [takeSelection, commitHighlight]);

  const cycleInk = useCallback((delta: number) => {
    const next = ((inkRef.current - 1 + delta + INK_COUNT) % INK_COUNT) + 1;
    setInk(next);
    toast(tf("bookInkSet", { ink: localeNum(next) }));
  }, []);

  /** The highlight `x` and `e` mean when the reader has not pointed at one:
   *  the one the selection overlaps, else the last one on the page they are
   *  reading. Never a highlight on some other page — a keystroke that deletes
   *  something off screen is a keystroke nobody presses twice. */
  const highlightHere = useCallback((): BookHighlight | null => {
    const here = highlightsRef.current.filter((h) => h.page === stateRef.current.page);
    if (here.length === 0) return null;
    const selected = selectionByPage(scrollRef.current, stateRef.current.rotation).find(
      (p) => p.page === stateRef.current.page,
    );
    const box = selected ? unionOf(selected.pieces.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }))) : null;
    if (box) {
      const hit = here.find((h) => h.rects.some((r) => overlaps(r, box)));
      if (hit) return hit;
    }
    return here[here.length - 1];
  }, []);

  /** `x` — take one back, with the Undo the rest of this product offers for
   *  anything destructive. */
  const removeHighlightHere = useCallback(() => {
    const mark = highlightHere();
    if (mark === null) {
      toast(t("bookNoHighlightHere"), "error");
      return;
    }
    void forgetHighlight(mark);
    actionToast(t("bookHighlightDeleted"), t("undo"), () => void commitHighlight(mark));
  }, [highlightHere, forgetHighlight, commitHighlight]);

  /** `e` — a note in the margin. On the selection when there is one (marking
   *  it first, because a note has to be attached to something), otherwise on
   *  the highlight the reader is looking at. */
  const noteHere = useCallback(() => {
    if (hasSelection(scrollRef.current)) {
      const marks = markSelection();
      if (marks.length === 0) return;
      setNoting(marks[0]);
      setOverlay("note");
      return;
    }
    const mark = highlightHere();
    if (mark === null) {
      toast(t("bookNoSelection"), "error");
      return;
    }
    setNoting(mark);
    setOverlay("note");
  }, [markSelection, highlightHere]);

  // ── Citing ────────────────────────────────────────────────────────────────
  //
  // `c` assembles the passage and shows it in an EDITABLE field before a
  // single character reaches the note. That confirmation is not ceremony: the
  // assembler is the best guess anyone can make about a page that has no
  // reading order in it, and the one failure this reader must never have is a
  // sentence the author did not write going silently into somebody's notes and
  // out again into their own writing. A quote you can see before it lands is a
  // quote you can fix.

  const beginCite = useCallback(
    (picking: boolean) => {
      const marks = takeSelection();
      if (marks.length === 0) {
        toast(t("bookNoSelection"), "error");
        return;
      }
      const targets = citeTargets();
      if (targets.length === 0) {
        toast(t("bookCiteNoTarget"), "error");
        return;
      }
      // A sentence that ran over a page break is one sentence: the pages are
      // joined by the same rule that joins two lines, hyphen and all.
      const quote = marks.map((m) => m.text).reduce((acc, next) => joinFragments(acc, next), "");
      setPendingCite({
        marks,
        quote,
        target: currentCiteTarget()?.path ?? targets[0].path,
        picking,
      });
      setOverlay("cite");
    },
    [takeSelection],
  );

  const finishCite = useCallback(
    (quote: string, targetPath: string) => {
      const cite = pendingCite;
      setOverlay("none");
      setPendingCite(null);
      if (cite === null || quote.trim() === "") return;
      const first = cite.marks[0];
      const label = citeLabel(state.title || entry?.name || "", first.page);
      const markdown = citationMarkdown({
        quote: quote.trim(),
        label,
        target: entry?.name ?? "",
        anchor: { page: first.page, rect: boundingRect(first.rects), id: first.id },
      });
      // The ink goes down only now. A citation the reader cancelled must leave
      // the page exactly as it was.
      for (const mark of cite.marks) void commitHighlight(mark);
      clearSelection();
      void (async () => {
        try {
          const undo = await citeIntoNote(targetPath, markdown);
          actionToast(tf("bookReaderLabel", { title: targetPath }), t("undo"), () => {
            void undo().catch(() => toast(t("bookCited"), "error"));
          });
        } catch {
          toast(t("bookCiteFailed"), "error");
        }
      })();
    },
    [pendingCite, commitHighlight, entry, state.title],
  );

  // ── Arriving from a citation ──────────────────────────────────────────────
  //
  // A `[[Book.pdf#page=42&rect=…]]` clicked in a note opens this reader with an
  // anchor. Jump to the page and pulse the rectangle ONCE: a citation into a
  // 900-word page that only opened the page has not really answered the click,
  // and a ring left permanently around a sentence is a defacement of a book.
  const arrived = useRef<BookAnchor | null>(null);
  useEffect(() => {
    if (citation === null || doc === null || spreads.length === 0) return;
    if (arrived.current === citation) return;
    arrived.current = citation;
    goToPage(citation.page, "auto");
    const stored = citation.id === null ? undefined : highlightsRef.current.find((h) => h.id === citation.id);
    const rects = stored ? stored.rects : citation.rect ? [citation.rect] : [];
    if (rects.length > 0) setPulse({ page: citation.page, rects });
    // Landed. The pane clears its one-shot target so the tab does not reopen
    // on this citation forever; `arrived` keeps the null that follows from
    // re-triggering anything.
    onLanded?.();
  }, [citation, doc, spreads.length, goToPage, highlights, onLanded]);

  useEffect(() => {
    if (pulse === null) return;
    const timer = window.setTimeout(() => setPulse(null), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  // ── Outline ───────────────────────────────────────────────────────────────
  const loadOutline = useCallback(async () => {
    if (!doc || outline !== null) return;
    try {
      const raw = await doc.getOutline();
      const rows: OutlineRow[] = [];
      const walk = async (items: OutlineItems, depth: number): Promise<void> => {
        for (const item of items ?? []) {
          let page = 0;
          try {
            // A destination is either an explicit array (whose first element is
            // a page reference) or a NAME that has to be looked up first. Both
            // shapes are common in the wild and a reader that handles only the
            // first has no contents page for half the books in a vault.
            const dest = typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
            const ref = Array.isArray(dest) ? dest[0] : null;
            if (ref) page = (await doc.getPageIndex(ref)) + 1;
          } catch {
            page = 0;
          }
          rows.push({ title: item.title, page, depth });
          if (item.items?.length) await walk(item.items, depth + 1);
        }
      };
      await walk(raw, 0);
      setOutline(rows);
    } catch {
      setOutline([]);
    }
  }, [doc, outline]);

  // ── Search ────────────────────────────────────────────────────────────────
  /** Bumped per search; a scan that is no longer the newest stops publishing.
   *  The scan is page-by-page and awaits between pages, so a SLOWER earlier
   *  query could finish after a faster later one and overwrite its results —
   *  scrolling the reader away from hits they were already walking. */
  const searchSeq = useRef(0);

  const runSearch = useCallback(
    async (text: string) => {
      const seq = ++searchSeq.current;
      if (!doc || text.trim() === "") {
        setHits([]);
        return;
      }
      const found: Hit[] = [];
      const total = doc.numPages;
      const from = stateRef.current.page;
      // Scanned from the reader's own page forward and then round — a search
      // in a book is nearly always "the next one of these", not "the first one
      // in the volume", and on a 900-page book the difference is the whole
      // experience.
      for (let step = 0; step < total && found.length < SEARCH_MAX; step += 1) {
        const page = ((from - 1 + step) % total) + 1;
        try {
          const content = await doc.getPage(page).then((p) => p.getTextContent());
          const pageText = textOf(content);
          const matches = findMatches(pageText, text);
          matches.forEach((_, nth) => found.push({ page, nth }));
        } catch {
          // A page whose text cannot be extracted contributes no hits.
        }
        if (seq !== searchSeq.current) return; // superseded mid-scan
      }
      if (seq !== searchSeq.current) return;
      setHits(found);
      setHitAt(0);
      if (found.length > 0) goToPage(found[0].page);
      else toast(t("bookNoMatches"));
    },
    [doc, goToPage],
  );

  const stepHit = useCallback(
    (delta: number) => {
      if (hits.length === 0) {
        toast(t("bookNoMatches"));
        return;
      }
      const next = (hitAt + delta + hits.length) % hits.length;
      setHitAt(next);
      goToPage(hits[next].page);
    },
    [hitAt, hits, goToPage],
  );

  // Paint the current hit once its page is on screen. The DOM pass re-runs the
  // SAME matcher over the SAME text, which is the only reason the k-th match
  // in the extracted string and the k-th match in the text layer are the same
  // match (search.ts explains why the offsets survive the round trip).
  useEffect(() => {
    if (hits.length === 0) return;
    const hit = hits[hitAt];
    const frame = requestAnimationFrame(() => {
      hitRange.current = highlightHit(scrollRef.current, hit.page, hit.nth, query);
    });
    return () => cancelAnimationFrame(frame);
  }, [hits, hitAt, query, spreadIndex]);

  // ── The chrome that gets out of the way ──────────────────────────────────
  const wake = useCallback(() => {
    setChromeShown(true);
    if (chromeTimer.current !== null) window.clearTimeout(chromeTimer.current);
    chromeTimer.current = window.setTimeout(() => setChromeShown(false), CHROME_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (chromeTimer.current !== null) window.clearTimeout(chromeTimer.current);
    };
  }, [wake]);

  // ── Commands ──────────────────────────────────────────────────────────────
  const runCommand = useCallback(
    (command: BookCommand) => {
      switch (command.kind) {
        case "goto":
          goToPage(command.relative ? stateRef.current.page + command.page : command.page, scrollBehavior());
          break;
        case "quit":
          onClose();
          break;
        case "library":
          onLibrary();
          break;
        case "outline":
          void loadOutline();
          setOverlay("outline");
          break;
        case "zoom":
          update({ fit: "free", zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, command.percent / 100)) });
          break;
        case "fit":
          update({ fit: command.fit });
          break;
        case "rotate":
          rotateBy(command.quarters);
          break;
        case "dual":
          update({ dual: command.on ?? !stateRef.current.dual });
          break;
        case "invert":
          if (command.mode === null) cycleInvert();
          else update({ invert: command.mode });
          break;
        case "direction":
          update({ rtl: command.rtl });
          break;
        case "mark":
          update({ marks: { ...stateRef.current.marks, [command.name]: stateRef.current.page } });
          toast(tf("bookMarkSet", { name: command.name, page: localeNum(stateRef.current.page) }));
          break;
        case "jump": {
          const target = stateRef.current.marks[command.name];
          if (target) goToPage(target, scrollBehavior());
          else toast(tf("bookNoMark", { name: command.name }), "error");
          break;
        }
        case "search":
          setQuery(command.query);
          void runSearch(command.query);
          break;
        case "forget": {
          const key = keyRef.current;
          if (key) void forgetBookState(key).then(() => toast(t("bookForgot"))).catch(() => {});
          break;
        }
        case "help":
          setOverlay("help");
          break;
        case "highlight":
          markSelection();
          break;
        case "ink":
          if (command.ink === null) cycleInk(1);
          else {
            const picked = Math.min(INK_COUNT, Math.max(1, Math.round(command.ink)));
            setInk(picked);
            toast(tf("bookInkSet", { ink: localeNum(picked) }));
          }
          break;
        case "cite":
          beginCite(command.pick);
          break;
        case "note":
          noteHere();
          break;
        case "annotations":
          setOverlay("annotations");
          break;
        case "unknown":
          toast(tf("bookUnknownCommand", { word: command.word }), "error");
          break;
      }
    },
    [
      goToPage,
      onClose,
      onLibrary,
      loadOutline,
      update,
      rotateBy,
      cycleInvert,
      runSearch,
      markSelection,
      cycleInk,
      beginCite,
      noteHere,
    ],
  );

  // ── The keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return; // another pane holds the keyboard
      const target = e.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return; // the command line and the search box own their keys
      wake();

      if (e.key === "Escape") {
        e.preventDefault();
        if (overlay !== "none") setOverlay("none");
        else if (hits.length > 0) clearHighlight();
        pending.current = { digits: "", op: null };
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Ctrl+D / Ctrl+U — half a screen, the one modified pair zathura has.
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          const key = shortcutKey(e);
          if (key === "d") {
            e.preventDefault();
            scrollBy(view.height / 2);
            return;
          }
          if (key === "u") {
            e.preventDefault();
            scrollBy(-view.height / 2);
            return;
          }
        }
        return; // every other modified chord belongs to the browser
      }

      // Layout-independent keys first: they carry no character to resolve.
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          scrollBy(SCROLL_STEP);
          return;
        case "ArrowUp":
          e.preventDefault();
          scrollBy(-SCROLL_STEP);
          return;
        case "PageDown":
          e.preventDefault();
          scrollBy(view.height * 0.92);
          return;
        case "PageUp":
          e.preventDefault();
          scrollBy(-view.height * 0.92);
          return;
        case "Home":
          e.preventDefault();
          goToPage(1, scrollBehavior());
          return;
        case "End":
          e.preventDefault();
          goToPage(state.pages, scrollBehavior());
          return;
        case " ":
          e.preventDefault();
          scrollBy(e.shiftKey ? -view.height * 0.92 : view.height * 0.92);
          return;
        case "Enter":
          e.preventDefault();
          scrollBy(view.height * 0.92);
          return;
        default:
          break;
      }

      const key = shortcutKey(e);
      if (key === null) return;

      // A pending operator eats the next key whatever it is: `m` then any
      // character sets that mark, including an Arabic one.
      const op = pending.current.op;
      if (op !== null) {
        e.preventDefault();
        pending.current = { digits: "", op: null };
        if (op === "g") {
          if (key === "g") goToPage(1, scrollBehavior());
          return;
        }
        // Marks are named by what the reader TYPED, not by the physical key:
        // a mark set with ج must be recalled with ج.
        const name = e.key.length === 1 ? e.key : key;
        runCommand(op === "m" ? { kind: "mark", name } : { kind: "jump", name });
        return;
      }

      if (key >= "0" && key <= "9") {
        e.preventDefault();
        pending.current = { digits: pending.current.digits + key, op: null };
        return;
      }
      const count = pending.current.digits === "" ? null : Number(pending.current.digits);
      pending.current = { digits: "", op: null };

      switch (key) {
        case "j":
          // `J` — the shifted pair — is a PAGE, the way zathura reads: j/k for
          // the eye, J/K for the thumb. Count-aware, so `5J` is five pages on.
          if (e.shiftKey) {
            e.preventDefault();
            goToPage(Math.min(stateRef.current.pages, stateRef.current.page + (count ?? 1)), scrollBehavior());
            break;
          }
          e.preventDefault();
          scrollBy(SCROLL_STEP * (count ?? 1));
          break;
        case "k":
          if (e.shiftKey) {
            e.preventDefault();
            goToPage(Math.max(1, stateRef.current.page - (count ?? 1)), scrollBehavior());
            break;
          }
          e.preventDefault();
          scrollBy(-SCROLL_STEP * (count ?? 1));
          break;
        case "g":
          e.preventDefault();
          if (e.shiftKey) goToPage(count ?? state.pages, scrollBehavior());
          else pending.current = { digits: "", op: "g" };
          break;
        case "/":
          e.preventDefault();
          setOverlay("search");
          break;
        case "n":
          e.preventDefault();
          stepHit(e.shiftKey ? -1 : 1);
          break;
        case "o":
          e.preventDefault();
          void loadOutline();
          setOverlay(overlay === "outline" ? "none" : "outline");
          break;
        case "=":
        case "+":
          e.preventDefault();
          zoomBy(1.15);
          break;
        case "-":
          e.preventDefault();
          zoomBy(1 / 1.15);
          break;
        case "a":
          e.preventDefault();
          // Shift+A is the marked-passage panel. The pair reads badly written
          // down and perfectly under the hand: `a` is a fit, `A` is a list.
          if (e.shiftKey) setOverlay(overlay === "annotations" ? "none" : "annotations");
          else update({ fit: "width" });
          break;
        case "s":
          e.preventDefault();
          update({ fit: "page" });
          break;
        case "d":
          e.preventDefault();
          update({ dual: !state.dual });
          break;
        case "i":
          e.preventDefault();
          cycleInvert();
          break;
        case "r":
          e.preventDefault();
          rotateBy(e.shiftKey ? -1 : 1);
          break;
        case "h":
          e.preventDefault();
          // `H` cycles the ink, `h` uses it. Six inks and no numbers, because
          // the digits are the count prefix — `3h` has to mean something else
          // or `12G` stops working.
          if (e.shiftKey) cycleInk(1);
          else markSelection();
          break;
        case "c":
          e.preventDefault();
          beginCite(e.shiftKey);
          break;
        case "e":
          e.preventDefault();
          noteHere();
          break;
        case "x":
          e.preventDefault();
          removeHighlightHere();
          break;
        case "m":
          e.preventDefault();
          pending.current = { digits: "", op: "m" };
          break;
        case "'":
          e.preventDefault();
          pending.current = { digits: "", op: "'" };
          break;
        case ";": // Shift+; is `:` on a US layout; isKey's shifted-twin table
        case ":": //  covers the rest, and both spellings arrive here.
          e.preventDefault();
          setCommandText("");
          setOverlay("command");
          break;
        case "q":
          e.preventDefault();
          onClose();
          break;
        case "l":
          e.preventDefault();
          onLibrary();
          break;
        case "?":
          e.preventDefault();
          setOverlay(overlay === "help" ? "none" : "help");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    active,
    overlay,
    hits.length,
    view.height,
    state.pages,
    state.dual,
    scrollBy,
    goToPage,
    zoomBy,
    update,
    cycleInvert,
    rotateBy,
    stepHit,
    loadOutline,
    runCommand,
    markSelection,
    cycleInk,
    beginCite,
    noteHere,
    removeHighlightHere,
    onClose,
    onLibrary,
    wake,
  ]);

  useEffect(() => () => clearHighlight(), []);

  // The theme's ground, for the night composite. Read from the live custom
  // property rather than written down anywhere: fifteen themes, and a book
  // read at night in `sandstone` should be dark sandstone.
  const paper = useMemo(() => readToken("--bg"), [state.invert]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (failed) {
    return (
      <div className="s-book s-book--empty">
        <p className="s-book__message">{t("bookOpenFailed")}</p>
        <button type="button" className="s-book__button" onClick={onLibrary}>
          {t("bookLibrary")}
        </button>
      </div>
    );
  }

  const title = state.title || entry?.name.replace(/\.pdf$/i, "") || "";

  return (
    <div className="s-book" onMouseMove={wake} data-chrome={chromeShown ? "on" : "off"}>
      <div
        className="s-book__scroll"
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={-1}
        role="document"
        aria-label={tf("bookReaderLabel", { title })}
      >
        <div className="s-book__doc" dir={state.rtl ? "rtl" : "ltr"}>
          {doc === null && <p className="s-book__message">{t("bookLoading")}</p>}
          {spreads.map((spread) => {
            const heights = spread.pages.map((p) => sizeOf(p).h * scale);
            return (
              <div
                key={spread.index}
                className="s-book__spread"
                data-spread={spread.index}
                ref={(el) => {
                  if (el) spreadEls.current.set(spread.index, el);
                  else spreadEls.current.delete(spread.index);
                }}
                style={{ blockSize: `${Math.max(...heights) + PAGE_GAP}px` }}
              >
                {windowed.has(spread.index) && doc
                  ? spread.pages.map((page) => (
                      <PageSlot
                        key={page}
                        doc={doc}
                        page={page}
                        scale={scale}
                        rotation={state.rotation}
                        invert={state.invert}
                        paper={paper}
                        width={sizeOf(page).w * scale}
                        height={sizeOf(page).h * scale}
                        marks={highlights.filter((h) => h.page === page)}
                        pulseRects={pulse !== null && pulse.page === page ? pulse.rects : EMPTY_RECTS}
                      />
                    ))
                  : spread.pages.map((page) => (
                      <div
                        key={page}
                        className="s-book__placeholder"
                        style={{ inlineSize: `${sizeOf(page).w * scale}px`, blockSize: `${sizeOf(page).h * scale}px` }}
                        aria-hidden="true"
                      />
                    ))}
              </div>
            );
          })}
        </div>
      </div>

      <header className="s-book__top">
        <span className="s-book__title" dir="auto">
          {title}
        </span>
        <button type="button" className="s-book__act" onClick={onLibrary} aria-label={t("bookLibrary")}>
          <span aria-hidden="true">☰</span>
        </button>
        <button type="button" className="s-book__act" onClick={onClose} aria-label={t("bookClose")}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>

      <footer className="s-book__status">
        <span>{tf("bookPageOf", { page: localeNum(state.page), total: localeNum(state.pages) })}</span>
        <span>{tf("bookZoomPct", { percent: localeNum(Math.round(scale * 100)) })}</span>
        {hits.length > 0 && (
          <span>{tf("bookMatchOf", { index: localeNum(hitAt + 1), total: localeNum(hits.length) })}</span>
        )}
        {/* The ink in force. A chrome-free reader still has to answer "which
            colour will `h` use", and a swatch answers it without a toolbar. */}
        <span
          className="s-book__ink-chip"
          data-ink={ink}
          title={tf("bookZoomPct", { percent: localeNum(ink) })}
          aria-label={tf("bookInkSet", { ink: localeNum(ink) })}
        />
      </footer>

      {overlay === "command" && (
        <CommandLine
          value={commandText}
          onChange={setCommandText}
          onCancel={() => setOverlay("none")}
          onSubmit={(line) => {
            setOverlay("none");
            const parsed = parseCommand(line);
            if (parsed) runCommand(parsed);
          }}
        />
      )}

      {overlay === "search" && (
        <SearchLine
          value={query}
          onChange={setQuery}
          onCancel={() => setOverlay("none")}
          onSubmit={(text) => {
            setOverlay("none");
            void runSearch(text);
          }}
        />
      )}

      {overlay === "outline" && (
        <OutlinePanel rows={outline} onPick={(page) => { setOverlay("none"); goToPage(page, scrollBehavior()); }} onClose={() => setOverlay("none")} />
      )}

      {overlay === "help" && <HelpSheet onClose={() => setOverlay("none")} />}

      {overlay === "cite" && pendingCite !== null && (
        <CitePanel
          cite={pendingCite}
          targets={citeTargets()}
          onSubmit={finishCite}
          onCancel={() => {
            setOverlay("none");
            setPendingCite(null);
          }}
        />
      )}

      {overlay === "note" && noting !== null && (
        <MarginNotePanel
          mark={noting}
          onSubmit={(text) => {
            setOverlay("none");
            setNoting(null);
            void commitHighlight({ ...noting, note: text, updatedAt: Date.now() });
          }}
          onCancel={() => {
            setOverlay("none");
            setNoting(null);
          }}
        />
      )}

      {overlay === "annotations" && (
        <AnnotationsPanel
          marks={highlights}
          onClose={() => setOverlay("none")}
          onGo={(mark) => {
            setOverlay("none");
            goToPage(mark.page, scrollBehavior());
            setPulse({ page: mark.page, rects: mark.rects });
          }}
          onNote={(mark) => {
            setNoting(mark);
            setOverlay("note");
          }}
          onDelete={(mark) => {
            void forgetHighlight(mark);
            actionToast(t("bookHighlightDeleted"), t("undo"), () => void commitHighlight(mark));
          }}
        />
      )}
    </div>
  );
}

// ── One page ────────────────────────────────────────────────────────────────

/** A stable empty array, so a page with no pulse on it does not get a new
 *  prop identity every render and re-run its whole rendering effect. */
const EMPTY_RECTS: BookRect[] = [];

interface SlotProps {
  doc: PdfDocument;
  page: number;
  scale: number;
  rotation: BookRotation;
  invert: BookInvert;
  paper: string;
  width: number;
  height: number;
  marks: BookHighlight[];
  pulseRects: BookRect[];
}

function PageSlot({
  doc,
  page,
  scale,
  rotation,
  invert,
  paper,
  width,
  height,
  marks,
  pulseRects,
}: SlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    void renderPage({
      doc,
      pageNumber: page,
      scale,
      rotation,
      invert,
      canvas,
      textLayer: textRef.current,
      paper,
      signal: controller.signal,
    }).catch(() => {
      // Cancelled (the reader scrolled on) or unrenderable. Either way the
      // slot keeps its reserved space and the scroll position is undisturbed,
      // which matters more than an error nobody can act on.
    });
    return () => controller.abort();
  }, [doc, page, scale, rotation, invert, paper]);

  return (
    <div className="s-book__page" style={{ inlineSize: `${width}px`, blockSize: `${height}px` }} data-page={page}>
      <canvas className="s-book__canvas" ref={canvasRef} />
      {/* The ink sits BETWEEN the canvas and the text layer, and it is
          `aria-hidden` and `pointer-events: none`: the words a highlight
          covers are already in the text layer, where they can be read,
          searched and selected, and a screen reader that also announced a
          coloured rectangle over them would say everything twice. The marked
          passages are listed as text in the `A` panel, which is where a
          keyboard reader reaches them. */}
      <div className="s-book__ink-layer" aria-hidden="true">
        {marks.map((mark) =>
          mark.rects.map((rect, i) => (
            <span
              key={`${mark.id}-${i}`}
              className="s-book__ink"
              data-ink={mark.ink}
              data-annotated={mark.note === "" ? undefined : "yes"}
              style={inkStyle(rect, rotation)}
            />
          )),
        )}
        {pulseRects.map((rect, i) => (
          <span key={`pulse-${i}`} className="s-book__pulse" style={inkStyle(rect, rotation)} />
        ))}
      </div>
      <div className="s-book__text" ref={textRef} />
    </div>
  );
}

// ── Overlays ────────────────────────────────────────────────────────────────

interface LineProps {
  value: string;
  onChange(next: string): void;
  onSubmit(value: string): void;
  onCancel(): void;
}

function CommandLine({ value, onChange, onSubmit, onCancel }: LineProps) {
  return (
    <form
      className="s-book__line"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <span className="s-book__prompt" aria-hidden="true">
        :
      </span>
      <input
        className="s-book__input"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label={t("bookCommandLabel")}
        placeholder={t("bookCommandPlaceholder")}
      />
    </form>
  );
}

function SearchLine({ value, onChange, onSubmit, onCancel }: LineProps) {
  return (
    <form
      className="s-book__line"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <span className="s-book__prompt" aria-hidden="true">
        /
      </span>
      <input
        className="s-book__input"
        autoFocus
        type="search"
        value={value}
        dir="auto"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label={t("bookSearchLabel")}
        placeholder={t("bookSearchPlaceholder")}
      />
    </form>
  );
}

function OutlinePanel({
  rows,
  onPick,
  onClose,
}: {
  rows: OutlineRow[] | null;
  onPick(page: number): void;
  onClose(): void;
}) {
  return (
    <aside className="s-book__outline" aria-label={t("bookOutline")}>
      <header className="s-book__outline-head">
        <h2>{t("bookOutline")}</h2>
        <button type="button" className="s-book__act" onClick={onClose} aria-label={t("closeViewer")}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      {rows === null && <p className="s-book__message">{t("bookLoading")}</p>}
      {rows !== null && rows.length === 0 && <p className="s-book__message">{t("bookNoOutline")}</p>}
      <ol className="s-book__outline-list">
        {(rows ?? []).map((row, i) => (
          <li key={`${row.title}-${i}`} style={{ paddingInlineStart: `${row.depth * 14}px` }}>
            <button type="button" className="s-book__outline-row" onClick={() => onPick(row.page || 1)} dir="auto">
              <span className="s-book__outline-title">{row.title}</span>
              {row.page > 0 && <span className="s-book__outline-page">{localeNum(row.page)}</span>}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

// ── Annotating and citing ───────────────────────────────────────────────────

/**
 * The confirmation `c` shows before one character reaches a note.
 *
 * THE QUOTE FIELD IS EDITABLE, AND THAT IS THE POINT OF THE PANEL. A PDF page
 * has no reading order in it — only glyphs at coordinates — so assembling a
 * passage is inference, and inference is occasionally wrong: a running head
 * caught in the selection, a footnote marker, a column detector that read a
 * wide table as two columns. Every one of those produces a quotation that is
 * fluent, plausible and NOT WHAT THE BOOK SAYS, and a wrong quotation that
 * looks right is the worst thing this reader could put into someone's writing.
 * So it is shown, in full, in a field, before it is written.
 *
 * The note picker is here too rather than in a dialog of its own: `c` opens
 * this with the quote focused and the note beside you already chosen, and
 * `Shift+C` opens the same panel with the picker focused. One surface, two
 * doors, nothing to learn twice.
 */
function CitePanel({
  cite,
  targets,
  onSubmit,
  onCancel,
}: {
  cite: PendingCite;
  targets: CiteTarget[];
  onSubmit(quote: string, target: string): void;
  onCancel(): void;
}) {
  const [quote, setQuote] = useState(cite.quote);
  const [target, setTarget] = useState(cite.target ?? targets[0]?.path ?? "");
  return (
    <form
      className="s-book__sheet"
      role="dialog"
      aria-label={t("bookCiteTitle")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(quote, target);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        // Ctrl+Enter files it from inside the textarea, where a bare Enter has
        // to keep meaning "new line" — a quotation is prose and prose has
        // paragraphs in it.
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSubmit(quote, target);
        }
      }}
    >
      <label className="s-book__field">
        <span className="s-book__field-name">{t("bookCiteInto")}</span>
        <select
          className="s-book__select"
          autoFocus={cite.picking}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {targets.map((option) => (
            <option key={option.path} value={option.path}>
              {option.title}
            </option>
          ))}
        </select>
      </label>
      <label className="s-book__field">
        <span className="s-book__field-name">{t("bookCiteQuoteLabel")}</span>
        <textarea
          className="s-book__quote"
          autoFocus={!cite.picking}
          value={quote}
          dir="auto"
          rows={6}
          onChange={(e) => setQuote(e.target.value)}
        />
      </label>
      <div className="s-book__sheet-acts">
        <button type="button" className="s-book__button" onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className="s-book__button s-book__button--primary" disabled={target === ""}>
          {t("save")}
        </button>
      </div>
    </form>
  );
}

/** A note in the margin. The one place in this reader where the reader's own
 *  words go, so it is a plain textarea and nothing else. */
function MarginNotePanel({
  mark,
  onSubmit,
  onCancel,
}: {
  mark: BookHighlight;
  onSubmit(note: string): void;
  onCancel(): void;
}) {
  const [note, setNote] = useState(mark.note);
  return (
    <form
      className="s-book__sheet"
      role="dialog"
      aria-label={t("bookMarginNote")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(note);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSubmit(note);
        }
      }}
    >
      <blockquote className="s-book__sheet-quote" dir="auto">
        {mark.text}
      </blockquote>
      <label className="s-book__field">
        <span className="s-book__field-name">{t("bookMarginNote")}</span>
        <textarea
          className="s-book__quote"
          autoFocus
          value={note}
          dir="auto"
          rows={4}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="s-book__sheet-acts">
        <button type="button" className="s-book__button" onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className="s-book__button s-book__button--primary">
          {t("save")}
        </button>
      </div>
    </form>
  );
}

/** Every passage marked in this book — the panel `A` opens.
 *
 *  It is also the accessibility answer to the ink: a coloured rectangle over a
 *  page is invisible to a screen reader and unreachable from a keyboard, so
 *  the passages exist HERE as text, in reading order, with a control each for
 *  the three things one can do to them. Nothing in this reader is reachable
 *  only by pointing at it. */
function AnnotationsPanel({
  marks,
  onGo,
  onNote,
  onDelete,
  onClose,
}: {
  marks: BookHighlight[];
  onGo(mark: BookHighlight): void;
  onNote(mark: BookHighlight): void;
  onDelete(mark: BookHighlight): void;
  onClose(): void;
}) {
  return (
    <aside className="s-book__outline s-book__annots" aria-label={t("bookOutline")}>
      <header className="s-book__outline-head">
        <h2>{t("bookAnnotations")}</h2>
        <button type="button" className="s-book__act" onClick={onClose} aria-label={t("bookAnnotations")}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      {marks.length === 0 && <p className="s-book__message">{t("bookNoAnnotations")}</p>}
      <ol className="s-book__outline-list">
        {marks.map((mark) => (
          <li key={mark.id} className="s-book__annot">
            <button type="button" className="s-book__annot-body" onClick={() => onGo(mark)} dir="auto">
              <span className="s-book__ink-chip" data-ink={mark.ink} aria-hidden="true" />
              <span className="s-book__annot-page">{localeNum(mark.page)}</span>
              <span className="s-book__annot-text">{mark.text}</span>
              {mark.note !== "" && <span className="s-book__annot-note">{mark.note}</span>}
            </button>
            <span className="s-book__annot-acts">
              <button
                type="button"
                className="s-book__act"
                onClick={() => onNote(mark)}
                aria-label={t("bookMarginNote")}
              >
                <span aria-hidden="true">✎</span>
              </button>
              <button
                type="button"
                className="s-book__act"
                onClick={() => onDelete(mark)}
                aria-label={t("delete")}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** The reader's own key sheet. Deliberately local rather than a section of the
 *  app-wide sheet: these keys are live only while a book is open, and a global
 *  list that describes them everywhere is a list that lies most of the time. */
const HELP_ROWS: { keys: string; label: I18nKey }[] = [
  { keys: "j k", label: "bookKeyScroll" },
  { keys: "J K", label: "bookKeyPageStep" },
  { keys: "Space", label: "bookKeyPage" },
  { keys: "gg G", label: "bookKeyFirstLast" },
  { keys: "12G", label: "bookKeyGoto" },
  { keys: "/", label: "bookKeySearch" },
  { keys: "n N", label: "bookKeyNextMatch" },
  { keys: "o", label: "bookKeyOutline" },
  { keys: "+ -", label: "bookKeyZoom" },
  { keys: "a s", label: "bookKeyFit" },
  { keys: "d", label: "bookKeyDual" },
  { keys: "i", label: "bookKeyInvert" },
  { keys: "r", label: "bookKeyRotate" },
  { keys: "m '", label: "bookKeyMarks" },
  { keys: "h H", label: "bookKeyHighlight" },
  { keys: "c C", label: "bookKeyCite" },
  { keys: "e", label: "bookKeyMarginNote" },
  { keys: "x", label: "bookKeyUnhighlight" },
  { keys: "A", label: "bookKeyAnnotations" },
  { keys: ":", label: "bookKeyCommand" },
  { keys: "l", label: "bookKeyLibrary" },
  { keys: "q", label: "bookKeyClose" },
  { keys: "?", label: "bookKeyHelp" },
];

function HelpSheet({ onClose }: { onClose(): void }) {
  return (
    <aside className="s-book__help" aria-label={t("bookHelpTitle")}>
      <header className="s-book__outline-head">
        <h2>{t("bookHelpTitle")}</h2>
        <button type="button" className="s-book__act" onClick={onClose} aria-label={t("closeViewer")}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <dl className="s-book__help-list">
        {HELP_ROWS.map((row) => (
          <div key={`${row.keys}-${row.label}`} className="s-book__help-row">
            <dt>
              <kbd>{row.keys}</kbd>
            </dt>
            <dd>{t(row.label)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Do two page rectangles touch? Used to decide which highlight a selection is
 *  pointing at, so `x` and `e` act on the passage under the reader's hand
 *  rather than on whichever one happens to be last. */
function overlaps(a: BookRect, b: BookRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** What a citation's link reads as in the note: the book and the page, in the
 *  instance's own numerals — an Arabic instance prints ٤٢ everywhere else and
 *  a citation that suddenly says 42 reads as somebody else's software. */
function citeLabel(title: string, page: number): string {
  return tf("bookCiteLabel", { name: title.replace(/\.pdf$/i, ""), page: localeNum(page) });
}

/** A live theme token, resolved from the document. Never a literal: the night
 *  composite has to land on the ground the reader's theme actually paints. */
function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#000000";
}

/** pdf.js text items, joined the way the page reads. `hasEOL` is the extractor
 *  telling us the PAGE broke a line here; keeping it as a newline is what lets
 *  search.ts match a phrase across it. */
function textOf(content: { items: unknown[] }): string {
  let out = "";
  for (const item of content.items) {
    const it = item as { str?: string; hasEOL?: boolean };
    if (typeof it.str !== "string") continue;
    out += it.str;
    if (it.hasEOL) out += "\n";
  }
  return out;
}

/** A sample of the book's own text, from the MIDDLE — front matter is where a
 *  copyright page and a translator's note live, and both are in English in
 *  books that are not. */
async function sampleDirection(doc: PdfDocument): Promise<boolean> {
  const total = doc.numPages;
  const pages = [Math.ceil(total * 0.4), Math.ceil(total * 0.5), Math.ceil(total * 0.6)];
  let sample = "";
  for (const page of pages) {
    try {
      const content = await doc.getPage(page).then((p) => p.getTextContent());
      sample += textOf(content);
    } catch {
      // no text on that page — the next one may have some
    }
  }
  return detectRtl(sample);
}

const HIGHLIGHT_NAME = "vellum-book-search";

interface HighlightRegistry {
  set(name: string, highlight: object): void;
  delete(name: string): void;
}

function highlightRegistry(): HighlightRegistry | null {
  const css = CSS as unknown as { highlights?: HighlightRegistry };
  return css.highlights ?? null;
}

function clearHighlight(): void {
  highlightRegistry()?.delete(HIGHLIGHT_NAME);
}

/**
 * Paint the k-th match on a page, scroll it into view, and hand back the Range.
 *
 * Uses the CSS Custom Highlight API where the browser has it: a Range can then
 * be painted without inserting a single node into the text layer, which is the
 * only way to highlight text that must ALSO stay selectable and stay in the
 * exact positions pdf.js computed. Inserting `<mark>` elements — the obvious
 * alternative — reflows the layer and breaks the selection annotating needs.
 * Where the API is missing the match still scrolls into view; it is simply not
 * tinted.
 *
 * The Range comes back because it is also the KEYBOARD'S way to select a
 * passage: `/phrase` then `h` marks exactly what was found (see `hitRange`).
 */
function highlightHit(
  scroller: HTMLElement | null,
  page: number,
  nth: number,
  query: string,
): Range | null {
  clearHighlight();
  if (!scroller || query.trim() === "") return null;
  const host = scroller.querySelector<HTMLElement>(`[data-page="${page}"] .s-book__text`);
  if (!host) return null;

  // Flatten the layer into one string plus a node map, then run the SAME
  // matcher the extracted text was searched with. THE SAME STRING, and that is
  // the load-bearing part: the scan haystack (`textOf`) writes "\n" wherever
  // pdf.js reported `hasEOL`, and the text layer renders that same fact as a
  // <br> — which a SHOW_TEXT walk skips entirely. The two haystacks then
  // disagreed about both offsets and match COUNT, so the `nth` computed
  // against one indexed into the other and `n` lit the wrong occurrence. The
  // walk now speaks for the <br> the way the extractor spoke for `hasEOL`.
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).tagName === "BR") text += "\n";
      continue;
    }
    const textNode = node as Text;
    nodes.push({ node: textNode, start: text.length });
    text += textNode.data;
  }
  const matches = findMatches(text, query);
  const match = matches[nth];
  if (!match) return null;

  const locate = (offset: number): { node: Text; offset: number } | null => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      if (nodes[i].start <= offset) return { node: nodes[i].node, offset: offset - nodes[i].start };
    }
    return null;
  };
  const from = locate(match.start);
  const to = locate(Math.max(match.start, match.end - 1));
  if (!from || !to) return null;
  const range = document.createRange();
  try {
    range.setStart(from.node, Math.min(from.offset, from.node.data.length));
    range.setEnd(to.node, Math.min(to.offset + 1, to.node.data.length));
  } catch {
    return null;
  }

  const registry = highlightRegistry();
  const Ctor = (window as unknown as { Highlight?: new (...ranges: Range[]) => object }).Highlight;
  if (registry && Ctor) registry.set(HIGHLIGHT_NAME, new Ctor(range));

  const rect = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (rect.height > 0 && (rect.top < box.top + 40 || rect.bottom > box.bottom - 40)) {
    scroller.scrollBy({ top: rect.top - box.top - box.height / 3, behavior: "auto" });
  }
  return range;
}
