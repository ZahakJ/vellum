// Daily note: open (or create) daily/YYYY-MM-DD.md for today.
// Shared by the App shell shortcut (Ctrl/Cmd+D) and the command palette.

import { createNote } from "./api.ts";
import { getDateCalendar, siteDate } from "./dates.ts";
import { collectNotes } from "./editor/links.ts";
import { t } from "./i18n.ts";
import { useStore } from "./state.ts";
import { toast } from "./toast.ts";

/** Today's daily note path, in local time. */
export function dailyNotePath(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `daily/${y}-${m}-${d}.md`;
}

/** A daily note's path → the date it names, or null when the path is not one.
 *  The FILENAME is always ISO and stays ISO: it sorts, it is what every other
 *  vault tool expects, and `[[2026-08-16]]` has to keep resolving. */
export function dailyNoteDate(path: string): Date | null {
  const m = /(?:^|\/)(\d{4})-(\d{2})-(\d{2})\.(?:md|tex|latex)$/i.exec(path);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Local noon, not UTC midnight: the filename was built from LOCAL date
  // parts (dailyNotePath above), so reading it back as UTC would shift the
  // day for every reader east or west of Greenwich — which for a Hijri
  // rendering is a different month name, not a rounding error.
  const date = new Date(y, mo - 1, d, 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** What a daily note is CALLED on screen when the instance prints another
 *  calendar — "٢ صفر ١٤٤٨ هـ" for `daily/2026-08-16.md`. Null in gregorian
 *  mode, deliberately: there the ISO filename already IS the date the reader
 *  asked for, and re-spelling it as "16 August 2026" would change a label
 *  nobody complained about. Null for anything that is not a daily note. */
export function dailyNoteLabel(path: string): string | null {
  if (getDateCalendar() === "gregorian") return null;
  const date = dailyNoteDate(path);
  if (!date) return null;
  return siteDate(date, useStore.getState().blogLocale, { dateStyle: "long" });
}

/** Open today's daily note, creating it first if it doesn't exist yet. */
export async function openDailyNote(): Promise<void> {
  const store = useStore.getState();
  const path = dailyNotePath();
  const exists = collectNotes(store.tree).some((n) => n.path === path);
  if (!exists && !store.admin) {
    toast(t("noDailyNote"));
    return;
  }
  if (!exists) {
    try {
      await createNote(path);
      await store.loadTree();
      // Fresh daily note: land in the editor, not an empty reading pane.
      if (store.readingMode) store.setReadingMode(false);
    } catch (err) {
      // 409 = it exists after all (stale tree) — fall through and open it.
      const message = err instanceof Error ? err.message : "";
      if (!/exists/i.test(message)) {
        console.error(`vellum: creating daily note ${path} failed`, err);
        toast(t("dailyNoteFailed"));
        return;
      }
    }
  }
  store.openNote(path);
}
