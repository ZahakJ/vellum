// Right panel: backlinks into the open note (store keeps them fresh via
// openNote + SSE). Collapses to zero width; a floating chip over the center
// column reopens it. Clicking an entry opens that note.

import { useState } from "react";
import type { ReactNode } from "react";
import TocPanel from "../reading/TocPanel.tsx";
import { useStore } from "../state.ts";

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

export default function BacklinksPanel() {
  const backlinks = useStore((s) => s.backlinks);
  const openPath = useStore((s) => s.openPath);
  const openNote = useStore((s) => s.openNote);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <aside
        className={`s-panel${collapsed ? " s-panel--collapsed" : ""}`}
        aria-hidden={collapsed}
      >
        <TocPanel />
        <header className="s-panel-header">
          <span className="s-panel-title">Backlinks</span>
          <span className="s-panel-count">{backlinks.length}</span>
          <button
            type="button"
            className="s-panel-toggle s-iconbtn"
            onClick={() => setCollapsed(true)}
            aria-expanded={!collapsed}
            title="Hide backlinks"
            tabIndex={collapsed ? -1 : 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </header>
        <div className="s-panel-body">
          {!openPath ? (
            <p className="s-panel-empty">No note open.</p>
          ) : backlinks.length === 0 ? (
            <p className="s-panel-empty">
              No backlinks yet — link to this note with [[…]]
            </p>
          ) : (
            backlinks.map((bl) => (
              <button
                key={`${bl.path}:${bl.context}`}
                type="button"
                className="s-backlink"
                onClick={() => openNote(bl.path)}
                title={bl.path}
              >
                <span className="s-backlink-title">{bl.title}</span>
                <span className="s-backlink-context">
                  {renderContext(bl.context)}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
      {collapsed && (
        <button
          type="button"
          className="s-panel-reopen"
          onClick={() => setCollapsed(false)}
          title="Show backlinks"
          aria-label="Show backlinks"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      )}
    </>
  );
}
