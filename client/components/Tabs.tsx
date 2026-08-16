// Tabs row: one tab per open note. Click switches, middle-click or the ×
// button closes, and unsaved notes show a dirty dot.

import { t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { stripBidiControls } from "../../shared/bidi.ts";
import { noteLabelOf } from "../../shared/noteFormat.ts";

/** Tab label: the basename, with bidi controls out. A filename carrying an
 *  RLO reorders its own label ("Bidi<U+202E>Attack Note" → "BidietoN kcattA"),
 *  and these labels travel into aria-labels and the document title. */
function titleOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return stripBidiControls(noteLabelOf(base));
}

export default function Tabs() {
  const openTabs = useStore((s) => s.openTabs);
  const openPath = useStore((s) => s.openPath);
  const dirty = useStore((s) => s.dirty);
  const openNote = useStore((s) => s.openNote);
  const closeTab = useStore((s) => s.closeTab);
  const admin = useStore((s) => s.admin);
  useStore((s) => s.language); // re-render the chrome strings on language change

  // Visitors get a clean publish-site chrome: no tab bar until a second
  // note is actually open.
  if (!admin && openTabs.length < 2) return null;

  if (openTabs.length === 0) return <div className="s-tabs s-tabs--empty" />;

  return (
    <div className="s-tabs" role="tablist">
      {openTabs.map((path) => {
        const isActive = path === openPath;
        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            title={path}
            className={`s-tab${isActive ? " s-tab--active" : ""}${dirty[path] ? " s-tab--dirty" : ""}`}
            onClick={() => openNote(path)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(path);
              }
            }}
            onMouseDown={(e) => {
              // Stop middle-click autoscroll before auxclick fires.
              if (e.button === 1) e.preventDefault();
            }}
          >
            {/* Note-derived text inside chrome: direction per title. */}
            <span className="s-tab-title" dir="auto">{titleOf(path)}</span>
            {dirty[path] && <span className="s-tab-dirty" aria-label={t("unsaved")} />}
            <button
              type="button"
              className="s-tab-close"
              aria-label={tf("closeTab", { title: titleOf(path) })}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(path);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
