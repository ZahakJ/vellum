// Right panel: backlinks into the open note (store keeps them fresh via
// openNote + SSE). Collapsible; clicking an entry opens that note.

import { useState } from "react";
import { useStore } from "../state.ts";

export default function BacklinksPanel() {
  const backlinks = useStore((s) => s.backlinks);
  const openPath = useStore((s) => s.openPath);
  const openNote = useStore((s) => s.openNote);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`s-backlinks${collapsed ? " s-backlinks--collapsed" : ""}`}>
      <header className="s-backlinks__header">
        <button
          type="button"
          className="s-backlinks__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          title={collapsed ? "Show backlinks" : "Hide backlinks"}
        >
          {collapsed ? "«" : "»"}
        </button>
        {!collapsed && (
          <h3 className="s-backlinks__title">
            Backlinks
            <span className="s-backlinks__count">{backlinks.length}</span>
          </h3>
        )}
      </header>
      {!collapsed && (
        <div className="s-backlinks__list">
          {!openPath ? (
            <p className="s-backlinks__none">No note open.</p>
          ) : backlinks.length === 0 ? (
            <p className="s-backlinks__none">No notes link here yet.</p>
          ) : (
            backlinks.map((bl) => (
              <button
                key={`${bl.path}:${bl.context}`}
                type="button"
                className="s-backlinks__item"
                onClick={() => openNote(bl.path)}
                title={bl.path}
              >
                <span className="s-backlinks__item-title">{bl.title}</span>
                <span className="s-backlinks__item-context">{bl.context}</span>
              </button>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
