# Keymap

*Every keyboard binding, and why the awkward ones are where they are.*

← [Back to the README](../README.md) · [All docs](README.md)

---

`Ctrl/Cmd /` opens the in-app shortcut sheet — every binding, grouped and searchable, in whichever
language the instance is in. This page is the same list on paper.

## Shell

| Keys | Action |
| ---- | ------ |
| `Ctrl/Cmd /` | Keyboard shortcuts — every binding, grouped and searchable |
| `Ctrl/Cmd P` | Command palette (open note, run command) |
| `Ctrl/Cmd K` | Search — focuses the sidebar search in the app; opens a centered search overlay on the public blog |
| `Ctrl/Cmd E` | Toggle reading view ⇄ editor |
| `Ctrl/Cmd G` | Toggle graph view |
| `Ctrl/Cmd N` | New note |
| `Ctrl/Cmd D` | Open today's daily note (`daily/YYYY-MM-DD.md`) |
| `Ctrl/Cmd Shift P` | Publish / unpublish the open note |
| `Ctrl/Cmd Alt B` | Collapse / reopen the **Notes sidebar** |
| `Ctrl/Cmd Alt Shift B` | Collapse / reopen **Outline & backlinks** |
| `Ctrl/Cmd Shift Z` | Zen mode — all chrome steps aside (`Esc` returns) |
| `Esc` | Out of the shortcut sheet, out of visitor preview, out of zen, and back to the note from `Ctrl/Cmd K` |

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
| `Ctrl/Cmd S` | Save now (autosave runs regardless, 600 ms after you stop) |
| `Ctrl/Cmd ↑` / `↓` | Move the current line up / down |
| `Ctrl/Cmd Z` / `Ctrl/Cmd Shift Z` | Undo / redo (inside the editor; see the note on zen below) |
| `Ctrl/Cmd F` | Find within the note |
| `Right-click` / `Shift F10` / the menu key | Formatting menu for the selection — text style, structure, insert, colour |
| `/` at line start | Slash menu (callout, code fence, table, …) |
| `Tab` | Indent |

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
| `Ctrl Shift [` / `]` *(macOS: `Cmd Alt [` / `]`)* | Fold / unfold the section at the cursor |
| `Ctrl/Cmd Alt [` / `]` | Fold / unfold everything |
| `Ctrl/Cmd Alt F` | Focus one section — everything else collapses; `Esc` restores it exactly |
| `Ctrl/Cmd Alt ↑` / `↓` | Jump to the previous / next heading (scrolls, in reading view) |

## Navigation & pointer

| Keys | Action |
| ---- | ------ |
| Click | Follow a rendered wikilink (create it if unresolved) |
| `Ctrl/Cmd`-click | Follow a wikilink on the line you're editing |
| `↑` `↓` `Enter` `Esc` | Navigate / confirm / dismiss the palette (`Enter` always runs the keyboard's row, never whatever the mouse happens to rest on) |
| `←` `→` `Esc` | Previous / next file in the attachment viewer, and out of it |

Every modal, popover and picker in the product answers the same four keys — `Esc` to leave, arrows
to move, `Enter` to commit, type-ahead where there is a list — and `Esc` always belongs to the
innermost layer that is open.

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
