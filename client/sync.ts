// Backup & sync, client side: one shared copy of the repo status, so the
// status-bar glyph, the settings panel and the palette command all read and
// write the same thing rather than each polling on its own.
//
// A plain module with subscribers (like i18n.ts) rather than store state: the
// status is admin-only chrome that most sessions never ask for, and it must
// keep updating while a modal is open.

import type { GitSyncStatus } from "../shared/types.ts";
import { getSyncStatus, syncInit, syncNow } from "./api.ts";
import { localeDigits, t } from "./i18n.ts";
import { toast } from "./toast.ts";

/** When a sync ran, in the instance's date locale. `hour: "numeric"`, not
 *  "2-digit": a 12-hour clock with a leading zero ("02:11 PM") is a format no
 *  locale asks for. Shared by the badge's panel and the settings block so the
 *  two never drift. */
export function syncWhen(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...localeDigits(locale),
  });
}

/** The cause of a failure that the CLIENT already knows, in our own words.
 *  git's line ("could not read Username … terminal prompts disabled") is an
 *  implementation detail of the same event: the red, alarming sentence should
 *  be the one a reader can act on, and git's stays underneath it as the
 *  quotable evidence. `authMode` comes from the form in the settings panel
 *  (which may hold an unsaved edit) and from the status everywhere else. */
export function syncCause(authMode: string, status: GitSyncStatus | null): string | null {
  if (status === null) return null;
  if (!status.configured) return t("syncNoRemoteSet");
  if (authMode === "token" && !status.tokenSet) return t("syncTokenMissing");
  return null;
}

let status: GitSyncStatus | null = null;
/** A request started by THIS client is in flight (the server's own `busy`
 *  covers a sync started elsewhere — e.g. the timer, or another tab). */
let pending = false;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const cb of listeners) cb();
}

export function onSyncChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function syncSnapshot(): GitSyncStatus | null {
  return status;
}

/** True while a sync this client asked for has not answered yet. */
export function syncPending(): boolean {
  return pending;
}

/** True when a sync is running anywhere (this client, another tab, the timer). */
export function syncBusy(): boolean {
  return pending || status?.busy === true;
}

/** Refresh the cached status. Quiet on failure: the status glyph is ambient
 *  chrome, and a 401 after a session expires must not spray toasts. */
export async function refreshSyncStatus(): Promise<GitSyncStatus | null> {
  try {
    status = await getSyncStatus();
  } catch {
    status = null;
  }
  emit();
  return status;
}

function report(next: GitSyncStatus): void {
  status = next;
  const last = next.last;
  if (last && !last.ok) toast(last.message);
  else if (last) {
    toast(
      last.committed
        ? t("syncPushed")
        : last.remoteAdvanced === true
          ? t("syncPushedOnly")
          : t("syncUpToDate"),
    );
  }
  emit();
}

function fail(err: unknown): void {
  // The message IS the git line the server produced (token-scrubbed there) —
  // "Updates were rejected", "Permission denied (publickey)", "Remote history
  // has diverged". Nothing generic replaces it: it is the whole diagnosis.
  const message = err instanceof Error ? err.message : t("syncFailed");
  console.error("vellum: git sync failed", message);
  toast(message);
}

/** Sync now. Concurrent clicks are absorbed here; a sync already running on
 *  the server answers 409 and that message is what the reader sees. */
export async function runSyncNow(): Promise<void> {
  if (pending) return;
  pending = true;
  emit();
  try {
    report(await syncNow());
  } catch (err) {
    fail(err);
    await refreshSyncStatus();
  } finally {
    pending = false;
    emit();
  }
}

/** Make the vault a git repository and point origin at the configured remote. */
export async function runSyncInit(): Promise<void> {
  if (pending) return;
  pending = true;
  emit();
  try {
    status = await syncInit();
    toast(t("syncInitDone"));
  } catch (err) {
    fail(err);
  } finally {
    pending = false;
    emit();
  }
}
