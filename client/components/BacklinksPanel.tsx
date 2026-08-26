// Right panel: backlinks into the open note (store keeps them fresh via
// openNote + SSE). Collapses to zero width; a slim handle on the panel's own
// edge reopens it. Clicking an entry opens that note AND lands on the mention
// (client/landing.ts); resting the pointer on a card previews the note.

import { Suspense, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Backlink } from "../../shared/types.ts";
import { localeNum, t } from "../i18n.ts";
// client/landing.ts is reached by DYNAMIC import throughout this file: the
// panel is part of the admin-first-paint budget check-bundle measures, and
// landing/hovering is interaction-time code. The reading view's static import
// of the same module keeps it a single instance.
import { lazySurface } from "../lazySurface.tsx";
import TocPanel from "../reading/TocPanel.tsx";
import { hasPanelPreference, useStore } from "../state.ts";
import LocalGraph from "./LocalGraph.tsx";

// NOTE HISTORY IS LAZY, and it is the only one of the three stacked sections
// that is. It carries a markdown renderer (the revision viewer draws the whole
// note), a stylesheet and a modal, none of which a visitor can ever reach —
// both history routes 404 to one — and most admin sessions never open the
// section either, because it starts collapsed. `lazySurface` rather than bare
// `lazy()` so a redeploy that rotates the chunk hash mid-session gets the
// reload card instead of blanking the panel.
const HistoryPanel = lazySurface(() => import("./HistoryPanel.tsx"));

