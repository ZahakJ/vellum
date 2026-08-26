// Backup & sync: mirror the vault to a git remote the operator configures.
//
// Everything here shells out to the `git` BINARY through execFile with a fixed
// argument array — never a shell string, never string interpolation into a
// command. A vault path, a branch name or a remote URL is data; it travels as
// argv[n] and can therefore never become a command.
//
// CREDENTIALS. Two modes, chosen per instance:
//   ssh   — the app stores no secret at all. Pushes ride the machine's own SSH
//           agent/keys, exactly as a shell `git push` would.
//   token — the token lives in VELLUM_DATA/git-credentials.json (0600), NEVER
//           in settings.json, never in the vault, never in the repo. It is
//           handed to git at push time through GIT_ASKPASS + an env var, so it
//           never appears in the remote URL, in .git/config, in process argv
//           (world-readable via `ps`), or in any string this module returns.
//           Every message that can reach a client or a log goes through
//           scrub() first, which redacts the stored token and any URL userinfo
//           defensively.
//
// The settings key is `gitSync` (see shared/types.ts); its validators live
// here so settings.ts only has to call them. The settings.ts import is
// circular and inert for the same reason site.ts's is: both sides export
// functions only and neither calls the other at module top level.

import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  GitSyncEffective,
  GitSyncResult,
  GitSyncSettings,
  GitSyncStatus,
  NoteHistoryResponse,
  NoteRevision,
  NoteRevisionBlob,
} from "../shared/types.ts";
import { getSettings } from "./settings.ts";
import { dataDir } from "./site.ts";
import { getVaultRoot, TRASH_DIR, VaultError } from "./vault.ts";

const run = promisify(execFile);

const CREDENTIALS_FILE = "git-credentials.json";
const ASKPASS_FILE = "git-askpass.sh";

const DEFAULT_BRANCH = "main";
const REMOTE_MAX = 300;
const BRANCH_MAX = 100;
const TOKEN_MAX = 500;
const USER_MAX = 100;
const INTERVAL_MAX = 1440; // 24h

const LOCAL_TIMEOUT_MS = 60_000;
const NETWORK_TIMEOUT_MS = 180_000;
const MAX_BUFFER = 4 * 1024 * 1024;

// ---------------------------------------------------------------- validation

/** Shell metacharacters and whitespace. Nothing here can reach a shell (we
 *  never use one), but a remote carrying them is malformed by any reading and
 *  a flat refusal is the cheapest possible defense in depth. */
const UNSAFE = /[\s`$;&|<>(){}\[\]'"\\^*?!#\u0000-\u001f\u007f]/;

/** The token shapes the big hosts hand out. scrub() already redacts these on
 *  the way OUT; cleanRemote() refuses them on the way IN, on every scheme —
 *  the `user@` a bare ssh remote is allowed to carry is a USERNAME, and a
 *  username that is literally a personal access token is a pasted secret
 *  whichever spelling it arrived in. */
const TOKEN_SHAPE = /^(gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,}|glpat-[A-Za-z0-9_-]{6,})$/;

/** Token-shaped, tested on the raw text AND on its percent-decoding (URL
 *  parsing escapes the userinfo, and a malformed escape must not throw). */
function isTokenShaped(userinfo: string): boolean {
  if (TOKEN_SHAPE.test(userinfo)) return true;
  try {
    return TOKEN_SHAPE.test(decodeURIComponent(userinfo));
  } catch {
    return false;
  }
}

/** A remote URL Vellum will hand to git: https://… or ssh://… / git@host:path,
 *  with no shell metacharacters, no embedded credentials, length-capped. */
export function cleanRemote(value: string): string {
  const remote = value.trim();
  if (remote === "") return "";
  if (remote.length > REMOTE_MAX) {
    throw new VaultError(400, `Settings value "gitSync.remote" too long (${REMOTE_MAX} characters max)`);
  }
  if (UNSAFE.test(remote) || remote.startsWith("-")) {
    throw new VaultError(400, 'Settings value "gitSync.remote" contains characters a git remote may not hold');
  }
  if (/^https:\/\//i.test(remote) || /^ssh:\/\//i.test(remote)) {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      throw new VaultError(400, 'Settings value "gitSync.remote" is not a valid URL');
    }
    if (!url.hostname) throw new VaultError(400, 'Settings value "gitSync.remote" has no host');
    // A PASSWORD in the URL is always refused: that is where a pasted token
    // ends up, and it would land in .git/config and in every error line git
    // prints. A bare USERNAME is refused on https:// for the same reason
    // (`https://<token>@host/…` is the shape most hosts hand out), but it is
    // legitimate on ssh:// — `ssh://git@host/you/vault.git` is git's own
    // canonical spelling of the scp-style `git@host:you/vault.git` this
    // function accepts two lines down, and that "user@" carries no secret at
    // all. Refusing it while accepting its twin, with a message pointing at a
    // token field SSH never consults, was a dead end for the commonest paste.
    //
    // And on EITHER scheme, a username that is token-SHAPED is refused too:
    // the rationale for allowing ssh's `user@` is that it carries no secret,
    // which stops being true the moment the user part is a `ghp_…`. Same
    // known prefixes scrub() redacts on the way out.
    if (
      url.password !== "" ||
      (url.username !== "" && /^https:/i.test(url.protocol)) ||
      isTokenShaped(url.username)
    ) {
      throw new VaultError(
        400,
        'Settings value "gitSync.remote" must not embed a username or password — use the token field instead',
      );
    }
    return remote;
  }
  // scp-style: git@host:owner/repo.git (user@ is required; a bare host:path is
  // ambiguous with a local path). The user part gets the same token test: this
  // spelling has no URL parser in front of it, so it is checked by hand.
  const scp = /^([A-Za-z0-9._-]+)@[A-Za-z0-9.-]+:[^:]+$/.exec(remote);
  if (scp) {
    if (isTokenShaped(scp[1])) {
      throw new VaultError(
        400,
        'Settings value "gitSync.remote" must not embed a username or password — use the token field instead',
      );
    }
    return remote;
  }
  throw new VaultError(
    400,
    'Settings value "gitSync.remote" must start with https:// , ssh:// or git@host:path',
  );
}

