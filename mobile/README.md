# Vellum for Android

A native APK that connects to **your** Vellum server. It is not a second Vellum;
it is a door onto the one you already run.

The app has exactly two screens of its own — a connection screen and a capture
sheet — and after the first of those it hands the whole display to your
instance, signed in, full screen, with its own session cookie. Everything you
know about Vellum on a laptop is the same here, because it *is* the same: the
responsive web client already handles coarse pointers, 44px targets, drawers and
RTL, and this ships none of it twice.

```
mobile/
  src/            the two screens — TypeScript, no framework, ~24 kB shipped
  android/        the Capacitor shell: four Java classes and the resources
  icons/          make-icons.mjs — the ✦ mark, rendered to every raster
  scripts/        build-apk.mjs — one command to a signed APK
  out/            finished APKs (gitignored)
```

---

## The architecture decision

**The phone is a client of the server. Git sync is the server's job.**

Vellum's server owns the vault and already does git backup and sync server-side
(`server/gitSync.ts`). So the phone holds no vault, no repository and no working
copy. It reads and writes through the same HTTP API the web client uses, over
the same session cookie, and every conflict question has the same answer it has
always had — the one the server gives.

Two other shapes were considered and rejected:

**On-device git via `isomorphic-git`.** A real vault clone on the phone, editing
offline, pushing later. Rejected because of what it does *next to a live
server*: the same vault would then have two writers with independent histories,
one of which spends most of its life asleep in a pocket. A week-old phone clone
that wakes up and pushes is a merge conflict inside somebody's prose, resolved
by a phone, at the worst possible moment. Vellum's own write path already refuses
stale saves with a precondition (`baseMtimeMs`) precisely because silent
divergence is the failure it will not accept; shipping a second full history
would have been that failure with a bow on it.

**`nodejs-mobile` — run the actual server on the phone.** Rejected on a fact,
not a preference: Vellum's `package.json` sets `engines.node >= 24`, and it means
it — unflagged TypeScript execution, `node:sqlite`, `--env-file-if-exists`. The
`nodejs-mobile` runtimes are years behind that, and the app would have needed a
fork of the server that is allowed to be older than the server. One vault, one
server, one version.

What that leaves is a shell, and a shell has one interesting decision in it:

**The one host it may open is chosen at run time, so the gate is at run time
too.** Capacitor's `server.allowNavigation` is a build-time list; for an app
whose server is whatever its owner typed, the only value that would work there is
`"*"`, which is the same as no gate. Instead the shell leaves that setting off
entirely and implements `VellumPlugin.shouldOverrideLoad` — the hook Capacitor
consults before every navigation. It says yes to exactly one scheme + host +
port, the one that was verified and saved, and lets Capacitor's default (open it
in the browser) have every other link in your notes.

### How the pieces fit

| Piece | Where | What it does |
| --- | --- | --- |
| Connection screen | `src/connect.ts` | Takes an address, verifies it with `GET /api/me`, remembers it, hands over the WebView |
| Capture sheet | `src/capture.ts` | "Share to Vellum" from any app → a bullet in `Inbox/YYYY-MM-DD.md` |
| `VellumPlugin` | `android/…/VellumPlugin.java` | The navigation gate, the share Intent, the trusted-host store |
| `MainActivity` | `android/…/MainActivity.java` | Back = history back; leaves only from the connection screen |
| `ShareActivity` | `android/…/ShareActivity.java` | The share target, in its own task so a capture never costs you your place |
| `SystemBarInsets` | `android/…/SystemBarInsets.java` | Keeps the status bar and the gesture bar off the page, on both activities |

**Why every network call goes through `CapacitorHttp` and not `fetch`.** The
connection screen is served from `https://localhost`; your vault is on your own
host. That is cross-origin, and Vellum's server ships no CORS headers — correctly,
since its API is not for other people's pages. `CapacitorHttp` performs the
request natively, so there is no preflight to fail, and Capacitor installs its
cookie manager over the WebView's own store, so the `vellum_session` cookie your
instance set when you signed in rides along on the capture sheet's write.

**Why the shell pads for the system bars instead of letting the page do it.**
Android 15 draws every window edge to edge, and Android 16 does it whether the
app asked or not: the status bar and the gesture bar become glass over the top
and bottom of the WebView. Capacitor 8 ships a handler for this, and it decides
between padding the WebView's container and passing the insets to the page as
`env(safe-area-inset-*)` on two facts — the WebView's major version, and whether
the loaded page declared `viewport-fit=cover`. This app cannot answer either
one. Nearly every page it shows belongs to your instance, on your origin, and
Capacitor only injects the script that reads that second fact into *its own*
origin — so on your vault the flag is a leftover reading from the connection
screen, and a phone with a current WebView hands the insets to CSS that was
never told about them. The symptom is the vault's tab bar sitting under the
notification bar, on a new phone, invisibly to an emulator with an older WebView.

So `insetsHandling` is `disable` in `capacitor.config.ts` and
`SystemBarInsets.java` pads unconditionally: status bar plus display cutout on
top, navigation bar below, the side insets in landscape, and the keyboard's own
inset in place of the bottom one when it opens — so the editor resizes rather
than being covered. The strips are painted iron-gall, the same ground as the
page. The bundled screens still carry `env(safe-area-inset-*)` in `styles.css`
as a second layer; because the native layer consumes the insets, those read zero,
and the two can never double up. What is deliberately *not* used is
`android:windowOptOutEdgeToEdge`, which is deprecated already and ignored from
API 36 — an escape hatch with an expiry date is a bug scheduled for later.

