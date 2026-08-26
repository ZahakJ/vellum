// Moderation panel ("Moderate comments" in the palette): the newest comments
// across every note in one modal list — hide/unhide, delete, or jump to the
// note a comment sits under. Admin-only; the server 404s the feed for anyone
// else (and when COMMENTS is off, which renders the graceful disabled state).

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CommentData } from "../../shared/types.ts";
import { useDialog } from "../a11y.ts";
import { getDateCalendar, siteDate } from "../dates.ts";
import { countPhrase, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { confirmModal } from "./Confirm.tsx";
import { authorName, deleteComment, IconEyeSlash, setCommentHidden } from "./Marginalia.tsx";
import "../styles/comments.css";
import { stripNoteExt } from "../../shared/noteFormat.ts";

const FEED_LIMIT = 100;

type Feed =
  | { state: "loading" }
  | { state: "disabled" } // COMMENTS off (or feed unreachable) — 404
  | { state: "error" }
  | { state: "ready"; comments: CommentData[] };

async function fetchFeed(): Promise<Feed> {
  const res = await fetch(`/api/comments/all?limit=${FEED_LIMIT}`);
  if (res.status === 404) return { state: "disabled" };
  if (!res.ok) return { state: "error" };
  return { state: "ready", comments: (await res.json()) as CommentData[] };
}

function titleOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  return stripNoteExt(base);
}

function snippetOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139).trimEnd()}…` : flat;
}

// The instance's date locale, not the browser's: an Arabic site formats its
// timestamps in Arabic for every admin — including the numerals. Without
// localeDigits() this row printed "15 أغسطس" while the blog printed
// "١٥ أغسطس" for the same day: two numeral systems for dates in one product.
function shortDate(ms: number): string {
  const locale = useStore.getState().blogLocale;
  const d = new Date(ms);
  // "Same year, so drop the year" is a GREGORIAN test, and it stops being
  // true the moment the instance prints another calendar: a comment from
  // eight months ago sits in a different Hijri year and would lose the one
  // digit that says so. Outside gregorian mode the year always shows.
  const sameYear =
    getDateCalendar() === "gregorian" && d.getFullYear() === new Date().getFullYear();
  return siteDate(d, locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export default function ModerationPanel() {
  const setModerationOpen = useStore((s) => s.setModerationOpen);
  const openSettingsAt = useStore((s) => s.openSettingsAt);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [feed, setFeed] = useState<Feed>({ state: "loading" });
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    let disposed = false;
    fetchFeed()
      .then((f) => {
        if (!disposed) setFeed(f);
      })
      .catch(() => {
        if (!disposed) setFeed({ state: "error" });
      });
    return () => {
      disposed = true;
    };
  }, []);

  const close = useCallback(() => setModerationOpen(false), [setModerationOpen]);

  // Escape, a Tab ring that stays inside the panel, and focus handed back to
  // the palette row that opened it.
  useDialog(panelRef, { onEscape: close });

  const jump = (path: string) => {
    useStore.getState().openNote(path);
    close();
  };

  // EVERY OUTCOME SPEAKS, not only the failures (v1.8 UX audit F25). Hiding a
  // comment moves one row's eye glyph and nothing else; deleting one takes the
  // row away, which reads the same as a list that reordered. The panel used to
  // toast only when something went wrong, so the reader's evidence that
  // moderation had happened at all was a two-pixel change in an icon.
  const toggleHidden = (id: number, hidden: boolean) => {
    setCommentHidden(id, hidden)
      .then(() => {
        setFeed((f) =>
          f.state === "ready"
            ? {
                state: "ready",
                comments: f.comments.map((cm) => (cm.id === id ? { ...cm, hidden } : cm)),
              }
            : f,
        );
        toast(t(hidden ? "commentHiddenToast" : "commentUnhiddenToast"));
      })
      .catch(() => toast(t(hidden ? "hideCommentFailed" : "unhideCommentFailed"), "error"));
  };

  const remove = (id: number) => {
    void confirmModal({
      title: t("deleteCommentTitle"),
      body: t("deleteCommentBody"),
    }).then((ok) => {
      if (!ok) return;
      deleteComment(id)
        .then(() => {
          setFeed((f) =>
            f.state === "ready"
              ? { state: "ready", comments: f.comments.filter((cm) => cm.id !== id) }
              : f,
          );
          // No Undo offered, and deliberately: a deleted comment is gone from
          // the SQLite store, there is no `.trash` behind it, and a button
          // that cannot keep its promise is worse than none. The confirm
          // dialog is where this one is taken back.
          toast(t("commentDeletedToast"));
        })
        .catch(() => toast(t("deleteCommentFailed"), "error"));
    });
  };

  return (
    <div className="s-moderation-overlay" onMouseDown={close}>
      <div
        ref={panelRef}
        className="s-moderation"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="s-moderation__header">
          <h2 className="s-moderation__title" id={titleId}>{t("moderationTitle")}</h2>
          {feed.state === "ready" && feed.comments.length > 0 && (
            <span className="s-moderation__count">
              {countPhrase(feed.comments.length, "comments")}
              {feed.comments.length >= FEED_LIMIT ? t("newestSuffix") : ""}
            </span>
          )}
          <button
            type="button"
            className="s-moderation__close"
            title={t("close")}
            aria-label={t("closeModeration")}
            onClick={close}
          >
            ×
          </button>
        </header>

        <div className="s-moderation__list">
          {feed.state === "loading" && (
            <div className="s-moderation__empty">{t("readingMargins")}</div>
          )}
          {/* THE SWITCH, NOT THE SHELL VARIABLE (v1.8 UX audit F33). This
              state used to read "start the server with COMMENTS=on", which
              tells an owner who has never opened a terminal that the feature
              is not for them — while the panel two clicks away has had a
              Comments row with an on/off control in it the whole time. The
              button closes this modal and opens Settings ON that row. */}
          {feed.state === "disabled" && (
            <div className="s-moderation__empty">
              {t("commentsOff")}
              <button
                type="button"
                className="s-btn s-btn--accent s-moderation__door"
                onClick={() => {
                  close();
                  openSettingsAt("rowComments");
                }}
              >
                {t("commentsOffAction")}
              </button>
            </div>
          )}
          {feed.state === "error" && (
            <div className="s-moderation__empty">{t("commentsLoadFailed")}</div>
          )}
          {feed.state === "ready" && feed.comments.length === 0 && (
            <div className="s-moderation__empty">{t("marginsClean")}</div>
          )}
          {feed.state === "ready" &&
            feed.comments.map((cm) => (
              <div
                key={cm.id}
                className={`s-modrow${cm.hidden ? " s-modrow--hidden" : ""}`}
              >
                <div className="s-modrow__meta">
                  <span className="s-modrow__author" dir="auto">{authorName(cm.author)}</span>
                  <span className="s-modrow__time">{shortDate(cm.createdMs)}</span>
                  {cm.hidden && <span className="s-comment__chip">{t("hiddenChip")}</span>}
                  <button
                    type="button"
                    className="s-modrow__note" dir="auto"
                    title={tf("openNote", { path: cm.notePath })}
                    onClick={() => jump(cm.notePath)}
                  >
                    {titleOf(cm.notePath)}
                  </button>
                </div>
                <div className="s-modrow__body">
                  <span className="s-modrow__snippet" dir="auto">{snippetOf(cm.body)}</span>
                  <span className="s-modrow__tools">
                    <button
                      type="button"
                      className={`s-comment__hide${cm.hidden ? " s-comment__hide--on" : ""}`}
                      title={t(cm.hidden ? "unhideComment" : "hideComment")}
                      aria-label={t(cm.hidden ? "unhideComment" : "hideComment")}
                      aria-pressed={cm.hidden === true}
                      onClick={() => toggleHidden(cm.id, !cm.hidden)}
                    >
                      <IconEyeSlash off={!cm.hidden} />
                    </button>
                    <button
                      type="button"
                      className="s-comment__delete s-modrow__delete"
                      title={t("deleteComment")}
                      aria-label={t("deleteComment")}
                      onClick={() => remove(cm.id)}
                    >
                      ×
                    </button>
                  </span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
