# Typography

*The self-hosted font catalog, the four slots, your own uploaded faces, and how Arabic and Latin share one paragraph.*

← [Back to the README](../README.md) · [All docs](README.md)

---

The catalog is the no-CSS version of the [`custom.css` escape hatch](theming.md#bring-your-own-fonts-the-css-route) — and its point is **Arabic**.
Open **Settings → Typography** and you get four pickers:

| Slot | Drives | Offers |
| --- | --- | --- |
| **Reading text** | `--font-serif` — reading column, editor prose, headings | Lora, EB Garamond, Crimson Pro, Literata, Source Serif 4, Merriweather, Inter, Source Sans 3, IBM Plex Sans, Work Sans |
| **Interface** | `--font-ui` — sidebar, tabs, panels, status bar | the same Latin list |
| **Code** | `--font-mono` — code blocks, raw markdown, inline code | JetBrains Mono, IBM Plex Mono, Fira Code, Source Code Pro |
| **Arabic face** | the Arabic letters in **all three** of the above | Amiri, Scheherazade New, Noto Naskh Arabic, Markazi Text, Lateef, Aref Ruqaa · Noto Kufi Arabic, Noto Sans Arabic, IBM Plex Sans Arabic, Cairo, Tajawal, Reem Kufi, Almarai |

Every slot also takes **system**, the default: the built-in stacks, nothing downloaded, nothing
served — and every slot also offers **your own uploads** (below). **Reset fonts** puts all four
back to `system`.

**The picker draws every option in the face it names.** A list of family names set in the
interface font is a list of trademarks: nobody chooses between Literata and Source Serif by
reading the words. So each row renders in its own typeface, Arabic faces carry an Arabic sample,
and the rows are grouped (serif / sans / monospace / naskh / modern & kufi / *your fonts*) with a
filter field over them. The faces are fetched a **group at a time**, as that group first appears,
so opening the Code picker never downloads the Arabic ones.

**The specimen stays on screen while you choose.** A live sample block — one mixed line per slot,
Latin and Arabic in the same run, so per-character selection is visible at a glance — is pinned to
the top of the tab and updates *before* you save, including the size dial below. Choosing type is
a compare-and-adjust loop; a preview the picker covers up previews nothing.

## Self-hosting is the whole design

When you save, the *server* fetches the chosen families once from Google Fonts (a `woff2` request,
so you get `woff2` back), parses the `@font-face` blocks, downloads each face into
`VELLUM_DATA/fonts/catalog/<id>/`, and records the parsed `unicode-range`s in a `meta.json` beside
them. From then on the browser only ever sees your server: `GET /api/site-fonts.css` is generated
from the cache and every `src:` in it points at `/api/fonts/catalog/…` on this instance.
**No visitor's browser contacts an external host, ever** — not for the fonts, not for the
stylesheet. Only two hosts are ever reachable from the fetch side (`fonts.googleapis.com`,
`fonts.gstatic.com`), enforced as a hard allowlist on the parsed URL with redirects refused,
timeouts and per-file/per-family size caps. A download that fails is a clean **502 with a message**
and `settings.json` is left exactly as it was — so an offline box keeps serving whatever it has
already cached, and a save that only re-picks cached families still works with no network at all.

## The Arabic slot is per character, not per language

The generated stylesheet does not define three families and hope; it defines three *composites* —
`VellumProse`, `VellumUI`, `VellumMono` — and lists the Arabic face's `@font-face` blocks **first**,
narrowed to the Arabic unicode blocks, with the Latin face's blocks after and those same ranges
carved out of them. The two sets are disjoint, so the browser's per-character font matching does
the rest: in

> A mixed line is where the trick shows: the word خط sits inside an English sentence.

the Latin runs render in Lora and the Arabic word in Amiri — in one paragraph, with no markup,
no `lang` attribute and no direction involved. That works on an **English** instance too, which
is the point: a vault with Arabic quotations in English notes has never had a good answer before.

## And at the right size

Picking the right face is only half of "sets correctly"; the other half is *how big it comes out*.
Two faces at one `font-size` are not two faces at one apparent size: Amiri's base letters stand at
about 0.35 em where Lora's x-height is 0.51 em, so an unadjusted Arabic run beside Lora reads
roughly a third smaller — a footnote dropped into a paragraph. Each Arabic catalog entry therefore
carries a measured **`size-adjust`** (Amiri 138%, Scheherazade New 136%, Lateef 150%, Noto Kufi
Arabic 90%, Cairo and Almarai none), emitted on that family's `@font-face` blocks in the composite.
Because it rides on the *face*, it applies per character, in every slot, on an English instance as
much as an Arabic one — which the whole-UI `--font-scale` multiplier under `:root[lang="ar"]` can
never do, since it scales both scripts equally and so never moves the ratio between them.
The composites finally fall back to `var(--font-*-system)`, so any codepoint neither face covers
still lands on the stack the instance would have used — including the Arabic-first reorder and
the Arabic type-metric compensation that `:root[lang="ar"]` applies.

## Your own fonts

A catalog of twenty-seven Google families cannot be the whole answer for typography, and for
Arabic it is not even close: the face a serious instance wants is usually one its owner licensed,
and it is on nobody's CDN. So **Settings → Typography → Your own fonts** takes an upload.

| | |
| --- | --- |
| **Formats** | `.woff2`, `.woff`, `.ttf`, `.otf` |
| **Size** | 5 MB per file |
| **Stored in** | `VELLUM_DATA/fonts/custom/` — outside the vault, and `VELLUM_DATA` is gitignored, so an uploaded face never lands in your notes repo or in a backup push |
| **Served from** | `GET /api/fonts/custom/<file>` on this instance — same terms as the catalog cache: self-hosted, no external host, immutable caching |
| **Offered in** | all four slots, under **Your fonts** |

The **format is decided by the file's magic bytes** (`wOF2`, `wOFF`, `0x00010000`, `true`,
`OTTO`) — never by the extension and never by the upload's content type, both of which are
attacker-controlled text. A PNG renamed `.woff2` is a `400`, which matters because the file is
about to be served back with a font MIME type. The header is then read for **structure**: a
plausible table count and a table directory that fits inside the file it came in. That check
costs nothing and turns a file that could never render — magic bytes followed by five million
zeroes — into a `400` at upload time instead of a face that silently never draws.

