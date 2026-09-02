# Keymap

*Every keyboard binding, and why the awkward ones are where they are.*

← [Back to the README](../README.md) · [All docs](README.md)

---

`Ctrl/Cmd /` opens the in-app shortcut sheet — every binding, grouped and searchable, in whichever
language the instance is in. Inside it, `↑` `↓` walk the rows that can run (`Home` / `End` jump),
`Enter` runs the lit one and `Esc` closes; typing keeps filtering, and the cursor starts on the best
match, so "graph" then `Enter` is the whole gesture. This page is the same list on paper.

Literally the same list: the tables between here and *Menus, gestures and the pointer* are a
RENDERING of the `GROUPS` table in `client/components/ShortcutsHelp.tsx`, and `npm run check-keymap`
fails the build when they stop agreeing — in either direction. A binding exists in one place, and a
key documented here that nothing binds is as much a bug as a key nobody documented. The same gate
is what refuses two rows claiming one keystroke; see [Development](development.md).

<!-- keymap:begin -->

## Shell

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd /` | Keyboard shortcuts — every binding, grouped and searchable |
| `Ctrl/Cmd P` | Command palette (open note, run command) |
| `Ctrl/Cmd K` | Search — focuses the sidebar search in the app; opens a centered search overlay on the public blog |
| `Ctrl/Cmd E` | Toggle reading view ⇄ editor |
| `Ctrl/Cmd G` | Toggle graph view |
| `Ctrl/Cmd N` | New note |
| `Ctrl/Cmd Alt D` | Open today's daily note (`daily/YYYY-MM-DD.md`) |
| `Ctrl/Cmd Shift P` | Publish / unpublish the open note |
| `Ctrl/Cmd Alt P` | [Print the open note, or export it to PDF](printing.md) — Alt because `Ctrl/Cmd P` is the palette |
| `Ctrl/Cmd Alt B` | Collapse / reopen the **Notes sidebar** |
| `Ctrl/Cmd Alt Shift B` | Collapse / reopen **Outline & backlinks** |
| `Ctrl/Cmd Shift Z` | Zen mode — all chrome steps aside (`Esc` returns) |
| `Ctrl/Cmd \` | Split the pane — the new one opens on the same note |
| `Ctrl/Cmd Shift \` | Split downwards instead of beside |
| `Ctrl/Cmd Alt \` | Close the pane — its tabs are adopted by a neighbour, never dropped |
| `Ctrl/Cmd Alt PageDown` / `PageUp` | Next / previous tab in the focused pane |
| `Ctrl/Cmd Alt W` | Close this tab |
| `Ctrl/Cmd Alt Shift ↑` / `↓` | Move to the pane above / below |
| `Ctrl/Cmd Alt Shift ←` / `→` | Move to the pane on your left / right — physically, in both languages |
| `←` / `→` | Previous / next file in the attachment viewer |
| `Esc` | Out of the shortcut sheet, out of visitor preview, out of zen, out of the attachment viewer, and back to the note from `Ctrl/Cmd K` |

On the public blog shell only `Ctrl/Cmd K` and `Ctrl/Cmd /` are claimed; every other combination
is handed straight back to the browser.

## Writing

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd B` | **Bold** |
| `Ctrl/Cmd I` | *Italic* |
| `Ctrl/Cmd U` | Underline (`<u>`) |
| `Ctrl/Cmd Shift X` | Strikethrough |
| `Ctrl/Cmd Shift H` | Highlight |
| `Ctrl/Cmd Alt /` | Comment out the selection — `%%…%%` in a note, `%` in a `.tex` file |
| `Ctrl/Cmd D` | Select the next occurrence of the word under the cursor |
| `Ctrl/Cmd S` | Save now (autosave runs regardless, 600 ms after you stop) |
| `Ctrl/Cmd ↑` / `↓` | Move the current line up / down |
| `Ctrl/Cmd Z` / `Ctrl/Cmd Shift Z` | Undo / redo (inside the editor; see the note on zen below) |
| `Ctrl/Cmd F` | Find within the note |

## Tables

All five live ONLY while the caret sits inside a table block — outside one, `Tab` still indents,
`Enter` still breaks the line, and `Alt` with an arrow still belongs to the browser.

| Keys | Action |
| ---- | ------ |
| `Tab` | Next table cell (in the last cell: adds a row) |
| `Shift Tab` | Previous table cell |
| `Enter` | Down a row in the table (out of the table from the last row) |
| `Alt ↑` / `↓` | Move table row |
| `Alt ←` / `→` | Move table column, alignment row included (visual arrows — flipped in an RTL table) |

