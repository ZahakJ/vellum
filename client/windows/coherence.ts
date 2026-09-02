// Making several windows of one vault behave like one application.
//
// Installed once by the app shell. It owns the bus's lifetime and translates
// the four things a peer can tell us into the things this window already knows
// how to do — nothing here reimplements state, it only routes.
//
// What it deliberately does NOT do is mirror the document as it is typed. A
// full-text broadcast on every keystroke is a real cost with no bound, and
// inside one window a second pane already reads the same buffer and is
// character-live for free. Across windows the peer updates when the writer
// SAVES — one autosave behind, which is exactly the quality of Obsidian's own
// linked preview, at none of the cost.

import { openBus, onBus, postBus } from "./bus.ts";
import { holdsLease, installLease, setLeaseListener } from "./lease.ts";
import { windowId } from "./identity.ts";
import { useStore } from "../state.ts";
import { rebaseFromPeer, setBufferWritable } from "../editor/bufferBridge.ts";

/** Guards the echo: applying a peer's theme must not re-broadcast it, or two
 *  windows ping-pong one preference forever. */
let applying = false;

export function installWindowCoherence(): () => void {
  const closeBus = openBus();
  // A lease that changed hands is only meaningful if the buffer hears about
  // it: this is the one line that turns "somebody else is typing" into "my
  // autosave is off and my pane says why".
  setLeaseListener((path) => setBufferWritable(path, holdsLease(path)));
  const closeLease = installLease();

  const off = onBus((msg) => {
    if (msg.t === "prefs") {
      applying = true;
      try {
        const store = useStore.getState();
        // Theme and language are DEVICE preferences, and a device with two
        // windows open is still one device. A reader who switches to parchment
        // in one window and finds iron-gall in the other has two apps, not one.
        if (msg.theme !== undefined && msg.theme !== store.theme) {
          store.setTheme(msg.theme as Parameters<typeof store.setTheme>[0]);
        }
        // The PREFERENCE, compared against the preference — see the bus's
        // note on `editorLang`. A null (follow the site) is a real value
        // here; only an absent field means "nothing about language".
        if (msg.editorLang !== undefined && msg.editorLang !== store.editorLangPref) {
          store.setEditorLang(msg.editorLang);
        }
      } finally {
        applying = false;
      }
    } else if (msg.t === "wrote") {
      // A peer saved this note. Re-base our own precondition to the mtime they
      // were handed, so our next save is not refused for a change we already
      // know about — and so the 409 stays a signal about somebody we have NOT
      // heard from (Obsidian, a git pull) rather than routine noise.
      rebaseFromPeer(msg.path, msg.mtimeMs);
    } else if (msg.t === "auth") {
      // Signing out is a barrier, not an event: a window that kept an admin
      // shell after another signed out would hold a tree it may no longer read
      // and offer writes the server will refuse.
      if (!msg.admin && useStore.getState().admin) void useStore.getState().logout();
    }
  });

  // Broadcast our own preference changes. Subscribed rather than wrapped
  // around the setters, so a preference changed from ANY surface — the palette,
  // the settings panel, the theme picker — travels without each of them
  // knowing that other windows exist.
  const unsub = useStore.subscribe((s, prev) => {
    if (applying) return;
    if (s.theme !== prev.theme) postBus({ t: "prefs", id: windowId, theme: s.theme });
    if (s.editorLangPref !== prev.editorLangPref) {
      postBus({ t: "prefs", id: windowId, editorLang: s.editorLangPref });
    }
    // PREVIEW IS NOT A SIGN-OUT. `admin` also flips false while this window
    // previews as a visitor (loadMe reports the server's word, which is
    // "visitor" for the preview), and broadcasting that as an auth event
    // made every peer window call logout() — which POSTs /api/logout, which
    // bumps the session epoch, which revokes EVERY session on EVERY device.
    // One "Preview as visitor" with a second tab open signed the owner out
    // of the web admin, the desktop app and the phone at once, and each of
    // them fell back to the site language as a visitor — the "my editor
    // language randomly went back to Arabic" report. The flag is set before
    // loadMe flips admin (state.ts::setPreviewVisitor), so it is a reliable
    // witness here.
    if (s.admin !== prev.admin && s.authReady && !s.previewVisitor) {
      postBus({ t: "auth", id: windowId, admin: s.admin });
    }
  });

  return () => {
    unsub();
    off();
    closeLease();
    closeBus();
  };
}

/** Announce a save so peers holding the same note can re-base. Called by the
 *  buffer registry, which is the only thing that knows a write landed. */
export function announceWrite(path: string, mtimeMs: number): void {
  postBus({ t: "wrote", id: windowId, path, mtimeMs });
}

/** Pop the open note out into its own window.
 *
 *  A real second window on the SAME origin, which is what makes all of the
 *  above work: `BroadcastChannel`, `localStorage` and the session cookie are
 *  all per-origin, so the new window shares the reader's theme, their session
 *  and this bus without being told anything. */
export function popOutNote(path: string): void {
  const url = new URL(location.href);
  url.pathname = `/${path.replace(/\.(md|tex|latex)$/i, "")}`;
  // `noopener` would sever `window.opener`, which we do not use — but it also
  // makes some browsers open a TAB rather than a window, and the point here is
  // a window. The features string is what asks for one.
  window.open(url.toString(), `vellum:${path}`, "popup=yes,width=900,height=1000");
}