/** A branch name safe as a git ref (a conservative subset of
 *  git-check-ref-format: no .., no leading -/., no //, no .lock suffix). */
export function cleanBranch(value: string): string {
  const branch = value.trim();
  if (branch === "") return "";
  if (branch.length > BRANCH_MAX) {
    throw new VaultError(400, `Settings value "gitSync.branch" too long (${BRANCH_MAX} characters max)`);
  }
  const ok =
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".") &&
    !branch.endsWith(".lock") &&
    !branch.includes("@{");
  if (!ok) throw new VaultError(400, 'Settings value "gitSync.branch" is not a valid branch name');
  return branch;
}

/** Validate a PATCH of the `gitSync` object against the current stored value.
 *  Returns the object to store, or null to delete the key. */
export function cleanGitSyncPatch(
  value: unknown,
  currentRaw: unknown,
): Record<string, unknown> | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new VaultError(400, 'Settings key "gitSync" must be an object or null');
  }
  const patch = value as Record<string, unknown>;
  const current: Record<string, unknown> =
    typeof currentRaw === "object" && currentRaw !== null && !Array.isArray(currentRaw)
      ? { ...(currentRaw as Record<string, unknown>) }
      : {};
  const allowed = new Set(["enabled", "remote", "branch", "intervalMinutes", "pullFirst", "authMode"]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new VaultError(400, `Unknown settings key: gitSync.${key}`);
  }
  const bool = (key: "enabled" | "pullFirst"): void => {
    if (!(key in patch)) return;
    const v = patch[key];
    if (v === null) delete current[key];
    else if (typeof v === "boolean") current[key] = v;
    else throw new VaultError(400, `Settings key "gitSync.${key}" must be a boolean or null`);
  };
  bool("enabled");
  bool("pullFirst");
  if ("remote" in patch) {
    const v = patch.remote;
    if (v === null || v === "") delete current.remote;
    else if (typeof v === "string") {
      const clean = cleanRemote(v);
      if (clean === "") delete current.remote;
      else current.remote = clean;
    } else throw new VaultError(400, 'Settings key "gitSync.remote" must be a string or null');
  }
  if ("branch" in patch) {
    const v = patch.branch;
    if (v === null || v === "") delete current.branch;
    else if (typeof v === "string") {
      const clean = cleanBranch(v);
      if (clean === "") delete current.branch;
      else current.branch = clean;
    } else throw new VaultError(400, 'Settings key "gitSync.branch" must be a string or null');
  }
  if ("intervalMinutes" in patch) {
    const v = patch.intervalMinutes;
    if (v === null) delete current.intervalMinutes;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= INTERVAL_MAX) {
      current.intervalMinutes = v;
    } else {
      throw new VaultError(
        400,
        `Settings key "gitSync.intervalMinutes" must be a whole number of minutes (0–${INTERVAL_MAX}, 0 = manual only)`,
      );
    }
  }
  if ("authMode" in patch) {
    const v = patch.authMode;
    if (v === null) delete current.authMode;
    else if (v === "ssh" || v === "token") current.authMode = v;
    else throw new VaultError(400, 'Settings key "gitSync.authMode" must be "ssh" or "token"');
  }
  return Object.keys(current).length === 0 ? null : current;
}

/** The stored gitSync object, validated on read (malformed values dropped —
 *  reads never throw, exactly like the rest of getSettings()). */
export function readGitSyncSettings(raw: unknown): GitSyncSettings | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: GitSyncSettings = {};
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (typeof r.pullFirst === "boolean") out.pullFirst = r.pullFirst;
  if (typeof r.remote === "string") {
    try {
      const clean = cleanRemote(r.remote);
      if (clean !== "") out.remote = clean;
    } catch {
      /* malformed — dropped on read */
    }
  }
  if (typeof r.branch === "string") {
    try {
      const clean = cleanBranch(r.branch);
      if (clean !== "") out.branch = clean;
    } catch {
      /* malformed — dropped on read */
    }
  }
  if (
    typeof r.intervalMinutes === "number" &&
    Number.isInteger(r.intervalMinutes) &&
    r.intervalMinutes >= 0 &&
    r.intervalMinutes <= INTERVAL_MAX
  ) {
    out.intervalMinutes = r.intervalMinutes;
  }
  if (r.authMode === "ssh" || r.authMode === "token") out.authMode = r.authMode;
  return Object.keys(out).length === 0 ? undefined : out;
}

/** The gitSync configuration in effect right now (defaults filled in). Sync is
 *  OFF by default: a fresh instance touches no network and no repository. */
export function gitSyncEffective(): GitSyncEffective {
  const s = getSettings().gitSync ?? {};
  const cred = readCredentials();
  return {
    enabled: s.enabled ?? false,
    remote: s.remote ?? null,
    branch: s.branch ?? DEFAULT_BRANCH,
    intervalMinutes: s.intervalMinutes ?? 0,
    pullFirst: s.pullFirst ?? true,
    authMode: s.authMode ?? "ssh",
    tokenSet: cred.token !== null,
    gitUser: cred.user,
  };
}

// --------------------------------------------------------------- credentials

interface Credentials {
  token: string | null;
  user: string | null;
}

function credentialsPath(): string {
  return path.join(dataDir(), CREDENTIALS_FILE);
}

/** The stored credential, read fresh every time (it is tiny, and it must never
 *  be cached into a place a heap dump or a stale read could surface). */
