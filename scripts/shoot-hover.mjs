// Dev harness (not shipped): regression for the editor's wikilink hover
// preview. It ASSERTS and exits 1 — this feature died silently once already.
//   node scripts/shoot-hover.mjs http://localhost:7041 /outdir
// env: CHROMIUM=/usr/bin/chromium
//      VELLUM_PASSWORD=<pw>  — only if the instance sets ADMIN_PASSWORD_HASH;
//      without an admin session no editor mounts and the script refuses,
//      loudly, instead of reporting a crashed browser.
//
// The case that matters is a note WITH FRONTMATTER. Previews shipped broken
// on notes carrying a block widget (the frontmatter card, $$ math, an image)
// because CodeMirror's `hoverTooltip` resolves the pointer with
// `posAtCoords`, which maps through the vertical line layout and drifts by
// whole lines once a widget is in the document; the drifted position landed
// on a line with no link, so no card opened. A bare note — no frontmatter, no
// math — is the one shape that kept working, so testing "a note" is not
// testing this, and testing ONE link is not either: the drift is a function
// of what sits above the line, so the first link on a page could work while
// the third was dead. The script therefore picks its subjects through the API
// (first line `---`, plus a non-embed [[wikilink]]) and requires EVERY
// visible link it hovers to open a card.
//
// It also requires every card to still be there a beat after it opened. The
// second way this feature died was subtler than not opening: the card opens
// small, GROWS over the motionless pointer when the excerpt arrives, and is
// then lifted back above the link — and the dismiss handler took the browser's
// boundary events at face value and closed it ~200ms in. A check that samples
// once, straight after the hover, sees a card and calls it working.
import { chromium } from "playwright";

const [url = "http://localhost:7041", out = "shots"] = process.argv.slice(2);
const SUBJECTS = 4;
const LINKS_PER_SUBJECT = 3;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
// ONE context for the whole run: `browser.newPage()` makes a fresh context
// every time, which would drop the session cookie the login below sets and
// send every subject back to being a visitor.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

const fail = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

// One page per subject, closed after it: a 1,158-image vault plus a loaded
// machine will OOM a single long-lived renderer ("Target crashed") halfway
// through, and a harness that dies mid-run reports nothing at all.
// A card is created before its excerpt exists and filled when /api/note
// answers. On localhost that gap is a couple of milliseconds and the card is
// full-size before it is ever positioned; over a real network it is hundreds,
// and the card grows AFTER it has been placed — over the pointer that summoned
// it, which is how it ended up dismissing itself. Holding the note endpoint
// back makes this run the shape every remote reader gets, instead of the one
// shape (a same-machine vault, an idle browser) where the bug hides.
const NOTE_LATENCY_MS = 250;
let slowNotes = false;
let page;
const newPage = async () => {
  if (page) await page.close().catch(() => {});
  page = await context.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  await page.route(/\/api\/note\b/, async (route) => {
    if (slowNotes) await new Promise((r) => setTimeout(r, NOTE_LATENCY_MS));
    await route.continue();
  });
  return page;
};
const card = () => page.locator(".cm-s-hovercard");
const open = async (path) => {
  await page.goto(`${url}/${path.replace(/\.md$/i, "").split("/").map(encodeURIComponent).join("/")}`, {
    waitUntil: "load",
  });
  await page.waitForTimeout(1400);
  // A rebuild during the run renames the lazy Editor chunk, and a cached
  // index.html then imports a URL that is 404 — the editor never mounts and
  // every check below fails for a reason that has nothing to do with hovering.
  if ((await page.locator(".cm-editor").count()) === 0) {
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1600);
  }
  // Wait for the rendered link count to stop moving. CodeMirror decorates only
  // the visible range, and on this vault the visible range keeps shifting for
  // a second or two while banner/embedded images load — sampling too early
  // finds 1 link in a note that has 14, and the run then "passes" on a third
  // of the evidence it was asked for.
  let last = -1;
  for (let i = 0; i < 6; i++) {
    const now = await page.locator(".cm-s-wikilink").count();
    if (now > 0 && now === last) break;
    last = now;
    await page.waitForTimeout(400);
  }
  // Counted before any scrolling: the frontmatter card sits at the top of the
  // document and CodeMirror drops it from the DOM once it scrolls away.
  const props = await page.locator(".cm-s-props").count();
  // Still too few to be worth testing? Page down until enough links are in the
  // document. How much of a note is visible on first paint depends on which of
  // its images have loaded, and a run that hovers one link is not the run this
  // script was written to be.
  for (let i = 0; i < 8; i++) {
    if ((await page.locator(".cm-s-wikilink").count()) >= LINKS_PER_SUBJECT) break;
    await page
      .locator(".cm-scroller")
      .first()
      .evaluate((el) => el.scrollBy(0, el.clientHeight * 0.8));
    await page.waitForTimeout(400);
  }
  return props;
};
const away = async () => {
  await page.mouse.move(8, 870);
  await page.waitForTimeout(250);
};
await newPage();

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(800);

