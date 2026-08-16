---
title: Hosting Your Own Vault
tags: [guide, hosting, self-hosted]
---

# Hosting Your Own Vault

These seven starter notes were copied into `./vault` on first launch so the app
had something to show. The real point of Vellum is to sit on top of
*your* notes. #guide #hosting

## Point it at your notes

Any folder of `.md` files is a valid vault — including an existing Obsidian
vault, which will keep working in Obsidian at the same time:

```sh
VELLUM_VAULT=~/notes npm start
# or
npm start -- --vault ~/notes
```

Vellum never converts, moves, or wraps your files. It reads markdown, it
writes markdown, and a `chokidar` watcher keeps the index fresh — edit a note
in vim in another terminal and the change appears here within a heartbeat.
[[Search & Tags|Search]], [[Wikilinks & Backlinks|backlinks]], and the
[[Graph View]] are all rebuilt from the files themselves.

## Running it somewhere permanent

Vellum is a single Node process (Node ≥ 24) listening on port `6801`
(`PORT` overrides). A systemd unit is all it takes on a home server:

```ini
[Service]
Environment=VELLUM_VAULT=/srv/notes
ExecStart=/usr/bin/npm start --prefix /opt/vellum
Restart=on-failure
```

Put a reverse proxy with auth in front if the machine is reachable from the
internet — Vellum itself trusts everyone who can reach the port, on the
assumption that your notes live on your network.

## Back up like it's just files — because it is

- [ ] turn on **Site settings → Backup & sync**: it commits the vault and pushes
      it to a private git remote you own, by hand or on a timer (it only ever
      fast-forwards, so it can never merge conflict markers into a note)
- [ ] or point your existing sync (Syncthing, rsync, a backup tool) at the folder
- [ ] test a restore once — future-you sends thanks

That's the whole tour. Head back to [[Welcome]], or better: press
`Ctrl/Cmd N` (see [[Command Palette]]) and write the first note that's
actually yours.
