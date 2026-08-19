// The desktop app's pure spine.
//
// The Electron half of `electron/` cannot be driven here — there is no browser
// process under `node --test`, and installing Electron to run the test suite is
// exactly the cost `desktop/` being its own npm project exists to avoid. So the
// parts with a decision in them are written as pure modules and proved here,
// and what is left in the Electron-facing files is wiring:
//
//   electron/deeplink.ts  what a `vellum://` link and a double-clicked file are
//                         ALLOWED to name. Hostile input; the refusals are the
//                         product.
//   electron/prefs.ts     the port a vault gets, which decides whether the
//                         reader's theme, tabs and folds survive a launch.
//   electron/cookie.ts    the session lifetime, read off the wire instead of
//                         copied out of server/auth.ts.
//   electron/ipc.ts       the bridge's vocabulary (also counted by
//                         `npm run check-desktop`).
//
// Root `npm run typecheck` follows these imports in, which is the second half
// of why they are pure: the desktop's spine is typechecked by the release gate
// every contributor already runs, even though `electron/` is not in the root
// tsconfig's `include`.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  containsFile,
  knownVault,
  noteRef,
  parseDeepLink,
  relativeNote,
  routeForNote,
  vaultForFile,
} from "../electron/deeplink.ts";
import { TO_MAIN, TO_RENDERER, COMMANDS } from "../electron/ipc.ts";
import { parseSessionCookie } from "../electron/cookie.ts";
import { childEnv, parseEnvFile } from "../electron/server.ts";
import {
  EMPTY_PREFS,
  MAX_RECENTS,
  PORT_MAX,
  PORT_MIN,
  forgetVault,
  onSomeDisplay,
  parsePrefs,
  portCandidates,
  recentVaults,
  rememberBounds,
  rememberVault,
  rememberedPort,
  seedFor,
  type Prefs,
} from "../electron/prefs.ts";

// ── Deep links: what a stranger's link may name ────────────────────────────

describe("noteRef", () => {
  it("accepts an ordinary vault-relative note", () => {
    assert.equal(noteRef("Ideas/Cache locality.md"), "Ideas/Cache locality.md");
    assert.equal(noteRef("./Ideas/Note.md"), "Ideas/Note.md");
    assert.equal(noteRef("notes\\Idea.md"), "notes/Idea.md");
  });

  it("refuses every shape of escape", () => {
    // A `vellum://` URL can be opened by any page in any browser with no
    // prompt. Each of these is a file outside the vault.
    for (const evil of [
      "../secrets.md",
      "../../etc/passwd.md",
      "a/../../b.md",
      "a/b/../../../c.md",
      "/etc/passwd.md",
      "\\\\server\\share\\note.md",
      "C:/Users/me/note.md",
      "notes\\..\\..\\out.md",
      "note.md\u0000.png",
    ]) {
      assert.equal(noteRef(evil), null, `should refuse ${JSON.stringify(evil)}`);
    }
  });

  it("refuses anything that is not a note", () => {
    // Not a purity rule — the app can open an attachment. It means nothing OFF
    // this machine gets to choose the file the app reads and indexes.
    assert.equal(noteRef("photo.png"), null);
    assert.equal(noteRef("archive.zip"), null);
    assert.equal(noteRef(".ssh/id_rsa"), null);
    assert.equal(noteRef(""), null);
    assert.equal(noteRef("."), null);
  });

  it("keeps the three note extensions the rest of the product agrees on", () => {
    assert.equal(noteRef("a.md"), "a.md");
    assert.equal(noteRef("a.tex"), "a.tex");
    assert.equal(noteRef("a.latex"), "a.latex");
  });
});

