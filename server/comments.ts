// Marginalia: visitor comments under published notes, stored in a local
// SQLite file (node:sqlite — zero dependencies). Opt-in via COMMENTS=on or
// the settings panel (settings.commentsEnabled overrides the env value, live);
// off (the default) keeps the whole feature dark: no db file, routes 404.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CommentData } from "../shared/types.ts";
import { getSettings } from "./settings.ts";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_POSTS = 5;

export const AUTHOR_MAX = 40;
export const BODY_MAX = 2000;

let db: DatabaseSync | null = null;
let envOn = false;
let commentsDataDir = path.resolve("data");
let lastOpenErrorAt = 0;

/** Read COMMENTS / VELLUM_DATA from the environment. Call once at startup. */
export function initComments(env: NodeJS.ProcessEnv = process.env): void {
  envOn = /^(on|true|1|yes)$/i.test(env.COMMENTS?.trim() ?? "");
  commentsDataDir = path.resolve(env.VELLUM_DATA?.trim() || "data");
  if (envOn) openDb();
}

/** Open (or reuse) the comments db. Failures are logged, not thrown — the
 *  feature then just stays dark (commentsEnabled() false). */
function openDb(): void {
  if (db) return;
  try {
    mkdirSync(commentsDataDir, { recursive: true });
    const file = path.join(commentsDataDir, "comments.db");
    const opened = new DatabaseSync(file);
    opened.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS comments (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        notePath  TEXT    NOT NULL,
        author    TEXT    NOT NULL,
        body      TEXT    NOT NULL,
        createdMs INTEGER NOT NULL,
        ip        TEXT    NOT NULL,
        hidden    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_comments_notePath ON comments (notePath, createdMs);
    `);
    // Migration: databases created before moderation lack the `hidden` column
    // (CREATE TABLE IF NOT EXISTS never touches an existing table). Add it once.
    const cols = opened.prepare("PRAGMA table_info(comments)").all() as unknown as { name: string }[];
    if (!cols.some((col) => col.name === "hidden")) {
      opened.exec("ALTER TABLE comments ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
      console.log("vellum: comments db migrated — added hidden column");
    }
    db = opened;
    console.log(`vellum: comments enabled — ${file}`);
  } catch (err) {
    // Warn at most once a minute — this runs on every comments check while
    // the toggle wants comments on but the db cannot open.
    if (Date.now() - lastOpenErrorAt > 60_000) {
      lastOpenErrorAt = Date.now();
      console.error("vellum: could not open the comments db:", err);
    }
  }
}

/** Live merge: settings.commentsEnabled when set, else COMMENTS. Turning the
 *  feature on at runtime opens the db lazily right here; turning it off keeps
 *  the db file (and the open handle) but darkens every route/UI surface. */
export function commentsEnabled(): boolean {
  const want = getSettings().commentsEnabled ?? envOn;
  if (want && db === null) openDb();
  return want && db !== null;
}

interface CommentRow {
  id: number;
  notePath: string;
  author: string;
  body: string;
  createdMs: number;
  hidden: number;
}

function toComment(r: CommentRow, moderator: boolean): CommentData {
  const { hidden, ...rest } = r;
  // Visitors never learn a hidden flag exists; moderators always get it.
  return moderator ? { ...rest, hidden: hidden === 1 } : { ...rest };
}

/** All comments for a note, oldest first. The stored IP never leaves the
 *  server. Moderators see hidden comments (flagged); visitors never do. */
export function listComments(notePath: string, moderator = false): CommentData[] {
  if (!db) return [];
  const sql = `SELECT id, notePath, author, body, createdMs, hidden FROM comments
    WHERE notePath = ?${moderator ? "" : " AND hidden = 0"} ORDER BY createdMs, id`;
  const rows = db.prepare(sql).all(notePath) as unknown as CommentRow[];
  return rows.map((r) => toComment(r, moderator));
}

/** Comment counts per note path in one query (the blog's commentCount).
 *  Visitors count visible comments only; moderators include hidden ones. */
export function commentCounts(includeHidden: boolean): Map<string, number> {
  const out = new Map<string, number>();
  if (!db) return out;
  const rows = db
    .prepare(
      `SELECT notePath, COUNT(*) AS n FROM comments${includeHidden ? "" : " WHERE hidden = 0"} GROUP BY notePath`,
    )
    .all() as unknown as { notePath: string; n: number | bigint }[];
  for (const row of rows) out.set(row.notePath, Number(row.n));
  return out;
}

/** Newest comments across every note (moderation panel), hidden included. */
export function listAllComments(limit: number): CommentData[] {
  if (!db) return [];
  const rows = db
    .prepare(
      "SELECT id, notePath, author, body, createdMs, hidden FROM comments ORDER BY createdMs DESC, id DESC LIMIT ?",
    )
    .all(limit) as unknown as CommentRow[];
  return rows.map((r) => toComment(r, true));
}

/** Flip a comment's hidden flag. True when the row exists. */
export function setCommentHidden(id: number, hidden: boolean): boolean {
  if (!db) return false;
  return db.prepare("UPDATE comments SET hidden = ? WHERE id = ?").run(hidden ? 1 : 0, id).changes > 0;
}

export function addComment(notePath: string, author: string, body: string, ip: string): CommentData {
  if (!db) throw new Error("comments disabled");
  const createdMs = Date.now();
  const result = db
    .prepare("INSERT INTO comments (notePath, author, body, createdMs, ip) VALUES (?, ?, ?, ?, ?)")
    .run(notePath, author, body, createdMs, ip);
  return { id: Number(result.lastInsertRowid), notePath, author, body, createdMs };
}

/** True when a row was actually deleted. */
export function removeComment(id: number): boolean {
  if (!db) return false;
  return db.prepare("DELETE FROM comments WHERE id = ?").run(id).changes > 0;
}

/** Honeypot reply: shaped exactly like a stored comment so bots can't tell.
 *  The id continues the table's real AUTOINCREMENT sequence (sqlite_sequence
 *  survives deletes) with a nudge of jitter, so a probing bot sees ids in the
 *  same range real posts would get instead of a telltale [1e6, 2e6) band.
 *  (A follow-up GET can still notice the row never landed — closing that
 *  would mean persisting spam, which isn't worth it.) */
export function phantomComment(notePath: string, author: string, body: string): CommentData {
  let nextId = 1;
  if (db) {
    try {
      const row = db
        .prepare("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'comments'), 0) + 1 AS next")
        .get() as { next: number | bigint } | undefined;
      if (row) nextId = Number(row.next);
    } catch {
      // sqlite_sequence unavailable — fall back to MAX(id) + 1
      const row = db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM comments").get() as
        | { next: number | bigint }
        | undefined;
      if (row) nextId = Number(row.next);
    }
  }
  return { id: nextId + Math.floor(Math.random() * 2), notePath, author, body, createdMs: Date.now() };
}

// Sliding-window post limiter, same shape as the login limiter in auth.ts:
// checking never consumes an attempt — only recordCommentPost() does.
const postTimes = new Map<string, number[]>();

export function commentRateLimited(ip: string): boolean {
  const now = Date.now();
  if (postTimes.size > 1000) {
    for (const [key, times] of postTimes) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) postTimes.delete(key);
    }
  }
  const recent = (postTimes.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  postTimes.set(ip, recent);
  return recent.length >= RATE_MAX_POSTS;
}

export function recordCommentPost(ip: string): void {
  const times = postTimes.get(ip) ?? [];
  times.push(Date.now());
  postTimes.set(ip, times);
}
