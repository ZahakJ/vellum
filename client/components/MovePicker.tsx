// "Move to…" — the keyboard and touch half of drag-and-drop.
//
// Dragging is a mouse gesture. It does not exist on a phone, it is hostile to a
// trackpad, and it is unreachable from the keyboard entirely — so a tree whose
// ONLY way to move a note is a drag has quietly made a core operation
// mouse-only. This dialog is the same operation with the same rules
// (`canDrop`), reached from the tree's row menu and from the command palette,
// and it is the surface the reader gets on a touch device where the drag
// affordances never appear.
//
// It mounts its own React root on demand rather than living in App.tsx: the
// store is a module-level zustand and i18n is module-level too, so nothing here
// needs the app's tree — and the shell agent's App.tsx stays untouched.
//
// Shape follows the command palette (CONTRACTS "Command palette"): filter field
// on top, 34px rows, selected row on --accent-soft with a gold leading bar,
// arrow keys + Enter + Esc. A reader who can drive the palette can drive this
// without being taught twice.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t, tf } from "../i18n.ts";
import { allFolders, canDrop, folderLabel, itemLabel, moveTo, parentDir, type MoveItem } from "../move.ts";
import { promptNewFolder } from "../prompts.ts";
import { attachScrollFade } from "../scrollFade.ts";
import { useStore } from "../state.ts";

interface Row {
  /** Vault path of the destination folder ("" = the vault root). */
  path: string;
  /** The folder's own name, or the root's label. */
  name: string;
  /** Everything above it, printed faint on the trailing side. */
  parent: string;
}

/** Is `path` the folder new attachments are written into?
 *
 *  F11: the picker listed `attachments/` beside every real destination, and a
 *  note moved in there is a note filed with the pasted screenshots — the one
 *  place in the vault that is not about its contents. The policy comes from the
 *  server (MeData.attachmentFolder) rather than from a guess about the name:
 *  under "specified" it is one fixed path, and under "subfolder" it is a NAME
 *  that repeats under every note folder, so both shapes are asked here.
 *
 *  Only for notes. A FOLDER may legitimately be filed anywhere the reader
 *  likes, including into their attachments — and hiding the row would take
 *  away the only keyboard route to a move the drag still allows. */
function isAttachmentSink(path: string): boolean {
  const at = useStore.getState().attachmentFolder;
  if (!at || path === "") return false;
  return at.mode === "specified"
    ? path === at.folder
    : path.slice(path.lastIndexOf("/") + 1) === at.folder;
}

function buildRows(item: MoveItem): Row[] {
  const tree = useStore.getState().tree;
  const rows: Row[] = [];
  // The vault root is a destination like any other and is easy to forget: it is
  // the one folder with no row of its own in the tree.
  if (canDrop(item, "")) rows.push({ path: "", name: t("moveVaultRoot"), parent: "" });
  for (const path of allFolders(tree)) {
    if (!canDrop(item, path)) continue; // self, own descendants, current parent
    if (!item.isFolder && isAttachmentSink(path)) continue;
    rows.push({ path, name: path.slice(path.lastIndexOf("/") + 1), parent: parentDir(path) });
  }
  return rows;
}

/** What the dialog resolves with: a destination folder, or the reader asking
 *  for one that does not exist yet (F11 — see the pinned row below). */
export type MoveChoice = { dir: string } | { newFolder: string };

