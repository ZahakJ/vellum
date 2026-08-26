import { el, wordmark } from "./dom.ts";
import { t } from "./i18n.ts";
import { VellumNative, type PendingShare } from "./native.ts";
import { HttpError, normalizeServerUrl, readNote, writeNote } from "./server.ts";
import { lastServer } from "./store.ts";

/**
 * The capture sheet: what "Share to Vellum" opens.
 *
 * WHERE IT LANDS. One note per day, `Inbox/YYYY-MM-DD.md`, appended as a
 * timestamped bullet. A note per capture would turn a week of link-saving into
 * forty files nobody opens; a single ever-growing Inbox.md would turn it into a
 * file nobody can scroll. The dated note is the shape the vault already has a
 * word for, and it is the one an owner triages and empties.
 *
 * WHY THERE IS NO H1. Vellum titles a note from its filename. A `# 2026-08-25`
 * at the top would print the date twice on every page it appears on.
 *
 * WHY IT WRITES WITH A PRECONDITION. `PUT /api/note` accepts `baseMtimeMs`, and
 * the server refuses the write if the file moved underneath us. A capture is
 * the likeliest write in the whole app to race an open editor on a laptop, and
 * a refused capture the owner can retry beats a silent overwrite of a morning's
 * notes. The one arm that sends no precondition is the day's FIRST capture,
 * where there is no file yet to guard.
 */

const DIGITS = 2;

function pad(n: number): string {
  return String(n).padStart(DIGITS, "0");
}

/** The LOCAL day and minute, in Western digits — the instance-wide rule, and in
 *  any case a filename is not prose. `toISOString` would be the wrong day for
 *  anyone capturing after their local midnight. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function nowHm(): string {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function inboxPath(): string {
  return `Inbox/${today()}.md`;
}

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/**
 * A share → the markdown the owner is offered.
 *
 * A shared page arrives as a title (EXTRA_SUBJECT) plus its URL (EXTRA_TEXT).
 * Landing that as two lines of plain text throws away the one thing markdown is
 * for, so it becomes a link. Everything else arrives as itself.
 */
export function draftFrom(share: PendingShare): string {
  const text = (share.text ?? "").trim();
  const subject = (share.subject ?? "").trim();
  if (text && subject && isUrl(text)) return `[${subject}](${text})`;
  if (text && subject && subject !== text) return `${subject}\n${text}`;
  return text || subject;
}

/** One bullet, with its continuation lines indented so a multi-line capture
 *  stays inside the list item instead of ending it. */
export function bulletFor(body: string): string {
  const lines = body.trim().split("\n");
  const [first, ...rest] = lines;
  const tail = rest.map((line) => (line.trim() ? `  ${line}` : "")).join("\n");
  return `- ${nowHm()} — ${first}${tail ? `\n${tail}` : ""}\n`;
}

/** Append, with exactly one blank-free join: an existing note that ends mid-line
 *  gets its newline, one that already ends in a newline does not get a second. */
export function appended(existing: string, bullet: string): string {
  if (!existing) return bullet;
  return existing.endsWith("\n") ? existing + bullet : `${existing}\n${bullet}`;
}

export async function mountCapture(root: HTMLElement, share: PendingShare): Promise<void> {
  const saved = await lastServer();
  const parsed = saved ? normalizeServerUrl(saved) : null;

  const message = el("p", { class: "message", hidden: true });
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  const setMessage = (text: string, kind: "error" | "good" = "error"): void => {
    message.className = kind === "error" ? "message" : "message good";
    message.textContent = text;
    message.hidden = false;
  };

  const close = (): void => void VellumNative.closeShare();

  // No server yet, or a saved value this build can no longer parse: say so and
  // get out of the way. Silently discarding somebody's share is the one failure
  // this sheet must never have.
  if (!parsed || !parsed.ok) {
    root.replaceChildren(
      el(
        "div",
        { class: "sheet" },
        el("div", { class: "masthead" }, wordmark(t.wordmark)),
        el("p", { class: "message", textContent: t.captureNoServer }),
        el("div", { class: "spacer" }),
        el("button", { class: "btn-quiet", type: "button", textContent: t.captureCancel, onclick: close }),
      ),
    );
    return;
  }
  const { url: base, host } = parsed;

  const draft = draftFrom(share);
  const body = el("textarea", { id: "capture-body", value: draft, spellcheck: true });
  body.setAttribute("dir", "auto");

  const save = el("button", { class: "btn-primary", type: "submit", textContent: t.captureSave });
  const cancel = el("button", { class: "btn-quiet", type: "button", textContent: t.captureCancel, onclick: close });

  const form = el(
    "form",
    {},
    el("div", {}, el("label", { htmlFor: "capture-body", textContent: t.captureBody }), body),
    el("p", { class: "target-line", textContent: t.captureTargetIs(inboxPath()) }),
    message,
    el("div", { class: "capture-actions" }, save, cancel),
  );

  root.replaceChildren(
    el(
      "div",
      { class: "sheet" },
      el(
        "div",
        { class: "masthead" },
        wordmark(t.captureTitle),
        el("p", { class: "lede", textContent: t.captureLede(host) }),
      ),
      form,
    ),
  );

  if (!draft) setMessage(t.captureEmpty);
  else body.setSelectionRange(draft.length, draft.length);

  form.onsubmit = (event) => {
    event.preventDefault();
    void commit();
  };

  async function commit(): Promise<void> {
    const text = body.value.trim();
    if (!text) {
      setMessage(t.captureEmpty);
      body.focus();
      return;
    }

    save.disabled = true;
    save.textContent = t.captureSaving;
    message.hidden = true;

    const path = inboxPath();
    const bullet = bulletFor(text);
    try {
      await append(base, path, bullet);
    } catch (err) {
      // A refused write is retried ONCE, and only for the one status that means
      // "your copy is out of date": 409. An append is the rare write where that
      // is safe to do automatically — re-reading and re-appending loses nothing,
      // because the thing being added was never in the file either time. The
      // editor's own save cannot do this and should not; a capture can.
      if (err instanceof HttpError && err.status === 409) {
        try {
          await append(base, path, bullet);
        } catch (again) {
          return fail(again);
        }
      } else {
        return fail(err);
      }
    }

    save.textContent = t.captureSaved;
    setMessage(t.captureSaved, "good");
    // Long enough to read the word, short enough that nobody waits for it.
    setTimeout(close, 550);

    function fail(err: unknown): void {
      save.disabled = false;
      save.textContent = t.captureSave;
      const status = err instanceof HttpError ? err.status : 0;
      if (status === 401 || status === 403) setMessage(t.captureUnauthorized(host));
      else if (status === 0) setMessage(t.errUnreachable(host));
      else setMessage(t.captureFailed);
    }
  }
}

/** Read the day's note, add the bullet, put it back — with the read's mtime as
 *  the write precondition, so a concurrent edit is a 409 rather than a loss. */
async function append(base: string, path: string, bullet: string): Promise<void> {
  const existing = await readNote(base, path);
  await writeNote(base, path, appended(existing.content, bullet), existing.mtimeMs);
}