**Why the capture is an append with a precondition, and why it retries.** The
sheet reads today's inbox note, adds one timestamped bullet, and PUTs it back
with the read's `mtimeMs` as the write precondition. If the file moved
underneath — you were editing it on the laptop — the server answers 409 and the
sheet re-reads and re-appends, once. An append is the rare write where that is
safe to do automatically: the thing being added was not in the file either time.
The editor's own save cannot do this and does not.

---

## Building

Everything below is `npm run` from `mobile/`. The first run installs Gradle's
wrapper distribution, which takes a few minutes; after that a build is ~20s.

```sh
cd mobile
npm install

npm run typecheck      # the shell's TypeScript
npm run apk:debug      # → out/vellum-1.8.0-debug.apk
npm run apk:release    # → out/vellum-1.8.0-release.apk   (signed, if you have a key)
```

`apk:*` runs `vite build` → `cap sync android` → `gradlew assemble…` and copies
the result into `out/` with a name a human can read. It sets `JAVA_HOME` and
`ANDROID_HOME` itself, because on most machines the default `java` is newer than
the Android Gradle Plugin accepts and the failure says nothing about Java
versions. Override with `VELLUM_JAVA_HOME` / `ANDROID_HOME` if yours live
elsewhere.

Toolchain this was built against:

| | |
| --- | --- |
| Capacitor | 8.5.0 (`@capacitor/core`, `cli`, `android`) |
| Android Gradle Plugin | 8.13.0 |
| Gradle | 8.14.3 (via the wrapper) |
| compileSdk / targetSdk | 36 |
| minSdk | 24 (Android 7.0) |
| Build tools | 36.0.0 |
| JDK | 21 (Temurin 21.0.11+10) |

Android lint runs clean:

```sh
cd android && ./gradlew :app:lintDebug
```

Two lint warnings in `res/xml/network_security_config.xml` are silenced with
`tools:ignore` and an argument written at the site: this app permits cleartext
and trusts the user certificate store, because a self-hosted vault at
`http://192.168.1.24:5173` or behind a private CA is the case it exists for, and
it only ever talks to the one host its owner named.

### Changing the mark

```sh
npm run icons     # needs ImageMagick's `magick` on PATH
```

`icons/make-icons.mjs` draws the ✦ from a single path and writes every launcher
raster, the adaptive foreground, the themed-icon monochrome layer and the splash
vector. The same path is inlined in `src/dom.ts` for the on-screen wordmark — an
Android WebView cannot be trusted to have the `✦` character in a font, and a
wordmark that is a different shape on every phone is not a wordmark. Change the
path in one place and all four follow.

---

## Signing

The release build is signed with a key that lives **only on the release machine**.
`mobile/.gitignore` covers both files; both are `chmod 600`.

```sh
keytool -genkeypair -v \
  -keystore vellum-release.keystore \
  -alias vellum \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -storetype PKCS12 \
  -dname "CN=Vellum, OU=Vellum Mobile, O=Vellum"
```

Then `mobile/keystore.properties`, beside it:

```properties
storeFile=vellum-release.keystore
storePassword=…
keyAlias=vellum
keyPassword=…
```

`storePassword` and `keyPassword` are the same string: PKCS12 has no separate
per-entry password, and `keytool` will tell you so if you try. Gradle asks for
both anyway.

`android/app/build.gradle` declares the release `signingConfig` **only when
`keystore.properties` exists**, so a fresh clone still builds a debug APK; without
it, `apk:release` produces an unsigned APK and says so. Signing is v2 + v3, no v1
— v1 is for API 23 and below and this app's floor is 24, while v3 carries the
key-rotation lineage that makes replacing this key possible later without every
installed copy refusing the update.

> **Back up `vellum-release.keystore` and `keystore.properties` somewhere that is
> not this machine.** Android identifies an app by its signature. Lose this pair
> and no future build can ever update an installed copy — for a sideloaded APK
> there is no recovery path, only uninstall and start again.

---

## Sideloading

The APK is not on any store. Install it yourself:

**Over USB.** Enable Developer options → USB debugging on the phone, then:

```sh
~/Android/Sdk/platform-tools/adb install -r mobile/out/vellum-1.8.0-release.apk
```

`-r` reinstalls over an existing copy and keeps its data — as long as it was
signed with the same key.

**Without a cable.** Copy the `.apk` to the phone (Nextcloud, `adb push`, a USB
cable in file-transfer mode) and open it in the phone's file manager. Android
will ask permission to install unknown apps *for that file manager*; grant it,
install, and revoke it afterwards if you like.

Debug and release APKs are signed with different keys and cannot replace each
other. To go from one to the other, uninstall first.

## First run

1. Open Vellum. Type your server's address — `vellum.example.com`, or
   `192.168.1.24:5173`.
   A bare name is assumed to be `https`; an address on your own network
   (`10.x`, `192.168.x`, `172.16–31.x`, `100.64+`, `*.local`, `*.lan`,
   `localhost`) is assumed to be `http`. Typing the scheme always wins.
2. The app checks `GET /api/me` before it goes anywhere, so a typo is a sentence
   on this screen rather than a blank WebView.
3. It remembers what worked. Next launch it reconnects without a tap; the back
   gesture from the instance's first page brings you here to choose another, and
   back from here leaves.
4. Sign in on your instance's own login screen. The session cookie persists —
   your server gives it a seven-day sliding life, so an active writer never meets
   the login screen again.
5. Share a link or a selection from any app → **Capture to Vellum** → it lands as
   a timestamped bullet in `Inbox/YYYY-MM-DD.md`, creating the note and the
   folder if this is the day's first.

## What this app does not do

No camera, no location, no contacts, no storage, no analytics, no push. Its
manifest asks for `INTERNET` and nothing else. It has no offline mode — when the
server is unreachable, it says so and stops, because the alternative was a second
copy of your vault with its own opinions.
