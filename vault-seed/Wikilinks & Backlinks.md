# Wikilinks & Backlinks

Links are what turn a folder of files into a vault. #guide #linking

## Making a link

Type `[[` and Vellum offers every note title in the vault — pick one and
you get a link like [[Graph View]]. Links match by **file name**, not path, so
[[Hosting Your Own Vault]] resolves even though it lives in the `guides/`
folder. Case doesn't matter either: [[welcome]] finds `Welcome.md`.

Two useful variants:

- `[[Editing|the editor guide]]` → a link with display text: [[Editing|the editor guide]]
- `[[Search & Tags#Tags]]` → jumps toward a heading: [[Search & Tags#Tags]]

Ctrl/Cmd-click a link to follow it (or plain click when the syntax is hidden).

## Backlinks

The panel on the right answers the reverse question: *who links here?* Open it
now — [[Welcome]] and [[Editing]] both point at this note, so they appear
there with the sentence that mentioned it. Backlinks need no effort on your
part; every link you write is automatically an edge in both directions.

That two-way structure is also what [[Graph View]] draws.

## Renaming without fear

Rename a note (via the [[Command Palette]]) and Vellum rewrites every
`[[wikilink]]` that pointed at the old name. Your web of notes doesn't tear
when a title improves.

- [ ] Try it: create a note, link it from here, rename it, watch this line update
