// Styled in-family replacement for window.confirm AND window.prompt.
// Promise API: `const ok = await confirmModal({ title, body })` — resolves
// true on Confirm/Enter, false on Cancel/Esc/backdrop. A single <ConfirmHost>
// (mounted once in App) renders the dialog: raised panel, serif title,
// danger button gold-outline → red fill on hover, focus-trapped.
//
// One escalation above that: `grave` marks the dialog whose action cannot be
// undone. It wears red at rest rather than the brand gold, and it does not
// pre-focus its danger button — two dialogs that look identical and both
// answer Enter are not two speeds, they are one accident.
//
// `promptModal` is the same host wearing a field. It exists because the four
// creation flows (Ctrl/Cmd+N, the sidebar's New note, the tree's "New note
// here", New folder) were the last window.* boxes in the product, and an OS
// dialog cannot take the theme, the type scale or RTL mirroring — its
// OK/Cancel were the only untranslated chrome on an Arabic instance. It was
// also a functional risk: once a browser's "prevent this page from creating
// additional dialogs" box is ticked, prompt() returns null forever and there
// is NO working new-note path left, silently.
//
// The prompt's own idea: `check` is the caller's whole naming rule, and the
// dialog SHOWS it. Every keystroke is run through it, the resulting vault path
// is printed under the field, and the promise resolves with exactly that
// path — so "I typed Ideas and got ideas/Ideas.md" is something the reader
// watched happen rather than discovered afterwards in the tree.

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

/** What the caller's naming rule makes of the text currently in the field. */
export interface PromptCheck {
  /** The value the action will actually use — trimmed, slash-stripped, with
   *  the folder joined on and the `.md` appended. An empty string means "not
   *  submittable yet" and greys the confirm button without scolding anyone
   *  for a field they have not finished typing. */
  value: string;
  /** Printed under the field whenever it differs from what was typed, so the
   *  normalization is visible BEFORE the file exists. */
  note?: string;
  /** Blocks submission and paints the line as an error. */
  error?: string;
}

export interface PromptOptions {
  /** Serif dialog title ("New note"). */
  title: string;
  /** Optional detail line under the title (which folder it lands in). */
  body?: string;
  /** Prefilled text. Its stem is selected on open, so typing replaces the
   *  name and keeps the extension. */
  value?: string;
  placeholder?: string;
  /** Confirm button label (default: the localized "Create"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** The naming rule, run on every keystroke. Omitted, the raw trimmed text
   *  is the value and nothing is printed under the field. */
  check?: (raw: string) => PromptCheck;
}

interface PendingConfirm {
  kind: "confirm";
  opts: ConfirmOptions;
  resolve: (result: ConfirmResult) => void;
}

interface PendingPrompt {
  kind: "prompt";
  opts: PromptOptions;
  resolve: (value: string | null) => void;
}

type Pending = PendingConfirm | PendingPrompt;

// Module-level bridge: callers never need the host's React context. Requests
// made before the host mounts queue up and drain on mount.
let hostPush: ((p: Pending) => void) | null = null;
const preMountQueue: Pending[] = [];

function enqueue(pending: Pending): void {
  if (hostPush) hostPush(pending);
  else preMountQueue.push(pending);
}

/** Ask the user to confirm a destructive action, and find out HOW they left:
 *  "confirm" only on an explicit confirm (click or Enter), "extra" on the
 *  optional quiet third route, "cancel" for everything else. */
export function confirmModalEx(opts: ConfirmOptions): Promise<ConfirmResult> {
  return new Promise((resolve) => enqueue({ kind: "confirm", opts, resolve }));
}

/** Ask the user to confirm a destructive action. Resolves true only on an
 *  explicit Confirm (click or Enter); everything else resolves false. */
export function confirmModal(opts: ConfirmOptions): Promise<boolean> {
  return confirmModalEx(opts).then((result) => result === "confirm");
}

/** Ask for one line of text. Resolves with the CHECKED value (see
 *  `PromptCheck.value`) on an explicit Create/Enter, `null` on
 *  Cancel/Esc/backdrop — never with something the dialog did not print. */
export function promptModal(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => enqueue({ kind: "prompt", opts, resolve }));
}

/** The caller's rule, or the trivial one (trim) when it did not bring a rule. */
function runCheck(opts: PromptOptions, raw: string): PromptCheck {
  return opts.check ? opts.check(raw) : { value: raw.trim() };
}

