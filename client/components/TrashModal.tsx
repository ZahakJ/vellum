// Trash browser (palette: "Open trash") — the other half of the delete story.
//
// Every delete dialog in this product ends the same sentence: "recoverable
// from disk". It was true and it was useless, because `.trash/` is a dot-dir
// that the tree, the indexer and the watcher are all built to ignore — so the
// only way to act on the promise was to leave the product, open a terminal and
// `mv` a folder back. A safety net nobody can reach is a safety net in the
// same sense that a locked fire exit is a fire exit.
//
// So: list what is in there, say when it was deleted and where it came from,
// put it back, or erase it. Admin-only (the server 404s the listing for
// anyone else, and the two mutations ride the auth guard), path-safe (the
// entry NAME is the id; the server refuses separators, `..` and dot-prefixes),
// and it restores to the recorded origin rather than dumping everything at the
// vault root.

import { useCallback, useEffect, useState } from "react";
import type { TrashEntry } from "../../shared/types.ts";
import { listTrash, purgeTrash } from "../api.ts";
import { countPhrase, localeDigits, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { formatSize } from "./AttachmentViewer.tsx";
import { confirmModal } from "./Confirm.tsx";
import { contentsPhrase } from "./deleteFlow.ts";
import "../styles/trash.css";

type Feed =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; entries: TrashEntry[] };

/** The instance's date locale, not the browser's — and its numerals with it.
 *  Same rule the moderation rows follow: an Arabic instance that prints
 *  "١٥ أغسطس" in the blog must not print "15 Aug" here. */
function deletedOn(ms: number): string {
  const locale = useStore.getState().blogLocale;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    ...localeDigits(locale),
  });
}

function IconFolder() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconNote() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function IconClip() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.18 5.18l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.49-8.48" />
    </svg>
  );
}

function IconRestore() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

