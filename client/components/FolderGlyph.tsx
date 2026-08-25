// ONE glyph from the closed folder set (shared/folderIcons.ts), drawn.
//
// Deliberately the smallest component in the tree: it imports the path table
// and nothing else. Both the sidebar (admin bundle) and the blog chunk render
// folder glyphs, and a component that dragged the store, the i18n dictionary
// or a stylesheet behind it would drag all three into the anonymous reader's
// download for the sake of twelve path strings.
//
// It is DECORATION. Every folder glyph in this app sits beside a name that is
// always present — the tree row's label, the folder card's title — so the svg
// is `aria-hidden` and carries no fact of its own (map-vault §5).

import { FOLDER_ICON_PATHS, isFolderIcon } from "../../shared/folderIcons.ts";

export default function FolderGlyph({ icon, size = 14 }: { icon: string; size?: number }) {
  // An unknown icon draws NOTHING, never a placeholder box — the rule
  // PanelGlyphs.tsx:92-100 set for the design rail. A settings.json edited by
  // hand, or a build older than the glyph it is being asked for, leaves the
  // row exactly as it was rather than putting a mystery mark on it.
  if (!isFolderIcon(icon)) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {FOLDER_ICON_PATHS[icon].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
