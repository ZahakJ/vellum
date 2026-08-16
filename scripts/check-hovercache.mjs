// Hover-card cache gate: prove the LRU bound holds in a real session.
//
//   node scripts/check-hovercache.mjs [http://localhost:6801]
//   (requires playwright; CHROMIUM=/usr/bin/chromium uses a system browser)
//
// A hover card is a rendered note body — a detached DOM tree, sometimes with
// figures and KaTeX in it. The cache that holds them is keyed by note path,
// so its natural ceiling is the vault: on a 1,388-note vault an evening of
// skimming links would retain every note skimmed, and on a 10k-note vault the
// whole thing. `CACHE_MAX` in client/hovercard.ts is the fix; this is the
// proof, because a bound that is only asserted by a constant is a bound that
// silently stops being true the next time the eviction code is touched.
//
// The test drives real pointer hovers over as many distinct post links as the
// site offers, then reads the cache size back through the read-only probe
// `window.__vellumHoverCardCacheSize`. It also watches the JS heap, since the
// failure mode it guards against is retention, not correctness.
//
// It needs a running instance with at least a handful of published posts —
// point it at the perf fixture, not the seed vault, or it will pass trivially
// by never filling the cache.

// The class under test is client TypeScript; Node runs it directly from
// 22.18 on (and from 22.6 with --experimental-strip-types). On an older
// runtime the browser half below still runs — say so rather than fail, since
// "your node is old" is not a bug in the cache.
let Lru = null;
try {
  ({ Lru } = await import("../client/lru.ts"));
} catch (err) {
  console.log(`check-hovercache: skipping the policy check (${String(err).split("\n")[0]})`);
}

// ── part 1: the eviction policy itself ──────────────────────────────────────
// Needs no browser and no fixture, and is the half that actually exercises
// eviction — a real vault may simply not publish enough notes to overflow a
// 24-entry cache in one sitting.
if (Lru) {
  let evicted = 0;
  const lru = new Lru({ max: 3, onEvict: () => evicted++ });
  const problems = [];
  for (let i = 0; i < 1000; i++) {
    lru.set(`k${i}`, i);
    if (lru.size > 3) problems.push(`size ${lru.size} after ${i + 1} sets`);
  }
  if (lru.size !== 3) problems.push(`final size ${lru.size}, want 3`);
  if (evicted !== 997) problems.push(`evicted ${evicted}, want 997`);
  if (lru.get("k999") !== 999) problems.push("most recent entry was evicted");
  if (lru.get("k0") !== undefined) problems.push("oldest entry survived 1000 inserts");

  // Recency, not insertion order: a hit must move a key back to the front.
  const r = new Lru({ max: 2 });
  r.set("a", 1);
  r.set("b", 2);
  r.get("a"); // "a" is now the most recently used
  r.set("c", 3); // must evict "b", not "a"
  if (r.get("a") !== 1) problems.push("a re-read entry was evicted before an untouched one");
  if (r.get("b") !== undefined) problems.push("the least recently used entry survived");

  // Replacing a key must not spend budget twice.
  const d = new Lru({ max: 2 });
  d.set("x", 1);
  d.set("x", 2);
  d.set("y", 3);
  if (d.get("x") !== 2) problems.push("re-setting a key evicted it");
  if (d.size !== 2) problems.push(`size ${d.size} after two distinct keys, want 2`);

  // TTL expires AND releases.
  const t = new Lru({ max: 10, ttlMs: 1 });
  t.set("old", 1);
  const until = Date.now() + 3;
  while (Date.now() < until) {
    /* spin briefly — shorter than any timer granularity worth awaiting */
  }
  if (t.get("old") !== undefined) problems.push("a stale entry was served");
  if (t.size !== 0) problems.push(`a stale entry stayed resident (size ${t.size})`);

  if (problems.length > 0) {
    console.error("check-hovercache: Lru policy is wrong:");
    for (const p of problems) console.error(`  FAIL  ${p}`);
    process.exit(1);
  }
  console.log("check-hovercache: Lru policy ok (bound, recency, replace, ttl release)");
}

// ── part 2: the bound in a real browsing session ────────────────────────────
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "check-hovercache: playwright is not installed.\n" +
      "  npm i -D playwright   (or set CHROMIUM=/path/to/chromium after installing the library)",
  );
  process.exit(1);
}

