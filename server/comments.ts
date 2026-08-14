// Marginalia: visitor comments under published notes, stored in a local
// SQLite file (node:sqlite — zero dependencies). Opt-in via COMMENTS=on;
// off (the default) keeps the whole feature dark: no db file, routes 404.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CommentData } from "../shared/types.ts";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_POSTS = 5;

export const AUTHOR_MAX = 40;
export const BODY_MAX = 2000;

let db: DatabaseSync | null = null;

/** Read COMMENTS / VELLUM_DATA from the environment. Call once at startup. */
export function initComments(env: NodeJS.ProcessEnv = process.env): void {
  const on = /^(on|true|1|yes)$/i.test(env.COMMENTS?.trim() ?? "");
  if (!on) return;
  const dataDir = path.resolve(env.VELLUM_DATA?.trim() || "data");
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "comments.db");
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS comments (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      notePath  TEXT    NOT NULL,
      author    TEXT    NOT NULL,
      body      TEXT    NOT NULL,
      createdMs INTEGER NOT NULL,
      ip        TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_notePath ON comments (notePath, createdMs);
  `);
  console.log(`vellum: comments enabled — ${file}`);
}

export function commentsEnabled(): boolean {
  return db !== null;
}

interface CommentRow {
  id: number;
  notePath: string;
  author: string;
  body: string;
  createdMs: number;
}

/** All comments for a note, oldest first. The stored IP never leaves the server. */
export function listComments(notePath: string): CommentData[] {
  if (!db) return [];
  const rows = db
    .prepare("SELECT id, notePath, author, body, createdMs FROM comments WHERE notePath = ? ORDER BY createdMs, id")
    .all(notePath) as unknown as CommentRow[];
  return rows.map((r) => ({ ...r }));
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
