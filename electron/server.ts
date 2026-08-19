// The server, supervised.
//
// ── WHY A CHILD PROCESS AND NOT A FUNCTION CALL ─────────────────────────────
//
// The obvious refactor — pull `server/index.ts` apart into `createApp()` and
// `boot()` so the desktop can call it in-process — was considered and refused.
// `server/index.ts` is not a module with a `main()` bolted on; it is a SCRIPT,
// and the script is the contract:
//
//   · it parses argv and the environment (`resolveVaultRoot`);
//   · it seeds a fresh vault from `vault-seed/` before anything reads it;
//   · it `process.exit(1)`s on a `ConfigError`, printing the sentence that
//     fixes it and no stack trace, which is a deliberate product decision;
//   · it top-level-`await`s `initIndexer()`;
//   · it runs seven inits in an order `migrateSettings()` silently depends on
//     (after `initSite()`, before anything reads the merged settings view).
//
// A second caller of that sequence is a second thing to keep true. The web
// deployment — the actual product, the one people run — would then be paying,
// in drift, for a boot path only the desktop exercises. Spawning the script
// means the desktop runs the same code in the same order for the same reasons,
// and the day someone reorders those inits there is exactly one place it can
// go wrong.
//
// The cost is a process boundary, and this file is that boundary: spawn, learn
// the port, notice death, and stop.
//
// ── RUNNING IT AT ALL ───────────────────────────────────────────────────────
//
// `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, never `node`. A packaged
// app cannot assume the reader has Node installed — most readers of a desktop
// app do not — so the Node that runs the server is the one inside Electron.
// That is precisely what `electron/probe.ts` interrogates before we get here.

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portCandidates, rememberedPort, type Prefs } from "./prefs.ts";

/** Repo root — the directory holding `server/`, `dist/` and `vault-seed/`.
 *  In a package this is `resources/app`; in dev it is the clone. */
export const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

const SERVER_ENTRY = path.join(APP_ROOT, "server", "index.ts");

/** How long the child gets to print a port before we call it dead. A cold
 *  first index of a large vault is slow, and `initIndexer()` is awaited BEFORE
 *  `serve()` — so this is generous on purpose. It is a stuck-process timeout,
 *  not a performance budget. */
const BOOT_TIMEOUT_MS = 90_000;

export interface VaultServer {
  vault: string;
  port: number;
  origin: string;
  /** True when the vault did not get the port it had last time — the reader's
   *  stored theme, tabs and folds for this vault live on the OLD origin and
   *  are about to look lost. main.ts says so. */
  moved: boolean;
  child: ChildProcess;
  stop: () => void;
}

/** Can we bind this port on loopback? Asked by actually binding it, because
 *  every other way of asking is a guess. Racy by nature — something can take
 *  the port between this close and the child's listen — which is why the
 *  caller retries down the candidate list rather than trusting one answer. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/** The environment the server child is given.
 *
 *  Built explicitly rather than inherited-and-patched. The desktop app is its
 *  own deployment: a `.env` in the clone, or a `PUBLIC=false` left over in the
 *  reader's shell, must not be able to change what the desktop's server is —
 *  and the ones that decide who is admin are exactly the ones that would be
 *  most confusing to have arrive from somewhere else. Everything Vellum reads
 *  is stated here; everything else (PATH, HOME, LANG, the proxy variables) is
 *  inherited, because a child process still has to be able to reach a network
 *  and find a temp directory. */
/** Keys the DESKTOP owns whatever any .env says: where the server sits and
 *  which directories it reads are this process's decisions — a deployment's
 *  PORT is the one thing that must NOT follow it into a window, or opening the
 *  vault fights the deployment for its own socket. */
// Credential lives HERE, not in auth.ts, although auth mints it: the root
// tsconfig reaches this module (tests import childEnv), and auth.ts types
// against `electron` itself — a type-only import of Credential from auth
// dragged the whole electron type surface into a project that cannot resolve
// it. The interface describes what the server child is GIVEN, so the child's
// module is its natural home.
export interface Credential {
  /** The plaintext. In memory, in this process, for this launch. */
  password: string;
  /** What the server child is given as ADMIN_PASSWORD_HASH. */
  hash: string;
  /** What the server child is given as SESSION_SECRET. */
  secret: string;
}

const DESKTOP_OWNED = new Set(["PORT", "HOST", "VELLUM_VAULT", "VELLUM_DATA", "ELECTRON_RUN_AS_NODE"]);