Anything the server *decompresses* out of an uploaded file is **bounded before it is read**. A
`name` table sits behind one brotli pass in WOFF2 and behind per-table zlib in WOFF1, and both
of those are decompression bombs unless the output is capped: an 800-byte file whose stream holds
900 MB of zeroes will otherwise allocate all 900 MB, synchronously, from a request. Each call is
now held to the length the file's own directory claims, itself clamped to a hard 32 MB ceiling.
A file that breaks the bound is not an error — it simply falls back to the filename-derived
family, which is what an unreadable font has always done.

The stored filename is a slug this server builds (lowercase ASCII, collision-suffixed), so nothing
you type reaches a path, a route parameter or a `url()`. When your filename leaves nothing — which
is what `خط-عربي.otf` does to an ASCII slug — the **font's own family name is used instead**, so
that file is stored as `amiri.otf` rather than as `font.otf`, `font-2.otf`, `font-3.otf`. The
**family name** itself comes from the font's `name` table where the file allows it, falling back
to the filename, so your picker says *Kitab* rather than *upload-3*.

Concurrent uploads are safe: filename allocation and the sidecar index are serialized, and the
index is written through a per-writer temporary file. (Four parallel uploads of four different
faces used to leave two files on disk, one of them labelled with another font's family, and three
`500`s — while the bytes were on disk all along.)

Uploaded faces are emitted into `/api/site-fonts.css` as ordinary self-hosted `@font-face`
blocks, and they take the **same per-slot `unicode-range` discipline** as the catalog: in the
Arabic slot a custom face is narrowed to the Arabic blocks, and a custom face in a Latin slot
standing beside an Arabic one has those blocks carved out of it. The two sets stay disjoint, so
per-character matching works with your own type exactly as it does with ours.

Uploads are admin-only (`POST /api/fonts/upload`; an admin previewing the public site is refused
like any other visitor), and **removing** a face is guarded twice: a font a slot still names shows
which slot instead of a delete button, and the server refuses the delete with a `409` regardless.

## Arabic size match

The catalog's Arabic entries carry a *measured* `size-adjust`; an uploaded face cannot. So when an
Arabic face is chosen the tab grows one more control — a percentage with its unit in the field —
which overrides the compensation for whatever is in the Arabic slot, catalog or upload. It is set
by eye against the specimen two rows above it, which is the only way this number is ever really
set. Stored as `settings.fonts.arabicSizeAdjust` (50–300, absent = the catalog's own value, or
none).

## Escape hatch, unchanged

For anything neither the catalog nor the uploader covers — a variable font you want to drive with
a custom axis, a script-specific stack, a face you would rather wire by hand — drop the file in
`VELLUM_DATA/fonts/` and name it from `custom.css` exactly as shown in
[Theming](theming.md#bring-your-own-fonts-the-css-route). That link is injected *after* the
generated stylesheet, so a `custom.css` rule on `:root` wins over the catalog, the uploads and the
defaults alike.