function readCredentials(): Credentials {
  try {
    const parsed: unknown = JSON.parse(readFileSync(credentialsPath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return { token: null, user: null };
    const r = parsed as Record<string, unknown>;
    return {
      token: typeof r.token === "string" && r.token !== "" ? r.token : null,
      user: typeof r.user === "string" && r.user !== "" ? r.user : null,
    };
  } catch {
    return { token: null, user: null };
  }
}

/** Write (or clear) the credential file: 0600, atomic, VELLUM_DATA only. */
function writeCredentials(next: Credentials): void {
  const file = credentialsPath();
  if (next.token === null && next.user === null) {
    try {
      rmSync(file);
    } catch {
      /* nothing stored */
    }
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const body: Record<string, string> = {};
  if (next.token !== null) body.token = next.token;
  if (next.user !== null) body.user = next.user;
  // mode on open AND an explicit chmod: the mode argument is masked by umask,
  // so a permissive umask would otherwise leave the file group/world readable.
  writeFileSync(tmp, `${JSON.stringify(body)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
  // The create mode is masked by umask, and a pre-existing file keeps its own
  // mode — so assert 0600 after the rename rather than trusting either.
  chmodSync(file, 0o600);
}

// A settings PATCH is all-or-nothing, and the credential lives in a different
// file from settings.json — so the two credential keys VALIDATE during the
// patch and only WRITE once the whole patch has been accepted and persisted.
// A patch that 400s on a later key therefore leaves the stored token untouched.
type StagedCredential = { kind: "token" | "user"; value: string | null };
let staged: StagedCredential[] = [];

/** Drop anything staged by an earlier (failed) patch. */
export function discardStagedGitCredentials(): void {
  staged = [];
}

/** Write everything the accepted patch staged, in order. */
export function applyStagedGitCredentials(): void {
  const queue = staged;
  staged = [];
  for (const item of queue) {
    const current = readCredentials();
    if (item.kind === "token") writeCredentials({ token: item.value, user: current.user });
    else writeCredentials({ token: current.token, user: item.value });
  }
}

/** PATCH gitToken: write-only. "" / null clears it. The value never comes
 *  back out of the API — only `tokenSet` does. */
export function setGitToken(value: unknown): void {
  if (value === null || value === "") {
    staged.push({ kind: "token", value: null });
    return;
  }
  if (typeof value !== "string") {
    throw new VaultError(400, 'Settings key "gitToken" must be a string or null');
  }
  const token = value.trim();
  if (token.length > TOKEN_MAX) {
    throw new VaultError(400, `Settings key "gitToken" is too long (${TOKEN_MAX} characters max)`);
  }
  if (/[\s\u0000-\u001f\u007f]/.test(token)) {
    throw new VaultError(400, 'Settings key "gitToken" must not contain whitespace or control characters');
  }
  staged.push({ kind: "token", value: token });
}

/** PATCH gitUser: the username the token pairs with (not a secret, but it
 *  lives with the token rather than in settings.json). */
export function setGitUser(value: unknown): void {
  if (value === null || value === "") {
    staged.push({ kind: "user", value: null });
    return;
  }
  if (typeof value !== "string") {
    throw new VaultError(400, 'Settings key "gitUser" must be a string or null');
  }
  const user = value.trim();
  if (user.length > USER_MAX) {
    throw new VaultError(400, `Settings key "gitUser" is too long (${USER_MAX} characters max)`);
  }
  if (/[\s:\u0000-\u001f\u007f]/.test(user)) {
    throw new VaultError(400, 'Settings key "gitUser" must not contain whitespace, colons or control characters');
  }
  staged.push({ kind: "user", value: user });
}

// ------------------------------------------------------------------ scrubbing

/** Redact anything secret-shaped from text that may reach a client, a toast or
 *  a log line: the stored token itself, URL userinfo (user:pass@host), and the
 *  well-known token prefixes in case one was pasted somewhere it should not
 *  have been. Also collapses git's multi-line output to one readable line. */
export function scrub(text: string): string {
  let out = String(text ?? "");
  const token = readCredentials().token;
  if (token && token.length >= 4) out = out.split(token).join("•••");
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1");
  out = out.replace(/\b(gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,}|glpat-[A-Za-z0-9_-]{6,})\b/g, "•••");
  out = out.replace(/[\u0000-\u001f\u007f]+/g, " ");
  return out.replace(/\s+/g, " ").trim().slice(0, 400);
}

interface ExecFailure {
  stderr?: string;
  stdout?: string;
  message?: string;
}

/** The most useful single line of a failed git invocation, scrubbed. */
function gitMessage(err: unknown): string {
  const e = (err ?? {}) as ExecFailure;
  const text = [e.stderr, e.stdout, e.message].find((t) => typeof t === "string" && t.trim() !== "") ?? "git failed";
  const lines = String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !/^hint:/i.test(l));
  const useful = lines.filter((l) => !/^(warning|remote):?\s*$/i.test(l));
  return scrub(useful.slice(-3).join(" · ") || String(text));
}

// ------------------------------------------------------------------ git calls

/** The askpass helper git calls when a password is needed. It holds NO secret:
 *  it echoes an environment variable this process sets on the git child only.
 *  Written into VELLUM_DATA at 0700 so the executable bit is guaranteed. */
function ensureAskpass(): string {
  const file = path.join(dataDir(), ASKPASS_FILE);
  const body = `#!/bin/sh
# Written by Vellum. Holds no secret: it echoes the variables Vellum sets on
# the git process it spawns. Safe to delete — it is recreated on demand.
case "$1" in
  Username*) printf '%s' "$VELLUM_GIT_USER" ;;
  *) printf '%s' "$VELLUM_GIT_TOKEN" ;;
esac
`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, { encoding: "utf8", mode: 0o700 });
  return file;
}

/** Environment for a git child. `network` requests are the only ones that ever
 *  see the token, and they see it through GIT_ASKPASS + env — never argv (which
 *  `ps` shows to every user on the box) and never the remote URL. */
function gitEnv(network: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.GIT_TERMINAL_PROMPT = "0"; // never block waiting on a tty that isn't there
  delete env.GIT_ASKPASS;
  delete env.VELLUM_GIT_TOKEN;
  delete env.VELLUM_GIT_USER;
  // `cwd` is the vault, but these would override it and point git at another
  // repository entirely if they happened to be set in the server's own
  // environment. The vault is the only thing this module may act on.
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_NAMESPACE;
  // Same reasoning one level up: redirecting git's CONFIG redirects everything
  // config can reach — core.hooksPath, url.*.insteadOf, credential.helper —
  // just as effectively as GIT_DIR redirects the work tree, and redirecting
  // the TRANSPORT (ssh / proxy / external diff) replaces the program git
  // executes. None of these is reachable from a request, so this is hardening
  // rather than a hole; it is also one delete each.
  delete env.GIT_CONFIG;
  delete env.GIT_CONFIG_GLOBAL;
  delete env.GIT_CONFIG_SYSTEM;
  delete env.GIT_EXTERNAL_DIFF;
  delete env.GIT_PROXY_COMMAND;
  delete env.GIT_SSH;
  delete env.GIT_SSH_COMMAND;
  // GIT_CONFIG_COUNT + GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n is config injection
  // by another spelling, and it is indexed — so the whole family goes.
  delete env.GIT_CONFIG_COUNT;
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete env[key];
  }
  // The one legitimate use of GIT_SSH_COMMAND — "push with THIS deploy key" —
  // gets its own explicit door instead of ambient inheritance: an operator who
  // means it sets VELLUM_GIT_SSH_COMMAND, and nothing else in the environment
  // can steer git's transport by accident.
  const ssh = process.env.VELLUM_GIT_SSH_COMMAND?.trim();
  if (ssh) env.GIT_SSH_COMMAND = ssh;
  if (!network) return env;
  const eff = gitSyncEffective();
  if (eff.authMode !== "token") return env;
  const cred = readCredentials();
  if (cred.token === null) return env;
  env.GIT_ASKPASS = ensureAskpass();
  env.VELLUM_GIT_TOKEN = cred.token;
  // Hosts that ignore the username (GitHub fine-grained tokens, GitLab PATs
  // as "oauth2") still need *something* non-empty here.
  env.VELLUM_GIT_USER = cred.user ?? "vellum";
  return env;
}

/** Run git in the vault with a FIXED argument array — no shell, ever. */
async function git(args: string[], opts: { network?: boolean } = {}): Promise<string> {
  const network = opts.network === true;
  // `-c credential.helper=` empties the helper list for this invocation: the
  // token must never be handed to (and cached by) the machine's own credential
  // store, e.g. a global `credential.helper store` writing ~/.git-credentials.
  const prefix = network ? ["-c", "credential.helper="] : [];
  const { stdout } = await run("git", [...prefix, ...args], {
    cwd: getVaultRoot(),
    env: gitEnv(network),
    timeout: network ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return stdout.toString();
}

/** git that answers null instead of throwing (probe calls). */
async function gitTry(args: string[], opts: { network?: boolean } = {}): Promise<string | null> {
  try {
    return await git(args, opts);
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- status

let busy = false;
let lastResult: GitSyncResult | null = null;
/** Set while the interval timer is failing, so the log says it once. */
let loggedFailure: string | null = null;

/** Host part of a remote, for display only — never the path, never userinfo. */
export function remoteHost(remote: string | null): string | null {
  if (!remote) return null;
  const scp = /^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):/.exec(remote);
  if (scp) return scp[1];
  try {
    return new URL(remote).hostname || null;
  } catch {
    return null;
  }
}

/** True when the vault directory is itself the root of a git work tree (a
 *  vault sitting INSIDE some other repository must not count — git would
 *  happily answer about the parent). */
async function repoRoot(): Promise<string | null> {
  const top = await gitTry(["rev-parse", "--show-toplevel"]);
  if (top === null) return null;
  const root = top.trim();
  if (root === "") return null;
  // git answers with the resolved path, so compare resolved paths — a vault
  // reached through a symlink is still the same work tree.
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(root) === real(getVaultRoot()) ? root : null;
}

async function currentBranch(): Promise<string | null> {
  const sym = await gitTry(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (sym !== null && sym.trim() !== "") return sym.trim();
  const head = await gitTry(["rev-parse", "--abbrev-ref", "HEAD"]);
  const name = head?.trim();
  return name && name !== "HEAD" ? name : null;
}

/** Repo state for the settings panel and the status-bar glyph. */
export async function gitStatus(): Promise<GitSyncStatus> {
  const eff = gitSyncEffective();
  const base: GitSyncStatus = {
    enabled: eff.enabled,
    configured: eff.remote !== null,
    repo: false,
    branch: null,
    dirty: 0,
    // NOT 0 — UNKNOWN. There is no remote-tracking ref until a fetch or a push
    // has succeeded at least once, and "0 ahead · 0 behind" is what a fully
    // backed-up vault reads: answering it here made the never-pushed case
    // indistinguishable from the safe one, in the one panel whose entire job
    // is saying whether the writing is somewhere else yet.
    ahead: null,
    behind: null,
    remoteHost: remoteHost(eff.remote),
    originSet: false,
    busy,
    intervalMinutes: eff.intervalMinutes,
    authMode: eff.authMode,
    tokenSet: eff.tokenSet,
    last: lastResult,
  };
  if ((await repoRoot()) === null) return base;
  base.repo = true;
  base.branch = await currentBranch();
  const porcelain = await gitTry(["status", "--porcelain"]);
  base.dirty = porcelain === null ? 0 : porcelain.split("\n").filter((l) => l.trim() !== "").length;
  const origin = await gitTry(["remote", "get-url", "origin"]);
  base.originSet = origin !== null && origin.trim() !== "";
  if (base.originSet && base.remoteHost === null) base.remoteHost = remoteHost(origin!.trim());
  const branch = eff.branch || base.branch;
  if (branch && (await gitTry(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`])) !== null) {
    const counts = await gitTry(["rev-list", "--left-right", "--count", `HEAD...refs/remotes/origin/${branch}`]);
    const [ahead, behind] = (counts ?? "").trim().split(/\s+/).map((n) => Number.parseInt(n, 10));
    if (Number.isFinite(ahead) && Number.isFinite(behind)) {
      base.ahead = ahead;
      base.behind = behind;
    }
  }
  return base;
}