describe("parseDeepLink", () => {
  it("reads the two spellings a link in the wild actually has", () => {
    assert.deepEqual(parseDeepLink("vellum://note?path=Ideas/A.md"), {
      vault: null,
      note: "Ideas/A.md",
    });
    assert.deepEqual(parseDeepLink("vellum:///note?path=Ideas/A.md"), {
      vault: null,
      note: "Ideas/A.md",
    });
  });

  it("carries a vault and a note together", () => {
    const link = parseDeepLink("vellum://open?vault=/home/me/vault&note=A.md");
    assert.equal(link?.note, "A.md");
    assert.equal(link?.vault, path.normalize("/home/me/vault"));
  });

  it("refuses anything that is not a vellum link", () => {
    assert.equal(parseDeepLink("https://example.com/"), null);
    assert.equal(parseDeepLink("file:///etc/passwd"), null);
    assert.equal(parseDeepLink("not a url"), null);
    assert.equal(parseDeepLink("vellum://delete?path=A.md"), null);
    assert.equal(parseDeepLink("vellum://open"), null); // names nothing
  });

  it("drops a bad note but keeps a good vault", () => {
    const link = parseDeepLink("vellum://open?vault=/home/me/vault&note=../../x.md");
    assert.equal(link?.note, null);
    assert.equal(link?.vault, path.normalize("/home/me/vault"));
  });

  it("refuses a relative vault", () => {
    // An absolute path is the only kind that means one directory.
    assert.equal(parseDeepLink("vellum://open?vault=../../..")?.vault ?? null, null);
  });
});

describe("knownVault", () => {
  const known = [path.resolve("/home/me/notes"), path.resolve("/home/me/work")];

  it("honors a vault the reader has already opened", () => {
    assert.equal(knownVault(path.resolve("/home/me/notes"), known), known[0]);
    assert.equal(knownVault(path.resolve("/home/me/notes") + path.sep, known), known[0]);
  });

  it("refuses a directory nothing has opened", () => {
    // THE rule. Without it, `vellum://open?vault=/` is a link that makes the
    // app index and serve the reader's entire disk.
    assert.equal(knownVault("/", known), null);
    assert.equal(knownVault(path.resolve("/home/me"), known), null);
    assert.equal(knownVault(path.resolve("/home/me/notes/sub"), known), null);
  });
});

describe("file associations", () => {
  const vault = path.resolve("/home/me/notes");

  it("does not mistake a sibling for a child", () => {
    assert.equal(containsFile(vault, path.resolve("/home/me/notes-backup/A.md")), false);
    assert.equal(containsFile(vault, path.resolve("/home/me/notes/A.md")), true);
    assert.equal(containsFile(vault, vault), false);
  });

  it("resolves a file to its vault-relative note", () => {
    assert.equal(relativeNote(vault, path.resolve("/home/me/notes/Ideas/A.md")), "Ideas/A.md");
    assert.equal(relativeNote(vault, path.resolve("/home/me/other/A.md")), null);
  });

  it("picks the DEEPEST vault holding the file", () => {
    // A reader who opened both a vault and a sub-folder of it as vaults meant
    // the sub-folder when they double-clicked a file inside it.
    const vaults = [path.resolve("/home/me"), path.resolve("/home/me/notes")];
    assert.equal(vaultForFile(path.resolve("/home/me/notes/A.md"), vaults), vaults[1]);
    assert.equal(vaultForFile(path.resolve("/home/me/A.md"), vaults), vaults[0]);
    assert.equal(vaultForFile(path.resolve("/tmp/A.md"), vaults), null);
  });
});

describe("routeForNote", () => {
  it("spells a note exactly as the app's own address bar does", () => {
    // Not a stylistic agreement. A deep link that lands on `/Welcome.md` when
    // the router spells it `/Welcome` puts the reader on a URL the router
    // rewrites out from under them — and, in the tree-miss case, on a
    // different note.
    //
    // The expected values are `client/router.ts::notePathToUrl`'s, written out
    // rather than imported: that module reaches the store, the tree, the toast
    // host and a stylesheet, none of which loads under `node --test`. The two
    // implementations share the half that decides the answer
    // (`shared/noteFormat.ts::stripNoteExt`); this pins the other half.
    assert.equal(routeForNote("Welcome.md"), "/Welcome");
    assert.equal(routeForNote("Ideas/Cache locality.md"), "/Ideas/Cache%20locality");
    assert.equal(routeForNote("Paper.tex"), "/Paper");
    assert.equal(routeForNote("Notes/A & B.md"), "/Notes/A%20%26%20B");
    assert.equal(routeForNote("مقالة.md"), "/%D9%85%D9%82%D8%A7%D9%84%D8%A9");
  });
});

// ── Ports: the reader's theme, tabs and folds, in one integer ──────────────

