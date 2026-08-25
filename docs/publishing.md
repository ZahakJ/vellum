# Publishing & access

*Public reading vs admin editing, the `publish:` flag, previewing as a visitor, putting it on the internet, and reader comments.*

← [Back to the README](../README.md) · [All docs](README.md)

---

## Public reading, admin editing

Out of the box Vellum runs in **open local mode** — no password, every visitor is an admin (a
warning is printed at startup). To put a vault on a network you don't fully trust, set an admin
password:

```sh
cp .env.example .env
npm run hash-password        # prompts for a password, prints an argon2id hash
```

Put the printed hash in `.env` (single-quoted — it contains `$`), plus a cookie-signing secret:

```sh
ADMIN_PASSWORD_HASH='$argon2id$v=19$m=65536,...'
SESSION_SECRET=some-long-random-string   # e.g. openssl rand -hex 32
```

With a hash set, visitors get the **reading view**: fully rendered notes, search, graph, backlinks
— but no editor and no create/rename/delete anywhere. A quiet "Sign in" link in the status bar
opens the login modal; a correct password sets a signed, httpOnly session cookie and unlocks
editing on the spot, no reload. Set `PUBLIC=false` to require login even for reading, and
`HOME_NOTE` to pick the note fresh visitors land on.

**`PUBLIC=false` requires a password, and says so by refusing to start.** Without
`ADMIN_PASSWORD_HASH` there is no session for the flag to require, so "private" would have meant
the opposite of itself: every anonymous request treated as a full admin. Rather than boot into
that, Vellum prints the `npm run hash-password` line and exits. (Running deliberately open on a
trusted network is still fine — just don't also claim to be private.) For the same reason,
**[backup & sync](backup-and-sync.md) needs a password in every mode**: without one, anyone who
can reach the port could point the remote at their own server and push your whole vault to it.

**Sessions.** The cookie is httpOnly, `SameSite=Lax`, `Secure` whenever the request arrives over
HTTPS (directly, or via `X-Forwarded-Proto` from an address listed in `TRUSTED_PROXIES` — set
`SECURE_COOKIES=true`/`false` to decide it yourself, e.g. `false` for LAN-over-http), and lives
**7 days**, renewed automatically while you are using the app. **Signing out signs you out
everywhere**, on every device, immediately: sessions carry an epoch stored in `VELLUM_DATA`, and
logging out bumps it. **Changing `ADMIN_PASSWORD_HASH` does the same** — every cookie issued under
the old password stops working the moment the new one is in place, which is the whole point of
changing it after a laptop goes missing. (Upgrading Vellum also invalidates existing sessions
once; you sign in again.)

**Login rate limit.** 10 failed attempts per minute per IP, plus a global ceiling, and the slot is
taken *before* the password is checked — so a thousand simultaneous guesses are still ten guesses.
At most two password verifications run at once (each argon2id hash costs 64 MB by design), so login
traffic can't starve the process that is also serving your notes.

## What counts as published

Exactly one thing: `publish: true` in a note's frontmatter.

```yaml
---
title: On Marginalia
publish: true
tags: [writing]
date: 2026-08-16
---
```

`Ctrl/Cmd Shift P` toggles it on the open note, and so do "Publish note" / "Unpublish note" in the
command palette; the write is a surgical one-line frontmatter edit that leaves the rest of the
file alone. A `.tex` note carries the same flag in
[its own comment block](latex.md) and publishes identically.

Everything a visitor can see follows from that flag. The tree, search, the graph, backlinks,
the post list, the RSS feed and the SSE event stream are all re-derived per request against the
published set, so an unpublished path is not merely hidden — it is indistinguishable from a path
that does not exist. Attachments follow their note: a published note's banner and embeds are
fetchable, an unpublished note's are not.

Two settings can *narrow* what visitors see further, without unpublishing anything:
[`EXCLUDE_TAGS`](configuration.md#environment-variables) hides tags from the public topic
surfaces, and the [language filter](arabic-and-rtl.md#language-filter) hides notes not written in
a chosen language. Both are curation. `publish: false` is the switch with teeth.

One frontmatter key *widens* rather than narrows: `folders:` names the
[public folders](blog-mode.md#custom-public-folders) a published note belongs to — your own
collections on the blog, beside the topics its tags create. It changes nothing about whether the
note is published, and it is inert until you declare a folder with that address in Settings.

## Preview as visitor

As the signed-in admin you can **preview as visitor** at any time — the eye icon in the status
bar, or "Preview as visitor" in the command palette. It is not a client-side imitation: every
request is re-scoped server-side through the exact code path a stranger's request takes
(published-only tree, search, graph, feed of events), so what you see is byte-for-byte what the
public site serves. A slim gold banner marks the mode; "Exit preview" returns you to the full app
on the same note. It never survives a reload.

## Putting it on the internet

Run Vellum behind any HTTPS reverse proxy (Caddy, nginx, a Cloudflare tunnel, …) forwarding to
`localhost:6801` — the app is a single origin (API + static client on one port), so no special
proxy rules are needed; just make sure it is only reachable over TLS so the login password and
session cookie stay private.

When you do sit it behind a proxy, also set `TRUSTED_PROXIES` to the proxy's address (e.g.
`TRUSTED_PROXIES=127.0.0.1,::1`) so the login rate limit keys off the real client IP from
`X-Forwarded-For` instead of lumping everyone together as the proxy's IP. The header is only ever
trusted when the connection comes from a listed address — otherwise it is ignored, since clients
can forge it.

Request bodies are capped server-side before any parsing buffers them: 10 MB on any `/api`
request, and a much tighter 64 KB on the anonymous surfaces (comment posts and login), so
oversized uploads are rejected (HTTP 413) instead of occupying memory. A matching cap at the proxy
is still a sensible extra layer — e.g. nginx `client_max_body_size 10m;`.

## Comments

Set `COMMENTS=on` (or the toggle in Settings → Publishing & comments) and every **published** note
grows a quiet "Marginalia" section under its reading view: visitors can leave a plain-text note
(name optional — "Anonymous" otherwise). Off (the default), the feature is completely dark — no
UI, and the API routes answer 404.

Moderation is built in for admins. On each comment: a quiet delete `×` (confirmed before it
does anything irreversible) and an eye toggle that **hides** the comment instead — hidden
comments vanish for visitors but stay in the database, rendered ghosted with a "hidden" chip
for the admin, and can be unhidden at any time. The command palette's **"Moderate comments"**
opens a panel of the newest comments across every note — each row shows author, snippet and
the note it belongs to (click to jump there), with the same hide/delete controls.

Comments are stored in an SQLite file at `VELLUM_DATA/comments.db` (default `./data/`, created
on demand, gitignored) using Node's built-in `node:sqlite` — no extra dependencies. Abuse
controls are built in: post requests over 64 KB are rejected before any parsing touches
them, posting is rate-limited to 5 comments/min/IP (honoring `TRUSTED_PROXIES` for the real
client address, same as login), bodies are capped at 2000 characters of plain text (always
rendered escaped, never as HTML/markdown), names at 40, and the form carries a hidden honeypot
field that silently swallows bot submissions. Comments can only ever be read or written on notes
with `publish: true` — for anything else the API answers the same 404 a missing note would, so
unpublished paths stay unguessable. With `PUBLIC=false` (fully private vault), visitors can
neither read nor post comments at all.

## The three public shells

| `PUBLIC_LAYOUT` | What a visitor gets |
| --- | --- |
| `app` *(default)* | The application itself, read-only: sidebar, tabs, graph, search — no editor |
| `blog` | A classic blog: masthead, topic nav, article pages, RSS, comments — see [Blog mode](blog-mode.md) |
| `designed` | A homepage you compose yourself out of sections — see [Designer](designer.md) |

Signed-in admins are unaffected by any of them — the full app, sidebar and all, stays exactly as
it is. The visitor shell exists only for visitors.
