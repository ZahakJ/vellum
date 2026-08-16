// The reorderable list both composers are built on: one row per section (or
// per article part), dragged with a pointer or moved with the keyboard, each
// row opening onto its own options.
//
// THREE THINGS ARE NOT NEGOTIABLE HERE, and each one is a bug this component
// exists to not have:
//
//  * A drag is not the only way to reorder. Drag-and-drop is unreachable with
//    a keyboard and unreliable under a finger, so every row also carries ↑/↓
//    buttons, and Alt+↑/↓ moves the focused row. The buttons are not a
//    fallback that appears on small screens — they are always there, because
//    a control that exists only on one input device is a control half the
//    readers do not have.
//  * Moving a row keeps the focus on THAT row. Reordering by button is a
//    repeated gesture ("down, down, down"), and a list that drops focus after
//    each press turns three presses into three hunts for the button.
//  * A locked row (the article body) still moves. It cannot be switched off
//    or removed, and its switch and ✕ are absent rather than disabled — an
//    inert control is a question the reader has to answer twice.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Toggle } from "../controls/Fields.tsx";
import { t, tf } from "../../i18n.ts";

export interface ListRow {
  id: string;
  type: string;
  enabled: boolean;
}

interface Props<T extends ListRow> {
  items: T[];
  label: (item: T) => string;
  desc: (item: T) => string;
  /** Locked rows keep their position controls and lose their switch and ✕. */
  locked?: (item: T) => boolean;
  renderOptions: (item: T) => ReactNode;
  onReorder: (from: number, to: number) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove?: (id: string) => void;
}

export default function SectionList<T extends ListRow>({
  items,
  label,
  desc,
  locked,
  renderOptions,
  onReorder,
  onToggle,
  onRemove,
}: Props<T>) {
  // One row open at a time: a composer whose every row is expanded is a long
  // form, which is the shape this list exists instead of.
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  // The row a keyboard move just relocated; focus follows it after the
  // reorder has committed (a moved node loses focus when React re-keys it).
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"] .s-dsnc-row__name`)
      ?.focus();
  }, [items]);

  const move = (id: string, delta: number): void => {
    const from = items.findIndex((item) => item.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return;
    refocus.current = id;
    onReorder(from, to);
  };

  return (
    <ul className="s-dsnc-list" ref={listRef}>
      {items.map((item, index) => {
        const isLocked = locked?.(item) === true;
        const open = openId === item.id;
        return (
          <li
            key={item.id}
            data-row={item.id}
            className={[
              "s-dsnc-row",
              item.enabled ? "" : "s-dsnc-row--off",
              open ? "s-dsnc-row--open" : "",
              dragId === item.id ? "s-dsnc-row--dragging" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable
            onDragStart={(e) => {
              setDragId(item.id);
              e.dataTransfer.effectAllowed = "move";
              // Firefox refuses to start a drag with an empty payload.
              e.dataTransfer.setData("text/plain", item.id);
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => {
              if (dragId === null || dragId === item.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDragEnter={() => {
              // Live reorder while the pointer travels: the reader sees the
              // arrangement they are about to get, not an insertion caret
              // they have to translate into one.
              if (dragId === null || dragId === item.id) return;
              const from = items.findIndex((row) => row.id === dragId);
              if (from < 0 || from === index) return;
              onReorder(from, index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragId(null);
            }}
          >
            <div className="s-dsnc-row__head">
              <span className="s-dsnc-grip" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                  <circle cx="6" cy="4" r="1.3" />
                  <circle cx="10" cy="4" r="1.3" />
                  <circle cx="6" cy="8" r="1.3" />
                  <circle cx="10" cy="8" r="1.3" />
                  <circle cx="6" cy="12" r="1.3" />
                  <circle cx="10" cy="12" r="1.3" />
                </svg>
              </span>
              <button
                type="button"
                className="s-dsnc-row__name"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : item.id)}
                onKeyDown={(e) => {
                  // Alt+↑/↓ is the keyboard's drag. Plain arrows stay with
                  // the browser so the list can still be read through.
                  if (!e.altKey) return;
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    move(item.id, -1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    move(item.id, 1);
                  }
                }}
              >
                <span className="s-dsnc-row__label">{label(item)}</span>
                <span className="s-dsnc-row__desc">{desc(item)}</span>
              </button>
              <div className="s-dsnc-row__tools">
                <button
                  type="button"
                  className="s-iconbtn s-dsnc-move"
                  disabled={index === 0}
                  title={t("dsnMoveUp")}
                  aria-label={tf("dsnMoveUpOf", { name: label(item) })}
                  onClick={() => move(item.id, -1)}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M8 12.5V4M4 7.5 8 3.5l4 4" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="s-iconbtn s-dsnc-move"
                  disabled={index === items.length - 1}
                  title={t("dsnMoveDown")}
                  aria-label={tf("dsnMoveDownOf", { name: label(item) })}
                  onClick={() => move(item.id, 1)}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M8 3.5V12M4 8.5l4 4 4-4" />
                  </svg>
                </button>
                {isLocked ? (
                  <span className="s-dsnc-locked">{t("dsnAlwaysShown")}</span>
                ) : (
                  <>
                    <Toggle
                      value={item.enabled}
                      onChange={(next) => onToggle(item.id, next)}
                      label={tf("dsnShowOf", { name: label(item) })}
                      onLabel={t("dsnShown")}
                      offLabel={t("dsnHidden")}
                    />
                    {onRemove && (
                      <button
                        type="button"
                        className="s-iconbtn s-dsnc-remove"
                        title={t("dsnRemove")}
                        aria-label={tf("dsnRemoveOf", { name: label(item) })}
                        onClick={() => {
                          if (openId === item.id) setOpenId(null);
                          onRemove(item.id);
                        }}
                      >
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            {open && <div className="s-dsnc-row__opts">{renderOptions(item)}</div>}
          </li>
        );
      })}
    </ul>
  );
}
