import { cfg, log } from "./config.js";
import * as db from "./db.js";
import { ingest } from "./ingest.js";
import { selectAndWrite } from "./claude.js";
import { verify } from "./verify.js";
import { renderSlides } from "./render.js";
import * as tg from "./telegram.js";
import { publishCarousel, insights } from "./instagram.js";

/* ---------------------------------------------------------------- 21:00 IST */
export async function draftJob() {
  await db.expireStale();
  await ingest(48);

  const candidates = await db.freshCandidates(48);
  if (!candidates.length) {
    await tg.say("<b>No draft tonight</b>\nNo candidate stories with a readable body in the last 48 hours.");
    return;
  }

  const draft = await selectAndWrite(candidates);

  if (draft.blocked) {
    await tg.say(`<b>Blocked</b>\n${tg.escapeHtml(draft.blocked_reason || "no candidate met the day's rules")}`);
    return;
  }

  const row = candidates.find((c) => c.source_url === draft.chosen_url);
  if (!row) {
    await tg.say("<b>Blocked</b>\nModel returned a URL that was not in the candidate list. Nothing published.");
    return;
  }

  // The gate. Runs against the stored body, not against anything the model said.
  const check = verify(draft, row.raw_text);

  const patch = {
    status: check.pass ? "drafted" : "held",
    day_format: draft.day_format,
    reason: draft.reason_for_choice,
    slides_json: draft.slides,
    caption: draft.caption,
    hashtags: draft.hashtags,
    facts_used: draft.facts_used,
    confidence: draft.confidence,
    fact_report: check,
  };
  await db.update(row.id, patch);
  const full = await db.byId(row.id);

  if (!check.pass) {
    log("held:", check.failures.join(" | "));
    await tg.held(full, check.failures);
    return;
  }

  const imageUrls = await renderSlides(draft.slides, {
    day: draft.day_of_week.toLowerCase(),
    source_domain: row.source_domain,
    handle: cfg.handle,
  });
  await db.update(row.id, { image_urls: imageUrls });
  full.image_urls = imageUrls;

  const lowConfidence = Number(draft.confidence) < cfg.minConfidence;

  if (cfg.autoApprove && !lowConfidence) {
    await db.update(row.id, { status: "approved" });
    await tg.sendForApproval(full, imageUrls);
    await tg.say(`Auto-approved. Publishes at 08:00. Reply Skip on the card above to stop it.`);
  } else {
    await tg.sendForApproval(full, imageUrls);
    if (lowConfidence)
      await tg.say(`Confidence ${Number(draft.confidence).toFixed(2)} is below ${cfg.minConfidence} — held for a human even though the facts check out.`);
  }
}

/* ---------------------------------------------------------------- 08:00 IST */
export async function publishJob() {
  const row = await db.oneByStatus("approved");
  if (!row) {
    await tg.say("<b>Nothing published</b>\nNo approved draft waiting.");
    return;
  }
  if (!row.image_urls?.length) {
    await db.update(row.id, { status: "failed", error: "no rendered images" });
    await tg.say(`<b>Publish failed</b>\nDraft #${row.id} had no rendered images.`);
    return;
  }

  try {
    const { id, permalink } = await publishCarousel(row.image_urls, row.caption, row.hashtags);
    await db.update(row.id, {
      status: "posted", ig_post_id: id, ig_permalink: permalink,
      posted_at: new Date().toISOString(),
    });
    await tg.say(`<b>Published</b>\nDraft #${row.id} is live.\n${permalink || id}`);
  } catch (e) {
    await db.update(row.id, { status: "failed", error: e.message });
    await tg.say(`<b>Publish failed</b>\nDraft #${row.id}\n${tg.escapeHtml(e.message)}`);
    throw e;
  }
}

/* --------------------------------------------- 08:05 IST, yesterday's numbers */
export async function reportJob() {
  const since = new Date(Date.now() - 36 * 3600e3).toISOString();
  const { data } = await db.db.from("posts")
    .select("id, ig_post_id, ig_permalink, source_title")
    .eq("status", "posted").gte("posted_at", since);

  if (!data?.length) return;
  for (const p of data) {
    if (!p.ig_post_id) continue;
    const m = await insights(p.ig_post_id);
    if (!m) continue;
    await db.update(p.id, { insights: m });
    await tg.say(
      `<b>Yesterday</b> · reach ${m.reach ?? "-"} · saves ${m.saved ?? "-"} · ` +
      `shares ${m.shares ?? "-"} · interactions ${m.total_interactions ?? "-"}\n` +
      `${p.ig_permalink || p.ig_post_id}`);
  }
}

/* ------------------------------------------------- Telegram button callbacks */
export async function onDecision(decision, id) {
  try {
    const row = await db.byId(id);
    if (!row) return;
    if (["posted", "failed"].includes(row.status)) {
      await tg.say(`Draft #${id} is already ${row.status}. No change.`);
      return;
    }
    await db.update(id, { status: decision });
    await tg.say(decision === "approved"
      ? `Draft #${id} approved. Publishes at 08:00.`
      : `Draft #${id} skipped. Nothing goes out tomorrow unless a new draft is approved.`);
  } catch (e) {
    log("decision failed", e.message);
  }
}