const base = (process.argv[2] || "http://localhost:6801").replace(/\/$/, "");
/** Must match CACHE_MAX in client/hovercard.ts. */
const CACHE_MAX = 24;

const executablePath = process.env.CHROMIUM;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));

let failed = false;
const fail = (msg) => {
  console.error(`  FAIL  ${msg}`);
  failed = true;
};

await page.goto(base, { waitUntil: "load" });
await page.waitForTimeout(1500);

const hasProbe = await page.evaluate(() => typeof window.__vellumHoverCardCacheSize === "function");
if (!hasProbe) {
  fail("no window.__vellumHoverCardCacheSize — hover cards are not installed on this page");
  console.error("        (run against a PUBLIC_LAYOUT=blog instance; the blog shell installs them)");
  await browser.close();
  process.exit(1);
}

// Every distinct internal link the home page offers. Hovering the same link
// twice would prove nothing — the point is DISTINCT keys.
const links = await page.$$eval("a[href^='/']", (as) =>
  [...new Set(as.filter((a) => a.getAttribute("aria-hidden") !== "true").map((a) => a.getAttribute("href")))]
    .filter((h) => h && h !== "/" && !h.startsWith("/topic/") && !h.startsWith("/api/") && !h.startsWith("/feed")),
);
console.log(`check-hovercache: ${links.length} distinct note links on ${base}/`);
if (links.length < 4) {
  fail(`only ${links.length} previewable links — point this at a vault with published posts`);
  await browser.close();
  process.exit(1);
}

const heapBefore = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));

// Hover each link long enough to open a card (OPEN_MS is 350ms), several
// times around, so the cache is asked to hold far more than its bound.
const ROUNDS = Math.max(3, Math.ceil((CACHE_MAX * 3) / links.length));
let opened = 0;
const openedPaths = new Set();
for (let round = 0; round < ROUNDS; round++) {
  for (const href of links) {
    const el = await page.$(`a[href="${href.replace(/"/g, '\\"')}"]`);
    if (!el) continue;
    try {
      // Scroll FIRST and settle. A card dismisses on scroll (by design — a
      // popover anchored to a moving link is worse than no popover), so
      // hovering a link that is still scrolling into view opens nothing.
      await el.scrollIntoViewIfNeeded({ timeout: 1500 });
      await page.waitForTimeout(180);
      await el.hover({ timeout: 1500 });
    } catch {
      continue; // covered or detached; the next one will do
    }
    await page.waitForTimeout(430);
    if (await page.$(".s-hovercard")) {
      opened++;
      openedPaths.add(href);
    }
    await page.mouse.move(5, 5);
    await page.waitForTimeout(60);
  }
}

const size = await page.evaluate(() => window.__vellumHoverCardCacheSize());
const heapAfter = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));

const expected = Math.min(CACHE_MAX, openedPaths.size);
console.log(`  cards opened            ${opened} (over ${ROUNDS} rounds of ${links.length} links)`);
console.log(`  distinct notes previewed ${openedPaths.size}`);
console.log(`  retained cache entries  ${size}   (bound ${CACHE_MAX}, expected ${expected})`);
if (heapBefore) {
  console.log(
    `  JS heap                 ${(heapBefore / 1048576).toFixed(1)} MB → ${(heapAfter / 1048576).toFixed(1)} MB`,
  );
}

if (opened === 0) fail("no hover card ever opened — the test proved nothing");
// The bound itself.
if (size > CACHE_MAX) fail(`cache holds ${size} entries, bound is ${CACHE_MAX}`);
// …and that it is a CACHE, not a coincidence: every distinct note previewed
// (up to the bound) must still be there. A cache that silently stopped
// retaining would also satisfy "size <= 24", and would be a different bug.
if (size < expected) {
  fail(`cache holds ${size} of the ${openedPaths.size} distinct notes previewed — retention is broken`);
}
// A run that never gets near the bound cannot demonstrate eviction. Say so
// rather than pass quietly: it means the fixture is too small for this test.
if (openedPaths.size <= CACHE_MAX) {
  console.log(
    `  note: only ${openedPaths.size} distinct notes were previewable, so eviction was never exercised;\n` +
      `        run against a vault publishing more than ${CACHE_MAX} notes to test the eviction path.`,
  );
}

await browser.close();
console.log(failed ? "\nHOVER CACHE FAILED" : "\nHOVER CACHE OK — bounded and reached");
process.exit(failed ? 1 : 0);
