// Moderation panel ("Moderate comments" in the palette): the newest comments
// across every note in one modal list — hide/unhide, delete, or jump to the
// note a comment sits under. Admin-only; the server 404s the feed for anyone
// else (and when COMMENTS is off, which renders the graceful disabled state).

import { useEffect, useState } from "react";
import type { CommentData } from "../../shared/types.ts";
import { countPhrase, localeDigits, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { confirmModal } from "./Confirm.tsx";
import { authorName, deleteComment, IconEyeSlash, setCommentHidden } from "./Marginalia.tsx";
import "../styles/comments.css";

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
  return base.replace(/\.md$/i, "");
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
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    ...localeDigits(locale),
  });
}

export default function ModerationPanel() {
  const setModerationOpen = useStore((s) => s.setModerationOpen);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [feed, setFeed] = useState<Feed>({ state: "loading" });

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModerationOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setModerationOpen]);

  const close = () => setModerationOpen(false);

  const jump = (path: string) => {
    useStore.getState().openNote(path);
    close();
  };

  const toggleHidden = (id: number, hidden: boolean) => {
    setCommentHidden(id, hidden)
      .then(() =>
        setFeed((f) =>
          f.state === "ready"
            ? {
                state: "ready",
                comments: f.comments.map((cm) => (cm.id === id ? { ...cm, hidden } : cm)),
              }
            : f,
        ),
      )
      .catch(() => toast(t(hidden ? "hideCommentFailed" : "unhideCommentFailed")));
  };

  const remove = (id: number) => {
    void confirmModal({
      title: t("deleteCommentTitle"),
      body: t("deleteCommentBody"),
    }).then((ok) => {
      if (!ok) return;
      deleteComment(id)
        .then(() =>
          setFeed((f) =>
            f.state === "ready"
              ? { state: "ready", comments: f.comments.filter((cm) => cm.id !== id) }
              : f,
          ),
        )
        .catch(() => toast(t("deleteCommentFailed")));
    });
  };

  return (
    <div className="s-moderation-overlay" onMouseDown={close}>
      <div
        className="s-moderation"
        role="dialog"
        aria-label={t("cmdModerateComments")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="s-moderation__header">
          <h2 className="s-moderation__title">{t("moderationTitle")}</h2>
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
          {feed.state === "disabled" && (
            <div className="s-moderation__empty">{t("commentsOff")}</div>
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
