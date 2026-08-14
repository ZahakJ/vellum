---
title: Embeds & Transclusion
tags: [vellum, embeds]
---

# Embeds & Transclusion

Vellum understands Obsidian's `![[...]]` embed syntax. An embed pulls another
file *into* the note you are reading — a note, an image, or an attachment.
#embeds

## Transclude a note

Write `![[Welcome]]` and the whole note appears inline as a card — read-only,
one level deep, and cycle-safe. Click its title to jump to the real thing:

![[Welcome]]

## Embed an attachment

Non-image files render as a card that opens the file in a new tab. This one is
a real PDF that ships with the seed vault:

![[vellum-sample.pdf]]

## When an embed breaks

A target that does not exist gets a dashed placeholder instead of a card, so
broken links are easy to spot while you write:

![[this-file-does-not-exist.png]]

More connective tissue lives in [[Wikilinks & Backlinks]] — embeds are just
wikilinks with an appetite.
