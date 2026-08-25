# Trackers

*A fenced block that turns a note into a living progress card — and a board that shelves all of them.*

← [Back to the README](../README.md) · [All docs](README.md)

---

A tracker is a ` ```tracker ` fence. It renders as a card with cover art, a
progress bar, a status chip, a rating and your own notes — in the editor, in
reading view, on the published blog, and inside a transclusion, because all
four draw it with the same renderer.

```tracker
title: Elden Ring
kind: game
cover: elden-ring.jpg
progress: 62/130
unit: hours
status: playing
rating: 9/10
started: 2026-07-01
notes: |
  Margit took 14 tries.
```

## The fields

| Key | What it takes | Notes |
| --- | --- | --- |
| `title` | any text | Or just write the title on a line of its own. |
| `kind` | `book` `game` `film` `show` `course` `project` `habit`, or your own word | Picks the glyph and the default unit. `movie`, `series`, `tv`, `novel`, `anime`, `class`, `routine` fold into the seven; anything else keeps your word and gets the ✦ glyph. |
| `cover` | an attachment name, or `![[name.jpg]]` | Resolved exactly like an embed. Missing or broken → the kind's glyph, never a broken picture. |
| `progress` | `62/130`, `45%`, `45`, `62 of 130` | A fraction derives the percentage; a bare number *is* the percentage. Eastern Arabic digits are read too. |
| `unit` | any word | Yours, printed as you wrote it. Leave it out and the kind's own unit is used (pages, hours, minutes, episodes, lessons, tasks, days) — localized and correctly pluralised. |
| `status` | `planned` `active` `done` `paused` `dropped` | Plus the words people actually type: `reading`, `playing`, `watching`, `in-progress`, `started`, `finished`, `on hold`, `dnf`, `backlog`… Left out, it is derived from the progress. |
| `rating` | `8/10`, `4/5`, `★★★★`, `4` | A bare number is out of five up to five, out of ten above it. |
| `started`, `finished` | a date | An ISO date (`2026-07-01`) is formatted in the site's own calendar and numerals; anything else prints as written. |
| `notes` | a block scalar (the key, a colon, then a `\|`) | Markdown, rendered through the normal pipeline. |

Unknown keys are ignored, and a fence with **neither a title nor a progress**
stays a plain code block. That is deliberate: unparseable content must read as
its own source rather than vanish into an empty card, which is the rule
`$$ math $$` already follows.

A note may hold as many trackers as you like.

## Nudging the bar

In the editor, an admin session gets a quiet **−** and **+** at the card's
inline edge. One press is one unit — it rewrites the `progress:` line in your
file and nothing else, as a single undo step. There is no separate store: the
note *is* the state, so editing the number by hand does exactly what the button
does.

Cross into 100% and the fill takes on a soft glow and the wordmark's ✦ appears
beside the count.

Reading view and the public site are inert by design — there is no write path
for a visitor, and buttons that cannot work are furniture that lies.

## The board

A ` ```tracker-board ` fence draws every tracker in the vault as a grid of
mini-cards, grouped by status (active first, then planned, done, paused,
dropped). Each card links to the note its tracker lives in.

```tracker-board
kind: game
status: active
limit: 12
```

| Filter | Effect |
| --- | --- |
| `kind` | Only that kind. Folded like the card's own `kind:`, so `kind: movie` finds your films. |
| `status` | Only that status, synonyms included. |
| `limit` | At most that many cards. |

An empty body is a board of everything. A vault with no trackers gets an
inviting empty state rather than a blank.

## Publishing a shelf

The board is audience-aware. It reads `GET /api/trackers`, which is scoped
exactly like the blog's own post list:

- a **visitor** sees trackers from **published notes only**, with the language
  filter applied at their scope;
- an **admin** sees the whole vault;
- **templates are excluded from both** — a stencil carrying a tracker skeleton
  would otherwise shelve itself as a book nobody has started.

So a board left on a published note is safe: put your reading year on the
public site without opening the rest of the vault. Cover art on a published
tracker is served to visitors too — the indexer collects tracker covers into
the same allowlist that governs banners and embeds.

## In Obsidian

`tracker` is a Vellum extension, not an Obsidian feature. Open the same vault
in Obsidian and the fence degrades to what it is — a labelled code block whose
lines are all readable. Nothing is converted, nothing is lost, and the note
still says everything it said here. See
[OBSIDIAN-COMPAT.md](../OBSIDIAN-COMPAT.md).
