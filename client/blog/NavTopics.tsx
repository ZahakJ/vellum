// The topics row of the blog nav — ONE LINE, always.
//
// The taxonomy of a real vault is not a fixed size: eleven topics, nineteen,
// three. A wrapping flex row answers that by growing a second, ragged line
// and stranding "More ▾" on it, which reads as a broken nav rather than a
// deliberate one. A fixed cap (the old NAV_TOPICS_MAX = 7) answers it by
// being wrong at every width except the one it was tuned for: seven topics
// overflow a 900px nav and leave a gap in a 1440px one.
//
// So the row measures. A hidden twin of the full row — same classes, same
// font, therefore the same metrics — is laid out once per topics/language
// change; from those widths we take as many topics as fit beside "Home",
// reserving room for the "More ▾" summary whenever anything is left over, and
// fold the remainder into its menu. A ResizeObserver on the row re-runs the
// arithmetic on every width change, and because the row is a `flex: 1` item
// its width does NOT depend on its own content, so the observer can never
// chase its own tail.
//
// Below the burger breakpoint the row becomes a wrapping drop panel and every
// topic shows at once (`expandAll`) — an overflow menu inside an overflow
// panel would be a menu inside a menu. The COLLECTIONS do not go with them:
// blog.css keeps Home and the folder chips in the bar at those widths and
// folds only the topics away (v1.8 UX audit F38), so the one run that is the
// site's own declared structure is never something a reader has to open a
// menu called TOPICS to find.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PublicFolderCard } from "../../shared/types.ts";
import FolderGlyph from "../components/FolderGlyph.tsx";
import { t } from "../i18n.ts";
import { useStore } from "../state.ts";
import { folderUrl, topicUrl } from "./nav.ts";
import { isLabelled as tagIsLabelled, label as tagLabel, useTagLabels } from "../tagLabels.ts";
import { NavLink } from "./util.tsx";

/** Matches the column gap of .s-blog-nav__links in blog.css. */
const GAP = 4;

