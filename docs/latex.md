# LaTeX notes

*`.tex` and `.latex` files are notes, not imports — edited, published, searched and linked exactly as markdown is.*

← [Back to the README](../README.md) · [All docs](README.md)

---

A `.tex` file is a **note**, not an import. It is in the tree, in search, in
the graph, in the backlinks panel, in the tag counts, in the post list and in
the RSS feed, and it publishes to the blog exactly as a `.md` note does — same
typography, same themes, same visitor scoping, both languages. And it still
compiles: everything Vellum adds is a LaTeX comment or a macro you can ship
beside the file.

- **Live-preview editor** — the CodeMirror `stex` mode themed to whichever of
  the fifteen rooms you are in, with the same bargain the markdown editor
  makes: the caret's line shows raw TeX, every other line reads as the thing it
  becomes. Sectioning is set in serif, `\emph`/`\textbf`/`\texttt` render,
  `\item` becomes a bullet or its number, `$…$` and display environments are
  set by KaTeX, `\cite` is a chip, and `\begin{figure}` shows **your vault's
  actual image** with its caption. (Section and equation *numbers* are the
  reading view's — they are a property of the whole document, and a number that
  renumbered itself as you typed above it would be a distraction rather than a
  preview; the outline panel beside the editor prints them.) Fold any
  environment or section from the chevron beside it. Autocomplete covers
  `\note{`, `\ref{`, `\cite{` and `\begin{` (which writes the matching `\end`)
- **The formatting keys write LaTeX here** — `Ctrl/Cmd B` in a `.tex` note is
  `\textbf{…}`, not `**…**`; `Ctrl/Cmd I` is `\emph{…}`, inline code is
  `\texttt{…}`, "Heading 2" is `\subsection{…}`, a bulleted list is an
  `itemize` environment and a wikilink is `\note{…}`. Strikethrough, highlight,
  the task list and the colour swatches are **absent** from the menu in a
  `.tex` note rather than approximated: LaTeX cannot spell them without a
  package your document may not load, and a key that quietly writes something
  neither Vellum nor `pdflatex` can render is worse than a key that does
  nothing
- **Reading & publishing** — rendered in the same visual language as markdown:
  numbered sections, numbered equations, "Figure 1" captions, theorem boxes,
  resolved cross-references, a `\bibitem` bibliography, footnotes. The outline
  panel follows the `\section` hierarchy
- **Frontmatter that pdflatex ignores** — a leading comment block:
  ```latex
  %---
  % publish: true
  % tags: [physics, fourier]
  % banner: "Media/heat.png"
  %---%
  ```
  or, if you would rather write a macro, `\vellum{publish=true, citekey=fourier1822}`
- **Links, three ways** — `\note{Fourier Transform}` and
  `\note[the transform]{Fourier Transform}` are Vellum's own macro (ship
  [`vellum.sty`](#vellumsty) beside the file and it compiles anywhere);
  `%% [[Private Scratch]] %%` is a link the PDF never shows; and an existing
  project lights up **unmodified**, because `\input`, `\include`, `\cite`,
  `\ref` and `\eqref` already say what they mean — Vellum simply extends their
  search path to the vault, local definitions first, so importing a project can
  never change how it compiles
- **One anchor space** — a markdown heading and a LaTeX `\label` are the same
  kind of thing, so `[[Heat Equation#eq:fourier]]` and `\note{Notes\#Derivation}`
  are one lookup in either direction, and `![[Heat Equation#eq:fourier]]`
  transcludes **just that equation**, rendered by KaTeX, into a markdown note

A `.tex` note takes the site's [text direction](arabic-and-rtl.md#note-direction--alignment) — an
Arabic paper is written right to left — and refuses the alignment measure: its source is markup
end to end.

## `vellum.sty`

The dozen lines that make `\note{…}` compile outside Vellum. Download it from your own instance at
`/api/vellum.sty` (or "LaTeX: download vellum.sty" in the command palette), drop it beside your
document, and `\usepackage{vellum}`. Without it the file still opens in Vellum; with it,
`pdflatex` renders the very same file.

## What renders, and what does not

An honest boundary beats a leaky claim of "full LaTeX". Anything not listed
below is **passed through as a quiet inline marker** — never as raw source,
never as a crash — and an unparseable document still opens, lists, publishes
and searches by its title.

| | |
| --- | --- |
| **Structure** | `\part` `\chapter` `\section` `\subsection` `\subsubsection` `\paragraph` `\subparagraph` (starred forms unnumbered), `\appendix`, `\maketitle` with `\title`/`\author`/`\date`, `abstract`, `\tableofcontents`, `\label` anywhere |
| **Text** | `\emph` `\textit` `\textbf` `\texttt` `\textsc` `\textsf` `\underline`, `\footnote`, `\\` breaks, `~`, `--`/`---`, ` ``…'' ` quotes, accents (`\'e` `\"o` `\c{c}` …), `\LaTeX` and the common symbol macros, `\url` and `\href` |
| **Lists** | `itemize`, `enumerate` (numbered), `description` |
| **Maths** | `$…$`, `\(…\)`, `\[…\]`, `$$…$$`, `equation` `align` `gather` `multline` `alignat` `flalign` `eqnarray` `displaymath` and their starred forms, `aligned` `gathered` `split` `cases` `array` and the matrix family — all through KaTeX, with **Vellum's own equation numbering** (KaTeX restarts its counter per block, which would print "(1)" for every equation in a paper) and `\nonumber`/`\notag` honoured |
| **Floats** | `figure` with `\includegraphics` (extension optional, resolved against your vault) and `\caption`; `table` with `tabular`/`tabularx`/`longtable`, `\multicolumn`, alignment from the column spec |
| **Blocks** | `quote` `quotation` `verse`, `center`, `verbatim` `lstlisting` `minted` (highlighted), `thebibliography` with `\bibitem` |
| **Theorems** | `theorem` `lemma` `proposition` `corollary` `definition` `remark` `example` `proof` and friends, numbered, with the optional `[title]` |
| **Macros** | `\newcommand`/`\renewcommand` with up to nine arguments and an optional default — expanded in text, and handed to KaTeX for maths |
| **Ignored** | preamble furniture (`\documentclass`, `\usepackage`, `\setlength`, `\hypersetup`, spacing commands, `\index`, `\nocite`) — consumed silently, never printed |

Known simplifications, stated rather than discovered: numbering is
article-style (`1`, `1.1`, `1.1.1`) whatever the document class; `\ref` prints a
number for a local label and the target's *title* across a note boundary,
because a bare "1" means nothing in someone else's paper; and BibTeX is not
run — `\cite` resolves against a `\bibitem` in the document or a note carrying
that `citekey:`, and is otherwise left alone.