export default function TrashModal() {
  const setTrashOpen = useStore((s) => s.setTrashOpen);
  const restoreTrash = useStore((s) => s.restoreTrash);
  useStore((s) => s.language); // re-render the chrome strings on a language change
  const [feed, setFeed] = useState<Feed>({ state: "loading" });
  // Names currently mid-flight: their row's buttons go inert, so a double
  // click cannot fire two restores of one entry (the second would 404 and
  // toast a failure about something that in fact succeeded).
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const reload = useCallback(() => {
    listTrash()
      .then((entries) => setFeed({ state: "ready", entries }))
      .catch((err: unknown) => {
        console.error("vellum: reading .trash failed", err);
        setFeed({ state: "error" });
      });
  }, []);

  useEffect(reload, [reload]);

  const close = useCallback(() => setTrashOpen(false), [setTrashOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const mark = (name: string, on: boolean) => {
    setBusy((cur) => {
      const next = new Set(cur);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const restore = (entry: TrashEntry) => {
    mark(entry.name, true);
    restoreTrash(entry.name)
      .then((result) => {
        // The toast says WHERE it landed, and says so differently when that is
        // not where it came from. A restore that quietly went somewhere else
        // is the same species of lie as a delete that quietly took four
        // images with it.
        toast(
          tf(result.renamed ? "restoredRenamedToast" : "restoredToast", {
            name: entry.name,
            path: result.path,
          }),
        );
        reload();
      })
      .catch((err: unknown) => {
        console.error("vellum: restore failed", err);
        toast(t("restoreFailed"));
      })
      .finally(() => mark(entry.name, false));
  };

  const purge = (entry: TrashEntry) => {
    void confirmModal({
      title: tf("permDeleteTitle", { name: entry.name }),
      body: tf("purgeBody", { name: entry.name }),
      confirmLabel: t("deletePermanently"),
      // The bin's own delete is the one act in the product with nothing behind
      // it, so it wears the same red-at-rest dialog the vault's erase wears.
      grave: true,
    }).then((ok) => {
      if (!ok) return;
      mark(entry.name, true);
      purgeTrash(entry.name)
        .then(() => {
          toast(tf("purgedToast", { name: entry.name }));
          reload();
        })
        .catch((err: unknown) => {
          console.error("vellum: purge failed", err);
          toast(t("purgeFailed"));
        })
        .finally(() => mark(entry.name, false));
    });
  };

  const emptyAll = (entries: TrashEntry[]) => {
    const contents = contentsPhrase(
      entries.reduce((n, e) => n + e.notes, 0),
      entries.reduce((n, e) => n + e.attachments, 0),
    );
    void confirmModal({
      title: t("emptyTrashTitle"),
      body: tf("emptyTrashBody", { contents }),
      confirmLabel: t("deletePermanently"),
      grave: true,
    }).then((ok) => {
      if (!ok) return;
      // The listing is refetched from the SERVER after — never optimistically
      // emptied — so an entry that failed to go stays visible instead of
      // vanishing from a list that lied about it. And the TOAST follows the
      // results: "Emptied .trash" over a bin that still holds three things is
      // the same small dishonesty as "0 notes" over four images.
      void Promise.allSettled(entries.map((e) => purgeTrash(e.name))).then((results) => {
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0) console.error("vellum: emptying .trash failed", failed);
        toast(t(failed.length > 0 ? "purgeFailed" : "emptiedTrashToast"));
        reload();
      });
    });
  };

  const ready = feed.state === "ready" ? feed.entries : [];

  return (
    <div className="s-trash-overlay" onMouseDown={close}>
      <div
        className="s-trash"
        role="dialog"
        aria-modal="true"
        aria-label={t("trashBrowser")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="s-trash__header">
          <h2 className="s-trash__title">{t("trashBrowser")}</h2>
          {ready.length > 0 && (
            <span className="s-trash__count" dir="auto">
              {countPhrase(ready.length, "trashItems")}
            </span>
          )}
          {ready.length > 0 && (
            <button type="button" className="s-trash__empty-all" onClick={() => emptyAll(ready)}>
              {t("emptyTrash")}
            </button>
          )}
          <button
            type="button"
            className="s-trash__close"
            title={t("close")}
            aria-label={t("closeTrash")}
            onClick={close}
          >
            ×
          </button>
        </header>

        <div className="s-trash__list">
          {feed.state === "loading" && <div className="s-trash__empty">{t("trashLoading")}</div>}
          {feed.state === "error" && <div className="s-trash__empty">{t("trashLoadFailed")}</div>}
          {feed.state === "ready" && feed.entries.length === 0 && (
            <div className="s-trash__empty">{t("trashEmpty")}</div>
          )}
          {feed.state === "ready" &&
            feed.entries.map((entry) => (
              <div key={entry.name} className="s-trashrow">
                <span className="s-trashrow__glyph" aria-hidden="true">
                  {entry.kind === "folder" ? (
                    <IconFolder />
                  ) : entry.kind === "note" ? (
                    <IconNote />
                  ) : (
                    <IconClip />
                  )}
                </span>
                <span className="s-trashrow__main">
                  <span className="s-trashrow__name" dir="auto">
                    {entry.name}
                  </span>
                  {/* One string, not three JSX fragments, and dir="auto" over
                      it: a run of segments joined by "·" is ONE text run to
                      the bidi algorithm, and separate spans in an RTL
                      paragraph reorder against each other. A FOLDER earns the
                      contents counts — the same two currencies the folder
                      delete dialog now uses, because a bin entry that says
                      "0 notes" over four images is this round's bug one step
                      later. A single note or attachment does not: its glyph
                      and its name already said which it is. */}
                  <span className="s-trashrow__meta" dir="auto">
                    {[
                      entry.kind === "folder"
                        ? contentsPhrase(entry.notes, entry.attachments)
                        : null,
                      formatSize(entry.bytes),
                      deletedOn(entry.deletedMs),
                    ]
                      .filter((part): part is string => part !== null)
                      .join(" · ")}
                  </span>
                  {/* Where it goes back to — said BEFORE the restore, because
                      "restored" landing somewhere unexpected is exactly the
                      kind of surprise this whole surface exists to remove. */}
                  <span
                    className={`s-trashrow__origin${entry.origin === null || entry.originTaken ? " s-trashrow__origin--warn" : ""}`}
                    dir="auto"
                  >
                    {entry.origin === null
                      ? t("trashOriginUnknown")
                      : entry.originTaken
                        ? tf("trashOriginTaken", { path: entry.origin })
                        : tf("trashFrom", { path: entry.origin })}
                  </span>
                </span>
                <span className="s-trashrow__tools">
                  <button
                    type="button"
                    className="s-trashrow__restore"
                    disabled={busy.has(entry.name)}
                    title={t("restore")}
                    onClick={() => restore(entry)}
                  >
                    <IconRestore />
                    <span className="s-trashrow__restore-label">{t("restore")}</span>
                  </button>
                  <button
                    type="button"
                    className="s-trashrow__purge"
                    disabled={busy.has(entry.name)}
                    title={t("deletePermanently")}
                    aria-label={t("deletePermanently")}
                    onClick={() => purge(entry)}
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
