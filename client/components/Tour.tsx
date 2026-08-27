// THE TOUR — a deck of illustrated folios, flipped one at a time.
//
// The problem, in the owner's words: a real reader never discovered that this
// product has a DESIGNER until they were told. The depth is all there — fifty-
// nine presets, trackers, collections, LaTeX notes, a book reader, twenty-one
// themes, templates, split panes, the graph, backup, note history, search
// operators, publish-and-preview, the phone — and every bit of it is behind a
// command palette nobody thinks to search. Depth you have to know the name of
// is depth nobody meets.
//
// FOUR DECISIONS, and they are the whole design.
//
//  1. A FOLIO, NOT A TOOLTIP. Each card is a page from the manuscript: one
//     drawn miniature at 64×48, the feature's name in the serif, and two
//     sentences that sell the moment rather than document the control. There
//     is no tour of an interface that is worth reading; there is a tour of
//     what you could DO, and the interface is where it happens.
//
//  2. EVERY CARD ENDS IN A REAL ACTION. "Show me" opens the designer, opens
//     the theme picker, opens Settings scrolled to the exact row, writes a
//     live tracker into a new scratch note, runs a search with an operator
//     already in it. The deck CLOSES FIRST, so the thing it just opened is on
//     screen alone rather than behind a modal — the same rule the shortcut
//     sheet's action rows follow, for the same reason.
//
//  3. IT IS ONLY EVER ENTERED. No autoplay, no first-run interstitial, no
//     toast. Four doors (the palette, the empty state, the shortcut sheet,
//     Welcome.md) and one quiet gold dot that goes out for good the first time
//     anybody presses one. client/tour.ts carries that rule and the flag.
//
//  4. IT REMEMBERS. Esc leaves, and the folio you were on is where you come
//     back — by id, so reordering the deck later does not send a returning
//     reader to a different card.
//
// FLIPPING is logical, never physical: ← and → (and vim's h and l) mean
// PREVIOUS and NEXT according to the reading direction, so an Arabic reader's
// → walks backwards through the deck exactly as it walks backwards through a
// line. The swipe reads the same way. The page-turn is 180ms of transform and
// opacity and is gone entirely under `prefers-reduced-motion` — tour.css owns
// that, so there is no motion query in here to get wrong.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDialog } from "../a11y.ts";
import { getLang, localeNum, t } from "../i18n.ts";
import { isKey } from "../keys.ts";
import { sidebarIsDrawer, useStore } from "../state.ts";
import { createNote, putNote } from "../api.ts";
import { syncSnapshot } from "../sync.ts";
import { toast } from "../toast.ts";
import { newNoteFromTemplateCommand } from "../templateActions.ts";
import { openDesigner } from "./design/openDesigner.ts";
import { openThemePicker } from "./ThemePicker.tsx";
import TourGlyph from "./TourGlyphs.tsx";
import {
  TOUR_CARDS,
  TOUR_PREREQ,
  TOUR_UI,
  type TourAction,
  type TourCard,
  type TourText,
} from "./tourCards.ts";
import type { TreeNode } from "../../shared/types.ts";
import "../styles/tour.css";

/** Where the deck left off, by card id. */
const AT_KEY = "vellum.tour-at";

/** How far a finger travels before a pan on the folio is a page turn. Twice
 *  the shell's own slop (client/swipe.ts): this surface is a modal with two
 *  buttons in the middle of it, and a 12px twitch while pressing "Show me"
 *  must never flip the page out from under the press. */
const SWIPE_SLOP = 44;

// ── Copy that travels in the data (see tourCards.ts) ───────────────────────

/** One localized string. Falls back to English rather than to nothing: an
 *  empty card is worse than an untranslated one, and tests/tour.test.ts is
 *  what stops the fallback ever being reached. */
function tx(text: TourText): string {
  return text[getLang()] || text.en;
}

/** The same, with `{name}` slots filled — `tf()`'s job, for the copy `tf()`
 *  cannot see. */
function txf(text: TourText, vars: Record<string, string>): string {
  return tx(text).replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? vars[key] : whole,
  );
}

// ── The actions ────────────────────────────────────────────────────────────

/** Every note path in the vault, so a scratch note can be given a name that
 *  is free. Cheap: the tree is already in the store. */
