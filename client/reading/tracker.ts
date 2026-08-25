// THE TRACKER CARD, DRAWN. One renderer, five surfaces.
//
// The reading view, the blog article, a transclusion card, the note hover
// preview and the editor's live-preview block widget all draw a tracker
// through this module — the rule tables.ts wrote down and CONTRACTS.md holds
// ("One renderer, four surfaces. The editor never grows a second table
// renderer."). It is called from client/reading/render.ts's fence branch, so
// everything downstream of renderNoteContent gets the card for free.
//
// IT IS LOADED ON DEMAND. render.ts reaches this module through a dynamic
// import (see trackerBlock there): it and its stylesheet are 14 kB, and a
// reader of a note with no tracker in it owes none of them. Only the box the
// card lands in is in the first-paint sheet.
//
// It builds DOM imperatively rather than through innerHTML because it has to
// hold live references: the bar's fill is animated after mount, the cover is
// swapped when /api/resolve answers, and the editor's stepper needs its two
// buttons back. The one thing that arrives as HTML is the author's `notes:`
// markdown, which the caller renders through the normal inline pipeline (this
// module never parses markdown itself).
//
// INERT BY DEFAULT. Reading output does not act — interactivity belongs to the
// editor (render.ts's own note above onRootClick). The − / + stepper appears
// only when the caller passes `onStep`, which only the editor widget does; on
// the blog there is no write path and the card is a picture.

import "./tracker.css";
import { FOLDER_ICON_PATHS, type FolderIcon } from "../../shared/folderIcons.ts";
import {
  foldKind,
  type BoardFilter,
  type Tracker,
  type TrackerKind,
  type TrackerStatus,
} from "../../shared/tracker.ts";
import type { TrackerMeta } from "../../shared/types.ts";
import { getTrackers } from "../api.ts";
import { siteDate } from "../dates.ts";
import { autoDir, countPhrase, localeNum, t, tf, type CountUnit, type I18nKey } from "../i18n.ts";
import { Lru } from "../lru.ts";
import { useStore } from "../state.ts";
import {
  embedKnownBroken,
  fileUrl,
  markEmbedBroken,
  resolveAttachment,
} from "../editor/embeds.ts";

/** What the caller lends the card. Every field is optional except the note's
 *  own path, which is what a cover name resolves against. */
export interface TrackerHooks {
  notePath: string;
  /** The author's `notes:` markdown, already rendered to HTML by the caller's
   *  inline pipeline. */
  notesHtml?: string;
  /** Editor only: nudge the progress by ±1 unit. Its absence is what makes
   *  every other surface inert. */
  onStep?: (delta: number) => void;
  /** Called after any change that alters the card's HEIGHT once it is already
   *  on screen — a cover landing, a board filling. The editor answers it with
   *  view.requestMeasure(): CodeMirror's height map records a widget at the
   *  size it had when it was mounted, and a widget that grows afterwards puts
   *  every document position below it out by that much (livePreview.ts:971). */
  onResize?: () => void;
}

// ── Localized vocabulary ────────────────────────────────────────────────────

const STATUS_LABEL: Record<TrackerStatus, I18nKey> = {
  planned: "trackerStatusPlanned",
  active: "trackerStatusActive",
  done: "trackerStatusDone",
  paused: "trackerStatusPaused",
  dropped: "trackerStatusDropped",
};

const KIND_LABEL: Record<TrackerKind, I18nKey> = {
  book: "trackerKindBook",
  game: "trackerKindGame",
  film: "trackerKindFilm",
  show: "trackerKindShow",
  course: "trackerKindCourse",
  project: "trackerKindProject",
  habit: "trackerKindHabit",
};

/** What each kind is counted in when the author names no `unit:`. These are
 *  countPhrase keys, not words: "130 pages" is "١٣٠ صفحات" in Arabic and a
 *  bare English noun on an Arabic card is exactly the half-translation
 *  check-i18n exists to catch. An author's own `unit:` is CONTENT and prints
 *  as they wrote it. */
const KIND_UNIT: Record<TrackerKind, CountUnit> = {
  book: "pages",
  game: "hours",
  film: "minutes",
  show: "episodes",
  course: "lessons",
  project: "tasks",
  habit: "days",
};

/** The board's reading order: what you are doing now, then what you mean to
 *  do, then what you finished — the two shelves nobody wants first, last. */
const GROUP_ORDER: TrackerStatus[] = ["active", "planned", "done", "paused", "dropped"];