## Templates

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd Alt T` | Insert template… at the cursor |
| `Ctrl/Cmd Alt Shift T` | New note from template… |

`Ctrl/Cmd Alt` rather than the obvious `Ctrl/Cmd T`: that one is the browser's new tab, and
`Ctrl/Cmd Shift T` reopens a closed one. Neither is takeable.

## Sections & folding

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd Shift [` / `]` | Fold / unfold the section at the cursor — or the chevron beside the heading |
| `Ctrl/Cmd Alt [` / `]` | Fold / unfold everything |
| `Ctrl/Cmd Alt F` | Focus one section — everything else collapses; `Esc` restores it exactly |
| `Ctrl/Cmd Alt ↑` / `↓` | Jump to the previous / next heading (scrolls, in reading view) |

**On macOS both fold rows are spelled differently, and the table above does not say so yet.** Both
bindings come from CodeMirror's own `foldKeymap`, which overrides the section fold for Mac
(`Ctrl-Shift-[` becomes `Cmd-Alt-[`) and leaves fold-all on `Ctrl-Alt-[` for every platform. So on a
Mac the section fold is `Cmd Alt [` / `]` — not `Cmd Shift [`, which binds nothing — and fold-all
keeps its `Ctrl`. The shortcut sheet prints `Ctrl/Cmd` for both; the keymap gate compares the sheet
against this page and cannot see past either of them into CodeMirror, so this paragraph is the
correction until the two rows are given their real Mac spellings.

**`Ctrl/Cmd G` is the graph everywhere, including inside the editor, and that is a decision.**
CodeMirror's `searchKeymap` binds `Mod-g` to "find again", and the shell claims the key first in the
capture phase — so that binding has never fired here. It stays that way: find-again already has two
other ways to run (`F3`, and `Enter` in the find field), while the graph toggle is a documented
Vellum binding a reader would be surprised to lose halfway through a note. This is the opposite call
to the one made for `Ctrl/Cmd D` and `Ctrl/Cmd B`, where the editor's meaning is the per-minute one
and the shell's was the once-a-day one — the rule is which verb the key is worth more to, not who
asked first. Written down because a keymap gate that compares this page to the shortcut sheet cannot
see CodeMirror's own keymaps, so the next reader to notice `Mod-g` would otherwise "fix" it.

<!-- keymap:end -->

## Menus, gestures and the pointer

Below the line the ledger stops. These are SURFACES rather than bindings — Vellum claims no
keystroke of its own for them, so the shortcut sheet names the surface where its other rows name a
key, and the keymap gate leaves them alone.

