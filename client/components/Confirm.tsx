// Styled in-family replacement for window.confirm on destructive actions.
// Promise API: `const ok = await confirmModal({ title, body })` — resolves
// true on Confirm/Enter, false on Cancel/Esc/backdrop. A single <ConfirmHost>
// (mounted once in App) renders the dialog: raised panel, serif title,
// danger button gold-outline → red fill on hover, focus-trapped.

import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n.ts";

export interface ConfirmOptions {
  /** Serif dialog title ("Delete note?"). */
  title: string;
  /** Optional detail line under the title. */
  body?: string;
  /** Danger button label (default: the localized "Delete"). */
  confirmLabel?: string;
  /** Quiet button label (default: the localized "Cancel"). */
  cancelLabel?: string;
}

interface Pending {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

// Module-level bridge: callers never need the host's React context. Requests
// made before the host mounts queue up and drain on mount.
let hostPush: ((p: Pending) => void) | null = null;
const preMountQueue: Pending[] = [];

/** Ask the user to confirm a destructive action. Resolves true only on an
 *  explicit Confirm (click or Enter); everything else resolves false. */
export function confirmModal(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const pending = { opts, resolve };
    if (hostPush) hostPush(pending);
    else preMountQueue.push(pending);
  });
}

export default function ConfirmHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const queueRef = useRef<Pending[]>([]);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    hostPush = (p: Pending) => {
      setCurrent((cur) => {
        if (cur) {
          queueRef.current.push(p);
          return cur;
        }
        return p;
      });
    };
    for (const p of preMountQueue.splice(0)) hostPush(p);
    return () => {
      hostPush = null;
    };
  }, []);

  const settle = useCallback((ok: boolean) => {
    setCurrent((cur) => {
      cur?.resolve(ok);
      return queueRef.current.shift() ?? null;
    });
  }, []);

  // Focus management: remember the opener, focus the danger button (Enter
  // confirms), give focus back on close.
  useEffect(() => {
    if (current) {
      restoreRef.current = document.activeElement;
      confirmRef.current?.focus();
    } else if (restoreRef.current instanceof HTMLElement) {
      restoreRef.current.focus();
      restoreRef.current = null;
    }
  }, [current]);

  // Esc cancels, Enter confirms, Tab is trapped between the two buttons.
  useEffect(() => {
    if (!current) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        settle(false);
      } else if (e.key === "Enter") {
        // Let a focused Cancel button keep its meaning; anywhere else, Enter
        // is the explicit confirm the dialog advertises.
        if (document.activeElement === cancelRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        settle(true);
      } else if (e.key === "Tab") {
        e.preventDefault();
        const next =
          document.activeElement === confirmRef.current
            ? cancelRef.current
            : confirmRef.current;
        next?.focus();
      }
    };
    // Capture phase: the dialog outranks every other global shortcut.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current, settle]);

  if (!current) return null;
  const { opts } = current;

  return (
    <div className="s-confirm-overlay" onMouseDown={() => settle(false)}>
      <div
        className="s-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={opts.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="s-confirm__title">{opts.title}</h2>
        {opts.body && <p className="s-confirm__body">{opts.body}</p>}
        <div className="s-confirm__actions">
          <button
            ref={cancelRef}
            type="button"
            className="s-confirm__cancel"
            onClick={() => settle(false)}
          >
            {opts.cancelLabel ?? t("cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="s-confirm__danger"
            onClick={() => settle(true)}
          >
            {opts.confirmLabel ?? t("delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