// ── Small builders ──────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One glyph from the shared folder set, as an <svg>. The React twin is
 *  client/components/FolderGlyph.tsx; this is the same table drawn by hand,
 *  because the reading pipeline is not React and must not import it. Unknown
 *  icons cannot reach here — shared/tracker.ts only ever answers with a member
 *  of the enum. Decoration: the glyph always sits beside a name. */
function glyph(icon: FolderIcon, size: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of FOLDER_ICON_PATHS[icon]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/** An ISO-ish date under the instance's calendar and numerals; anything else
 *  prints exactly as the author typed it (a season, "last winter", a Hijri
 *  date they wrote by hand — none of which we may silently rewrite). */
function dateText(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const formatted = siteDate(raw, useStore.getState().blogLocale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  return formatted || raw;
}

/** "62 / 130 pages" — localeNum on both halves, the unit agreed in Arabic. */
function fractionText(tracker: Tracker): string | null {
  if (tracker.done === null || tracker.total === null) return null;
  if (tracker.unit !== null) {
    return `${localeNum(tracker.done)} / ${localeNum(tracker.total)} ${tracker.unit}`;
  }
  if (tracker.kindKey !== null) {
    return `${localeNum(tracker.done)} / ${countPhrase(tracker.total, KIND_UNIT[tracker.kindKey])}`;
  }
  return `${localeNum(tracker.done)} / ${localeNum(tracker.total)}`;
}

// ── The bar's memory ────────────────────────────────────────────────────────

/** Where each tracker's bar was last painted, so the next paint ANIMATES FROM
 *  THERE rather than from zero.
 *
 *  This is the whole feel of the feature. The editor rebuilds the widget on
 *  every document edit, so without a memory a nudge from 62 to 63 would paint
 *  a fresh bar at 0 and run it all the way up — a flash backwards, which reads
 *  as a bug rather than as progress. With it, the first sight of a card fills
 *  from empty (the introduction) and every nudge afterwards moves one notch
 *  (the reward). Bounded because the key space is "every tracker ever
 *  rendered in this session"; an eviction costs one re-introduction. */
const lastPainted = new Lru<number>({ max: 256 });

function paintFill(fill: HTMLElement, key: string, percent: number): void {
  const previous = lastPainted.get(key);
  fill.style.inlineSize = `${previous ?? 0}%`;
  lastPainted.set(key, percent);
  // One frame at the old value, so the transition has something to run from.
  requestAnimationFrame(() => {
    fill.style.inlineSize = `${percent}%`;
  });
}

// ── Covers ──────────────────────────────────────────────────────────────────

/** Mount a cover into `slot`: the image when it resolves and loads, the kind
 *  glyph when it does not. Never a broken <img> — the rule the embed widgets
 *  already keep (client/editor/widgets.ts:42-110). */
function mountCover(
  slot: HTMLElement,
  name: string | null,
  icon: FolderIcon,
  hooks: TrackerHooks,
): void {
  const fallback = (): void => {
    const box = el("span", "s-rv-tracker__coverfall");
    box.appendChild(glyph(icon, 32));
    slot.replaceChildren(box);
    hooks.onResize?.();
  };
  if (name === null || embedKnownBroken(name)) {
    fallback();
    return;
  }
  const mount = (path: string): void => {
    const img = document.createElement("img");
    img.className = "s-rv-tracker__coverimg";
    img.alt = "";
    img.draggable = false;
    img.onload = () => hooks.onResize?.();
    img.onerror = () => {
      markEmbedBroken(name);
      fallback();
    };
    img.src = fileUrl(path);
    slot.replaceChildren(img);
  };
  const resolved = resolveAttachment(name);
  if (typeof resolved === "string") mount(resolved);
  else if (resolved === null) fallback();
  else {
    fallback(); // the glyph holds the box's size while the lookup is out
    void resolved.then((path) => {
      if (path && slot.isConnected) mount(path);
    });
  }
}

// ── The card ────────────────────────────────────────────────────────────────

/** The tracker card. `hooks.onStep` turns it into the editor's interactive
 *  card; without it the card is a picture, which is what every public surface
 *  gets. */
export function renderTrackerCard(tracker: Tracker, hooks: TrackerHooks): HTMLElement {
  const card = el("div", `s-rv-tracker s-rv-tracker--${tracker.status}`);
  // THE CARD FOLLOWS ITS TITLE'S SCRIPT, NOT ITS CHROME'S — the rule the
  // designed shell's byline had to learn four times over (DESIGN.md). It
  // cannot be `dir="auto"`: the first strong character in this subtree belongs
  // to the LOCALIZED KIND ("Book"), so an Arabic book on an English instance
  // came out left-to-right with its bar filling away from its own title.
  card.dir = autoDir(tracker.title);

  const cover = el("div", "s-rv-tracker__cover");
  mountCover(cover, tracker.cover, tracker.icon, hooks);
  card.appendChild(cover);

  const body = el("div", "s-rv-tracker__body");
  card.appendChild(body);

  // Eyebrow: the kind, then the status chip at the inline end.
  const eyebrow = el("div", "s-rv-tracker__eyebrow");
  const kind = el("span", "s-rv-tracker__kind");
  kind.appendChild(glyph(tracker.icon, 14));
  const kindWord =
    tracker.kindKey !== null ? t(KIND_LABEL[tracker.kindKey]) : tracker.kind;
  if (kindWord) kind.appendChild(el("span", "s-rv-tracker__kindname", kindWord));
  eyebrow.appendChild(kind);
  const chip = el("span", `s-rv-tracker__status s-rv-tracker__status--${tracker.status}`);
  if (tracker.status !== "planned" && tracker.status !== "active") {
    chip.appendChild(el("span", "s-rv-tracker__dot"));
  }
  chip.appendChild(document.createTextNode(t(STATUS_LABEL[tracker.status])));
  eyebrow.appendChild(chip);
  body.appendChild(eyebrow);

  if (tracker.title) {
    const title = el("div", "s-rv-tracker__title", tracker.title);
    title.dir = "auto";
    body.appendChild(title);
  }

  const percent = tracker.percent;
  if (percent !== null) {
    const track = el("div", "s-rv-tracker__track");
    // A progress bar is a graphic that carries a fact, so it says the fact
    // out loud: the visible percentage is in the meta line beside it, and the
    // role/value pair is what a screen reader gets instead of the pixels.
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(Math.round(percent)));
    track.setAttribute("aria-label", t("trackerProgress"));
    const fill = el("span", "s-rv-tracker__fill");
    track.appendChild(fill);
    body.appendChild(track);
    paintFill(fill, `${hooks.notePath}::${tracker.title}`, percent);
  }

  const meta = el("div", "s-rv-tracker__meta");
  if (percent !== null) {
    meta.appendChild(
      el("span", "s-rv-tracker__pct", tf("trackerPercent", { percent: localeNum(Math.round(percent)) })),
    );
  }
  const fraction = fractionText(tracker);
  if (fraction !== null) {
    const count = el("span", "s-rv-tracker__count", fraction);
    count.dir = "auto";
    meta.appendChild(count);
  }
  // The wordmark's star, earned: it exists only at 100%.
  if (percent !== null && percent >= 100) {
    const star = el("span", "s-rv-tracker__flourish", "✦");
    star.title = t("trackerComplete");
    meta.appendChild(star);
  }
  // The dates are their own group at the far end of the line. They go in as
  // SIBLINGS of the counts rather than in a box of their own, so the meta
  // line's one hairline rule separates them from each other too — two runs of
  // text with nothing but whitespace between them is the ambiguity the
  // separator rule exists to end.
  const dates: string[] = [];
  if (tracker.started !== null) dates.push(tf("trackerStarted", { date: dateText(tracker.started) }));
  if (tracker.finished !== null) dates.push(tf("trackerFinished", { date: dateText(tracker.finished) }));
  for (const [i, text] of dates.entries()) {
    meta.appendChild(
      el("span", `s-rv-tracker__date${i === 0 ? " s-rv-tracker__date--lead" : ""}`, text),
    );
  }
  if (meta.childNodes.length > 0) body.appendChild(meta);

  if (tracker.rating !== null) {
    const { value, max } = tracker.rating;
    const stars = el("div", "s-rv-tracker__stars");
    // The stars are the PICTURE of the rating; the sentence beside them in the
    // accessibility tree is the rating. aria-hidden on the glyphs would fight
    // the label, so the row carries the label and the glyphs are its text.
    stars.setAttribute("role", "img");
    stars.setAttribute(
      "aria-label",
      tf("trackerRating", { value: localeNum(Math.round(value * 10) / 10), max: localeNum(max) }),
    );
    for (let i = 1; i <= Math.min(max, 10); i++) {
      const on = i <= Math.round(value);
      stars.appendChild(
        el("span", `s-rv-tracker__star s-rv-tracker__star--${on ? "on" : "off"}`, on ? "★" : "☆"),
      );
    }
    body.appendChild(stars);
  }

  if (hooks.notesHtml) {
    const notes = el("div", "s-rv-tracker__notes");
    notes.dir = "auto";
    notes.innerHTML = hooks.notesHtml;
    body.appendChild(notes);
  }

  const onStep = hooks.onStep;
  if (onStep) {
    const step = el("div", "s-rv-tracker__step");
    for (const [delta, key, label] of [
      [1, "+", "trackerStepUp"],
      [-1, "−", "trackerStepDown"],
    ] as const) {
      const button = document.createElement("button");
      button.className = "s-rv-tracker__stepbtn";
      button.type = "button";
      button.ariaLabel = t(label);
      button.title = t(label);
      button.textContent = key;
      button.addEventListener("mousedown", (ev) => ev.preventDefault());
      button.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onStep(delta);
      });
      step.appendChild(button);
    }
    card.appendChild(step);
  }

  return card;
}

