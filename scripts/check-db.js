/*
 * Proves the database before anything else runs.
 *
 * Creates the file and schema if they are not there, inserts one sentinel row
 * through the same path ingest uses, reads it back, checks the defaults the
 * pipeline depends on, exercises dedupe and the JSON round-trip, then deletes
 * it. Needs no credentials and no network.
 *
 *   npm run check:db
 */
import { handle, insertCandidates, update, byId, freshCandidates, close } from "../src/db.js";
import { cfg } from "../src/config.js";

const SENTINEL = `https://example.invalid/curious-desk-selftest/${Date.now()}`;
const fail = (m, e) => { console.error(`FAIL  ${m}`); if (e) console.error(e); process.exit(1); };
const ok = (m) => console.log(`ok    ${m}`);

let inserted = null;
try {
  const db = handle();
  ok(`opened ${cfg.dbPath}`);

  const cols = db.prepare("pragma table_info(posts)").all().map((c) => c.name);
  if (!cols.includes("raw_text")) fail("posts table has no raw_text column");
  ok(`posts table has ${cols.length} columns`);

  const rows = insertCandidates([{
    source_url: SENTINEL,
    source_title: "curious-desk self test",
    source_domain: "example.invalid",
    source_date: new Date().toISOString(),
    raw_summary: "inserted by scripts/check-db.js",
  }]);
  if (rows.length !== 1) fail(`insert returned ${rows.length} rows, expected 1`);
  inserted = rows[0];
  ok(`inserted row id ${inserted.id}`);

  const back = byId(inserted.id);
  if (!back) fail("read-back returned nothing");
  if (back.source_url !== SENTINEL) fail("read-back source_url does not match");
  if (back.status !== "new") fail(`status default is "${back.status}", expected "new"`);
  if (back.raw_text !== null) fail("raw_text should default to null");
  if (!back.created_at) fail("created_at was not set");
  ok("read back with status=new, raw_text=null, created_at set");

  update(inserted.id, { raw_text: "x".repeat(500) });
  if (byId(inserted.id).raw_text?.length !== 500) fail("raw_text update did not stick");
  ok("raw_text update works");

  // The columns that were jsonb and text[] in Postgres must survive a round trip.
  update(inserted.id, {
    hashtags: ["#india", "#startups"],
    slides_json: [{ layout: "hook", headline: "round trip" }],
    confidence: 0.81,
  });
  const j = byId(inserted.id);
  if (!Array.isArray(j.hashtags) || j.hashtags[1] !== "#startups") fail("hashtags did not round-trip as an array");
  if (j.slides_json?.[0]?.layout !== "hook") fail("slides_json did not round-trip as an object");
  if (Math.abs(j.confidence - 0.81) > 1e-9) fail("confidence did not round-trip as a number");
  ok("json and array columns round-trip");

  if (!freshCandidates(48).some((c) => c.id === inserted.id))
    fail("row with a body is not visible to freshCandidates");
  ok("freshCandidates sees the row once it has a body");

  const dup = insertCandidates([{ source_url: SENTINEL, source_title: "duplicate" }]);
  if (dup.length !== 0) fail(`dedupe on source_url is broken — got ${dup.length} new rows`);
  ok("dedupe on source_url returns 0 new rows");

  console.log("\nDatabase is good. Step 2 passes.");
} finally {
  if (inserted) {
    handle().prepare("delete from posts where id = ?").run(inserted.id);
    console.log(`ok    cleaned up row ${inserted.id}`);
  }
  close();
}