// SAY WHICH SESSION THIS IS BEFORE MEASURING IT. This harness never logged in,
// so against an instance started WITH ADMIN_PASSWORD_HASH it browsed as a
// visitor: no editor mounts on an unpublished note, the `.cm-scroller`
// evaluate times out, and the run printed "browser died (TimeoutError…)" and
// "the browser crashed (memory?)" — a gate blaming the machine for a session
// it chose itself. It now signs in when it can (VELLUM_PASSWORD) and refuses
// with the real reason when it cannot.
const me = await page.evaluate(async () => await (await fetch("/api/me")).json());
if (!me.admin) {
  const password = process.env.VELLUM_PASSWORD ?? "";
  const res = password
    ? await page.evaluate(async (pw) => {
        const r = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        });
        return { status: r.status, body: await r.text() };
      }, password)
    : null;
  if (res && res.status === 200) {
    console.log("[shoot-hover] signed in with $VELLUM_PASSWORD");
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(800);
  } else {
    console.error(
      "[shoot-hover] this session is NOT an admin — no editor mounts, so there is nothing to hover.\n" +
        `  is this instance password-protected? /api/me says protected=${me.protected === true}, public=${me.public === true}.\n` +
        "  fix: point the script at an instance started without ADMIN_PASSWORD_HASH,\n" +
        "  or set VELLUM_PASSWORD=<the password> so this harness can sign in." +
        (res ? `\n  login attempt returned ${res.status}: ${res.body.slice(0, 120)}` : ""),
    );
    await browser.close();
    process.exit(1);
  }
}

const subjects = await page.evaluate(async (want) => {
  const tree = await (await fetch("/api/tree")).json();
  const paths = [];
  (function walk(node) {
    if (node.type === "file" && node.path.toLowerCase().endsWith(".md")) paths.push(node.path);
    for (const child of node.children ?? []) walk(child);
  })(tree);
  const found = [];
  for (const path of paths.slice(0, 400)) {
    if (found.length >= want) break;
    const note = await (await fetch(`/api/note?path=${encodeURIComponent(path)}`)).json();
    const body = note.content ?? "";
    if (!/^---\r?\n/.test(body)) continue;
    const body2 = body.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
    if (/(^|[^!])\[\[[^\]]+\]\]/.test(body2)) found.push(path);
  }
  return found;
}, SUBJECTS);

slowNotes = true; // the scan above reads hundreds of notes; don't hold those back

if (subjects.length === 0) {
  console.log("[shoot-hover] no note with frontmatter + a wikilink in this vault — nothing to test");
  await browser.close();
  process.exit(0);
}

let hovered = 0;
let opened = 0;
let survived = 0;
let shot = false;
let crashed = 0;
for (const path of subjects) {
  try {
    await newPage();
    const props = await open(path);
    console.log(`[subject] ${path}${props ? "" : "  (no frontmatter card rendered!)"}`);
    if (!props) check(false, "the subject renders a frontmatter card (else this proves nothing)", path);
    const links = page.locator(".cm-s-wikilink");
    const n = Math.min(await links.count(), LINKS_PER_SUBJECT);
    for (let i = 0; i < n; i++) {
      const link = links.nth(i);
      await link.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await link.hover();
      await page.waitForTimeout(700);
      const ok = (await card().count()) > 0;
      hovered++;
      if (ok) opened++;
      else console.log(`    dead link #${i + 1}: ${JSON.stringify((await link.innerText()).slice(0, 40))}`);
      if (ok) {
        // The pointer has not moved. Nothing may take the card away.
        await page.waitForTimeout(900);
        if ((await card().count()) > 0) survived++;
        else {
          console.log(
            `    card #${i + 1} dismissed itself under a resting pointer: ${JSON.stringify((await link.innerText()).slice(0, 40))}`,
          );
        }
      }
      if (ok && !shot && (await card().count()) > 0) {
        await page.screenshot({ path: `${out}/hover-frontmatter.png` });
        shot = true;
        check(
          (await page.locator(".cm-s-hovercard__title").first().innerText()).trim().length > 0,
          "the card names the target note",
        );
        check(
          (await page.locator(".cm-s-hovercard__body").first().innerText()).trim().length > 0,
          "the card carries an excerpt",
        );
      }
      await away();
    }
  } catch (err) {
    // A dead renderer is inconclusive, not a pass: counted and reported.
    crashed++;
    console.log(`  SKIP  ${path} — browser died (${String(err).split("\n")[0].slice(0, 80)})`);
  }
}
if (crashed) console.log(`[shoot-hover] ${crashed} subject(s) skipped: the browser crashed (memory?)`);

check(hovered >= 3, "enough links to be worth calling a test", `${hovered} hovered`);
check(opened === hovered, "every hovered wikilink opened a card", `${opened}/${hovered}`);
check(
  survived === opened,
  "every card was still open a second later (the pointer never moved)",
  `${survived}/${opened}`,
);

// Dismissal and the false-positive guard, on the last surviving page.
const link = page.locator(".cm-s-wikilink").first();
if ((await link.count()) > 0) {
  await link.scrollIntoViewIfNeeded();
  await link.hover();
  await page.waitForTimeout(700);
  const was = (await card().count()) > 0;
  const box = await link.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height * 4, { steps: 6 });
  await page.waitForTimeout(600);
  check(was && (await card().count()) === 0, "moving off the link dismisses the card");
  // Prose two lines below the link is not a link.
  await page.mouse.move(box.x + 30, box.y + box.height * 2 + 4, { steps: 4 });
  await page.waitForTimeout(700);
  check((await card().count()) === 0, "resting on plain prose opens nothing");
}

await browser.close();
if (fail.length) {
  console.error(`\n[shoot-hover] ${fail.length} check(s) failed:\n  - ${fail.join("\n  - ")}`);
  process.exit(1);
}
console.log("\n[shoot-hover] all checks passed.");