// ── The board ───────────────────────────────────────────────────────────────

function boardCard(meta: TrackerMeta): HTMLElement {
  // A wikilink by class, because the reading root's ONE delegated handler is
  // what navigates (render.ts onRootClick) and its keyboard twin activates the
  // same selector. A second click listener here would be a second navigation
  // model on a surface that has exactly one.
  const card = document.createElement("a");
  card.className = "s-rv-board__card s-rv-wikilink";
  card.dataset.target = meta.path;
  card.setAttribute("role", "link");
  card.tabIndex = 0;
  card.dir = "auto";
  card.title = meta.noteTitle;

  const thumb = el("span", "s-rv-board__thumb");
  if (meta.cover) {
    const img = document.createElement("img");
    img.className = "s-rv-board__thumbimg";
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => thumb.replaceChildren(glyph(meta.icon, 24));
    img.src = fileUrl(meta.cover);
    thumb.appendChild(img);
  } else {
    thumb.appendChild(glyph(meta.icon, 24));
  }
  card.appendChild(thumb);
  card.appendChild(el("span", "s-rv-board__title", meta.title));

  if (meta.percent !== null) {
    const track = el("span", "s-rv-board__track");
    const fill = el("span", "s-rv-board__fill");
    track.appendChild(fill);
    card.appendChild(track);
    card.appendChild(
      el("span", "s-rv-board__pct", tf("trackerPercent", { percent: localeNum(Math.round(meta.percent)) })),
    );
    paintFill(fill, `board::${meta.path}::${meta.title}`, meta.percent);
  }
  return card;
}

