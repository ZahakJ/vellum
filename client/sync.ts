// Backup & sync, client side: one shared copy of the repo status, so the
// status-bar glyph, the settings panel and the palette command all read and
// write the same thing rather than each polling on its own.
//
// A plain module with subscribers (like i18n.ts) rather than store state: the
// status is admin-only chrome that most sessions never ask for, and it must
// keep updating while a modal is open.

import type { GitSyncStatus } from "../shared/types.ts";
import { getSyncStatus, snapshotNow, syncInit, syncNow } from "./api.ts";
import { siteDate } from "./dates.ts";
import { t, tf } from "./i18n.ts";
import { toast } from "./toast.ts";
import { actionToast } from "./undoToast.ts";

/** The status bar's backup panel is a component's own `open` state — there is
 *  no store flag for it, and adding one would put a piece of transient chrome
 *  into the app's model for the sake of one toast. A window event is the same
 *  idiom the tree's "reveal this note" already uses (Sidebar.tsx). SyncBadge
 *  listens while it is mounted; nothing happens on an instance that never
 *  configured backup, which is exactly right. */
export const SYNC_PANEL_EVENT = "vellum:sync-panel";

export function openSyncPanel(): void {
  window.dispatchEvent(new CustomEvent(SYNC_PANEL_EVENT));
}

/** When a sync ran, in the instance's date locale. `hour: "numeric"`, not
 *  "2-digit": a 12-hour clock with a leading zero ("02:11 PM") is a format no
 *  locale asks for. Shared by the badge's panel and the settings block so the
 *  two never drift. */
export function syncWhen(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // Through client/dates.ts, so a backup that ran on ٢ صفر is reported on
  // ٢ صفر — the panel that answers "is my writing somewhere else yet" must
  // not be the one surface still printing a different calendar.
  return siteDate(date, locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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
  if (last && !last.ok) toast(last.message, "error");
  else if (last) {
    // A COMMIT IS AN EVENT, AND AN EVENT HAS A NAME (v1.8 UX audit F40).
    // "Vault committed and pushed" is true of every successful pass this
    // product has ever run — it reads the same after a chapter and after a
    // stray space — so the line carries the short sha when there is one, and
    // the toast carries the door to the panel that holds the rest of the
    // diagnosis: branch, remote, ahead/behind, git's own words.
    //
    // The two passes that commit NOTHING keep their plain sentence: there is
    // no sha to print, and "open the backup panel" about a no-op is chrome.
    if (last.committed && last.sha) {
      actionToast(tf("syncPushedSha", { sha: last.sha }), t("syncOpenPanel"), openSyncPanel);
      emit();
      return;
    }
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

/** A NOTE'S HISTORY GAINED A REVISION. The history panel listens: a reader who
 *  takes a snapshot from the palette with the timeline open must see the row
 *  it just made, and polling git for that would be a process per second.
 *  Window event rather than store state for the reason at the top of this
 *  file — none of this belongs in the app's model. */
export const HISTORY_CHANGED_EVENT = "vellum:history-changed";

export function historyChanged(): void {
  window.dispatchEvent(new CustomEvent(HISTORY_CHANGED_EVENT));
}

/** Snapshot now: ONE LOCAL COMMIT, no network at all.
 *
 *  This is the move the whole v1.8 slate rests on. The bulk editors (vault-wide
 *  search & replace, tag rename) are what a note-taker most wants and least
 *  trusts, and the reason is that a bad vault-wide edit is unrecoverable —
 *  so each of them offers a snapshot before it runs, and the palette offers it
 *  standalone for the reader who is about to try something on their own.
 *
 *  It shares `pending` with the sync calls above because the server shares its
 *  `busy` lock with them: two writers in `.git/index` is exactly the fight
 *  that lock exists to prevent, and a button that can only report 409 is
 *  better disabled. It does NOT touch `status`: nothing was pushed, so nothing
 *  the badge says about the remote has changed. */
export async function runSnapshotNow(): Promise<void> {
  if (pending) return;
  pending = true;
  emit();
  try {
    const made = await snapshotNow();
    // "Nothing changed" is a real and common answer — a reader who snapshots
    // twice in a row has not failed at anything — so it is a plain sentence,
    // not an error. A commit gets its short sha for the same reason the sync
    // toast does (F40): an event needs a name a reader can find again.
    if (made.committed && made.sha) toast(tf("snapshotMade", { sha: made.sha }));
    else toast(t("snapshotNothing"));
    if (made.committed) historyChanged();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    console.error("vellum: snapshot failed", err);
    toast(tf("snapshotFailed", { message }), "error");
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
