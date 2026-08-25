---
title: Trackers
tags: [vellum, trackers]
---

# Trackers

A note can hold a **living progress card**. Books, games, films, courses,
projects, habits — anything you are part-way through. Type ` ```tracker `
(or pick *Tracker* from the `/` menu) and fill in the fields you care about:

```tracker
title: The Name of the Rose
kind: book
progress: 214/536
status: reading
started: 2026-07-02
rating: 9/10
notes: |
  The library is the argument. Everything else is scaffolding.
```

Everything is optional except a title or a progress. Unknown keys are ignored,
and a fence that says nothing readable stays a plain code block rather than
becoming an empty card — the same promise `$$ math $$` makes. #trackers

## Nudging it

While you are editing, the card carries a quiet **−** and **+** at its edge.
Each press is one unit and one undo step: it edits the `progress:` line in this
file and nothing else. There is no hidden database — move the number by hand
and the card agrees with you.

```tracker
title: Outer Wilds
kind: game
progress: 18/22
unit: hours
status: playing
```

At 100% the bar takes on a soft glow and the wordmark's ✦ appears beside the
count. That is the entire reward system.

## The shelf

A ` ```tracker-board ` fence draws every tracker in the vault, grouped by
status — the whole shelf, in one block:

```tracker-board
```

It takes filters: `kind: game`, `status: active`, `limit: 12`. And it is
audience-aware, which is the useful part: on a **published** note a visitor
sees only the trackers that live in published notes, so you can put your
reading year on the public site without opening the rest of the vault.

Covers work too — `cover: rose.jpg` names an attachment exactly the way an
embed does, and a missing one falls back to the kind's own glyph rather than a
broken picture.
