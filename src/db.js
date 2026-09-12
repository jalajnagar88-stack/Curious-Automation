import { createClient } from "@supabase/supabase-js";
import { cfg } from "./config.js";

/*
 * The client is built on first property access, not at import time, so that a
 * step which never reaches Supabase can still import this module. Call sites
 * keep using `db.from(...)` unchanged.
 */
let _client = null;
const client = () =>
  (_client ||= createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false },
  }));

export const db = new Proxy({}, {
  get: (_t, prop) => {
    const v = client()[prop];
    return typeof v === "function" ? v.bind(client()) : v;
  },
});

/** Insert candidates, ignoring any URL already stored. Returns the new rows. */
export async function insertCandidates(rows) {
  if (!rows.length) return [];
  const { data, error } = await db
    .from("posts")
    .upsert(rows, { onConflict: "source_url", ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return data || [];
}

/*
 * Rows stored earlier whose body never extracted.
 *
 * Dedupe is on source_url, so a story whose first body fetch failed — a rate
 * limit, a timeout, a publisher having a bad minute — never reappears in the
 * insert result and would otherwise never get a second attempt. These rows are
 * invisible to freshCandidates (it filters raw_text is null), so they are lost
 * stories, not stored ones.
 */
export async function bodylessRows(hours = 48) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const { data, error } = await db
    .from("posts")
    .select("id, source_url, source_title, source_domain")
    .eq("status", "new")
    .is("raw_text", null)
    .gte("source_date", since)
    .order("source_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function freshCandidates(hours = 48) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  const { data, error } = await db
    .from("posts")
    .select("id, source_url, source_title, source_domain, source_date, raw_text")
    .eq("status", "new")
    .gte("source_date", since)
    .not("raw_text", "is", null)
    .order("source_date", { ascending: false })
    .limit(25);
  if (error) throw error;
  return data || [];
}

export async function weekPosted() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data, error } = await db
    .from("posts")
    .select("source_title, source_url, source_domain, raw_text")
    .eq("status", "posted")
    .gte("posted_at", since);
  if (error) throw error;
  return data || [];
}

export async function update(id, patch) {
  const { error } = await db.from("posts").update(patch).eq("id", id);
  if (error) throw error;
}

export async function oneByStatus(status) {
  const { data, error } = await db
    .from("posts").select("*").eq("status", status)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

export async function byId(id) {
  const { data, error } = await db.from("posts").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

/** Anything drafted but never resolved is stale once the next draft runs. */
export async function expireStale() {
  const cutoff = new Date(Date.now() - 20 * 3600e3).toISOString();
  await db.from("posts").update({ status: "skipped" })
    .in("status", ["drafted", "held"]).lt("created_at", cutoff);
}
