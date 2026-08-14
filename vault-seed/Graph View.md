---
title: Graph View
tags: [guide, graph]
---

# Graph View

Press `Ctrl/Cmd G` and the vault becomes a constellation: every note a node,
every [[Wikilinks & Backlinks|wikilink]] an edge, laid out by a small physics
simulation running at 60 fps. #guide #graph

Right now the graph shows these seven starter notes — [[Welcome]] sits at the
center because everything links from it. As your vault grows, clusters emerge
on their own: projects pull their notes together, reference notes become hubs,
and orphans drift to the edge asking to be linked.

## Reading the sky

| Gesture | Effect |
| ------- | ------ |
| Hover a node | Highlights it and its neighbors |
| Click a node | Opens that note in the editor |
| Drag a node | Pulls it around; the simulation reacts |
| Resize the window | The graph reflows to fit |

Node size follows link count, so well-connected notes literally loom larger.

## Why bother?

The graph is not decoration. It shows you:

- **Hubs** — notes doing the heavy lifting of your thinking
- **Orphans** — notes nothing points to, candidates for linking or deleting
- **Clusters** — topics that have quietly become their own project

When the graph looks wrong, the vault usually *is* wrong — a missing link, a
duplicate note. Fix it in the [[Editing|editor]], or find the stragglers with
[[Search & Tags]].
