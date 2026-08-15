// Styled in-family replacement for window.confirm on destructive actions.
// Promise API: `const ok = await confirmModal({ title, body })` — resolves
// true on Confirm/Enter, false on Cancel/Esc/backdrop. A single <ConfirmHost>
// (mounted once in App) renders the dialog: raised panel, serif title,
// danger button gold-outline → red fill on hover, focus-trapped.
//
// One escalation above that: `grave` marks the dialog whose action cannot be
// undone. It wears red at rest rather than the brand gold, and it does not
// pre-focus its danger button — two dialogs that look identical and both
// answer Enter are not two speeds, they are one accident.

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
  /** A third, deliberately quiet route out of the dialog — the harsher
   *  variant of the same action ("Delete permanently" beside "Move to
   *  .trash"). Rendered as plain text at the dialog's inline start, so it
   *  never competes with the two real buttons; picking it resolves "extra". */
  extraLabel?: string;
  /** The step past recoverable: an irreversible act (erasing a subtree from
   *  disk). It changes two things, and both are safety rather than styling —
   *  the danger button is filled red AT REST instead of wearing the brand
   *  gold, so it cannot be mistaken for the recoverable dialog it is stacked
   *  on top of; and it is NOT pre-focused, so Enter is not armed to confirm.
   *  See CONTRACTS.md, "Folder deletion". */
  grave?: boolean;
}

/** Which way the dialog was left. "extra" only ever comes from `extraLabel`. */
export type ConfirmResult = "confirm" | "cancel" | "extra";

interface Pending {
  opts: ConfirmOptions;
  resolve: (result: ConfirmResult) => void;
}

// Module-level bridge: callers never need the host's React context. Requests
// made before the host mounts queue up and drain on mount.
let hostPush: ((p: Pending) => void) | null = null;
const preMountQueue: Pending[] = [];

/** Ask the user to confirm a destructive action, and find out HOW they left:
 *  "confirm" only on an explicit confirm (click or Enter), "extra" on the
 *  optional quiet third route, "cancel" for everything else. */
export function confirmModalEx(opts: ConfirmOptions): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    const pending = { opts, resolve };
    if (hostPush) hostPush(pending);
    else preMountQueue.push(pending);
  });
}

/** Ask the user to confirm a destructive action. Resolves true only on an
 *  explicit Confirm (click or Enter); everything else resolves false. */
export function confirmModal(opts: ConfirmOptions): Promise<boolean> {
  return confirmModalEx(opts).then((result) => result === "confirm");
}

export default function ConfirmHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const queueRef = useRef<Pending[]>([]);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const extraRef = useRef<HTMLButtonElement>(null);
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

  const settle = useCallback((result: ConfirmResult) => {
    setCurrent((cur) => {
      cur?.resolve(result);
      return queueRef.current.shift() ?? null;
    });
  }, []);

  // Focus management: remember the opener, focus the danger button (Enter
  // confirms), give focus back on close. A `grave` dialog starts on Cancel
  // instead — an irreversible erase must never be one stray keypress away,
  // and the dialog that arms Enter is the recoverable one.
  useEffect(() => {
    if (current) {
      restoreRef.current = document.activeElement;
      if (current.opts.grave) cancelRef.current?.focus();
      else confirmRef.current?.focus();
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
        settle("cancel");
      } else if (e.key === "Enter") {
        // A grave dialog answers Enter only from the danger button itself:
        // "anywhere else" would make the backdrop, the body text and a
        // just-dismissed toast all fire an irreversible erase.
        if (current.opts.grave && document.activeElement !== confirmRef.current) return;
        // Let a focused Cancel (or the quiet extra) keep its own meaning;
        // anywhere else, Enter is the explicit confirm the dialog advertises.
        if (document.activeElement === cancelRef.current) return;
        if (document.activeElement === extraRef.current) {
          e.preventDefault();
          e.stopPropagation();
          settle("extra");
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        settle("confirm");
      } else if (e.key === "Tab") {
        e.preventDefault();
        // Cycle: danger → cancel → (extra) → danger. Shift walks it backwards.
        const ring = [confirmRef.current, cancelRef.current, extraRef.current].filter(
          (el): el is HTMLButtonElement => el !== null,
        );
        const at = ring.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.shiftKey ? -1 : 1;
        const next = ring[(Math.max(0, at) + step + ring.length) % ring.length];
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
    <div className="s-confirm-overlay" onMouseDown={() => settle("cancel")}>
      <div
        className={`s-confirm${opts.grave ? " s-confirm--grave" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={opts.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="s-confirm__title">{opts.title}</h2>
        {opts.body && <p className="s-confirm__body">{opts.body}</p>}
        <div className="s-confirm__actions">
          {opts.extraLabel && (
            <button
              ref={extraRef}
              type="button"
              className="s-confirm__extra"
              onClick={() => settle("extra")}
            >
              {opts.extraLabel}
            </button>
          )}
          <button
            ref={cancelRef}
            type="button"
            className="s-confirm__cancel"
            onClick={() => settle("cancel")}
          >
            {opts.cancelLabel ?? t("cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`s-confirm__danger${opts.grave ? " s-confirm__danger--grave" : ""}`}
            onClick={() => settle("confirm")}
          >
            {opts.confirmLabel ?? t("delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