function notePaths(node: TreeNode | null, into = new Set<string>()): Set<string> {
  if (!node) return into;
  if (node.type === "file") into.add(node.path);
  else for (const child of node.children ?? []) notePaths(child, into);
  return into;
}

/** "Tracker demo.md", or the first free number after it. A tour that writes
 *  over somebody's note is not a tour anybody forgives. */
function freeDemoPath(title: string): string {
  const taken = notePaths(useStore.getState().tree);
  if (!taken.has(`${title}.md`)) return `${title}.md`;
  for (let n = 2; n < 999; n++) {
    const path = `${title} ${n}.md`;
    if (!taken.has(path)) return path;
  }
  return `${title} ${Date.now()}.md`;
}

/** The demo note's body: one real tracker fence, with the prose that says
 *  where the syntax is documented. Deliberately a NEW note, clearly named,
 *  created through the same create-then-write path the template command uses
 *  — nothing existing is touched. */
const TRACKER_DEMO = `\`\`\`tracker
title: The Name of the Rose
kind: book
progress: 214/536
unit: pages
status: reading
rating: 9/10
notes: |
  Nudge the bar with the − and + at the card's edge — one press is one unit, and it rewrites the \`progress:\` line in this very file. There is no separate store: the note IS the state.
\`\`\`

A \`tracker-board\` fence shelves every tracker in the vault:

\`\`\`tracker-board
limit: 12
\`\`\`
`;

async function makeTrackerDemo(title: string): Promise<void> {
  const path = freeDemoPath(title);
  const store = useStore.getState();
  try {
    await createNote(path);
    await putNote(path, TRACKER_DEMO);
    await store.loadTree();
    store.openNote(path);
    if (useStore.getState().readingMode) useStore.getState().setReadingMode(false);
  } catch (err) {
    console.error("vellum: creating the tracker demo failed", err);
    toast(err instanceof Error ? err.message : t("actionFailed"), "error");
  }
}

/** What each card's button DOES. One place, so a card can only declare an
 *  action that exists — `TourAction` is exhaustive and the compiler holds it. */
function runAction(action: TourAction, demoTitle: string): void {
  const store = useStore.getState();
  switch (action) {
    case "designer":
      openDesigner();
      break;
    case "themes":
      openThemePicker();
      break;
    case "preview":
      void store.setPreviewVisitor(true);
      break;
    case "collections":
      store.openSettingsAt("rowPublicFolders");
      break;
    case "trackers":
      void makeTrackerDemo(demoTitle);
      break;
    case "history":
      // The panel that holds it, then the section inside it. History has no
      // store flag of its own — its collapse is component-local, persisted —
      // so the section is asked directly, on the bus it already listens to.
      // The bus name is a LITERAL here rather than an import: the constant is
      // declared beside its listener (`HISTORY_REVEAL_EVENT`, HistoryPanel.tsx)
      // and importing it would make the deck's chunk depend on the history
      // panel's — the whole revision reader, fetched to press a button. Same
      // trade the shortcut sheet makes with "vellum:quicksearch".
      store.setPanelCollapsed(false);
      window.dispatchEvent(new Event("vellum:history-reveal"));
      break;
    case "search":
      // The sidebar's own bus: it reveals the pane and fills the field. An
      // operator, not a word — the card's claim is that the field takes
      // orders, and the proof has to be an order.
      window.dispatchEvent(new CustomEvent("vellum:search", { detail: "is:published" }));
      break;
    case "templates":
      void newNoteFromTemplateCommand();
      break;
    case "palette":
      store.setPaletteOpen(true);
      break;
    case "library":
      store.openLibrary();
      break;
    case "split":
      if (!store.splitFocusedPane("inline")) toast(t("paneCapReached"));
      break;
    case "graph":
      store.setView("graph");
      break;
    case "sync":
      store.openSettingsAt("rowSyncEnabled");
      break;
    case "drawer":
      // On a phone the notes pane is an overlay drawer and on a laptop it is
      // a grid column; "open it" is a different call for each, and the store
      // already knows which shell it is in.
      if (sidebarIsDrawer()) store.setSidebarOpen(true);
      else store.setSidebarCollapsed(false);
      break;
    case "shortcuts":
      store.setShortcutsOpen(true);
      break;
  }
}

// ── The deck ───────────────────────────────────────────────────────────────