/** Parse a deployment's `.env`, the same dialect `node --env-file` reads:
 *  KEY=value lines, `#` comments, optional single/double quotes. Total — a
 *  malformed line is skipped, never fatal, because refusing to open a vault
 *  over a stray line in somebody's .env is worse than missing that line. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2) ||
      (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function childEnv(
  vault: string,
  dataDir: string,
  port: number,
  credential: Credential,
  deployEnv: Record<string, string> | null = null,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Pure-Node mode: no Chromium, no app lifecycle, just the bundled Node.
  env.ELECTRON_RUN_AS_NODE = "1";
  env.VELLUM_VAULT = vault;
  env.VELLUM_DATA = dataDir;
  env.HOST = "127.0.0.1";
  env.PORT = String(port);
  env.SECURE_COOKIES = "0";
  if (deployEnv !== null) {
    // AN ENV-LINKED VAULT IS THE DEPLOYMENT, IN A WINDOW. The row's `data`
    // override shares the deployment's settings.json and comments — and then
    // this function used to hand the child a minted credential and
    // PUBLIC="false" on top, which quietly rebuilt a DIFFERENT site over the
    // same data: the owner's password refused (the hash was ours, not
    // theirs), the public layout gone ("opening public mode says everything
    // is private"), the site language ignored. The deployment's own .env
    // wins for everything identity-shaped; the desktop keeps only the keys
    // that place the process (DESKTOP_OWNED above).
    for (const [key, value] of Object.entries(deployEnv)) {
      if (!DESKTOP_OWNED.has(key)) env[key] = value;
    }
    return env;
  }
  // A vault the desktop discovered itself: the owner IS the admin, so the
  // window signs itself in with a credential minted for this launch, and
  // nothing is public. See electron/auth.ts for all four of these.
  env.PUBLIC = "false";
  env.ADMIN_PASSWORD_HASH = credential.hash;
  env.SESSION_SECRET = credential.secret;
  return env;
}

/** The message `server/index.ts` sends once it is actually listening. */
interface ListeningMessage {
  type: "vellum:listening";
  port: number;
}

function isListening(msg: unknown): msg is ListeningMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as { type?: unknown }).type === "vellum:listening" &&
    typeof (msg as { port?: unknown }).port === "number"
  );
}

export interface StartOptions {
  vault: string;
  dataDir: string;
  prefs: Prefs;
  credential: Credential;
  /** The deployment's own .env, for an env-linked vault. See childEnv. */
  deployEnv?: Record<string, string> | null;
  /** Called for every line the child writes, so the app's own console is the
   *  server's console. A desktop app that swallows its server's stderr is a
   *  desktop app nobody can debug. */
  onLog?: (line: string) => void;
  /** The child died after a successful boot. */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

/**
 * Start a server for one vault and resolve once it says it is listening.
 *
 * The port is NOT read from our own `PORT`: the child reports what it actually
 * bound. Those are the same number in every normal case and different in the
 * one that matters (a race lost between our probe and the child's listen),
 * and the origin the app then loads has to be the true one.
 */
export async function startVaultServer(opts: StartOptions): Promise<VaultServer> {
  const wanted = rememberedPort(opts.vault, opts.prefs);
  const candidates = portCandidates(opts.vault, opts.prefs);
  let lastError: unknown = null;

  for (const port of candidates) {
    if (!(await isPortFree(port))) continue;
    try {
      const started = await spawnOn(port, opts);
      return { ...started, moved: wanted !== 0 && started.port !== wanted };
    } catch (err) {
      // EADDRINUSE between the probe and the listen — the race this loop
      // exists for. Anything else is a real failure and stops here.
      if (!isAddressInUse(err)) throw err;
      lastError = err;
    }
  }
  throw new Error(
    `vellum: no free port for this vault between ${candidates[0] ?? "—"} and the end of the desktop range` +
      (lastError ? ` (last: ${String(lastError)})` : ""),
  );
}

function isAddressInUse(err: unknown): boolean {
  return typeof err === "object" && err !== null && /EADDRINUSE/.test(String((err as Error).message));
}

function spawnOn(port: number, opts: StartOptions): Promise<Omit<VaultServer, "moved">> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: APP_ROOT,
      env: childEnv(opts.vault, opts.dataDir, port, opts.credential, opts.deployEnv ?? null),
      // "ipc" is the whole handshake: it is what gives the child a
      // `process.send`, which is what `server/index.ts` guards its two additive
      // lines on, and it is what makes `process.on("disconnect")` fire in the
      // child when this process dies. A server outliving the app that started
      // it is a port held forever and a vault indexed by a ghost.
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    let settled = false;
    const stderrTail: string[] = [];

    const line = (chunk: Buffer): void => {
      const text = chunk.toString();
      if (stderrTail.length < 40) stderrTail.push(text);
      opts.onLog?.(text);
    };
    child.stdout?.on("data", line);
    child.stderr?.on("data", line);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`vellum: the server did not start within ${BOOT_TIMEOUT_MS / 1000}s`));
    }, BOOT_TIMEOUT_MS);

    child.on("message", (msg: unknown) => {
      if (settled || !isListening(msg)) return;
      settled = true;
      clearTimeout(timer);
      const bound = msg.port;
      resolve({
        vault: opts.vault,
        port: bound,
        origin: `http://127.0.0.1:${bound}`,
        child,
        stop: () => stopChild(child),
      });
    });

    child.on("exit", (code, signal) => {
      if (settled) {
        opts.onExit?.(code, signal);
        return;
      }
      settled = true;
      clearTimeout(timer);
      // `server/index.ts` exits 1 on a ConfigError having printed the sentence
      // that fixes it. Carrying stderr into the rejection is what puts that
      // sentence in the dialog instead of "the app could not start".
      reject(new Error(stderrTail.join("").trim() || `vellum: the server exited with code ${code ?? signal}`));
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Ask, then insist. `disconnect()` is what the child's `process.on
 *  ("disconnect")` handler is waiting for and is the clean path; SIGKILL after
 *  a grace period is for a child wedged inside a synchronous index rebuild,
 *  which is a real state this app can be quit in. */
function stopChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.disconnect();
  } catch {
    /* already disconnected */
  }
  child.kill("SIGTERM");
  const hard = setTimeout(() => child.kill("SIGKILL"), 3000);
  hard.unref();
  child.once("exit", () => clearTimeout(hard));
}
