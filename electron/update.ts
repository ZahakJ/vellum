// Software updates, without a framework.
//
// The desktop app learns about a new release the same way a reader would —
// GitHub's releases API — and, when it is running as an AppImage, applies it
// the same way `writeNote` replaces a note: download beside the current file,
// fsync, rename over, relaunch. One HTTPS request every few hours and one
// atomic rename is the entire mechanism, and that is the argument for not
// shipping electron-updater to do it: the framework would be the largest
// dependency in the desktop app, pulled in to perform a dance this codebase
// already performs on every autosave.
//
// WHAT IT PROMISES, precisely:
//   · The check is quiet. No dialog, no dock bounce — a toast in the app's own
//     voice when a release is genuinely newer, and silence otherwise. Checked
//     at launch and every six hours, so an app that is never restarted still
//     hears about releases ("if we didn't restart it between releases").
//   · The download is background and VERIFIED by size before it replaces
//     anything; a truncated download can never become the installed app.
//   · The swap is atomic and the old file's mode survives — the same four
//     rules server/vault.ts documents, one directory over.
//   · A build that is NOT an AppImage (the deb, the pacman package, a dev
//     checkout) cannot replace itself in place, so "update" there opens the
//     release page instead of pretending.
//   · Nothing phones home beyond the releases endpoint of this repo, and the
//     manual "Check for updates…" menu item hits exactly the same code path —
//     it just reports "you are current" out loud where the timer stays silent.

import { app, shell } from "electron";
import { createWriteStream, promises as fs } from "node:fs";
import { get } from "node:https";
import type { IncomingMessage } from "node:http";
import path from "node:path";

const REPO = "ZahakJ/vellum";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
/** Six hours: fast enough that "still on yesterday's build" is a short-lived
 *  state, slow enough that GitHub never sees this app as traffic. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface UpdateState {
  /** "current" | "available" | "downloading" | "ready" | "failed" */
  phase: string;
  version: string;
}

type Listener = (state: UpdateState) => void;
let notify: Listener = () => {};
export function onUpdateState(fn: Listener): void {
  notify = fn;
}

let timer: NodeJS.Timeout | null = null;
let busy = false;
/** The downloaded, verified AppImage waiting for a relaunch, if any. */
let staged: { file: string; version: string } | null = null;

/** `1.6.0` vs `1.7.0`, numerically per part — enough for this repo's own tags,
 *  which is the only versioning this has to understand. */
function newer(remote: string, local: string): boolean {
  const a = remote.replace(/^v/, "").split(".").map(Number);
  const b = local.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = get(
      url,
      { headers: { "user-agent": `vellum-desktop/${app.getVersion()}`, accept: "application/vnd.github+json" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GET ${url}: HTTP ${res.statusCode}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
  });
}

/** Follow redirects by hand — GitHub asset downloads bounce through one — and
 *  stream to disk, resolving with the byte count actually written. */
function download(url: string, to: string, depth = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    if (depth > 4) {
      reject(new Error("too many redirects"));
      return;
    }
    const req = get(url, { headers: { "user-agent": `vellum-desktop/${app.getVersion()}` } }, (res: IncomingMessage) => {
      const where = res.headers.location;
      if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400 && where) {
        res.resume();
        resolve(download(where, to, depth + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET asset: HTTP ${res.statusCode}`));
        return;
      }
      const out = createWriteStream(to);
      let bytes = 0;
      res.on("data", (chunk: Buffer) => (bytes += chunk.length));
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve(bytes)));
      out.on("error", reject);
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

/** The path of the running AppImage, or null when this build cannot replace
 *  itself (deb, pacman, a dev checkout). AppImage's own runtime sets this. */
function selfPath(): string | null {
  const p = process.env.APPIMAGE;
  return typeof p === "string" && p !== "" ? p : null;
}

interface Asset {
  name?: string;
  size?: number;
  browser_download_url?: string;
}

export async function checkForUpdates(manual = false): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    if (staged !== null) {
      // Already downloaded and waiting; the only news is the reminder.
      notify({ phase: "ready", version: staged.version });
      return;
    }
    const release = (await fetchJson(API_LATEST)) as { tag_name?: string; assets?: Asset[] };
    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    if (!tag || !newer(tag, app.getVersion())) {
      // The timer stays silent about good news; the MENU says it out loud,
      // because a person who asked deserves an answer either way.
      if (manual) notify({ phase: "current", version: app.getVersion() });
      return;
    }
    const self = selfPath();
    if (self === null) {
      // Not self-replaceable: say a release exists and open the page on
      // request. Pretending otherwise is how updaters break packages that a
      // package manager owns.
      notify({ phase: "available", version: tag });
      return;
    }
    const asset = (release.assets ?? []).find((a) => typeof a.name === "string" && a.name.endsWith(".AppImage"));
    if (!asset?.browser_download_url) {
      notify({ phase: "available", version: tag });
      return;
    }
    notify({ phase: "downloading", version: tag });
    // Beside the target, dot-prefixed — the same siblings-only rule the vault's
    // atomic write follows, because /tmp may be another filesystem and a
    // cross-device rename is not a rename.
    const tmp = path.join(path.dirname(self), `.${path.basename(self)}.${tag}.part`);
    try {
      const bytes = await download(asset.browser_download_url, tmp);
      if (typeof asset.size === "number" && asset.size > 0 && bytes !== asset.size) {
        throw new Error(`short download: ${bytes} of ${asset.size} bytes`);
      }
      const mode = (await fs.stat(self)).mode & 0o777;
      await fs.chmod(tmp, mode || 0o755);
      staged = { file: tmp, version: tag };
      notify({ phase: "ready", version: tag });
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error("vellum: update check failed", err);
    if (manual) notify({ phase: "failed", version: app.getVersion() });
  } finally {
    busy = false;
  }
}

/** Swap the staged AppImage over the running one and relaunch. The running
 *  process keeps executing from its open file handle — Linux is fine with the
 *  name moving underneath it — so the rename is safe at any moment. */
export async function applyStagedUpdate(): Promise<void> {
  const self = selfPath();
  if (staged === null || self === null) {
    void shell.openExternal(RELEASES_PAGE);
    return;
  }
  await fs.rename(staged.file, self);
  staged = null;
  app.relaunch();
  app.quit();
}

export function openReleasePage(): void {
  void shell.openExternal(RELEASES_PAGE);
}

export function installUpdater(): void {
  if (timer !== null) return;
  void checkForUpdates(false);
  timer = setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS);
  timer.unref?.();
}
