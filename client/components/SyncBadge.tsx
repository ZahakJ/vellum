// Status-bar backup indicator (ADMIN only, and only once backup & sync is
// switched on with a remote — an instance that never configured it shows
// nothing at all).
//
// Deliberately quiet: a branch glyph, plus a count only when there is
// something uncommitted. Click opens a small panel with the whole diagnosis in
// it — branch, remote, ahead/behind, the last result, and git's own error line
// as SELECTABLE text with a copy button.
//
// It used to be a native `title` tooltip and a click that re-ran the sync.
// CONTRACTS.md calls that error text "the diagnosis", i.e. the string a reader
// pastes into a search box: a tooltip cannot be selected or copied, takes a
// second of hover, and does not exist at all on touch. And on a FAILURE, the
// one affordance the badge offered was the one action that cannot explain the
// failure — so the panel leads with "Backup settings" instead.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { localeNum, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import {
  onSyncChange,
  refreshSyncStatus,
  runSyncNow,
  syncBusy,
  syncCause,
  syncSnapshot,
  syncWhen,
} from "../sync.ts";

const POLL_MS = 20_000;

export default function SyncBadge() {
  const admin = useStore((s) => s.admin);
  const preview = useStore((s) => s.previewVisitor);
  const locale = useStore((s) => s.blogLocale);
  useStore((s) => s.language); // re-render the chrome strings on language change
  const [, bump] = useState(0);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [anchor, setAnchor] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  /** The status bar clips its own overflow (long breadcrumbs must not push the
   *  bar around), so the panel is `position: fixed` and pinned to the badge by
   *  hand. Anchored on the reading direction's END edge, which is the side the
   *  bar's own segments grow from. */
  const place = useCallback(() => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rtl = document.documentElement.dir === "rtl";
    setAnchor({
      bottom: Math.round(window.innerHeight - rect.top + 8),
      ...(rtl
        ? { left: Math.max(8, Math.round(rect.left)) }
        : { right: Math.max(8, Math.round(window.innerWidth - rect.right)) }),
    });
  }, []);

  useEffect(() => onSyncChange(() => bump((n) => n + 1)), []);

  useEffect(() => {
    if (!admin || preview) return;
    void refreshSyncStatus();
    const id = window.setInterval(() => void refreshSyncStatus(), POLL_MS);
    const onFocus = (): void => void refreshSyncStatus();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [admin, preview]);

  // Click-outside and Esc close the panel. Capture phase for the key, like the
  // other overlays, so the editor never sees it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    place();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => setCopied(false), [open]);

  const status = syncSnapshot();
  // Never shown to a visitor, and never shown on an instance that has not
  // turned sync on — the feature is invisible until it is asked for.
  if (!admin || preview || !status || !status.enabled || !status.configured) return null;

  const busy = syncBusy();
  const failed = status.last !== null && !status.last.ok;
  const state = busy ? "busy" : failed ? "error" : status.dirty > 0 ? "dirty" : "clean";
  const error = failed ? (status.last?.message ?? "") : null;
  // The cause we can state, ahead of git's implementation detail.
  const cause = syncCause(status.authMode, status);

  const label = busy
    ? t("syncing")
    : failed
      ? t("syncErrorShort")
      : status.dirty > 0
        ? localeNum(status.dirty)
        : "";

  const copyError = (): void => {
    if (error === null) return;
    void navigator.clipboard
      ?.writeText(error)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <>
      <span className="s-syncwrap" ref={wrapRef}>
        <button
          type="button"
          ref={btnRef}
          className={`s-statusbar__btn s-sync s-sync--${state}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("syncDetails")}
        >
          <svg
            className="s-sync__glyph"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="6" cy="4" r="2" />
            <circle cx="6" cy="20" r="2" />
            <circle cx="18" cy="8" r="2" />
            <path d="M6 6v8" />
            <path d="M18 10c0 4-6 3-6 8" />
          </svg>
          {label !== "" && <span className="s-sync__label">{label}</span>}
        </button>

        {open && (
          <div className="s-syncpop" style={anchor} role="dialog" aria-label={t("syncDetails")}>
            <div className="s-syncpop__line">
              {status.repo
                ? tf("syncTipBranch", { branch: status.branch ?? "—", host: status.remoteHost ?? "—" })
                : t("syncTipNoRepo")}
            </div>
            {status.repo && (
              <div className="s-syncpop__line s-syncpop__line--muted s-smodal__counts">
                <span>
                  {status.dirty > 0 ? tf("syncTipDirty", { count: localeNum(status.dirty) }) : t("syncTipClean")}
                </span>
                {/* Separated by a hairline, not a "·": the Eastern Arabic zero
                    is itself a dot. And null is not zero: no remote-tracking ref means nothing here
                    has ever reached the remote, which is the opposite of the
                    "0 ahead · 0 behind" a fully backed-up vault reads. */}
                {status.ahead !== null && status.behind !== null && (
                  <>
                    <bdi>{tf("syncAhead", { count: localeNum(status.ahead) })}</bdi>
                    <bdi>{tf("syncBehind", { count: localeNum(status.behind) })}</bdi>
                  </>
                )}
              </div>
            )}
            {status.repo && (status.ahead === null || status.behind === null) && (
              <div className="s-syncpop__line">
                <span className="s-syncpop__warn">{t("syncNoTracking")}</span>
              </div>
            )}
            {status.last !== null && (
              <div className="s-syncpop__line s-syncpop__line--muted s-smodal__counts">
                {/* Isolated separately: dir="auto" over "date — message" takes
                    its direction from the date and reorders the rest. */}
                <bdi>{syncWhen(status.last.at, locale)}</bdi>
                <bdi>
                  {status.last.ok
                    ? t(
                        status.last.committed
                          ? "syncPushed"
                          : status.last.remoteAdvanced === true
                            ? "syncPushedOnly"
                            : "syncUpToDate",
                      )
                    : (cause ?? t("syncFailed"))}
                </bdi>
              </div>
            )}
            {error !== null && (
              <div className="s-syncpop__err">
                <span className="s-syncpop__errlabel">{t("syncGitSaid")}</span>
                {/* git's words, verbatim, in their own LTR isolate — and
                    selectable, which is the whole point of not being a
                    tooltip. */}
                <code className="s-syncpop__errtext" dir="ltr">
                  {error}
                </code>
                <button type="button" className="s-btn s-syncpop__copy" onClick={copyError}>
                  {t(copied ? "syncCopied" : "syncCopyError")}
                </button>
              </div>
            )}
            <div className="s-syncpop__btns">
              <button
                type="button"
                className={`s-btn${failed ? " s-btn--accent" : ""}`}
                onClick={() => {
                  setOpen(false);
                  useStore.getState().setSettingsOpen(true);
                }}
              >
                {t("syncOpenSettings")}
              </button>
              <button
                type="button"
                className={`s-btn${failed ? "" : " s-btn--accent"}`}
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  void runSyncNow();
                }}
              >
                {busy ? t("syncing") : t("syncNow")}
              </button>
            </div>
          </div>
        )}
      </span>
      <span className="s-statusbar__dot" aria-hidden="true">
        ·
      </span>
    </>
  );
}
