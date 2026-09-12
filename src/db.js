import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cfg } from "./config.js";

/*
 * One SQLite file, opened on first use.
 *
 * This service has exactly one writer — the cron process — and stores under a
 * hundred rows a day, so a network database bought nothing but a signup, a set
 * of credentials and a second thing that can be down at 21:05. The schema is
 * the same single table; only the dialect changed.
 *
 * jsonb and text[] columns are held as JSON text and encoded and decoded here,
 * so everything upstream still hands us objects and arrays and gets them back.
 */
const JSON_COLS = new Set([
  "slides_json", "hashtags", "facts_used", "fact_report", "image_urls", "insights",
]);

let _db = null;

export function handle() {
  if (_db) return _db;
  mkdirSync(dirname(cfg.dbPath), { recursive: true });
  _db = new DatabaseSync(cfg.dbPath);
  _db.exec("pragma journal_mode = wal");   // survives a crash mid-write
  _db.exec("pragma foreign_keys = on");
  _db.exec("pragma busy_timeout = 5000");
  _db.exec(readFileSync(new URL("../sql/001_init.sqlite.sql", import.meta.url), "utf8"));
  return _db;
}

/** Kept for call sites that want the raw connection. */
export const db = new Proxy({}, {
  get: (_t, prop) => {
    const v = handle()[prop];
    return typeof v === "function" ? v.bind(handle()) : v;
  },
});

const encode = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue;
    out[k] = JSON_COLS.has(k) && v !== null && typeof v !== "string" ? JSON.stringify(v) : v;
  }
  return out;
};

const decode = (row) => {
  if (!row) return row;
  const out = { ...row };
  for (const k of JSON_COLS) {
    if (typeof out[k] === "string") {
      try { out[k] = JSON.parse(out[k]); } catch { /* leave the raw string */ }
    }
  }
  return out;
};

const rows = (sql, ...args) => handle().prepare(sql).all(...args).map(decode);
const since = (hours) => new Date(Date.now() - hours * 3600e3).toISOString();

/** Insert candidates, ignoring any URL already stored. Returns the new rows. */
export function insertCandidates(list) {
  if (!list.length) return [];
  const out = [];
  const tx = handle();
  tx.exec("begin");
  try {
    for (const raw of list) {
      const row = encode(raw);
      const cols = Object.keys(row);
      const stmt = tx.prepare(
        `insert or ignore into posts (${cols.join(", ")}) ` +
        `values (${cols.map(() => "?").join(", ")}) returning *`);
      const got = stmt.all(...cols.map((c) => row[c]));
      if (got.length) out.push(decode(got[0]));
    }
    tx.exec("commit");
  } catch (e) { tx.exec("rollback"); throw e; }
  return out;
}

export function freshCandidates(hours = 48) {
  return rows(
    `select id, source_url, source_title, source_domain, source_date, raw_text
       from posts
      where status = 'new' and source_date >= ? and raw_text is not null
      order by source_date desc limit 25`, since(hours));
}

/*
 * Rows stored earlier whose body never extracted.
 *
 * Dedupe is on source_url, so a story whose first body fetch failed never
 * reappears in the insert result and would otherwise never get a second
 * attempt. These rows are invisible to freshCandidates, which requires
 * raw_text, so they are lost stories rather than stored ones.
 */
export function bodylessRows(hours = 48) {
  return rows(
    `select id, source_url, source_title, source_domain
       from posts
      where status = 'new' and raw_text is null and source_date >= ?
      order by source_date desc`, since(hours));
}

export function weekPosted() {
  return rows(
    `select source_title, source_url, source_domain, raw_text
       from posts where status = 'posted' and posted_at >= ?`, since(7 * 24));
}

/** Posts published inside the window, for the morning insights job. */
export function postedSince(hours = 36) {
  return rows(
    `select id, ig_post_id, ig_permalink, source_title
       from posts where status = 'posted' and posted_at >= ?`, since(hours));
}

export function update(id, patch) {
  const row = encode(patch);
  const cols = Object.keys(row);
  if (!cols.length) return;
  handle()
    .prepare(`update posts set ${cols.map((c) => `${c} = ?`).join(", ")} where id = ?`)
    .run(...cols.map((c) => row[c]), id);
}

export function oneByStatus(status) {
  return rows(
    `select * from posts where status = ? order by created_at desc limit 1`, status)[0] || null;
}

export function byId(id) {
  return rows(`select * from posts where id = ?`, id)[0] || null;
}

/** Anything drafted but never resolved is stale once the next draft runs. */
export function expireStale() {
  handle()
    .prepare(`update posts set status = 'skipped'
               where status in ('drafted','held') and created_at < ?`)
    .run(since(20));
}

export function close() { if (_db) { _db.close(); _db = null; } }
