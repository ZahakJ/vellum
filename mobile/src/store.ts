import { Preferences } from "@capacitor/preferences";

/**
 * The saved server list — the phone's answer to the desktop app's vault list.
 *
 * Capacitor Preferences (SharedPreferences underneath) rather than
 * localStorage, for one reason that matters: the NATIVE side reads the same
 * store. `VellumPlugin` needs the trusted host on pages where no bridge exists,
 * and the capture sheet needs the base URL before any WebView has loaded the
 * server. A value only the WebView can see would not have been enough.
 */
export interface SavedServer {
  /** Normalized origin, no trailing slash: "https://vellum.example.com". */
  url: string;
  /** The instance's own `siteName` from /api/me, or its host if it has none. */
  name: string;
  /** Epoch ms of the last successful connection — the list's sort order. */
  usedAt: number;
}

const SERVERS = "servers";

/** ALSO WRITTEN BY JAVA (VellumPlugin.connect). Keep the key and the shape —
 *  a bare origin string — in step with `VellumPlugin.KEY_LAST_SERVER`. */
const LAST_SERVER = "lastServer";

export async function loadServers(): Promise<SavedServer[]> {
  const { value } = await Preferences.get({ key: SERVERS });
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    // Hand-validated rather than trusted: this store survives app upgrades, and
    // a half-written entry must not be able to blank the whole screen.
    return parsed
      .filter((s): s is SavedServer =>
        typeof s === "object" && s !== null &&
        typeof (s as SavedServer).url === "string" &&
        typeof (s as SavedServer).name === "string")
      .map((s) => ({ url: s.url, name: s.name, usedAt: Number(s.usedAt) || 0 }))
      .sort((a, b) => b.usedAt - a.usedAt);
  } catch {
    return [];
  }
}

export async function rememberServer(server: Omit<SavedServer, "usedAt">): Promise<void> {
  const others = (await loadServers()).filter((s) => s.url !== server.url);
  const next = [{ ...server, usedAt: Date.now() }, ...others];
  await Preferences.set({ key: SERVERS, value: JSON.stringify(next) });
}

export async function forgetServer(url: string): Promise<void> {
  const next = (await loadServers()).filter((s) => s.url !== url);
  await Preferences.set({ key: SERVERS, value: JSON.stringify(next) });
  if ((await lastServer()) === url) await Preferences.remove({ key: LAST_SERVER });
}

export async function lastServer(): Promise<string | null> {
  const { value } = await Preferences.get({ key: LAST_SERVER });
  return value ?? null;
}