const WIKILINK_SPLIT_RE =
  /(!?\[\[[^\]|#]+(?:#[^\]|]*)?(?:\|[^\]]*)?\]\])/g;
const WIKILINK_PARSE_RE =
  /^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/;

/** Inline markdown marks read as prose in context lines. */
function stripInlineMd(text: string): string {
  return text.replace(/\*\*|__|~~|`/g, "").replace(/^#{1,6}\s+/, "");
}

/** Render context text with `[[links]]` as gold spans — never raw brackets. */
function renderContext(text: string): ReactNode {
  return text.split(WIKILINK_SPLIT_RE).map((part, i) => {
    const m = WIKILINK_PARSE_RE.exec(part);
    if (!m) return stripInlineMd(part);
    const label = (m[2] ?? m[1]).trim();
    return (
      <span key={i} className="s-backlink-link">
        {label}
      </span>
    );
  });
}

interface BacklinkGroup {
  path: string;
  title: string;
  contexts: { text: string; line: number }[];
}

/** One card per source note (server sends one entry per mention): keeps the
 *  panel scannable and puts a mention-count badge on multi-link notes.
 *  Mentions are distinct by LINE now, not by context text — two identical
 *  lines are two places a click can land, and collapsing them would leave one
 *  of the mentions unreachable. */
function groupBacklinks(backlinks: Backlink[]): BacklinkGroup[] {
  const groups = new Map<string, BacklinkGroup>();
  for (const bl of backlinks) {
    const group = groups.get(bl.path);
    if (group) {
      if (!group.contexts.some((c) => c.line === bl.line)) {
        group.contexts.push({ text: bl.context, line: bl.line });
      }
    } else {
      groups.set(bl.path, {
        path: bl.path,
        title: bl.title,
        contexts: [{ text: bl.context, line: bl.line }],
      });
    }
  }
  return [...groups.values()];
}

// Below this viewport width the panel would squeeze the prose column to a
// few words per line — start collapsed there and track resizes.
//
// 1000 → 1360, and the number is arithmetic rather than taste: the pane costs
// 301px, the sidebar 293, and the prose column's box is 760, so 1354 is the
// first width at which the pane is FREE. Below 1000 it was already collapsing;
// between 1000 and 1354 it was taking the difference straight out of the
// measure, which is how 1024 ended up with a 319px reading ribbon — narrower
// than the same vault gets on a 390px phone. The pane is one click (or
// Ctrl/Cmd+Alt+Shift+B) away at any width, and a click IS a preference: it
// persists, and the auto-collapse never overrides it.
const NARROW_QUERY = "(max-width: 1360px)";

export default function BacklinksPanel() {
  const backlinks = useStore((s) => s.backlinks);
  const openPath = useStore((s) => s.openPath);
  const language = useStore((s) => s.language); // re-render the chrome strings on language change
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Hover previews over the cards: the blog shell's engine, the admin wiring
  // (client/landing.ts). One delegated install on the list's scroll container;
  // re-installed when the language flips because a rendered card carries t()
  // chrome — the same contract the blog install states.
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let dead = false;
    void import("../landing.ts").then((m) => {
      if (dead || !bodyRef.current) return;
      dispose = m.installNotePreviews(bodyRef.current, bodyRef.current);
    });
    return () => {
      dead = true;
      dispose?.();
    };
  }, [language]);
  // Collapse lives in the store now: Ctrl/Cmd+Alt+Shift+B and the palette toggle
  // the same flag this header button does, and it persists across reloads.
  const collapsed = useStore((s) => s.panelCollapsed);
  const setCollapsed = useStore((s) => s.setPanelCollapsed);
  const zen = useStore((s) => s.zen);
  // A deliberate open/close wins over the responsive auto-collapse. "Deliberate"
  // is exactly "persisted": every real toggle (this header button, the reopen
  // handle, Ctrl/Cmd+Alt+Shift+B, the palette) writes the flag, and the auto-
  // collapse never does — so the stored key IS the "the reader has decided"
  // bit, and it carries across sessions for free.
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    // A narrow window on first paint collapses the panel too, not just a
    // resize into one — but as a viewport fact, never as a stored preference.
    if (!hasPanelPreference() && mq.matches) setCollapsed(true, false);
    const onChange = (e: MediaQueryListEvent) => {
      if (!hasPanelPreference()) setCollapsed(e.matches, false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setCollapsed]);

  return (
    <>
      <aside
        className={`s-panel${collapsed ? " s-panel--collapsed" : ""}`}
        // Named by what it holds, not by the edge it happens to sit on — the
        // same rule the toggles and the palette follow. (The a11y round reached
        // for a "backlinksPanelAria" key here; main had already given the panel
        // a truer name, since it now carries the outline and the local graph
        // above the backlinks list.)
        aria-label={t("paneOutline")}
        aria-hidden={collapsed || zen}
      >
        <TocPanel />
        <LocalGraph />
        {/* Its own boundary, and a null fallback: the section is a collapsed
            header row until somebody opens it, so a skeleton where a one-line
            header is about to be would be the only thing that flickered. */}
        <Suspense fallback={null}>
          <HistoryPanel />
        </Suspense>
        <header className="s-panel-header">
          <span className="s-panel-title">{t("backlinks")}</span>
          <span className="s-panel-count">{localeNum(backlinks.length)}</span>
          <button
            type="button"
            className="s-panel-toggle s-iconbtn"
            onClick={() => setCollapsed(true)}
            aria-expanded={!collapsed}
            title={t("hidePaneOutline")}
            tabIndex={collapsed || zen ? -1 : 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </header>
        <div className="s-panel-body" ref={bodyRef}>
          {!openPath ? (
            <p className="s-panel-empty">{t("noNoteOpenDot")}</p>
          ) : backlinks.length === 0 ? (
            <p className="s-panel-empty">{t("noBacklinks")}</p>
          ) : (
            groupBacklinks(backlinks).map((group) => (
              // A div, not the single <button> it used to be: every context
              // line is now its own click target (a button may not contain
              // buttons), and each landing goes to ITS mention's line — the
              // title row lands on the first mention. `data-preview-path` is
              // what the hover install above resolves a card through.
              <div key={group.path} className="s-backlink" data-preview-path={group.path}>
                <button
                  type="button"
                  className="s-backlink-open"
                  onClick={() =>
                    void import("../landing.ts").then((m) => m.landOnLine(group.path, group.contexts[0].line))
                  }
                  title={group.path}
                >
                  {/* Note-derived text inside chrome: direction per note — but
                      per NOTE, not per card. The title line is a chrome block
                      (it also carries the mention-count badge), so it keeps the
                      shell's direction and start-alignment and only the title
                      itself is isolated; `dir="auto"` on the block would have
                      left-aligned an English title inside an otherwise
                      right-aligned Arabic card and moved the badge with it. */}
                  <span className="s-backlink-title">
                    <bdi>{group.title}</bdi>
                    {group.contexts.length > 1 && (
                      <span className="s-backlink-count">
                        {localeNum(group.contexts.length)}
                      </span>
                    )}
                  </span>
                </button>
                {group.contexts.map((context) => (
                  <button
                    key={context.line}
                    type="button"
                    className="s-backlink-context"
                    dir="auto"
                    onClick={() =>
                      void import("../landing.ts").then((m) => m.landOnLine(group.path, context.line))
                    }
                  >
                    {renderContext(context.text)}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </aside>
      {collapsed && !zen && (
        <button
          type="button"
          className="s-reopen s-reopen--panel"
          onClick={() => setCollapsed(false)}
          title={t("showPaneOutline")}
          aria-label={t("showPaneOutline")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      )}
    </>
  );
}