function prefsWith(...vaults: { path: string; port: number }[]): Prefs {
  return {
    ...EMPTY_PREFS,
    vaults: vaults.map((v) => ({ path: v.path, port: v.port, bounds: null, lastOpened: 1 })),
  };
}

describe("portCandidates", () => {
  it("offers the remembered port FIRST", () => {
    // The whole point: `localStorage` is keyed by origin and the origin is the
    // port, so the port a vault had is the port its stored layout lives on.
    const prefs = prefsWith({ path: "/v/a", port: 6842 });
    assert.equal(portCandidates("/v/a", prefs)[0], 6842);
    assert.equal(rememberedPort("/v/a", prefs), 6842);
  });

  it("offers no remembered port for a vault it has never seen", () => {
    assert.equal(rememberedPort("/v/new", EMPTY_PREFS), 0);
  });

  it("covers the whole desktop band exactly once", () => {
    const list = portCandidates("/v/a", EMPTY_PREFS);
    assert.equal(list.length, PORT_MAX - PORT_MIN + 1);
    assert.equal(new Set(list).size, list.length);
    for (const port of list) assert.ok(port >= PORT_MIN && port <= PORT_MAX);
  });

  it("skips ports other vaults already own, and never its own twice", () => {
    const prefs = prefsWith(
      { path: "/v/a", port: 6842 },
      { path: "/v/b", port: 6843 },
      { path: "/v/c", port: 6844 },
    );
    const list = portCandidates("/v/a", prefs);
    assert.equal(list[0], 6842);
    assert.equal(list.filter((p) => p === 6842).length, 1);
    assert.ok(!list.includes(6843));
    assert.ok(!list.includes(6844));
  });

  it("seeds from the vault path, so the same vault lands on the same port", () => {
    // This is what makes a reinstall — or the same vault on a second machine —
    // keep its stored layout without the preferences file having survived.
    const first = portCandidates("/home/me/notes", EMPTY_PREFS)[0];
    const again = portCandidates("/home/me/notes", EMPTY_PREFS)[0];
    assert.equal(first, again);
    assert.notEqual(first, portCandidates("/home/me/work", EMPTY_PREFS)[0]);
    assert.equal(seedFor("/home/me/notes"), seedFor("/home/me/notes"));
  });

  it("never proposes 6801 — the web deployment's own port", () => {
    // Running `npm start` in a terminal beside the desktop app is the normal
    // case, not a conflict to arbitrate.
    for (const vault of ["/a", "/b", "/some/deep/vault", "/خزانة"]) {
      assert.ok(!portCandidates(vault, EMPTY_PREFS).includes(6801));
    }
  });
});

describe("parsePrefs", () => {
  it("survives anything at all", () => {
    for (const junk of [null, 42, "text", [], { vaults: "no" }, { vaults: [1, 2, null] }]) {
      const prefs = parsePrefs(junk);
      assert.deepEqual(prefs.vaults, []);
      assert.equal(prefs.spellcheck, true);
    }
  });

  it("drops a bad field rather than the whole document", () => {
    const prefs = parsePrefs({
      vaults: [
        { path: "/v/a", port: 6842, lastOpened: 5 },
        { port: 6843 }, // no path — meaningless
        { path: "/v/c", port: 99999 }, // outside the desktop band
        { path: "/v/a", port: 6844 }, // duplicate path
      ],
    });
    assert.deepEqual(prefs.vaults.map((v) => v.path), ["/v/a", "/v/c"]);
    assert.equal(prefs.vaults.find((v) => v.path === "/v/c")?.port, 0);
  });

  it("refuses window bounds that cannot be a window", () => {
    const sane = { x: 100, y: 80, width: 1280, height: 860, maximized: false };
    assert.deepEqual(parsePrefs({ vaults: [{ path: "/v", port: 6820, bounds: sane }] }).vaults[0].bounds, sane);
    for (const bad of [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 1e9, height: 800 },
      { x: NaN, y: 0, width: 800, height: 600 },
      { x: 0, y: 0, width: 800 },
      "nope",
    ]) {
      assert.equal(parsePrefs({ vaults: [{ path: "/v", port: 6820, bounds: bad }] }).vaults[0].bounds, null);
    }
  });

  it("keeps a NEGATIVE origin — a display to the left of the primary one", () => {
    const left = { x: -1400, y: 40, width: 1280, height: 860, maximized: false };
    assert.deepEqual(parsePrefs({ vaults: [{ path: "/v", port: 6820, bounds: left }] }).vaults[0].bounds, left);
  });
});

