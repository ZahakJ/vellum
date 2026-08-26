# Vellum documentation

*The long-form manual. The [project README](../README.md) is the one-minute version.*

---

## Getting it running

| | |
| --- | --- |
| [Configuration](configuration.md) | Every `.env` key, the runtime Settings panel, [where attachments land](configuration.md#attachments), every settings key, and which wins |
| [Publishing & access](publishing.md) | Public reading vs admin editing, the `publish:` flag, preview as visitor, HTTPS, comments |
| [Backup & sync](backup-and-sync.md) | Committing the vault to a private git remote, by hand or on a timer, and [reading a note's history](backup-and-sync.md#note-history-reading-what-the-backup-kept) out of it |
| [Development](development.md) | Dev mode, the gate scripts, the screenshot harnesses, contributing a change |

## Writing

| | |
| --- | --- |
| [The editor & reading view](editor.md) | Live preview, wikilinks, selection, rendering, navigation |
| [Templates, banners & notes](templates-and-notes.md) | `banner:`, Obsidian-compatible templates, sections, attachments, trash |
| [LaTeX notes](latex.md) | `.tex` as a first-class note, `vellum.sty`, and exactly what renders |
| [Trackers](trackers.md) | The `tracker` fence, the board, and what a visitor sees of your shelf |
| [Printing & PDF](printing.md) | A note on paper: the print palette, page breaks, PDF bookmarks and working internal links |
| [Keymap](keymap.md) | Every binding, and why the awkward ones are where they are |

## Publishing

| | |
| --- | --- |
| [Blog mode](blog-mode.md) | The stock blog: masthead, topic nav, dashboard home, RSS, sitemap, SEO |
| [Designed mode](designer.md) | Composing your own homepage from sections; presets, nav, static pages |

## Look & language

| | |
| --- | --- |
| [Theming](theming.md) | The fifteen themes, the custom-theme builder, the CSS token API, `custom.css` |
| [Typography](typography.md) | The self-hosted font catalog, your own uploads, per-character Arabic |
| [Arabic & RTL](arabic-and-rtl.md) | The mirrored interface, the visitor switch, the language filter, Hijri dates, tag labels |

## Also in the repo

- [`DESIGN.md`](../DESIGN.md) — the rules a change is judged against
- [`CONTRACTS.md`](../CONTRACTS.md) — the invariants the code has committed to
- [`OBSIDIAN-COMPAT.md`](../OBSIDIAN-COMPAT.md) — what carries over from an Obsidian vault, in detail
- [`.env.example`](../.env.example) — the annotated environment file
