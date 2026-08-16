// GATE: no note ever hands a de-hashed TAG to a reader as prose.
//   node scripts/check-excerpt.mjs [http://localhost:6801]
//   env: VELLUM_PASSWORD=<pw>  — only if the instance sets ADMIN_PASSWORD_HASH
// Exits 1 on any miss. Run it like check-i18n / check-contrast / check-caret.
//
// WHAT IT PROVES. DESIGN.md's hard rule: no component may render raw markdown
// to the reader outside the editor — snippets STRIP or RENDER `#`. Removing
// the hash and leaving the word standing in the sentence is NEITHER, and it is
// what shipped: a post ending
//
//     …it buys the reader a breath. #design #typography
//
// printed on the front page as "…it buys the reader a breath. design
// typography" — two nouns glued to the end of a finished sentence, in the one
// place (a blog card) where the product is being judged by a stranger.
//
// The failure is a one-line regex in ONE shared helper (`stripInlineMd` in
// server/indexer.ts) that three reader-facing surfaces flow through, so the
// gate walks all three rather than the one that was reported:
//
//   · the post EXCERPT     → /api/posts        (blog cards, RSS, og:description)
//   · the search SNIPPET   → /api/search       (sidebar hits, blog search)
//   · the backlink CONTEXT → /api/backlinks    (the panel's context line)
//
// and it does it with a note whose body ENDS in a tag line, plus a tag at the
// end of an ordinary sentence — the two shapes a template writer actually
// produces, and the shapes where a stripper that only handles whole "Tags:"
// lines looks like it works.
//
// The fourth surface, the hover card, is deliberately not asserted here: it
// RENDERS its markdown (the other half of the rule), so its tags become pills
// and there is nothing to strip. scripts/shoot-hover.mjs owns that one.
//
// Two notes are written and both are deleted however the run ends — a gate
// that can leave fixtures behind in the vault it measures is a gate nobody
// runs twice.

const [url = "http://localhost:6801"] = process.argv.slice(2);

const GATE_PATH = "excerpt-gate.md";
const LINK_PATH = "excerpt-gate-link.md";

// The tag WORDS this gate hunts for. Each is a word that appears in the
// fixture ONLY as a tag, so finding it in prose can only mean one thing.
const TAG_WORDS = ["design", "typography", "kerning", "leading"];

const GATE_NOTE = `---
publish: true
date: 2026-01-02
tags: [excerptgate]
---

A paragraph does not need to earn its ending. When a sentence stops one clause
before the reader expects it to, it buys the reader a breath. #design #typography

Body text set solid reads as a wall; the second paragraph exists so a snippet
that windows the head of this note has somewhere to run on to, and so the cut
never lands on the tag line above. #kerning

#leading
`;

const LINK_NOTE = `---
publish: true
date: 2026-01-03
---

The backlink panel prints the line a link sits on, so the link and a tag share
one line here: [[excerpt-gate]] closes the thought. #design
`;

const fail = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

const api = async (path, init) => {
  const res = await fetch(`${url}/api${path}`, init);
  const body = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
};
const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// SAY WHICH SESSION THIS IS BEFORE MEASURING IT. This gate WRITES notes; a
// visitor session cannot, and a run that silently measured the vault's own
// notes instead would pass by not testing anything.
let me = await api("/me");
if (!me.admin) {
  const password = process.env.VELLUM_PASSWORD ?? "";
  const res = password
    ? await fetch(`${url}/api/login`, json("POST", { password })).catch(() => null)
    : null;
  const cookie = res?.headers.getSetCookie?.()[0] ?? res?.headers.get("set-cookie");
  if (res?.status === 200 && cookie) {
    // Carry the session by hand: this script uses bare fetch, which has no jar.
    const token = cookie.split(";")[0];
    const original = globalThis.fetch;
    globalThis.fetch = (input, init = {}) =>
      original(input, { ...init, headers: { ...(init.headers ?? {}), cookie: token } });
    me = await api("/me");
  }
}
if (!me.admin) {
  console.error(
    "check-excerpt: not an admin session. This gate WRITES two notes into the\n" +
      "vault; run it against an instance in open local mode, or set\n" +
      "VELLUM_PASSWORD for one that has ADMIN_PASSWORD_HASH.",
  );
  process.exit(1);
}

/** Every tag word that turned up as a bare noun in a reader-facing string. */
const bareTags = (text) =>
  TAG_WORDS.filter((word) => new RegExp(`(^|[^#\\p{L}])${word}\\b`, "iu").test(text));

const restore = async () => {
  for (const path of [GATE_PATH, LINK_PATH]) {
    await api(`/note?path=${encodeURIComponent(path)}&permanent=true`, {
      method: "DELETE",
    }).catch(() => {});
  }
};

try {
  await api(`/note?path=${encodeURIComponent(GATE_PATH)}`, json("PUT", { content: GATE_NOTE }));
  await api(`/note?path=${encodeURIComponent(LINK_PATH)}`, json("PUT", { content: LINK_NOTE }));

  // ── the post excerpt ────────────────────────────────────────────────────
  const posts = await api("/posts");
  const post = posts.find((p) => p.path === GATE_PATH);
  check(post !== undefined, "the fixture is published as a post");
  if (post) {
    const loose = bareTags(post.excerpt);
    check(loose.length === 0, "excerpt carries no de-hashed tag", JSON.stringify(post.excerpt));
    check(!post.excerpt.includes("#"), "excerpt carries no raw #tag either", JSON.stringify(post.excerpt));
    // The strip must not eat the sentence it was glued to: an excerpt that
    // "passes" by being empty has failed differently.
    check(
      /it buys the reader a breath\.$/.test(post.excerpt.trim()),
      "excerpt keeps the prose the tags were glued to",
      JSON.stringify(post.excerpt),
    );
    check(
      (post.tags ?? []).includes("design"),
      "the tag itself survives where tags belong (post.tags)",
      JSON.stringify(post.tags),
    );
  }

  // ── search snippets ─────────────────────────────────────────────────────
  // Two queries: one whose hit sits on the tag line's own sentence, and one
  // whose hit is in the paragraph that ENDS in a tag — the snippet window
  // runs past the tag in both.
  for (const q of ["breath", "solid"]) {
    const hit = (await api(`/search?q=${encodeURIComponent(q)}`)).find((r) => r.path === GATE_PATH);
    check(hit !== undefined, `search "${q}" finds the fixture`);
    if (!hit) continue;
    const plain = hit.snippet.replace(/<\/?mark>/g, "");
    check(bareTags(plain).length === 0, `snippet "${q}" carries no de-hashed tag`, JSON.stringify(plain));
    check(!plain.includes("#"), `snippet "${q}" carries no raw #tag`, JSON.stringify(plain));
  }

  // ── backlink context ────────────────────────────────────────────────────
  const links = await api(`/backlinks?path=${encodeURIComponent(GATE_PATH)}`);
  const back = links.find((b) => b.path === LINK_PATH);
  check(back !== undefined, "the linking note shows up in backlinks");
  if (back) {
    const context = back.context ?? back.line ?? "";
    check(bareTags(context).length === 0, "backlink context carries no de-hashed tag", JSON.stringify(context));
    check(!context.includes("#"), "backlink context carries no raw #tag", JSON.stringify(context));
  }
} finally {
  await restore();
}

console.log(fail.length === 0 ? "\ncheck-excerpt: PASS" : `\ncheck-excerpt: ${fail.length} FAILED`);
process.exit(fail.length === 0 ? 0 : 1);
