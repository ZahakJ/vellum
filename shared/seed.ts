// The one fact about the starter vault that BOTH sides need.
//
// The seeding rule and the copying live in `server/seed.ts`; the client's part
// is smaller and older than the seed route: on a first run, with no session to
// restore and no home note set, the app opens the guide the seed ships rather
// than the empty state (v1.8 audit, F1 — a fresh install landed on "The vault
// is open." with Welcome.md sitting right there in the tree). Both halves read
// the name from here so a rename of the guide cannot leave one of them
// pointing at a file that is no longer there.

/** The note `vault-seed/` ships as its guide. */
export const SEED_GUIDE = "Welcome.md";
