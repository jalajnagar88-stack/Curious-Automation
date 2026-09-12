/*
 * Proves the Supabase connection and the `posts` table before anything else runs.
 *
 * Until this passes, every later failure in the pipeline looks like a Supabase
 * failure. Inserts one sentinel row, reads it back, checks the columns the
 * pipeline actually depends on, exercises the dedupe path, then deletes it.
 *
 *   node scripts/check-supabase.js
 *
 * Needs only SUPABASE_URL and SUPABASE_SERVICE_KEY.
 */
import { db, insertCandidates, update } from "../src/db.js";

const SENTINEL = `https://example.invalid/curious-desk-selftest/${Date.now()}`;
const fail = (m, e) => { console.error(`FAIL  ${m}`); if (e) console.error(e); process.exit(1); };
const ok = (m) => console.log(`ok    ${m}`);

let inserted = null;
try {
  // 1 · the table is reachable and readable
  const { error: readErr } = await db.from("posts").select("id").limit(1);
  if (readErr) fail("cannot read posts — did sql/001_init.sql run?", readErr);
  ok("posts table is reachable");

  // 2 · insert through the same path ingest uses
  const rows = await insertCandidates([{
    source_url: SENTINEL,
    source_title: "curious-desk self test",
    source_domain: "example.invalid",
    source_date: new Date().toISOString(),
    raw_summary: "inserted by scripts/check-supabase.js",
  }]);
  if (rows.length !== 1) fail(`insert returned ${rows.length} rows, expected 1`);
  inserted = rows[0];
  ok(`inserted row id ${inserted.id}`);

  // 3 · read it back and check the defaults the pipeline relies on
  const { data: back, error: backErr } =
    await db.from("posts").select("*").eq("id", inserted.id).single();
  if (backErr) fail("read-back failed", backErr);
  if (back.source_url !== SENTINEL) fail("read-back source_url does not match");
  if (back.status !== "new") fail(`status default is "${back.status}", expected "new"`);
  if (back.raw_text !== null) fail("raw_text should default to null");
  if (!back.created_at) fail("created_at was not set");
  ok("read back with status=new, raw_text=null, created_at set");

  // 4 · the body-fill update ingest performs
  await update(inserted.id, { raw_text: "x".repeat(500) });
  const { data: filled } = await db.from("posts").select("raw_text").eq("id", inserted.id).single();
  if (filled?.raw_text?.length !== 500) fail("raw_text update did not stick");
  ok("raw_text update works");

  // 5 · dedupe: the same URL again must return nothing new
  const dup = await insertCandidates([{ source_url: SENTINEL, source_title: "duplicate" }]);
  if (dup.length !== 0) fail(`dedupe on source_url is broken — got ${dup.length} new rows`);
  ok("dedupe on source_url returns 0 new rows");

  console.log("\nSupabase is good. Step 2 passes.");
} finally {
  if (inserted) {
    const { error } = await db.from("posts").delete().eq("id", inserted.id);
    console.log(error ? `warn  could not clean up row ${inserted.id}: ${error.message}`
                      : `ok    cleaned up row ${inserted.id}`);
  }
}
