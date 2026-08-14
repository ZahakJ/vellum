---
title: Editing
tags: [guide, editor]
---

# Editing

Vellum's editor is a **live preview**: markdown syntax stays out of sight
until your cursor lands on a line, then the raw text reappears for editing.
Move the cursor here and the `#` and `**` marks on this very note will show
themselves. #guide #editor

## What renders live

- **Bold**, *italic*, ~~strikethrough~~, and `inline code`
- Headings, sized and set in serif
- Blockquotes with a gold bar:
  > Ink is the blood of thought.
- Bullet lists (the `-` becomes a proper •)
- Checkboxes you can click to toggle:
  - [x] wrote a note
  - [ ] linked it to another — see [[Wikilinks & Backlinks]]
- [[Wikilinks & Backlinks|Wikilinks]] in gold, #tags as pills, and bare URLs like https://example.com

## Code

Fenced code keeps its fences and gets monospace treatment:

```js
// autosave: nothing to remember
const AUTOSAVE_DEBOUNCE_MS = 600;
```

## Saving

You don't. Notes autosave ~600 ms after you stop typing, and `Ctrl/Cmd S`
forces a save if you're the belt-and-suspenders type. The dot on the tab shows
unsaved changes; it never lingers long.

## Vim mode

Toggle **vim** in the status bar (or via the [[Command Palette]]) for modal
editing. The setting persists across restarts.

Next: [[Wikilinks & Backlinks]], where notes start talking to each other.
