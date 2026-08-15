// Right panel: backlinks into the open note (store keeps them fresh via
// openNote + SSE). Collapses to zero width; a floating chip over the center
// column reopens it. Clicking an entry opens that note.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Backlink } from "../../shared/types.ts";
import { localeNum, t } from "../i18n.ts";
import TocPanel from "../reading/TocPanel.tsx";
import { useStore } from "../state.ts";
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
const NARROW_QUERY = "(max-width: 1000px)";

export default function BacklinksPanel() {
  const backlinks = useStore((s) => s.backlinks);
  const openPath = useStore((s) => s.openPath);
  const openNote = useStore((s) => s.openNote);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [collapsed, setCollapsed] = useState(
    () => window.matchMedia(NARROW_QUERY).matches,
  );
  // A deliberate open/close wins over the responsive auto-collapse.
  const userToggled = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      if (!userToggled.current) setCollapsed(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      <aside
        className={`s-panel${collapsed ? " s-panel--collapsed" : ""}`}
        aria-hidden={collapsed}
      >
        <TocPanel />
        <LocalGraph />
        <header className="s-panel-header">
          <span className="s-panel-title">{t("backlinks")}</span>
          <span className="s-panel-count">{localeNum(backlinks.length)}</span>
          <button
            type="button"
            className="s-panel-toggle s-iconbtn"
            onClick={() => {
              userToggled.current = true;
              setCollapsed(true);
            }}
            aria-expanded={!collapsed}
            title={t("hideBacklinks")}
            tabIndex={collapsed ? -1 : 0}
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
      {collapsed && (
        <button
          type="button"
          className="s-panel-reopen"
          onClick={() => {
            userToggled.current = true;
            setCollapsed(false);
          }}
          title={t("showBacklinks")}
          aria-label={t("showBacklinks")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      )}
    </>
  );
}