// ------------------------------------------------------------------- history
//
// THE READ HALF OF THE SAME REPOSITORY. Backup & sync has been committing the
// whole vault since v1.6 and there was no way to look at what it kept: the
// safety net existed and nothing in the product could reach it, which is the
// locked-fire-exit shape the trash browser was built to fix one floor down.
// Bulk-edit tools (search & replace, tag rename) are what a note-taker most
// wants and least trusts, and the reason is that a bad vault-wide edit is
// unrecoverable — so the undo of last resort ships FIRST, and the scary tools
// stand on top of it.
//
// Everything here is READ-ONLY git: `log`, `cat-file`, `show`. No index is
// touched, nothing is staged, nothing is fetched, so none of it can collide
// with a sync in flight and none of it needs the `busy` lock. Restoring is not
// in this module at all — it goes through PUT /api/note like every other write
// in the product, precondition and all, so a restore is an ordinary edit that
// the ordinary machinery (autosave conflict, undo, the next snapshot) already
// understands.

/** How many revisions one listing may carry, and the ceiling a caller may ask
 *  for. A note edited every day for four years has ~1,400 commits; the panel
 *  shows a timeline, not an archive, and `truncated` says when there is more. */
const HISTORY_DEFAULT = 100;
const HISTORY_MAX = 500;