export default function NavTopics({
  topics,
  folders,
  activeFolder,
  activeTag,
  isHome,
  expandAll,
  routeKey,
}: {
  topics: string[];
  /** The owner's PUBLIC FOLDERS, when the "show in navigation" sub-option is
   *  on (empty otherwise, and empty COLLECTIONS are filtered out upstream —
   *  see BlogShell). They are FIXED leading items, never folded into "More ▾"
   *  and never folded into the burger either: a declared collection is the
   *  site's own structure, and a structure that disappears at 900px — or on a
   *  phone — is not one. Topics still fold, at both breakpoints. */
  folders: PublicFolderCard[];
  activeFolder: string | null;
  activeTag: string | null;
  isHome: boolean;
  /** Burger panel open: show every topic, no overflow menu. */
  expandAll: boolean;
  /** Changes per route — closes the open "More ▾" menu. */
  routeKey: string;
}) {
  // Chrome strings AND the measurement depend on the language: "Home" and
  // "More" are different widths in Arabic, and the naskh type scale differs.
  const language = useStore((s) => s.language);
  // The row's widths are measured from the LABELS, so the measurement has to
  // re-run when they arrive or change — same reason it re-runs on `language`.
  const tagLabelsVersion = useTagLabels();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  /** Indices of `topics` shown in the row, ascending. Null until measured. */
  const [fitIdx, setFitIdx] = useState<number[] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => setMoreOpen(false), [routeKey]);

  // A HAIRLINE BETWEEN TWO KINDS OF CHIP (v1.8 UX audit F28). The row mixes
  // GAMES (a collection the owner declared) with games (a topic the notes
  // declared about themselves), and nothing on screen said the two runs were
  // different kinds of thing — same pill, same size, same colour, one after
  // the other. A hairline is the separator this product already uses between
  // groups (status bar, sync lines); a `·` is not, because the Eastern Arabic
  // zero IS a raised dot. Drawn only when there are two runs to separate.
  const showSep = folders.length > 0 && topics.length > 0;

  // <details> does not close on an outside click, and a menu left standing
  // over the page after the reader moved on reads as a stuck nav.
  const moreRef = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (ev: MouseEvent): void => {
      if (!moreRef.current?.contains(ev.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreOpen]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const twin = measureRef.current;
    if (!row || !twin) return;

    const measure = (): void => {
      const kids = [...twin.children] as HTMLElement[];
      if (kids.length < 2) return; // home + more always present
      // THE TWIN'S SHAPE IS THE ARITHMETIC'S SHAPE. Home, then one chip per
      // folder, then the hairline that separates the two runs, then the
      // topics, then the "More ▾" summary — and `lead` is what keeps the two
      // in step. Adding a row item without adding it here (and to the twin
      // below) is the one way this file breaks: the widths then belong to the
      // wrong elements and the fit is silently wrong.
      const lead = 1 + folders.length + (showSep ? 1 : 0);
      if (kids.length < lead + 1) return;
      const leadW =
        kids
          .slice(0, lead)
          .reduce((sum, k) => sum + k.getBoundingClientRect().width, 0) +
        GAP * (lead - 1);
      const moreW = kids[kids.length - 1].getBoundingClientRect().width;
      const items = kids.slice(lead, -1).map((k) => k.getBoundingClientRect().width);
      // One pixel of headroom: sub-pixel widths must not round into a wrap.
      const avail = row.clientWidth - 1;
      if (avail <= 0) {
        setFitIdx([]); // the row is display:none (burger widths) — nothing to fit
        return;
      }
      const chosen: number[] = [];
      let used = leadW;
      let n = 0;
      while (n < items.length && used + GAP + items[n] <= avail) {
        used += GAP + items[n];
        chosen.push(n);
        n++;
      }
      // Anything left over needs the "More ▾" summary on the SAME line, so
      // give back topics until it has room.
      if (chosen.length < items.length) {
        while (chosen.length > 0 && used + GAP + moreW > avail) {
          used -= GAP + items[chosen.pop() as number];
        }
        // …and then FILL AGAIN. Giving back is a prefix operation: it drops
        // the widest topic that happened to be last, and the old code stopped
        // there — at 860px that meant losing a 115px topic to a 1.4px
        // shortfall and leaving 118px of nav empty beside thirteen hidden
        // topics, which is the exact failure the fixed NAV_TOPICS_MAX was
        // replaced to fix. A short topic further down the list still fits in
        // what the long one vacated, so admit it. Order stays ascending (both
        // passes walk forward), so the row never reshuffles what it shows.
        const shown = new Set(chosen);
        for (let i = 0; i < items.length; i++) {
          if (shown.has(i)) continue;
          if (used + GAP + items[i] + GAP + moreW > avail) continue;
          used += GAP + items[i];
          chosen.push(i);
          shown.add(i);
        }
      }
      // Same list ⇒ same state object: a fresh array every ResizeObserver tick
      // would re-render the whole row for nothing.
      setFitIdx((prev) =>
        prev && prev.length === chosen.length && prev.every((v, i) => v === chosen[i])
          ? prev
          : chosen,
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [topics, folders, showSep, language, tagLabelsVersion]);

  // A shrunk topic list renders once with the previous measurement's indices
  // (the layout effect re-measures right after), so clamp rather than hand
  // `topics[i]` an index that no longer exists.
  const inRow =
    fitIdx === null ? topics.map((_, i) => i) : fitIdx.filter((i) => i < topics.length);
  const rowSet = new Set(inRow);
  const shown = expandAll ? topics : inRow.map((i) => topics[i]);
  const overflow = expandAll ? [] : topics.filter((_, i) => !rowSet.has(i));

  // Direction is per CONTENT, alignment per CHROME: the link keeps the
  // shell's direction (so a row of topics in an RTL nav still stacks and
  // aligns right in the menu) and only the tag itself is isolated, which is
  // what keeps an Arabic tag from reordering against a Latin one beside it.
  // The URL stays CANONICAL (`topicUrl(tag)`); only the word changes. A
  // localised label in the href would make every link the site draws a link
  // to a slug that has to be translated back on arrival — and would break the
  // moment a label was edited, on pages already in someone's browser history.
  const navItem = (tag: string) => (
    <NavLink
      key={tag}
      url={topicUrl(tag)}
      title={tagIsLabelled(tag) ? `#${tag}` : undefined}
      className={`s-blog-nav__link${tag === activeTag ? " s-blog-nav__link--active" : ""}`}
    >
      <bdi>{tagLabel(tag)}</bdi>
    </NavLink>
  );

  // A FOLDER CHIP IS NOT A TOPIC CHIP, and the row has to say so without a
  // second colour: the topic chips are words, and a folder wears its glyph
  // where a `#` would be. Same link furniture otherwise, so the two sit on one
  // baseline and the active state is the one the reader already knows.
  const folderItem = (folder: PublicFolderCard) => (
    <NavLink
      key={folder.id}
      url={folderUrl(folder.slug)}
      className={`s-blog-nav__link s-blog-nav__link--folder${
        folder.slug === activeFolder ? " s-blog-nav__link--active" : ""
      }`}
    >
      <span className="s-blog-nav__glyph" aria-hidden="true">
        <FolderGlyph icon={folder.icon} size={14} />
      </span>
      <bdi>{folder.title}</bdi>
    </NavLink>
  );

  return (
    <div className="s-blog-nav__links" ref={rowRef}>
      {/* `--home` is not decoration: at burger widths the stylesheet keeps
          this link and the folder chips in the bar and folds only the topics
          away (F38), and it needs a way to name the one it keeps. */}
      <NavLink
        url="/"
        className={`s-blog-nav__link s-blog-nav__link--home${isHome ? " s-blog-nav__link--active" : ""}`}
      >
        {t("home")}
      </NavLink>
      {folders.map(folderItem)}
      {showSep && <span className="s-blog-nav__sep" aria-hidden="true" />}
      {shown.map(navItem)}
      {overflow.length > 0 && (
        <details
          className="s-blog-more"
          ref={moreRef}
          open={moreOpen}
          onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="s-blog-nav__link s-blog-more__summary">
            {t("blogMore")} <span aria-hidden="true">▾</span>
          </summary>
          <div className="s-blog-more__menu">{overflow.map(navItem)}</div>
        </details>
      )}

      {/* The hidden twin every measurement comes from. Out of flow and
          inert, so it costs one layout per topics/language change and
          nothing else. */}
      <div className="s-blog-nav__measure" aria-hidden="true" ref={measureRef}>
        <span className="s-blog-nav__link">{t("home")}</span>
        {/* THE FOLDER CHIPS' TWIN. `lead` above counts these, so a chip added
            to the row and not to this clone makes every width after it belong
            to the wrong element. */}
        {folders.map((folder) => (
          <span key={folder.id} className="s-blog-nav__link s-blog-nav__link--folder">
            <span className="s-blog-nav__glyph">
              <FolderGlyph icon={folder.icon} size={14} />
            </span>
            <bdi>{folder.title}</bdi>
          </span>
        ))}
        {/* The hairline's own width, counted in `lead` above. */}
        {showSep && <span className="s-blog-nav__sep" />}
        {/* The twin measures what is DRAWN, so it measures the label: an
            Arabic label is a different width from its Latin canonical tag,
            and measuring the wrong string is how the row ends up one topic
            too wide at exactly the width it was tuned for. */}
        {topics.map((tag) => (
          <span key={tag} className="s-blog-nav__link">
            <bdi>{tagLabel(tag)}</bdi>
          </span>
        ))}
        <span className="s-blog-nav__link s-blog-more__summary">
          {t("blogMore")} <span>▾</span>
        </span>
      </div>
    </div>
  );
}
