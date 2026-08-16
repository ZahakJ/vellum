// Right panel: backlinks into the open note (store keeps them fresh via
// openNote + SSE). Collapses to zero width; a slim handle on the panel's own
// edge reopens it. Clicking an entry opens that note.

import { useEffect } from "react";
import type { ReactNode } from "react";
import type { Backlink } from "../../shared/types.ts";
import { localeNum, t } from "../i18n.ts";
import TocPanel from "../reading/TocPanel.tsx";
import { hasPanelPreference, useStore } from "../state.ts";
import LocalGraph from "./LocalGraph.tsx";

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
  contexts: string[];
}

/** One card per source note (server sends one entry per mention): keeps the
 *  panel scannable and puts a mention-count badge on multi-link notes. */
function groupBacklinks(backlinks: Backlink[]): BacklinkGroup[] {
  const groups = new Map<string, BacklinkGroup>();
  for (const bl of backlinks) {
    const group = groups.get(bl.path);
    if (group) {
      if (!group.contexts.includes(bl.context)) group.contexts.push(bl.context);
    } else {
      groups.set(bl.path, { path: bl.path, title: bl.title, contexts: [bl.context] });
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
  const openNote = useStore((s) => s.openNote);
  useStore((s) => s.language); // re-render the chrome strings on language change
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
        <div className="s-panel-body">
          {!openPath ? (
            <p className="s-panel-empty">{t("noNoteOpenDot")}</p>
          ) : backlinks.length === 0 ? (
            <p className="s-panel-empty">{t("noBacklinks")}</p>
          ) : (
            groupBacklinks(backlinks).map((group) => (
              <button
                key={group.path}
                type="button"
                className="s-backlink"
                onClick={() => openNote(group.path)}
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
                {group.contexts.map((context, i) => (
                  <span key={i} className="s-backlink-context" dir="auto">
                    {renderContext(context)}
                  </span>
                ))}
              </button>
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
