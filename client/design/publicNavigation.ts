import type { NavDesign, NavItem } from "../../shared/designChrome.ts";
import type { PublicFolderCard } from "../../shared/types.ts";
import { folderUrl } from "../blog/nav.ts";

/** Preserve authored navigation and its topic fallback while carrying the
 * instance's opted-in collection links into every designed shell. */
export function publicNavigation(
  nav: NavDesign,
  topics: string[],
  folders: PublicFolderCard[],
  enabled: boolean,
): NavItem[] {
  const filled = enabled ? folders.filter((folder) => folder.count > 0) : [];
  if (filled.length === 0) return nav.items;
  const items: NavItem[] = nav.items.length > 0 ? [...nav.items] : nav.fallback === "topics"
    ? topics.map((tag, index) => ({ id: `public-topic-${index}`, kind: "topic", target: tag, label: tag }))
    : [];
  const targets = new Set<string>();
  const visit = (rows: NavItem[]): void => {
    for (const row of rows) {
      if (row.kind === "url" && !row.hidden && row.target) targets.add(row.target);
      if (!row.hidden && row.children) visit(row.children);
    }
  };
  visit(items);
  for (const folder of filled) {
    const target = folderUrl(folder.slug);
    if (!targets.has(target)) items.push({ id: `public-folder-${folder.id}`, kind: "url", target, label: folder.title });
  }
  return items;
}
