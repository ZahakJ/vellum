# Backup & sync

*Committing your vault and pushing it to a private git remote you own — by hand or on a timer.*

← [Back to the README](../README.md) · [All docs](README.md)

---

Your vault is a folder of markdown files, so the oldest, most portable backup there is also the
best one: **git**. Vellum can commit the vault and push it to a remote you own — by hand, or
every few minutes — and it stays completely off until you switch it on.

> **Backup & sync needs an admin password in every mode.** Without one, anyone who can reach the
> port could point the remote at their own server and push your whole vault to it. See
> [Publishing](publishing.md#public-reading-admin-editing).

## 1. Have a remote to push to

Create an **empty, private** repository on whatever host you
use (a self-hosted Forgejo/Gitea/GitLab, or one of the big ones). Empty matters: Vellum only
ever fast-forwards, so a remote that already has commits of its own will refuse to sync until
you reconcile the two histories yourself. Copy its clone URL — either form works:

```
https://git.example.com/you/vault.git      # HTTPS: needs a token (below)
git@git.example.com:you/vault.git          # SSH: needs a key on this machine
```

## 2. Choose how this server signs in

- **SSH keys (recommended).** Vellum stores **no secret at all**; it runs `git` as the user your
  server runs as, and that user's own SSH key or agent does the authentication. Generate a key
  for the server (`ssh-keygen -t ed25519`), add the **public** half to your remote as a deploy
  key with write access, and confirm it works from a shell first — `ssh -T git@git.example.com`
  and one manual `git push` — because a key with a passphrase and no agent will simply fail
  under the server too.
- **Access token.** For HTTPS remotes. Create a **fine-grained** token scoped to that one
  repository with contents read/write and the shortest expiry you can live with — never a
  full-account classic token. Paste it into Settings → Backup & sync → Access token, with
  the username it pairs with (many hosts ignore the username; put anything non-empty).

**Where the token lives.** In `VELLUM_DATA/git-credentials.json`, mode `0600`, owned by the
server user. It is **never** written into `settings.json`, never into the vault, never into
`.git/config`, and never into the remote URL — which is why the remote field refuses a URL with
credentials baked in (`https://user:token@host/…`). At push time it reaches git through
`GIT_ASKPASS` and an environment variable on that one child process, so it never appears in a
command line (`ps` is readable by every user on the box) and never lands in your machine's own
credential store (each network call runs with `-c credential.helper=` to empty the helper list).
The API never gives it back: `GET /api/settings` answers `tokenSet: true` and nothing else, and
any git error shown to you or written to the log is scrubbed of the stored token and of any URL
userinfo first. **Clear token** deletes the file.

## 3. Turn it on

Settings → **Backup & sync**: switch Backup on (everything below that
switch stays disabled until you do), paste the remote URL, pick the branch (default `main`), and
pick an **Automatic sync** period — *Manual only* through *Once a day* (the timer skips a tick
while a sync is still running). If the vault is not a git repository yet, press **Initialize
repository**: that runs `git init`, makes the first commit, writes or extends `.gitignore` so
your instance data directory can never be committed, and points `origin` at your remote. The
button disappears once the vault is a repository.

## 4. Sync

The status bar shows a quiet branch glyph while backup is on: plain when everything
is committed, with a count when it is not, gold while a sync runs, red when the last one failed.
Click it for a small panel carrying the branch, the ahead/behind counts, the last result and —
on a failure — git's own error line as selectable text with a **Copy the error** button and a
one-click jump to the settings section. **Sync now** is in that panel and in the command palette.
One pass is:

1. optionally `fetch` + `merge --ff-only` — see below;
2. `git add -A`, then `.trash/` (and `VELLUM_DATA`, if you put it inside the vault) are dropped
   back out of the index — see **What sync never stages** below;
3. commit `vellum sync: <ISO timestamp>`, **skipped entirely when nothing changed**;
4. `git push`.

## Why pulls are fast-forward-only

Because the alternative can corrupt your notes. A real
merge of two diverged histories writes `<<<<<<<` conflict markers *into the markdown files*, and
an unattended background job that does that to a thousand notes is a worse outcome than any
missed backup. So Vellum never merges and never rebases (a `pull.rebase = true` in your own
gitconfig cannot change that — no `git pull` runs at all): if the remote has commits you do not
have, the sync stops **before touching the working tree** and tells you the histories diverged.
Nothing is committed, nothing is pushed, no note is modified. You then reconcile in a terminal,
which is where a human belongs for that decision. Vellum never force-pushes.

## What sync never stages

Two paths are removed from the index on every single pass, before
anything is committed, **whatever your vault's own `.gitignore` says about them**:

| Path | Why |
| --- | --- |
| `.trash/` | Deleting a note, an attachment or a folder *moves* it here, and the whole promise of that is that it is a **local** bin — something you dig through, restore from, or empty without consequence (the trash browser is the door: `Ctrl/Cmd P` → Open trash). Committing it makes every deletion permanent remote history, which is the opposite guarantee. The small `.vellum-trash.json` inside it — which records where each entry came from, so Restore is a restore — is local bookkeeping and is covered by the same rule. |
| `VELLUM_DATA`, when it is inside the vault | It holds `settings.json`, the comments database and your git **access token**. |

This is enforced with `git rm --cached` against the index, not with an ignore rule, and the
difference matters. An ignore rule is your file and your opinion: git's *last matching rule*
wins, so a vault whose `.gitignore` carries `.trash/` and then `!.trash/` un-ignores it again,
and a build that only checked "is there a `.trash/` line?" saw nothing to do and pushed the
trash. The index eviction asks no ignore file anything. It also **repairs** a vault that an
older build already pushed: the first sync after upgrading stages the removal, so the trash
leaves the tip of your branch on its own (it stays in the *history* — see the note about
rewriting below).

Vellum still *appends* `.trash/` and `.obsidian/workspace*.json` to your `.gitignore` if they
are missing, so a `git status` in a terminal is quiet too — but that is a courtesy, not the
mechanism.

## .gitignore advice

Beyond those two, the vault is committed as it stands, so decide what
does *not* belong in a backup before the first push:

```gitignore
.obsidian/workspace*    # Obsidian's per-machine window state, if you also use Obsidian
.DS_Store
*.pdf                   # large attachments, if your remote has a size limit
```

Keep `.obsidian/` itself if you want your Obsidian settings backed up; drop the whole directory
if you do not. **Never commit your instance data directory.** `VELLUM_DATA` (default `./data`)
holds `settings.json`, comment data and the git token, so keep it *outside* the vault — that is
the default, and this repository's own `.gitignore` already excludes `data/`.

If you have pointed `VELLUM_DATA` inside the vault anyway, Vellum defends it four ways, and all
four run on an existing repository with an existing `.gitignore` (which is the normal case, not
a special one): **Initialize repository** creates `.gitignore` or *appends* the data-directory
rule to the one you already have; every sync re-checks the rule with `git check-ignore` and
**refuses to run** if the directory is still not ignored; anything an older build already
committed is dropped from the index (`git rm --cached`); and the same eviction runs again after
`git add -A` on every pass, so the directory is out of the index no matter which ignore rule
matched last. A sync never stages your credentials. Note that files already pushed stay in the
remote's *history* — if that happened, rotate the token and rewrite the history in a terminal.

## Note history: reading what the backup kept

Every sync makes a commit, and every commit is a version of every note in it. **History** is the
read half of that: open a note, open the *History* section in the right-hand panel, and you get
the commits that touched this note — newest first, with the date, the message and how many lines
each one added and removed.

- Tap a row to **read that revision**, rendered exactly as the note renders anywhere else.
- **Restore this revision** writes it back through the ordinary save path, so it is undoable with
  `Ctrl/Cmd+Z` in the editor, and the toast that follows carries an **Undo** of its own. A restore
  is itself an edit, so the version you restored *from* is one snapshot away from being history
  too — nothing is lost either way.
- History **follows renames**. A note that used to be called something else keeps everything it
  was before the rename.

The section starts closed and asks git nothing until you open it: reading a note's log is a real
piece of work, and most of the time you are writing rather than looking backwards. Open it once and
it stays open.

### Snapshot now

The palette has **Snapshot now** — one commit of the whole vault, on this machine, with nothing
sent anywhere. It is the thing to press before an edit you are not sure about, and it does not
need a remote, a token or a network: any vault that is a git repository can take one. It appears
in your history as *Snapshot*.

If the vault is not a git repository yet, the History section says so and offers the switch —
turning on Backup & sync (step 3 above) is what starts keeping history in the first place.

History is admin-only in both directions: a visitor cannot see that a published note had eleven
drafts, and cannot read any of them.

## Two servers, one vault

It is a perfectly ordinary thing to end up with **two Vellum servers over the same folder** — the
desktop app runs a server of its own, and plenty of people also keep one running as a systemd
service so they can reach the vault from a browser. A `git pull`, Obsidian, Syncthing or a text
editor writing into the same folder is the same situation with a different second writer.

**The guarantee: a note you did not save cannot be overwritten by a copy somebody was still
holding.** Every save the editor makes carries the modification time of the file it was loaded
from, and the server refuses the write — `409`, nothing touched — if the file on disk is no longer
that one. Nothing is lost when this happens: your text stays in the editor, autosave stops so the
next keystroke cannot clobber the newer version, and a strip above the note offers the two ways
out — **Keep my version** (write yours over the newer file) or **Use the disk version** (take
theirs, undoably).

The reason this needed saying out loud is a real incident. A note was published from the browser;
the desktop app had been open for days with that note loaded from *before* the publish. Each
server watches the vault for its own connected clients, so the "this file changed" message never
reached the sleeping desktop app — and a browser's event stream replays nothing it missed while
the laptop was shut. The refusal above is what kept the note safe. What was missing was any way to
find out *before* trying to save.

So Vellum now **re-checks when it wakes up**: when its connection to the server comes back, or when
you return to a window that had been hidden, it asks the server for the current state of the notes
you have open. Ones you have not touched reload silently; one with unsaved edits gets the same
resolution strip immediately, while you are looking at it, instead of interrupting you later.

Two things worth knowing about the arrangement:

- **No note is locked.** Neither server owns the vault, and either can be stopped at any time —
  the refusal above is a check made at the moment of writing, not a claim staked in advance.
  Backup & sync is the one deliberate exception, for the reason in the next section: a commit is
  a whole-vault operation with a single git index, so it cannot be two things at once.
- **Scripts and older clients still work.** A write with no modification time attached — `curl`, a
  script of your own, an older desktop build — behaves exactly as it always did: last writer wins.
  The check is opt-in, and only clients that can handle a refusal ask for one.

If you run two servers, point both at the same vault directory and give them **different data
directories** (`VELLUM_DATA`) unless you also want them to share sessions and settings.

### One sync at a time — across every server

Notes are written one at a time; a **commit is written for the whole vault at once**, through a
single `.git/index` that git guards with a lock of its own. Two Vellums committing the same folder
in the same second do not produce two backups — one of them dies with *"Another git process seems
to be running in this repository"*, possibly having already staged half the vault. That is not
hypothetical: it is why sync used to be worth running only by hand on a machine that also ran the
desktop app.

So a mutating pass — **Sync now**, **Snapshot now**, **Make it a repo**, and every scheduled tick —
takes a lock file at `.git/vellum-sync.lock` first, and holds it until the pass is over. Only one
of them exists, so only one pass runs at a time **across every process sharing that vault**: the
desktop app, a systemd service, a second terminal, a scheduled interval. This is what makes an
automatic interval safe to leave switched on next to a desktop app.

- **What contention looks like.** A **Sync now** that arrives while another Vellum is mid-pass is
  not an error and does not retry: the backup panel's last line says *"Another Vellum is syncing
  this vault (pid …) — this pass did nothing"*, naming the process that has it, and the status
  glyph reads as busy for as long as the other one is working. **Snapshot now** and **Make it a
  repo** answer `409` with the same sentence. A scheduled tick that finds the vault locked simply
  skips and tries again on the next one; it records nothing.
- **How a crash recovers.** A lock file is not a file descriptor — nothing in the kernel removes it
  when its owner dies — so a Vellum killed mid-sync would otherwise wedge backup forever. Any other
  process may break the lock when **the process that took it is gone** (it records its pid and
  hostname, checked against the machine's own process table) or when **nothing has touched it for
  fifteen minutes**. Either way the break is logged as a warning naming the dead holder. A pass
  that is merely slow is never mistaken for a dead one: a live holder refreshes the lock every
  minute while it works.
- **What it does not cover.** The lock is advisory, so your own `git commit` in a terminal is
  unaffected — that has always been git's `index.lock` to arbitrate. And two *machines* sharing one
  vault over a network filesystem is outside what this buys: exclusive creation is only as atomic
  as the filesystem makes it, and the fifteen-minute age check is the only recovery there.

## Things worth knowing

- Every git invocation is an `execFile` with a fixed argument array. No shell is involved
  anywhere, and the remote URL and branch name are validated (scheme, no shell characters, no
  embedded credentials, safe ref name) before they are ever handed over. A `user@` that is
  *token-shaped* (`ghp_…`, `github_pat_…`, `glpat-…`) is refused on every scheme, including the
  scp-style `git@host:path` and `ssh://` forms where a plain username is fine.
- The git child process gets a **scrubbed environment**: `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_INDEX_FILE`, the object-directory variables, `GIT_CONFIG*` (including
  `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`), `GIT_SSH`, `GIT_SSH_COMMAND`, `GIT_PROXY_COMMAND` and
  `GIT_EXTERNAL_DIFF` are all removed, so nothing in the server's own environment can point git
  at another repository, another config, or another transport. If you *need* a custom SSH
  invocation — a specific deploy key, say — set **`VELLUM_GIT_SSH_COMMAND`** (e.g.
  `VELLUM_GIT_SSH_COMMAND="ssh -i /path/to/vault_ed25519 -o IdentitiesOnly=yes"`) and
  Vellum passes exactly that to git as `GIT_SSH_COMMAND`.
- "Ahead / behind" has a third state. Until a fetch or a push has succeeded once there is no
  remote-tracking ref to compare against, and the panel says **"Nothing has reached the remote
  yet"** rather than "0 ahead · 0 behind" — which is what a fully backed-up vault reads.
- Sync is admin-only, including for an admin previewing the public site. Visitors cannot even
  read the status — the branch, the dirty count and the remote host say too much about you.
- Only one sync runs at a time, and that means *at a time on this vault*, not merely in this
  server: a second request inside the same process answers `409` immediately, and a pass started by
  another Vellum over the same folder is held off by the lock file described above.
- A failing scheduled sync is logged **once**, not once per tick.
- If the machine has no git identity configured, commits are made as `Vellum
  <vellum@localhost>`; set `user.name`/`user.email` in the vault (or globally) to use your own.
- The API, for anyone scripting it (admin-only): `GET /api/sync/status`, `POST /api/sync/init`,
  `POST /api/sync/now`, `POST /api/sync/snapshot` (a local commit, no network), plus the two
  read-only history routes — `GET /api/history?path=` and `GET /api/history/blob?path=&sha=`. The
  blob route wants the path **that revision** lives under, which the listing gives you per row: a
  note that has been renamed lives under its old name in its older commits.