/** A commit subject is written by whoever made the commit — us, or the
 *  operator from a terminal, or a merge from a machine we know nothing about.
 *  It reaches a client, so it is scrubbed (control characters, anything
 *  token-shaped) and capped. */
const SUBJECT_MAX = 200;

/** Bytes of one revision this will hand back. Well under `MAX_BUFFER`, and the
 *  point is not the buffer: the answer is JSON in a modal, and a 40MB pasted
 *  dataset in a note is not something a reader can read there anyway. */
const BLOB_MAX_BYTES = 2 * 1024 * 1024;

/** True when the vault is a git work tree we may answer about. Exported so the
 *  API can give the "Backup is off — turn it on" answer instead of an error. */
export async function isGitRepo(): Promise<boolean> {
  return (await repoRoot()) !== null;
}

/** A full object name and nothing else. The blob route puts this straight into
 *  `<sha>:<path>`, which git parses as a revision spec — so it may never carry
 *  a `^`, a `~`, a `:` or a `@{…}`, all of which mean something there. */
export function isFullSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value); // sha-1 and sha-256 repos
}

function parseCount(value: string): number | null {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null; // git prints "-" for a binary blob
}

/** Parse one `-z` numstat record: `added\tremoved\tpath` for an ordinary
 *  change, and `added\tremoved\t` followed by NUL-separated old and new names
 *  for a rename. The `-z` spelling exists precisely so this is unambiguous —
 *  the human form prints `dir/{old => new}/note.md`, which no parser should
 *  ever be asked to take apart. */
function parseNumstat(parts: string[]): { added: number | null; removed: number | null; path: string | null } {
  const head = (parts[0] ?? "").replace(/^\n+/, "");
  const cols = head.split("\t");
  if (cols.length < 3) return { added: null, removed: null, path: null };
  const added = parseCount(cols[0]);
  const removed = parseCount(cols[1]);
  // Third column empty ⇒ rename: the two names follow as their own NUL fields,
  // and the one this revision's blob lives under is the NEW one.
  const path = cols[2] !== "" ? cols[2] : (parts[2] ?? parts[1] ?? null);
  return { added, removed, path: path === null || path === "" ? null : path };
}

/** Every commit that touched one note, newest first, across renames.
 *
 *  `--follow` is the whole reason a rename in this product does not throw the
 *  note's past away, and it is also why each entry carries its own `path`: an
 *  older revision of a note that has since moved is a blob under the OLD name,
 *  and `git show <sha>:<current path>` would simply miss.
 *
 *  `--` before the path so a note called `-x.md` is a pathspec rather than an
 *  option, and the pathspec is passed VERBATIM: git's own globbing is off for
 *  a literal path, and the caller has already run it through the vault's
 *  containment checks. */
export async function noteHistory(relPath: string, limit = HISTORY_DEFAULT): Promise<NoteHistoryResponse> {
  if (!(await isGitRepo())) return { repo: false, revisions: [], truncated: false };
  const max = Math.max(1, Math.min(HISTORY_MAX, Math.trunc(limit) || HISTORY_DEFAULT));
  // One extra, so "there is more" is a fact rather than a guess at the boundary.
  const out = await gitTry([
    "log",
    "--follow",
    "-z",
    "--numstat",
    `--max-count=${max + 1}`,
    "--format=%x1e%H%x1f%h%x1f%aI%x1f%s",
    "--",
    relPath,
  ]);
  if (out === null) return { repo: true, revisions: [], truncated: false };
  const revisions: NoteRevision[] = [];
  for (const chunk of out.split("\x1e")) {
    if (chunk === "") continue;
    const parts = chunk.split("\0");
    const [sha, short, iso, subject] = (parts[0] ?? "").split("\x1f");
    if (!sha || !isFullSha(sha)) continue;
    const stat = parseNumstat(parts.slice(1));
    revisions.push({
      sha,
      short: short ?? sha.slice(0, 7),
      iso: iso ?? "",
      subject: scrub(subject ?? "").slice(0, SUBJECT_MAX),
      path: stat.path ?? relPath,
      added: stat.added,
      removed: stat.removed,
    });
  }
  const truncated = revisions.length > max;
  return { repo: true, revisions: revisions.slice(0, max), truncated };
}

/** One revision's bytes. Admin-only at the route; here the two guarantees are
 *  that the sha is a bare object name (see `isFullSha`) and that the size is
 *  checked BEFORE the content is read, so a note somebody pasted a database
 *  into cannot be turned into a 40MB JSON body by asking for its history. */
export async function noteRevisionBlob(relPath: string, sha: string): Promise<NoteRevisionBlob> {
  if (!isFullSha(sha)) throw new VaultError(400, "Not a commit id");
  if (!(await isGitRepo())) throw new VaultError(404, "The vault is not a git repository");
  const spec = `${sha}:${relPath}`;
  const size = await gitTry(["cat-file", "-s", spec]);
  if (size === null) throw new VaultError(404, "No such revision of that note");
  const bytes = Number.parseInt(size.trim(), 10);
  if (Number.isFinite(bytes) && bytes > BLOB_MAX_BYTES) {
    throw new VaultError(413, `That revision is too large to open here (${bytes} bytes)`);
  }
  let content: string;
  try {
    content = await git(["show", spec]);
  } catch (err) {
    throw new VaultError(404, gitMessage(err));
  }
  return { sha, path: relPath, content };
}

// ---------------------------------------------------------------------- init

/** VELLUM_DATA's path RELATIVE to the vault, or null when it sits outside it
 *  (the default, and the only arrangement with nothing to defend). This is the
 *  one directory that must never reach the remote: it holds
 *  git-credentials.json. */
function dataDirInsideVault(): string | null {
  const rel = path.relative(path.resolve(getVaultRoot()), path.resolve(dataDir()));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.replace(/\\/g, "/");
}