describe("the recent list", () => {
  it("moves an opened vault to the head and keeps its geometry", () => {
    const bounds = { x: 10, y: 10, width: 900, height: 700, maximized: false };
    let prefs = rememberVault(EMPTY_PREFS, "/v/a", 6842, 1);
    prefs = rememberBounds(prefs, "/v/a", bounds);
    prefs = rememberVault(prefs, "/v/b", 6843, 2);
    prefs = rememberVault(prefs, "/v/a", 6842, 3);
    assert.equal(prefs.vaults[0].path, "/v/a");
    assert.deepEqual(prefs.vaults[0].bounds, bounds);
    assert.equal(recentVaults(prefs)[0].path, "/v/a");
  });

  it("caps the list", () => {
    let prefs = EMPTY_PREFS;
    for (let i = 0; i < MAX_RECENTS + 5; i++) prefs = rememberVault(prefs, `/v/${i}`, 6820 + i, i);
    assert.equal(prefs.vaults.length, MAX_RECENTS);
  });

  it("does not invent a vault from a stale window's geometry", () => {
    const before = rememberVault(EMPTY_PREFS, "/v/a", 6842, 1);
    const after = rememberBounds(before, "/v/gone", { x: 0, y: 0, width: 900, height: 700, maximized: false });
    assert.deepEqual(after.vaults.map((v) => v.path), ["/v/a"]);
  });

  it("forgets a vault, port and geometry together", () => {
    const prefs = forgetVault(rememberVault(EMPTY_PREFS, "/v/a", 6842, 1), "/v/a");
    assert.deepEqual(prefs.vaults, []);
  });
});

describe("onSomeDisplay", () => {
  const primary = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const secondary = { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };

  it("restores a window that is still visible", () => {
    assert.equal(onSomeDisplay({ x: 100, y: 100, width: 1280, height: 860, maximized: false }, [primary]), true);
    assert.equal(onSomeDisplay({ x: -1800, y: 60, width: 1280, height: 860, maximized: false }, [primary, secondary]), true);
  });

  it("refuses a window on a monitor that has been unplugged", () => {
    // The failure this exists for: the app "does not start", while in fact it
    // is running perfectly, off the side of the desk.
    assert.equal(onSomeDisplay({ x: -1800, y: 60, width: 1280, height: 860, maximized: false }, [primary]), false);
    assert.equal(onSomeDisplay({ x: 4000, y: 0, width: 1280, height: 860, maximized: false }, [primary]), false);
  });

  it("accepts a window hanging off an edge, if there is enough to grab", () => {
    assert.equal(onSomeDisplay({ x: 1830, y: 40, width: 1280, height: 860, maximized: false }, [primary]), true);
    assert.equal(onSomeDisplay({ x: 1900, y: 40, width: 1280, height: 860, maximized: false }, [primary]), false);
  });
});

// ── The session, as the server states it ───────────────────────────────────

describe("parseSessionCookie", () => {
  it("reads the name, the value and the lifetime the SERVER chose", () => {
    const cookie = parseSessionCookie(
      "vellum_session=v2.1.1770000000000.abc; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
    );
    assert.equal(cookie?.name, "vellum_session");
    assert.equal(cookie?.value, "v2.1.1770000000000.abc");
    // 7 days, and nothing in electron/ says "7" anywhere.
    assert.equal(cookie?.maxAge, 604800);
  });

  it("does not care what the cookie is called", () => {
    assert.equal(parseSessionCookie("whatever=x; Max-Age=60")?.name, "whatever");
  });

  it("reports no lifetime rather than a wrong one", () => {
    assert.equal(parseSessionCookie("a=b; Path=/")?.maxAge, 0);
    assert.equal(parseSessionCookie("a=b; Max-Age=nonsense")?.maxAge, 0);
    assert.equal(parseSessionCookie("a=b; Max-Age=-1")?.maxAge, 0);
  });

  it("refuses a header that is not a cookie", () => {
    assert.equal(parseSessionCookie(""), null);
    assert.equal(parseSessionCookie("=novalue"), null);
    assert.equal(parseSessionCookie("noequals"), null);
  });
});

