// Daily note: open (or create) daily/YYYY-MM-DD.md for today.
// Shared by the App shell shortcut (Ctrl/Cmd+D) and the command palette.

import { createNote } from "./api.ts";
import { collectNotes } from "./editor/links.ts";
import { useStore } from "./state.ts";
import { toast } from "./toast.ts";

/** Today's daily note path, in local time. */
export function dailyNotePath(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `daily/${y}-${m}-${d}.md`;
}

/** Open today's daily note, creating it first if it doesn't exist yet. */
export async function openDailyNote(): Promise<void> {
  const store = useStore.getState();
  const path = dailyNotePath();
  const exists = collectNotes(store.tree).some((n) => n.path === path);
  if (!exists && !store.admin) {
    toast("No daily note for today — sign in to create it");
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
        toast("Could not create today's daily note");
        return;
      }
    }
  }
  store.openNote(path);
}
