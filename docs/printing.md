# Printing & PDF

*A note, on paper — and the same thing your reader gets from an article on your site.*

← [Back to the README](../README.md) · [All docs](README.md)

---

`Ctrl/Cmd Alt P` prints the open note, or exports it to PDF through your browser's own print
dialog. The command palette carries the same row — **Print / Export PDF…** — and on the desktop app
it is **File → Print / Export PDF…**.

It is `Alt P` and not the `Ctrl/Cmd P` every other application prints with, because in Vellum that
chord has been the command palette since the first release and `Ctrl/Cmd Shift P` publishes the
open note. Neither of those was worth moving. On the **public blog** nothing is swallowed at all:
a visitor's own `Ctrl/Cmd P` is the browser's, and it produces the same pages.

## What comes out

| | |
| --- | --- |
| **The document, whole** | Not the screen. The app prints a freshly rendered copy of the note, so what lands on the page is the whole note — including the part you had scrolled past, and the body of a callout you had folded shut. |
| **Paper colours** | A light, parchment-cast palette, whatever theme you read in. Your theme is a property of the screen; the page is white because paper is. |
| **A real serif page** | 11pt serif on A4 or Letter with 20/25mm margins. The page box is the measure — there is no second column drawn inside it. |
| **Sensible breaks** | A heading never ends a page on its own, callouts, tables, figures, tracker cards and equations do not split, paragraphs keep three lines on either side of a break, and a table that runs over repeats its header row. |
| **Footnotes at the end**, under a hairline, as they are on screen. |
| **Links that make sense on paper** | An external link prints its address beside it. A `[[wikilink]]` prints as the words you wrote — it points into a vault the person holding the sheet does not have. |
| **A right-to-left page for a right-to-left note** | Margins, list markers, quotation bars and table column order all mirror, from an English instance as readily as from an Arabic one. |

## What a PDF gets that most exports do not

- **Bookmarks.** Your headings become the PDF's outline, because the reading view renders real
  `h1`–`h6` elements and every one of them carries an id.
- **Working internal links.** A footnote reference, its return arrow, and a `[[#Heading]]` pointer
  inside the same note are real fragment links, which Chrome turns into PDF link annotations. Click
  a footnote number in the exported PDF and it goes to the footnote.
- **Selectable text and real maths.** KaTeX renders to glyphs, not pictures.

For a PDF, choose *Save as PDF* (or *Print to file*) as the destination in the print dialog. If you
want the callout tints, the highlight marks and the banner in the file, leave **Background
graphics** on — Vellum only asks the printer for ink where the colour is carrying meaning.

## What is left off

The frontmatter properties card. It is the note's filing card, not its content — `id`, `publish`
and the `dg-*` keys say nothing to somebody holding paper — and the published blog has always
hidden it for the same reason. A `banner:` picture is the note's own and stays, clamped to 55mm so
it does not eat a third of the first sheet. A blog article's *generated* gradient banner — the
placeholder for a picture the author never chose — is dropped.

## Printing a published article

Nothing to configure. Open the piece on your site and print it: the masthead, the topic nav, the
share row, previous/next, related writings, the comment thread and the back-to-top button all step
aside, and the title, byline, hero and body print exactly as the reader sees them. That page needs
no JavaScript from us to do it, which is the point — the person printing your writing is usually
not you.

## If nothing seems to print

Printing from the graph view or the empty state prints one line saying so, because there is no
document on screen to print. Open a note first.

---

*Under the hood: `client/reading/print.css` is the whole `@media print` answer, and
`client/print.ts` decides which document is on the paper. `npm run check-print`
([Development](development.md)) is the gate that keeps both honest — a print stylesheet is the one
surface no screenshot ever shows.*
