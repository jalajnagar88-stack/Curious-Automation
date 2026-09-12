import cron from "node-cron";
import { cfg, log } from "./config.js";
import { draftJob, publishJob, reportJob, onDecision } from "./pipeline.js";
import { listen, say } from "./telegram.js";

const guard = (name, fn) => async () => {
  log(`--- ${name} start`);
  try { await fn(); log(`--- ${name} done`); }
  catch (e) {
    log(`--- ${name} FAILED`, e.stack || e.message);
    try { await say(`<b>${name} crashed</b>\n<code>${String(e.message).slice(0, 400)}</code>`); } catch {}
  }
};

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const once = arg("once");

if (once) {
  /*
   * Ingest is runnable on its own so the feeds and the article extractor can be
   * debugged without the model, the renderer, Telegram or Instagram in the way.
   *
   *   node src/index.js --once=ingest                  store rows
   *   node src/index.js --once=ingest --dry            touch no database at all
   *   node src/index.js --once=ingest --retry-bodies   second pass at empty bodies
   *   node src/index.js --once=ingest --hours=72 --limit=10
   */
  const ingestJob = async () => {
    const { ingest, retryBodies, printReport } = await import("./ingest.js");
    const hours = Number(arg("hours", 48));
    const limitArg = arg("limit");
    const limit = limitArg ? Number(limitArg) : Infinity;
    printReport(flag("retry-bodies")
      ? await retryBodies(hours, { limit })
      : await ingest(hours, { dry: flag("dry"), limit }));
  };

  const jobs = { ingest: ingestJob, draft: draftJob, publish: publishJob, report: reportJob };
  if (!jobs[once]) { console.error("--once= ingest | draft | publish | report"); process.exit(1); }
  await guard(once, jobs[once])();
  process.exit(0);
}

const opts = { timezone: cfg.tz };
cron.schedule(cfg.draftCron,   guard("draft",   draftJob),   opts);
cron.schedule(cfg.publishCron, guard("publish", publishJob), opts);
cron.schedule(cfg.reportCron,  guard("report",  reportJob),  opts);

listen(onDecision);

log(`curious-desk up · tz ${cfg.tz} · draft ${cfg.draftCron} · publish ${cfg.publishCron} · auto-approve ${cfg.autoApprove}`);