function Tour({ onClose }: { onClose: () => void }) {
  const admin = useStore((s) => s.admin);
  const preview = useStore((s) => s.previewVisitor);
  const comments = useStore((s) => s.commentsEnabled);
  useStore((s) => s.language); // re-render the copy on a language change

  // An admin previewing the public site is a visitor for as long as the
  // preview lasts — the same rule every other admin-scoped surface answers to.
  const canAct = admin && !preview;

  const cards = useMemo(
    () => TOUR_CARDS.filter((card) => canAct || !card.admin),
    [canAct],
  );

  const [at, setAt] = useState(() => {
    try {
      const id = localStorage.getItem(AT_KEY);
      const found = id === null ? -1 : cards.findIndex((card) => card.id === id);
      return found < 0 ? 0 : found;
    } catch {
      return 0;
    }
  });
  // Which way the last flip went, so the page turns the way the reader pushed
  // it. Reset to a forward turn on open.
  const [step, setStep] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);

  const index = Math.min(at, cards.length - 1);
  const card = cards[index];
  const total = cards.length;

  // FOCUS LANDS ON THE DECK, not on the first thing in it. The default is the
  // first tabbable, which is the ✕ — so the deck opened with its close button
  // ringed, which reads as "this is selected, press Enter" on the surface
  // whose whole job is to invite. The panel takes a programmatic-only tab stop
  // instead (useDialog gives it one), so ←/→ work immediately, Tab still walks
  // the ring, and nothing looks chosen.
  useDialog(panelRef, { onEscape: onClose, initialFocus: () => panelRef.current });

  // Remember the FOLIO, not the offset: the deck's shape depends on the
  // session (a visitor sees fewer cards) and its order may change in a later
  // release, and neither should send a returning reader somewhere else.
  useEffect(() => {
    try {
      localStorage.setItem(AT_KEY, card.id);
    } catch {
      // storage unavailable — the deck simply opens at the first folio
    }
  }, [card.id]);

  const flip = useCallback(
    (delta: number) => {
      setStep(delta);
      setAt((prev) => {
        const next = prev + delta;
        return next < 0 || next >= total ? prev : next;
      });
    },
    [total],
  );

  // THE READING DIRECTION DECIDES WHICH ARROW IS "NEXT". `dir` is read off the
  // document rather than off the language, so an instance whose chrome is
  // English inside an RTL page still flips the way the page reads.
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const forwardKey = rtl ? "ArrowLeft" : "ArrowRight";
  const backKey = rtl ? "ArrowRight" : "ArrowLeft";

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      // vim's h and l get the same LOGICAL mapping the arrows get, rather than
      // a second rule — and they are resolved through `isKey`, so an Arabic,
      // Russian or Greek keyboard reaches them by position (client/keys.ts)
      // while a Dvorak one, which types real Latin letters, is answered by the
      // letter under the finger rather than by where QWERTY would have put it.
      const forward = e.key === forwardKey || isKey(e, rtl ? "h" : "l");
      const back = e.key === backKey || isKey(e, rtl ? "l" : "h");
      if (!forward && !back) return;
      e.preventDefault();
      flip(forward ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, forwardKey, backKey, rtl]);

  // ── The swipe ────────────────────────────────────────────────────────────
  // A modal is a far simpler place to own a horizontal pan than the shell is:
  // there is nothing scrollable beside it and no drawer to fight over. Two of
  // the shell's five conflict rules still apply and are the only ones that do
  // — a pan whose vertical delta wins belongs to the folio's own scroller, and
  // a second finger is a pinch, never a page turn.
  const pan = useRef<{ id: number; x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (!e.isPrimary || e.pointerType === "mouse") return;
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent): void => {
    const start = pan.current;
    pan.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) < SWIPE_SLOP || Math.abs(dx) < Math.abs(e.clientY - start.y)) return;
    // Leftwards is FORWARD in a left-to-right deck and backward in a
    // right-to-left one, which is the same sentence the arrow keys got.
    flip(dx < 0 === !rtl ? 1 : -1);
  };

  const prereqOff =
    card.needs === "comments"
      ? !comments
      : card.needs === "repo"
        ? syncSnapshot()?.repo === false
        : false;

  const act = (): void => {
    // Close FIRST. Every one of these acts on the app, and running one behind
    // a modal is a change the reader cannot see.
    onClose();
    runAction(card.action, tx(DEMO_TITLE));
  };

  const position = txf(TOUR_UI.position, {
    n: localeNum(index + 1),
    total: localeNum(total),
  });

  return (
    <div className="s-palette-overlay s-tour-overlay" onMouseDown={onClose}>
      <div
        className="s-tour"
        role="dialog"
        aria-modal="true"
        aria-label={tx(TOUR_UI.deck)}
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (pan.current = null)}
      >
        <button
          type="button"
          className="s-tour__close s-iconbtn"
          onClick={onClose}
          aria-label={t("close")}
          title={t("close")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {/* The folio is remounted on every flip (`key`), which is what starts
            the page-turn animation fresh without a class to clear. */}
        <article
          className={`s-tour__folio s-tour__folio--${step > 0 ? "next" : "prev"}`}
          key={card.id}
        >
          <TourGlyph id={card.id} />
          <h2 className="s-tour__name">{tx(card.name)}</h2>
          <p className="s-tour__blurb">{tx(card.blurb)}</p>
          {prereqOff && card.needs && (
            <p className="s-tour__prereq">{tx(TOUR_PREREQ[card.needs])}</p>
          )}
          <button type="button" className="s-tour__go" onClick={act}>
            {tx(card.verb ?? TOUR_UI.showMe)}
          </button>
        </article>

        {/* The card that just arrived, said once, for a reader who cannot see
            the page turn. The folio itself is not a live region: announcing
            two sentences of prose on every flip is a worse answer than
            announcing the name and the position. */}
        <p className="s-sr-only" aria-live="polite">
          {txf(TOUR_UI.cardOf, {
            name: tx(card.name),
            n: localeNum(index + 1),
            total: localeNum(total),
          })}
        </p>

        <nav className="s-tour__nav" aria-label={tx(TOUR_UI.deck)}>
          <button
            type="button"
            className="s-tour__step"
            onClick={() => flip(-1)}
            disabled={index === 0}
            aria-label={tx(TOUR_UI.prev)}
            title={tx(TOUR_UI.prev)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <div className="s-tour__dots">
            {cards.map((one, i) => (
              <button
                type="button"
                key={one.id}
                className={`s-tour__dot${i === index ? " s-tour__dot--on" : ""}`}
                onClick={() => flip(i - index)}
                aria-label={txf(TOUR_UI.goTo, { name: tx(one.name) })}
                aria-current={i === index ? "true" : undefined}
              />
            ))}
          </div>
          <button
            type="button"
            className="s-tour__step"
            onClick={() => flip(1)}
            disabled={index === total - 1}
            aria-label={tx(TOUR_UI.next)}
            title={tx(TOUR_UI.next)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </nav>

        <p className="s-tour__foot">
          <span className="s-tour__count">{position}</span>
          {index === total - 1 ? (
            <span className="s-tour__hint">{tx(TOUR_UI.end)}</span>
          ) : (
            // BOTH ARE IN THE DOM AND CSS PICKS, like the empty state's two
            // halves: no resize listener, no first-paint flash, and nothing
            // for JS to get wrong about which input the reader has.
            <>
              <span className="s-tour__hint s-tour__hint--keys">{tx(TOUR_UI.hint)}</span>
              <span className="s-tour__hint s-tour__hint--touch">{tx(TOUR_UI.hintTouch)}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** The scratch note's name. Copy, so it is Arabic on an Arabic instance — a
 *  file this feature creates is a file somebody has to recognise in their own
 *  tree. */
const DEMO_TITLE: TourText = { en: "Tracker demo", ar: "عيّنة متتبِّع" };

// ---------------------------------------------------------------------------
// Imperative mount. The deck is opened from the palette, the empty state, the
// shortcut sheet and a link in a note — four surfaces in two component trees —
// so it mounts its own root on <body> rather than living inside one of them.
// Same shape as the theme picker and the designer, for the same reason.
// ---------------------------------------------------------------------------

let host: HTMLDivElement | null = null;
let root: Root | null = null;

export function closeTour(): void {
  if (!root || !host) return;
  const [r, h] = [root, host];
  root = null;
  host = null;
  // A later tick: React refuses to unmount a root while it is rendering, and
  // this is called from inside the deck's own handlers.
  setTimeout(() => {
    r.unmount();
    h.remove();
  }, 0);
}

export function openTour(): void {
  if (host) return;
  host = document.createElement("div");
  host.className = "s-tour-host";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<Tour onClose={closeTour} />);
}

export default Tour;