function MovePickerPanel({
  item,
  onDone,
}: {
  item: MoveItem;
  onDone(choice: MoveChoice | null): void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => buildRows(item), [item]);
  // THE ROW'S OWN NAME, not the disk's. The dialog is opened from a tree row
  // reading "Welcome" (and from the palette, on the note whose tab reads
  // "Welcome"), so a heading that says "Move “Welcome.md” to…" has renamed the
  // thing between the click and the dialog. `item.name` stays the byte the API
  // is called with — see move.ts.
  const shownName = itemLabel(item);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.path.toLowerCase().includes(q) || row.name.toLowerCase().includes(q));
  }, [rows, query]);

  useEffect(() => {
    inputRef.current?.focus();
    // A boundary that FADES rather than guillotines (CONTRACTS, Conventions):
    // this list is long in any real vault and its last visible row would
    // otherwise be sliced mid-glyph against the footer rule.
    if (listRef.current) return attachScrollFade(listRef.current);
  }, []);

  // Filtering must never leave the highlight past the end of the list.
  useEffect(() => {
    setSelected((at) => (at <= shown.length ? at : 0));
  }, [shown.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector(".s-movepick__row--active")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, shown]);

  // The NEW-FOLDER row is pinned under the list rather than in it: it is the
  // dialog's door out of a dead end (F11 — a vault whose every folder is
  // refused, or a filter that matches none, used to answer with a sentence and
  // nothing to press), and a door that scrolls away is not one. It is the last
  // stop of the arrow keys, so Enter reaches it without the mouse.
  const newFolderAt = shown.length;
  const commit = useCallback(
    (at: number) => {
      if (at === shown.length) {
        // The filter text is the reader's own words for where this belongs —
        // hand it to the naming dialog rather than making them type it twice.
        onDone({ newFolder: query.trim() });
        return;
      }
      const row = shown[at];
      if (row) onDone({ dir: row.path });
    },
    [onDone, shown, query],
  );

  // Capture phase, like the confirm dialog and the attachment viewer: while this
  // is open it outranks zen's Esc and every editor binding.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDone(null);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((at) => (at + 1) % (shown.length + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((at) => (at - 1 + shown.length + 1) % (shown.length + 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commit(selected);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [shown, selected, commit, onDone]);

  return (
    <div className="s-confirm-overlay" onMouseDown={() => onDone(null)}>
      <div
        className="s-movepick"
        role="dialog"
        aria-modal="true"
        aria-label={tf("moveToTitle", { name: shownName })}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="s-movepick__title" dir="auto">
          {tf("moveToTitle", { name: shownName })}
        </h2>
        <input
          ref={inputRef}
          className="s-movepick__input"
          type="text"
          dir="auto"
          value={query}
          placeholder={t("moveFilter")}
          aria-label={t("moveFilter")}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="s-movepick__list s-scrollfade" ref={listRef} role="listbox" aria-label={t("moveFilter")}>
          {shown.map((row, i) => (
            <button
              // The vault root has no path of its own, so its row needs a key no real
              // path can collide with. Spelled as an ESCAPE: written as a literal NUL
              // byte (which is what this was) the file stops being text — git reports
              // "Binary files differ" and shows no diff for it, GitHub renders nothing,
              // and a source file nobody can review is a source file nobody reviews.
              // Identical string at runtime.
              key={row.path || "\u0000root"}
              type="button"
              role="option"
              aria-selected={i === selected}
              className={`s-movepick__row${i === selected ? " s-movepick__row--active" : ""}`}
              // mousemove, not mouseenter: a list that scrolls under a still
              // pointer must not steal the keyboard's highlight (the palette's
              // own bug, CONTRACTS "Command palette").
              onMouseMove={() => setSelected(i)}
              onClick={() => commit(i)}
            >
              <span className="s-movepick__name" dir="auto">{row.name}</span>
              {row.parent && (
                <span className="s-movepick__parent" dir="auto">{row.parent}</span>
              )}
            </button>
          ))}
          {shown.length === 0 && (
            <p className="s-movepick__none">
              {rows.length === 0 ? t("moveNowhere") : t("moveNoFolders")}
            </p>
          )}
        </div>
        <button
          type="button"
          className={`s-movepick__row s-movepick__new${
            selected === newFolderAt ? " s-movepick__row--active" : ""
          }`}
          onMouseMove={() => setSelected(newFolderAt)}
          onClick={() => commit(newFolderAt)}
        >
          {/* The tree header's own new-folder mark, so the row is recognised
              before it is read. aria-hidden: the label says it. */}
          <svg
            className="s-movepick__glyph"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
          >
            <path
              d="M1.5 12.5v-9h4l1.5 2h7.5v7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path d="M8.5 7v4M6.5 9h4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="s-movepick__name" dir="auto">
            {query.trim() ? tf("moveNewFolderNamed", { name: query.trim() }) : t("moveNewFolder")}
          </span>
        </button>
        <p className="s-movepick__from" dir="auto">
          {tf("moveCurrently", { folder: folderLabel(parentDir(item.path)) })}
        </p>
      </div>
    </div>
  );
}

// ── Imperative bridge ───────────────────────────────────────────────────────
// One root at a time; a second call while one is open resolves the first as a
// cancel rather than stacking two dialogs over each other.

let closeOpen: (() => void) | null = null;

/** Ask which folder `item` should move into. Resolves with the destination
 *  folder path ("" = vault root), with a request for a folder that does not
 *  exist yet, or with null when the reader backed out. */
export function pickMoveTarget(item: MoveItem): Promise<MoveChoice | null> {
  closeOpen?.(); // a second request cancels the first rather than stacking
  return new Promise<MoveChoice | null>((resolve) => {
    const host = document.createElement("div");
    host.className = "s-movepick-host";
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const done = (choice: MoveChoice | null): void => {
      if (settled) return;
      settled = true;
      if (closeOpen === cancel) closeOpen = null;
      // Unmounting from inside a React event handler is a no-no; defer a tick.
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
      resolve(choice);
    };
    const cancel = (): void => done(null);
    closeOpen = cancel;
    root.render(<MovePickerPanel item={item} onDone={done} />);
  });
}

/** Pick a destination, then move — what the row menu and the palette both run.
 *
 *  "New folder…" (F11) is the same move with one step in front of it: the
 *  naming dialog is `promptNewFolder`, the SAME one the tree's own New folder
 *  opens, so the `..`/dotfile refusals and the "creates archive/2026" line
 *  under the field are the rules the reader already knows. It creates at the
 *  vault root and accepts a typed path, which is what makes one dialog enough
 *  for "Archive" and for "Archive/2026" alike. */
export async function moveViaPicker(item: MoveItem): Promise<void> {
  const choice = await pickMoveTarget(item);
  if (choice === null) return;
  if ("dir" in choice) {
    await moveTo(item, choice.dir);
    return;
  }
  const created = await promptNewFolder("", choice.newFolder);
  if (created === null) return;
  await moveTo(item, created);
}