| How | Action |
| --- | ------ |
| Click | Follow a rendered wikilink (create it if unresolved) |
| `Ctrl/Cmd`-click | Follow a wikilink on the line you're editing |
| Click | Open an image or PDF from the tree, in the attachment viewer |
| Right-click, `Shift F10`, or the menu key | Formatting menu for the selection — text style, structure, insert, colour |
| Right-click a misspelled word (nothing selected) | Spelling suggestions and "Add to dictionary" — with a selection, right-click means formatting instead |
| Right-click a heading, or the ⋯ beside it | Section menu — the whole subtree, not the line |
| Drag a row in **Outline** | Reorder a section, and everything under it |
| `/` at line start | Slash menu (callout, code fence, table, …) |
| `Tab` | Indent (CodeMirror's `indentWithTab`) |
| `↑` `↓` `Enter` `Esc` | Navigate / confirm / dismiss the palette (`Enter` always runs the keyboard's row, never whatever the mouse happens to rest on) |
| Selection menu | Extract the selection into a new linked note — `[[link]]` left standing, and the toast's Undo restores **both** files |
| Selection menu → Insert | Footnote — `[^n]` numbered so existing footnotes stay ordered, definition stub at the note's end; `\footnote{…}` in a `.tex` note |
| Selection menu → Structure | Title Case / UPPERCASE / lowercase over the selection, per cursor — wikilink targets and code spans untouched |
| Selection menu → Callout | Wrap the selection in a `> [!type]` callout — every line prefixed, blank lines kept inside the callout |

Every modal, popover and picker in the product answers the same four keys — `Esc` to leave, arrows
to move, `Enter` to commit, type-ahead where there is a list — and `Esc` always belongs to the
innermost layer that is open.

## The tour

A deck of illustrated cards, one feature each, with a **Show me** that really opens the thing it
describes. It claims no keystroke of its own — it is only ever entered, never shown — so its doors
are the palette (*Take the tour*), the quiet line on an empty vault, the foot of this sheet's own
`Ctrl/Cmd /` panel, and a line in `Welcome.md`.

| Keys | Action |
| ---- | ------ |
| `←` / `→`, or `h` / `l` | Flip a card. **Logical**: in Arabic, `←` goes forward |
| Swipe | The same flip, on a touch screen — mirrored the same way |
| `Esc` | Leave. The card you were on is where you come back |

## The designer

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd S` | Save the design draft |
| `Space` | Lift / drop a section row |
| `↑` / `↓` | Move a lifted row (`Alt ↑` / `↓` moves any row) |
| `Esc` | Cancel a lift, close the section picker, close the designer |

## Why these keys

The five formatting keys are Obsidian's, checked against its shortcut tables rather than guessed —
except underline, which Obsidian has no command for at all (markdown has no underline; Vellum's
emits `<u>`, which the sanitizer already admitted and the reading view already rendered). All five
**toggle**: press twice and the markers come off. With nothing selected they insert the pair and
park the caret between them, so bold-then-type works. Across a multi-line selection they apply
**per line** — markdown emphasis cannot cross a blank line, and one `**` at the top of three
paragraphs is two stray asterisks, not bold text. In a [`.tex` note](latex.md) the same five keys
write LaTeX instead, and the two markdown has no spelling for are absent from the menu rather than
approximated.

**`Ctrl/Cmd B` used to fold the notes sidebar.** Formatting won it: it is the binding every reader
arrives with, and a key that bolds a word in one half of the window and folds a pane in the other
is a key nobody can describe. The two pane toggles kept their shape — one key, `Shift` picks the
second pane — and moved one modifier out, so the only thing to re-learn is "add `Alt`". Outside the
editor `Ctrl/Cmd B` and `Ctrl/Cmd Shift B` are still swallowed, because Firefox's bookmarks sidebar
and Chrome's bookmark bar must never open over the app. macOS Option+B (`∫`) and Option+T (`†`)
work, and every binding declines when `AltGr` is held so a European layout's Right-Alt never folds
a pane by accident — see [Non-Latin keyboards](#non-latin-keyboards) for how that is decided.

**The tab keys wear `Alt` for the same reason the templates do.** The world has three chords for
tabs — `Ctrl Tab`, `Ctrl PageUp`/`PageDown` and `Ctrl W` — and the browser owns all three. Two of
them can be worn one modifier over, which is the escape hatch this page keeps taking; the third
cannot, because `Alt Tab` belongs to the window manager. So `Ctrl/Cmd Alt PageDown`/`PageUp` walks
the strip and `Ctrl/Cmd Alt W` closes the tab, and the muscle memory transfers with one extra
finger. Not arrows: `Ctrl Alt ←`/`→` is GNOME's workspace switcher and macOS Chrome's own tab
switcher, and neither hands it back. Next is **next along the strip** in both languages — the bar
mirrors with the reading direction, and a tab bar is a list, not a map.

Nothing in the interface calls either pane "the left one": the toggles, the palette and the
shortcut sheet say **Notes sidebar** and **Outline & backlinks**, in both languages, because
[in Arabic they swap ends](arabic-and-rtl.md).

In vim mode, `Ctrl D` and `Ctrl B` inside the editor keep their half-page scroll and page-up, and
`Esc` stays vim's mode key — use `Cmd`, the palette, or zen's ✕ instead. On macOS, `Cmd Shift Z`
inside the editor stays redo; `Ctrl Shift Z` enters zen there.

## Non-Latin keyboards

**Every binding on this page works with an Arabic, Persian, Russian, Greek or Hebrew system
keyboard.** That deserves saying out loud, because for a while it did not: the shortcuts were
matched against the letter the keyboard *typed*, and on an Arabic layout the key marked `P` types
`ح`, so `Ctrl P` opened nothing at all. If you run Vellum in Arabic — and the interface is fully
[translated and mirrored](arabic-and-rtl.md) for exactly that — your shortcuts are the keys marked
with the Latin letters on your keycaps.

The rule, in one line: **a shortcut follows the letter your layout types when that letter is
Latin, and the key's position when it is not.**

- On a US, UK or German keyboard nothing changes.
- On **AZERTY** and **Dvorak** the letters have moved, and the shortcut moved with them —
  `Ctrl Shift Z` for zen is the key that types `z` (physical `W` on AZERTY), not the key sitting
  where a US keyboard has Z. That key types `w`, and `Ctrl Shift W` closes your window.
- On **Arabic, Persian, Russian, Greek or Hebrew** there is no Latin letter to follow, so the
  position answers: the key marked `P` opens the palette whatever it types.
- **`AltGr` is always typing, never a command.** On layouts where Right-Alt reports as Ctrl+Alt,
  `AltGr E` stays `ę` and does not toggle the reading view.
- The `Ctrl/Cmd /` sheet knows this. On a keyboard that types none of these letters it prints the
  character each key produces beside the letter — `P` `ح` — with a line saying why. On Chromium;
  elsewhere it prints the letters alone rather than guessing.

Vim mode is the exception, and it is not one this can fix: in normal mode `hjkl` are keys your
Arabic or Russian layout does not have, so vim is a Latin-layout feature.