export default function ConfirmHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  /** What is in the prompt's field right now (empty for a confirm dialog). */
  const [raw, setRaw] = useState("");
  const queueRef = useRef<Pending[]>([]);
  /** `current`, readable synchronously — the module-level bridge and the
   *  settle helpers must not depend on a render having happened. */
  const currentRef = useRef<Pending | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const extraRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<Element | null>(null);

  /** Put a dialog (or nothing) on screen. The field's text is seeded HERE,
   *  in the same commit that mounts the input, so the focus effect below can
   *  select its stem from a DOM node that already holds the value. */
  const show = useCallback((next: Pending | null) => {
    currentRef.current = next;
    setCurrent(next);
    setRaw(next?.kind === "prompt" ? next.opts.value ?? "" : "");
  }, []);

  useEffect(() => {
    hostPush = (p: Pending) => {
      if (currentRef.current) queueRef.current.push(p);
      else show(p);
    };
    for (const p of preMountQueue.splice(0)) hostPush(p);
    return () => {
      hostPush = null;
    };
  }, [show]);

  const settle = useCallback(
    (result: ConfirmResult) => {
      const cur = currentRef.current;
      if (!cur) return;
      // Every route out of a prompt that is not its Create button is a
      // cancellation — Esc, the backdrop and the Cancel button alike.
      if (cur.kind === "prompt") cur.resolve(null);
      else cur.resolve(result);
      show(queueRef.current.shift() ?? null);
    },
    [show],
  );

  /** The prompt's Create. Resolves with the CHECKED value — never with the
   *  raw text, and never at all while the check blocks it. */
  const submit = useCallback(() => {
    const cur = currentRef.current;
    if (cur?.kind !== "prompt") return;
    const checked = runCheck(cur.opts, raw);
    if (!checked.value || checked.error) return;
    cur.resolve(checked.value);
    show(queueRef.current.shift() ?? null);
  }, [raw, show]);

  // Focus management: remember the opener, focus the danger button (Enter
  // confirms), give focus back on close. A `grave` dialog starts on Cancel
  // instead — an irreversible erase must never be one stray keypress away,
  // and the dialog that arms Enter is the recoverable one. A prompt starts in
  // its field with the STEM selected ("Untitled" of "Untitled.md"), so the
  // first keystroke names the note and the extension survives untouched.
  useEffect(() => {
    if (current) {
      restoreRef.current = document.activeElement;
      if (current.kind === "prompt") {
        const el = inputRef.current;
        el?.focus();
        const value = el?.value ?? "";
        const dot = value.lastIndexOf(".");
        el?.setSelectionRange(0, dot > 0 ? dot : value.length);
      } else if (current.opts.grave) cancelRef.current?.focus();
      else confirmRef.current?.focus();
    } else if (restoreRef.current instanceof HTMLElement) {
      restoreRef.current.focus();
      restoreRef.current = null;
    }
  }, [current]);

  // Esc cancels, Enter confirms, Tab is trapped inside the dialog.
  useEffect(() => {
    if (!current) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        settle("cancel");
      } else if (e.key === "Enter") {
        // A focused Cancel keeps its own meaning in either dialog.
        if (document.activeElement === cancelRef.current) return;
        if (current.kind === "prompt") {
          e.preventDefault();
          e.stopPropagation();
          submit();
          return;
        }
        // A grave dialog answers Enter only from the danger button itself:
        // "anywhere else" would make the backdrop, the body text and a
        // just-dismissed toast all fire an irreversible erase.
        if (current.opts.grave && document.activeElement !== confirmRef.current) return;
        // Let the quiet extra keep its own meaning; anywhere else, Enter is
        // the explicit confirm the dialog advertises.
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
        // Cycle: danger → cancel → (extra) → danger, or field → cancel →
        // create → field. Shift walks it backwards.
        const ring: HTMLElement[] = (
          current.kind === "prompt"
            ? [inputRef.current, cancelRef.current, confirmRef.current]
            : [confirmRef.current, cancelRef.current, extraRef.current]
        ).filter((el): el is HTMLInputElement | HTMLButtonElement => el !== null);
        const at = ring.indexOf(document.activeElement as HTMLElement);
        const step = e.shiftKey ? -1 : 1;
        const next = ring[(Math.max(0, at) + step + ring.length) % ring.length];
        next?.focus();
      }
    };
    // Capture phase: the dialog outranks every other global shortcut.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current, settle, submit]);

  if (!current) return null;

  if (current.kind === "prompt") {
    const opts = current.opts;
    const checked = runCheck(opts, raw);
    return (
      <div className="s-confirm-overlay" onMouseDown={() => settle("cancel")}>
        <div
          className="s-confirm"
          role="dialog"
          aria-modal="true"
          aria-label={opts.title}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h2 className="s-confirm__title">{opts.title}</h2>
          {opts.body && <p className="s-confirm__body" dir="auto">{opts.body}</p>}
          {/* dir="auto" is the whole reason this dialog exists in-family: an
              Arabic note name typed into an OS prompt was laid out left to
              right beside RTL chrome. Here the field takes the direction of
              what is actually in it, character by character. */}
          <div className="s-confirm__field">
            <input
              ref={inputRef}
              className="s-bmodal__input"
              type="text"
              dir="auto"
              value={raw}
              placeholder={opts.placeholder}
              aria-label={opts.title}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {/* Always rendered (a non-breaking space when there is nothing to
              say) so the dialog never resizes under the pointer. */}
          <p
            className={`s-confirm__note${checked.error ? " s-confirm__note--bad" : ""}`}
            dir="auto"
            role={checked.error ? "alert" : undefined}
          >
            {checked.error ?? checked.note ?? " "}
          </p>
          <div className="s-confirm__actions">
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
              className="s-btn s-btn--accent"
              disabled={!checked.value || !!checked.error}
              onClick={submit}
            >
              {opts.confirmLabel ?? t("create")}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