// ── The bridge's vocabulary ────────────────────────────────────────────────

describe("the IPC register", () => {
  it("names every channel exactly once, in one namespace", () => {
    const all = [...Object.values(TO_MAIN), ...Object.values(TO_RENDERER)];
    assert.equal(new Set(all).size, all.length, "a channel name is used twice");
    for (const channel of all) assert.match(channel, /^vellum:[a-z-]+$/);
  });

  it("has no command the menu could send that is not spelled here", () => {
    assert.equal(new Set(COMMANDS).size, COMMANDS.length);
    for (const command of COMMANDS) assert.match(command, /^[a-z-]+$/);
  });
});

describe("the data-dir override", () => {
  it("parses only an absolute path, and survives a round trip", () => {
    const prefs = parsePrefs({
      vaults: [
        { path: "/v/a", port: 6821, lastOpened: 5, data: "/srv/vellum-data" },
        { path: "/v/b", port: 6822, lastOpened: 4, data: "relative/nope" },
      ],
    });
    assert.equal(prefs.vaults[0].data, "/srv/vellum-data");
    assert.equal(prefs.vaults[1].data, undefined);
  });

  it("SURVIVES rememberVault, which rebuilds the row on every open", () => {
    // Without the carry, the override existed until the first launch: the
    // rewrite dropped it, the vault silently reverted to an empty per-app
    // home, and the desktop "lost" the reader's settings.
    let prefs = parsePrefs({
      vaults: [{ path: "/v/a", port: 6821, lastOpened: 5, data: "/srv/vellum-data" }],
    });
    prefs = rememberVault(prefs, "/v/a", 6823, 99);
    assert.equal(prefs.vaults[0].data, "/srv/vellum-data");
    assert.equal(prefs.vaults[0].port, 6823);
  });
});

describe("an env-linked vault is the deployment, in a window", () => {
  it("parses the .env dialect node --env-file reads, totally", () => {
    const env = parseEnvFile(
      [
        "# a comment",
        "PORT=8080",
        "SITE_NAME='Night Garden'",
        'ADMIN_PASSWORD_HASH="$argon2id$v=19$m=65536,t=3"',
        "  PUBLIC_LAYOUT = blog  ",
        "not a line",
        "lower=case is not a key",
        "",
      ].join("\n"),
    );
    assert.equal(env.SITE_NAME, "Night Garden");
    assert.equal(env.ADMIN_PASSWORD_HASH, "$argon2id$v=19$m=65536,t=3");
    assert.equal(env.PUBLIC_LAYOUT, "blog");
    assert.equal(env.lower, undefined);
  });

  it("the deployment's identity wins; the desktop keeps only placement", () => {
    const cred = { password: "minted", hash: "minted-hash", secret: "minted-secret" };
    const env = childEnv("/v", "/data", 6821, cred, {
      PORT: "8080",
      HOST: "0.0.0.0",
      ADMIN_PASSWORD_HASH: "owner-hash",
      SESSION_SECRET: "owner-secret",
      PUBLIC_LAYOUT: "blog",
      SITE_LANG: "ar",
    });
    // Identity is the deployment's: the owner's password works, the public
    // site is public, the site speaks its own language.
    assert.equal(env.ADMIN_PASSWORD_HASH, "owner-hash");
    assert.equal(env.SESSION_SECRET, "owner-secret");
    assert.equal(env.PUBLIC_LAYOUT, "blog");
    assert.equal(env.PUBLIC, undefined);
    // Placement is the desktop's: a deployment's PORT following it into a
    // window would fight the deployment for its own socket.
    assert.equal(env.PORT, "6821");
    assert.equal(env.HOST, "127.0.0.1");
  });

  it("without a linked deployment, the minted credential still rules", () => {
    const cred = { password: "minted", hash: "minted-hash", secret: "minted-secret" };
    const env = childEnv("/v", "/data", 6821, cred, null);
    assert.equal(env.ADMIN_PASSWORD_HASH, "minted-hash");
    assert.equal(env.PUBLIC, "false");
  });
});

