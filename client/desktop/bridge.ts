// The renderer's half of the desktop bridge: the shape of `window.vellumDesktop`
// and the one question worth asking before touching it.
//
// This file has NO import from "electron" and never will — `npm run
// check-desktop` asserts that about every file under `client/` and `server/`,
// because the moment one of them does, the web build stops building and the
// desktop app has quietly become the product rather than a wrapper around it.
// Everything here is plain data over the preload bridge (electron/preload.ts).

export interface SpellMenuPayload {
  word: string;
  suggestions: string[];
  x: number;
  y: number;
}

export interface FindResult {
  matches: number;
  active: number;
}

export interface DesktopHello {
  platform: string;
  vault: string;
  vaultName: string;
  pendingRoute: string | null;
  spellcheck: boolean;
  spellLanguages: string[];
}

export interface DesktopBridge {
  hello(): Promise<DesktopHello>;
  onCommand(cb: (command: string) => void): void;
  onSpellMenu(cb: (payload: SpellMenuPayload) => void): void;
  onFindResult(cb: (payload: FindResult) => void): void;
  onNavigate(cb: (route: string) => void): void;
  onOsTheme(cb: (dark: boolean) => void): void;
  spellReplace(text: string): Promise<void>;
  spellAdd(word: string): Promise<void>;
  updateApply(): Promise<void>;
  onUpdateState(cb: (payload: unknown) => void): void;
  findInPage(query: string, forward: boolean, again: boolean): Promise<void>;
  findStop(): Promise<void>;
  dragNote(rel: string): Promise<void>;
  openReference(route: string): Promise<void>;
}

declare global {
  interface Window {
    vellumDesktop?: DesktopBridge;
  }
}

/** Are we inside the desktop app?
 *
 *  Same test `client/components/ShortcutsHelp.tsx` already uses, and for the
 *  same reason it gives there: Electron stamps `Electron/<version>` into the
 *  user-agent and nothing else does, so the answer is false in every browser
 *  without anyone having to remember to set a build flag. Two spellings of
 *  "is this the desktop" would be one spelling too many. */
export const IS_DESKTOP =
  typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent);

/** The bridge, or null.
 *
 *  Null is a REAL state, not a defensive shrug: `IS_DESKTOP` can be true while
 *  the bridge is absent — an older desktop build loading a newer client, or a
 *  preload that failed to compile. Every caller here handles it by doing
 *  nothing at all, which leaves the browser's own behaviour in place. */
export function desktop(): DesktopBridge | null {
  return (typeof window !== "undefined" && window.vellumDesktop) || null;
}
