# Search & Tags

Two ways to find a note when you don't remember where you put it. #guide #search

## Full-text search

The search box in the sidebar (and the [[Command Palette]]) searches titles and
bodies of every note, with prefix and fuzzy matching — `grap` finds
[[Graph View]], `wikilnk` still finds [[Wikilinks & Backlinks]]. Results show a
snippet with the match highlighted, best hits first.

The index lives in memory and rebuilds itself the instant a file changes — even
if the change came from another editor entirely, because the files are plain
markdown on disk (see [[Hosting Your Own Vault]]).

## Tags

A tag is just a word with a `#` in front, written anywhere in a note:

- inline, like the #guide and #search tags scattered through these files
- or in frontmatter, which keeps the prose clean:

```yaml
---
tags: [guide, search]
---
```

Both count. The sidebar shows every tag in the vault as a gold pill with its
note count — click one to see its notes. Tags are cheap, so use them for
*status* and *kind* (#draft, #reference, #someday) and let
[[Wikilinks & Backlinks|links]] carry the actual structure.

## A tiny workflow

- [ ] Tag fleeting notes #inbox as you capture them in the [[Editing|editor]]
- [ ] Once a week, search `#inbox` and file, link, or delete each one
- [ ] Watch the [[Graph View]] get denser and the inbox stay empty