const IGNORE_HEADER = "# Vellum instance data (credentials, settings) — never commit this.";
const TRASH_HEADER = "# Vellum: local trash and editor scratch — never commit these.";

/** Rules that must hold on EVERY synced vault, regardless of where
 *  VELLUM_DATA lives.
 *
 *  `.trash/` is the load-bearing one. The whole justification for the
 *  folder-delete trash model (CONTRACTS, "recoverable from disk", "invisible
 *  to tree/indexer/watcher") assumes the trash is LOCAL — a bin you can dig
 *  through, or empty, without consequence. With sync on and this rule missing,
 *  `git add -A` committed it: deleting a 1,214-note folder became permanent
 *  history on the operator's remote, and "move to trash" was a slower spelling
 *  of "publish my deletions". Obsidian's `workspace*.json` is here for a
 *  smaller reason — it churns on every pane you open, so it turns an
 *  unattended hourly sync into a stream of empty commits. */
const BASE_RULES = [".trash/", ".obsidian/workspace.json", ".obsidian/workspace-mobile.json"];

/** Compare ignore rules the way git roughly does for a plain path: ignore
 *  surrounding whitespace, a leading `/`, and a trailing `/`. */
function ruleKey(line: string): string {
  return line.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function hasRule(body: string, rule: string): boolean {
  const want = ruleKey(rule);
  return body.split("\n").some((line) => ruleKey(line) === want);
}

/** The vault's own .gitignore. Creates it when the vault has none, and APPENDS
 *  the instance-data rule when one already exists without it.
 *
 *  Both halves matter, and the second is the one that was missing. This used
 *  to run only inside `if (not a repo yet)` and to return early on an existing
 *  file — so the two commonest real vaults, "already a git repository" and
 *  "already has a .gitignore", got no rule at all, and a VELLUM_DATA pointed
 *  inside the vault was then committed and PUSHED by `git add -A`, token file
 *  and all. It is idempotent: nothing is written when the rule is already
 *  there (by exact line, or as a broader pattern check-ignore honours). */
function seedGitignore(): void {
  const vault = getVaultRoot();
  const file = path.join(vault, ".gitignore");
  const rel = dataDirInsideVault();
  const dataRule = rel === null ? null : `${rel}/`;
  if (!existsSync(file)) {
    const lines = ["# Written by Vellum on first sync. Edit freely.", ...BASE_RULES, ".DS_Store"];
    if (dataRule !== null) lines.push("", IGNORE_HEADER, dataRule);
    writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
    return;
  }
  let body: string;
  try {
    body = readFileSync(file, "utf8");
  } catch {
    return; // unreadable .gitignore: syncNow()'s check-ignore gate still refuses
  }
  // THE APPEND PATH RUNS FOR EVERY VAULT, not only for one whose VELLUM_DATA
  // sits inside it. It used to bail here — `if (rel === null) return;` — and
  // rel is null in the DEFAULT arrangement (data/ next to the app), so on the
  // two commonest real vaults, "already a git repository" and "already has a
  // .gitignore", `.trash/` was never ignored and every deletion was pushed.
  const missing = BASE_RULES.filter((rule) => !hasRule(body, rule));
  const needsData = dataRule !== null && !hasRule(body, dataRule);
  if (missing.length === 0 && !needsData) return;
  const parts: string[] = [];
  if (missing.length > 0) parts.push("", TRASH_HEADER, ...missing);
  if (needsData) parts.push("", IGNORE_HEADER, dataRule as string);
  const sep = body === "" || body.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${body}${sep}${parts.join("\n")}\n`, "utf8");
}

/** The ONE call that stages the work tree. Nothing else in this module may run
 *  `git add`.
 *
 *  `.trash/` and — when it sits inside the vault — VELLUM_DATA are evicted
 *  from the INDEX after the add, not merely ignored before it, and that
 *  distinction is the whole fix. An ignore rule is the vault's opinion; this
 *  has to be a guarantee. seedGitignore() below still appends `.trash/` to the
 *  vault's own .gitignore — worth doing so a terminal `git status` is quiet
 *  too — but it cannot be the mechanism, because any rule-level check reads a
 *  vault whose .gitignore already carries a `.trash/` line as "already
 *  covered", and a later `!.trash/` in that same file then wins: git's LAST
 *  matching rule decides. Measured on exactly that file (`.trash/` then
 *  `!.trash/`), the rule-based build committed `.trash/guides/…` and would
 *  have pushed it. `git rm --cached` asks nothing of any ignore file, so no
 *  line in a .gitignore, in .git/info/exclude, or in the operator's global
 *  core.excludesFile can leave either path in the tree that gets committed.
 *
 *  It is also the same command that un-tracks what an OLDER build already
 *  committed, so the first sync after this change stages the removal — the
 *  trash stops being in the tip even on a repo that has been pushing it.
 *  `--ignore-unmatch` keeps it silent in the normal case, where neither path
 *  was ever in the index. */
async function stageAll(): Promise<void> {
  await git(["add", "-A"]);
  const paths = [TRASH_DIR];
  const rel = dataDirInsideVault();
  if (rel !== null) paths.push(rel);
  await gitTry(["rm", "-r", "--cached", "--ignore-unmatch", "-q", "--", ...paths]);
}

/** Refuse to stage anything while VELLUM_DATA is inside the vault and not
 *  ignored — and un-track it if a previous run already committed it.
 *
 *  This is the module's central promise ("the token never reaches the repo")
 *  enforced at the last possible moment, against git's own answer rather than
 *  against our belief about a file we wrote. `check-ignore` exits 0 when the
 *  path is ignored, non-zero (→ null through gitTry) when it is not. */
async function protectDataDir(): Promise<void> {
  // UNCONDITIONAL, and first: the .gitignore rules below apply to every vault,
  // and this function is the only thing standing between the working tree and
  // `git add -A`. Gating the seed on "is VELLUM_DATA inside the vault?" is
  // what left `.trash/` unignored on the default arrangement.
  seedGitignore();
  // Un-track a trash that an earlier build already committed — the same
  // repair, for the same reason, as the data-directory eviction below. Without
  // it a .gitignore rule changes nothing: git keeps tracking what it tracks.
  await gitTry(["rm", "-r", "--cached", "--ignore-unmatch", "-q", "--", TRASH_DIR]);
  const rel = dataDirInsideVault();
  if (rel === null) return; // VELLUM_DATA lives outside the vault: nothing more to do
  // EVICT FIRST. A file git already tracks stays tracked through every
  // .gitignore in the world, and this is the state a vault reaches when an
  // older build committed the data directory before it was ignored.
  // --ignore-unmatch keeps it quiet on the normal never-tracked case.
  await gitTry(["rm", "-r", "--cached", "--ignore-unmatch", "-q", "--", rel]);
  // ...and only then ask. `--no-index` is load-bearing: without it check-ignore
  // answers "not ignored" for anything in the index — the exact case above —
  // so the rule-based answer is the one to gate on.
  if ((await gitTry(["check-ignore", "-q", "--no-index", "--", rel])) === null) {
    throw new VaultError(
      400,
      `Refusing to sync: the instance data directory "${rel}" is inside the vault and is not ignored by git. ` +
        "It holds this instance's credentials. Add it to .gitignore, or point VELLUM_DATA outside the vault.",
    );
  }
}

/** Make the vault a git repository (if it is not one already) and point
 *  `origin` at the configured remote. Idempotent. */
export async function initRepo(): Promise<GitSyncStatus> {
  if (busy) throw new VaultError(409, "A sync is already running");
  busy = true;
  try {
    const eff = gitSyncEffective();
    const branch = eff.branch;
    if ((await repoRoot()) === null) {
      try {
        await git(["init", "-b", branch]);
      } catch {
        // git < 2.28 has no -b.
        await git(["init"]);
        await git(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
      }
    }
    // UNCONDITIONAL, outside the "was not a repo" branch: a vault that is
    // already a git repository is the commonest thing an operator points this
    // at, and it used to get no .gitignore at all — so the very next `add -A`
    // committed VELLUM_DATA/git-credentials.json when VELLUM_DATA sits inside
    // the vault. seedGitignore() appends to an existing file and is a no-op
    // once the rule is there.
    //
    // protectDataDir() rather than seedGitignore() alone: "make this a repo"
    // is exactly when a vault damaged by an older build should be repaired,
    // and the eviction of an already-tracked `.trash/` (or VELLUM_DATA) only
    // happens here and in syncNow(). It is idempotent and runs again below
    // before the initial commit.
    await protectDataDir();
    if (eff.remote !== null) {
      const existing = await gitTry(["remote", "get-url", "origin"]);
      if (existing === null) await git(["remote", "add", "origin", eff.remote]);
      else if (existing.trim() !== eff.remote) await git(["remote", "set-url", "origin", eff.remote]);
    }
    // Initial commit, so the first sync has a history to push.
    const head = await gitTry(["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (head === null) {
      await protectDataDir(); // same gate as syncNow(): nothing is staged unguarded
      await stageAll();
      // `diff --cached --quiet` exits non-zero (→ null here) when something IS
      // staged; a clean index exits 0 and there is nothing to commit.
      if ((await gitTry(["diff", "--cached", "--quiet"])) === null) await commit();
    }
  } catch (err) {
    if (err instanceof VaultError) throw err;
    throw new VaultError(500, gitMessage(err));
  } finally {
    busy = false;
  }
  // Sampled after the flag clears, so the answer never reports itself as busy.
  return gitStatus();
}

/** A local commit and nothing else — no fetch, no merge, no push.
 *
 *  This is "Snapshot now" in the palette, and it is the move that makes the
 *  scary tools safe: the bulk editors (search & replace, tag rename) offer a
 *  snapshot before they run, and a reader about to try something is owed a
 *  point to come back to WITHOUT waiting on a network that may not be there.
 *  It is `syncNow()` with the two network halves removed, and it goes through
 *  exactly the same `protectDataDir()` → `stageAll()` gate, because the one
 *  thing that must never differ between the two paths is what gets committed.
 *
 *  It does NOT record `lastResult`: the badge's sentence answers "is my
 *  writing somewhere else yet", and a local commit is not an answer to that
 *  question. Nothing is pushed, so nothing about the remote has changed. */
export async function snapshotNow(): Promise<{ committed: boolean; sha: string | null }> {
  if (busy) throw new VaultError(409, "A sync is already running");
  busy = true;
  try {
    if ((await repoRoot()) === null) {
      throw new VaultError(400, "The vault is not a git repository yet — initialize it first");
    }
    await protectDataDir();
    await stageAll();
    // Non-zero exit (→ null through gitTry) means the index holds changes.
    if ((await gitTry(["diff", "--cached", "--quiet"])) !== null) return { committed: false, sha: null };
    await commit("snapshot");
    return { committed: true, sha: (await gitTry(["rev-parse", "--short", "HEAD"]))?.trim() ?? null };
  } catch (err) {
    if (err instanceof VaultError) throw err;
    throw new VaultError(500, gitMessage(err));
  } finally {
    busy = false;
  }
}

/** Commit the staged tree. Supplies a fallback identity only when the machine
 *  has none configured — otherwise the operator's own git identity is used.
 *
 *  The `kind` reaches the subject line, and therefore the history timeline the
 *  reader reads: "vellum snapshot: …" for a point somebody deliberately made
 *  before an edit they were unsure of, "vellum sync: …" for the unattended
 *  backup. One row of that list has to be findable a week later. */
async function commit(kind: "sync" | "snapshot" = "sync"): Promise<void> {
  const message = `vellum ${kind}: ${new Date().toISOString()}`;
  const email = await gitTry(["config", "--get", "user.email"]);
  const identity =
    email !== null && email.trim() !== ""
      ? []
      : ["-c", "user.name=Vellum", "-c", "user.email=vellum@localhost"];
  await git([...identity, "commit", "-m", message]);
}

// ---------------------------------------------------------------------- sync

export type SyncTrigger = "manual" | "timer";

/** One sync pass: (optional) fast-forward-only pull, stage everything, commit
 *  when there is something to commit, push.
 *
 *  DIVERGENCE FAILS. The pull is `fetch` + `merge --ff-only`, never `pull`:
 *  a merge that cannot fast-forward stops before it touches the work tree, so
 *  a diverged history can never leave conflict markers inside a note. The
 *  operator's own `pull.rebase` config cannot turn it into a rebase either,
 *  because no `git pull` runs at all. Nothing here ever force-pushes. */
export async function syncNow(trigger: SyncTrigger = "manual"): Promise<GitSyncStatus> {
  // Claim the lock in the SAME synchronous step as the check. Every await
  // below is a yield point, so a check that sat before the first `await`
  // (reading settings is cheap, but probing the repo is not) let four
  // concurrent clicks all walk past it and then fight over .git/index.lock.
  if (busy) throw new VaultError(409, "A sync is already running");
  busy = true;
  const startedAt = new Date().toISOString();
  let committed = false;
  let pushed = false;
  try {
    const eff = gitSyncEffective();
    if (eff.remote === null) throw new VaultError(400, "No git remote is configured");
    if ((await repoRoot()) === null) {
      throw new VaultError(400, "The vault is not a git repository yet — initialize it first");
    }
    const branch = eff.branch;
    const on = await currentBranch();
    if (on === null) {
      throw new VaultError(400, "The vault repository has a detached HEAD — check out a branch first");
    }
    if (on !== branch) {
      throw new VaultError(400, `The vault is on branch "${on}" but sync is configured for "${branch}"`);
    }

    // origin follows the setting, always with a credential-free URL.
    const existing = await gitTry(["remote", "get-url", "origin"]);
    if (existing === null) await git(["remote", "add", "origin", eff.remote]);
    else if (existing.trim() !== eff.remote) await git(["remote", "set-url", "origin", eff.remote]);

    if (eff.pullFirst) {
      const fetched = await gitTry(["fetch", "origin", branch], { network: true });
      if (fetched !== null) {
        // Nothing to merge into on a repo with no commits yet.
        const head = await gitTry(["rev-parse", "--verify", "--quiet", "HEAD"]);
        if (head !== null) {
          try {
            await git(["merge", "--ff-only", "FETCH_HEAD"]);
          } catch (err) {
            // --ff-only refuses before writing anything, but if some other
            // state left a merge in progress, back all the way out so no note
            // can be left holding conflict markers.
            if (existsSync(path.join(getVaultRoot(), ".git", "MERGE_HEAD"))) {
              await gitTry(["merge", "--abort"]);
            }
            throw new VaultError(
              409,
              `Remote history has diverged — pull refused (nothing was merged): ${gitMessage(err)}`,
            );
          }
        }
      }
    }

    // Before ANYTHING is staged: the instance data directory must be ignored
    // (and un-tracked if an older build already committed it), or this pass
    // refuses outright. stageAll() is one line below, and it excludes both
    // `.trash/` and VELLUM_DATA by pathspec regardless of what this vault's
    // own .gitignore says — the refusal here is the second lock, not the only
    // one.
    await protectDataDir();

    await stageAll();
    // Non-zero exit (→ null) means the index holds changes; a clean index
    // means this pass commits nothing, exactly as specified.
    if ((await gitTry(["diff", "--cached", "--quiet"])) === null) {
      await commit();
      committed = true;
    }

    // Does this push actually MOVE the remote? "Nothing to commit" and
    // "nothing to push" are different answers, and the very first sync after
    // "Make it a repo" is exactly where they part: init makes the first
    // commit, so this pass commits nothing and then uploads the whole vault.
    // Reporting "already up to date" there is the one sentence a reader
    // cannot check. Sampled BEFORE the push, against the remote-tracking ref
    // (fresh when pullFirst is on; possibly stale otherwise, which can only
    // over-report a push that did happen).
    const head = await gitTry(["rev-parse", "--verify", "--quiet", "HEAD"]);
    const tracked = await gitTry(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
    const remoteAdvanced =
      committed || tracked === null || (head !== null && tracked.trim() !== head.trim());

    await git(["push", "--set-upstream", "origin", branch], { network: true });
    pushed = true;

    // The commit this pass made, named. Read AFTER the commit (so `head`
    // above, sampled for the push comparison, is the wrong one when this pass
    // committed) and never fatal: a backup that worked must not be reported as
    // a failure because `rev-parse` did — hence gitTry, and hence the `?`.
    const sha = committed
      ? ((await gitTry(["rev-parse", "--short", "HEAD"]))?.trim() ?? undefined)
      : undefined;

    lastResult = {
      at: startedAt,
      ok: true,
      message: committed
        ? "Committed and pushed"
        : remoteAdvanced
          ? "Pushed — nothing new to commit"
          : "Nothing to commit — already up to date",
      committed,
      pushed,
      remoteAdvanced,
      sha,
    };
    loggedFailure = null;
  } catch (err) {
    const message = err instanceof VaultError ? err.message : gitMessage(err);
    lastResult = { at: startedAt, ok: false, message, committed, pushed };
    if (trigger === "timer") {
      // Log a repeated failure ONCE — a broken remote must not fill the log
      // with one identical line per tick, forever.
      if (loggedFailure !== message) {
        console.error(`vellum: scheduled git sync failed — ${message} (further identical failures stay quiet)`);
        loggedFailure = message;
      }
    } else {
      console.error(`vellum: git sync failed — ${message}`);
    }
    if (err instanceof VaultError) throw err;
    throw new VaultError(500, message);
  } finally {
    busy = false;
  }
  // Sampled after the flag clears, so a successful pass never answers "busy".
  return gitStatus();
}

// --------------------------------------------------------------------- timer

const TICK_MS = 60_000;
let lastAttemptMs = 0;
let timer: NodeJS.Timeout | null = null;

/** Start the background scheduler. It ticks once a minute, does nothing at all
 *  unless sync is enabled with a remote and a non-zero interval, and skips
 *  every tick while a sync is already running. Settings are read live, so
 *  enabling/disabling from the panel takes effect without a restart. */
export function startGitSyncTimer(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    const eff = gitSyncEffective();
    if (!eff.enabled || eff.remote === null || eff.intervalMinutes <= 0) return;
    if (busy) return;
    const due = lastAttemptMs + eff.intervalMinutes * 60_000;
    if (Date.now() < due) return;
    lastAttemptMs = Date.now();
    void syncNow("timer").catch(() => {
      // syncNow already recorded and (once) logged the failure.
    });
  }, TICK_MS);
  // Never keep the process alive just to hold a timer.
  timer.unref?.();
}