function boardEmpty(): HTMLElement {
  const box = el("div", "s-rv-board__empty");
  const mark = el("span", "s-rv-board__emptyglyph");
  mark.appendChild(glyph("sparkle", 28));
  box.appendChild(mark);
  box.appendChild(el("p", "s-rv-board__emptytext", t("trackerBoardEmpty")));
  box.appendChild(el("code", "s-rv-board__emptyhint", "```tracker"));
  return box;
}

/** The board: a container painted synchronously, filled when /api/trackers
 *  answers. Synchronous first, because a block that is not in the document
 *  until a fetch resolves is a block CodeMirror measured at zero height and a
 *  blog page that reflows under the reader's eyes. */
export function renderTrackerBoard(filter: BoardFilter, hooks: TrackerHooks): HTMLElement {
  const board = el("div", "s-rv-board");
  const wanted = foldKind(filter.kind ?? null);
  void getTrackers()
    .then((all) => {
      let list = all.filter((meta) => {
        if (filter.status && meta.status !== filter.status) return false;
        if (filter.kind === undefined) return true;
        const own = meta.kind?.trim().toLowerCase() ?? "";
        return own === filter.kind.trim().toLowerCase() || (wanted !== null && foldKind(own) === wanted);
      });
      if (filter.limit !== undefined) list = list.slice(0, filter.limit);
      if (list.length === 0) {
        board.replaceChildren(boardEmpty());
        hooks.onResize?.();
        return;
      }
      const groups = document.createDocumentFragment();
      for (const status of GROUP_ORDER) {
        const rows = list.filter((meta) => meta.status === status);
        if (rows.length === 0) continue;
        const group = el("section", "s-rv-board__group");
        group.appendChild(el("h4", "s-rv-board__head", t(STATUS_LABEL[status])));
        const grid = el("div", "s-rv-board__grid");
        for (const meta of rows) grid.appendChild(boardCard(meta));
        group.appendChild(grid);
        groups.appendChild(group);
      }
      board.replaceChildren(groups);
      hooks.onResize?.();
    })
    .catch(() => {
      board.replaceChildren(el("div", "s-rv-board__empty", t("trackerBoardFailed")));
      hooks.onResize?.();
    });
  return board;
}
