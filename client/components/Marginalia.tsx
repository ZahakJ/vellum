// Marginalia: reader comments under the reading view of published notes.
// Renders nothing until GET /api/comments answers — a 404 (COMMENTS=off, or
// the note isn't commentable) keeps the whole section dark. Bodies are plain
// text: React escapes them on render, CSS preserves the line breaks.

import { useEffect, useRef, useState } from "react";
import type { CommentData } from "../../shared/types.ts";
import { withPreview } from "../api.ts";
import { countPhrase, localeDigits, t } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { confirmModal } from "./Confirm.tsx";
import "../styles/comments.css";

const AUTHOR_KEY = "vellum.comment.author";

async function fetchComments(path: string): Promise<CommentData[]> {
  const res = await fetch(`/api/comments?path=${encodeURIComponent(path)}`, withPreview());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CommentData[];
}

async function postComment(payload: {
  path: string;
  author: string;
  body: string;
  website: string;
}): Promise<CommentData> {
  const res = await fetch("/api/comments", withPreview({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data !== null && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as CommentData;
}

export async function deleteComment(id: number): Promise<void> {
  const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Admin-only: hide (or unhide) a comment. Hidden ones vanish for visitors. */
export async function setCommentHidden(id: number, hidden: boolean): Promise<void> {
  const res = await fetch(`/api/comments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Eye-with-slash glyph for the hide toggle (crossed out = currently hidden). */
export function IconEyeSlash({ off }: { off: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.6" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** "5 minutes ago" / "منذ ٥ دقائق" — Intl does the plural agreement AND the
 *  numerals, so an Arabic site gets Eastern Arabic digits here exactly like it
 *  does in post dates. numeric:"auto" buys the idiomatic "yesterday"/"أمس". */
function relativeTime(ms: number, locale: string): string {
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  // Same numeral rule as every other date in the product (i18n.ts owns it).
  const options: Intl.RelativeTimeFormatOptions = {
    numeric: "auto",
    ...localeDigits(locale),
  };
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, options);
  } catch {
    rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
  if (seconds < 45) return rtf.format(0, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 31) return rtf.format(-days, "day");
  const months = Math.round(days / 30.4);
  if (months < 12) return rtf.format(-months, "month");
  return rtf.format(-Math.round(days / 365.25), "year");
}

/** The server stores the language-agnostic sentinel "Anonymous" for a comment
 *  posted without a name (settings.language can change under stored data, so
 *  the fallback cannot be frozen into the row at write time) — the CHROME
 *  localizes it at render, here and in the moderation panel. A visitor who
 *  literally types "Anonymous" gets the same treatment; that is a feature. */
export function authorName(author: string): string {
  return author === "Anonymous" ? t("marginaliaAnonymous") : author;
}

function readStoredAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function Marginalia({ path }: { path: string }) {
  const admin = useStore((s) => s.admin);
  const openPublished = useStore((s) => s.openPublished);
  const inPublishedSet = useStore((s) => s.publishedPaths?.has(path) ?? false);
  const locale = useStore((s) => s.blogLocale);
  useStore((s) => s.language); // re-render chrome strings on a live language switch

  const [comments, setComments] = useState<CommentData[] | null>(null);
  const [author, setAuthor] = useState(readStoredAuthor);
  const [body, setBody] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — humans never see it
  const [posting, setPosting] = useState(false);
  const tempId = useRef(-1);

  // Visitors only ever see published notes; admins get marginalia only where
  // the note is actually published (comments are the public site's furniture).
  const commentable = !admin || openPublished === true || inPublishedSet;

  useEffect(() => {
    if (!commentable) return;
    let disposed = false;
    setComments(null);
    fetchComments(path)
      .then((list) => {
        if (!disposed) setComments(list);
      })
      .catch(() => {
        // COMMENTS=off or not commentable — the section stays hidden.
        if (!disposed) setComments(null);
      });
    return () => {
      disposed = true;
    };
  }, [path, commentable]);

  if (!commentable || comments === null) return null;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = body.trim();
    if (!text || posting) return;
    const name = author.trim().slice(0, 40);
    try {
      localStorage.setItem(AUTHOR_KEY, name);
    } catch {
      // storage unavailable — the name just won't stick
    }
    // Optimistic append: show the note immediately, reconcile on the response.
    const temp: CommentData = {
      id: tempId.current--,
      notePath: path,
      author: name || "Anonymous",
      body: text,
      createdMs: Date.now(),
    };
    setComments((list) => [...(list ?? []), temp]);
    setBody("");
    setPosting(true);
    postComment({ path, author: name, body: text, website })
      .then((saved) => {
        setComments((list) => (list ?? []).map((cm) => (cm.id === temp.id ? saved : cm)));
      })
      .catch((err: unknown) => {
        setComments((list) => (list ?? []).filter((cm) => cm.id !== temp.id));
        setBody(text); // give the words back
        toast(err instanceof Error ? err.message : t("marginaliaFailed"));
      })
      .finally(() => setPosting(false));
  };

  const remove = (id: number): void => {
    void confirmModal({
      title: t("deleteCommentTitle"),
      body: t("deleteCommentBody"),
    }).then((ok) => {
      if (!ok) return;
      deleteComment(id)
        .then(() => setComments((list) => (list ?? []).filter((cm) => cm.id !== id)))
        .catch(() => toast(t("deleteCommentFailed")));
    });
  };

  const toggleHidden = (id: number, hidden: boolean): void => {
    setCommentHidden(id, hidden)
      .then(() =>
        setComments((list) => (list ?? []).map((cm) => (cm.id === id ? { ...cm, hidden } : cm))),
      )
      .catch(() => toast(hidden ? t("hideCommentFailed") : t("unhideCommentFailed")));
  };

  return (
    <section className="s-marginalia" aria-label={t("marginaliaAria")}>
      <header className="s-marginalia__header">
        <h2 className="s-marginalia__title">{t("marginalia")}</h2>
        <span className="s-marginalia__count">
          {comments.length === 0
            ? t("marginaliaEmpty")
            : countPhrase(comments.length, "marginNotes")}
        </span>
      </header>

      {comments.length > 0 && (
        <ul className="s-marginalia__list">
          {comments.map((cm) => (
            <li
              key={cm.id}
              className={`s-comment${cm.hidden ? " s-comment--hidden" : ""}`}
            >
              <div className="s-comment__meta">
                <span className="s-comment__author" dir="auto">{authorName(cm.author)}</span>
                <span className="s-comment__time">{relativeTime(cm.createdMs, locale)}</span>
                {cm.hidden && <span className="s-comment__chip">{t("hiddenChip")}</span>}
                {admin && cm.id > 0 && (
                  <span className="s-comment__tools">
                    <button
                      type="button"
                      className={`s-comment__hide${cm.hidden ? " s-comment__hide--on" : ""}`}
                      title={cm.hidden ? t("unhideComment") : t("hideComment")}
                      aria-label={cm.hidden ? t("unhideComment") : t("hideComment")}
                      aria-pressed={cm.hidden === true}
                      onClick={() => toggleHidden(cm.id, !cm.hidden)}
                    >
                      <IconEyeSlash off={!cm.hidden} />
                    </button>
                    <button
                      type="button"
                      className="s-comment__delete"
                      title={t("deleteComment")}
                      aria-label={t("deleteComment")}
                      onClick={() => remove(cm.id)}
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>
              {/* Comment bodies and names are reader CONTENT, not chrome: without
                  dir="auto" an English comment inherits the Arabic shell's RTL
                  and renders its trailing punctuation on the wrong side
                  (".Mark T", ".…oral tradition is excellent"). */}
              <p className="s-comment__body" dir="auto">{cm.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form className="s-marginalia__form" onSubmit={submit}>
        <input
          type="text"
          className="s-marginalia__name"
          placeholder={t("marginaliaName")}
          maxLength={40}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
        {/* Honeypot: off-screen for humans, irresistible to bots. */}
        <input
          type="text"
          className="s-marginalia__web"
          name="website"
          placeholder="Website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
        <textarea
          className="s-marginalia__text"
          placeholder={t("marginaliaBody")}
          rows={3}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="s-marginalia__actions">
          <button
            type="submit"
            className="s-marginalia__post"
            disabled={posting || body.trim() === ""}
          >
            {t("marginaliaPost")}
          </button>
        </div>
      </form>
    </section>
  );
}
