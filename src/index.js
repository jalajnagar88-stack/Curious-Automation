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

const once = (process.argv.find((a) => a.startsWith("--once=")) || "").split("=")[1];

if (once) {
  const jobs = { draft: draftJob, publish: publishJob, report: reportJob };
  if (!jobs[once]) { console.error("--once= draft | publish | report"); process.exit(1); }
  await guard(once, jobs[once])();
  process.exit(0);
}

const opts = { timezone: cfg.tz };
cron.schedule(cfg.draftCron,   guard("draft",   draftJob),   opts);
cron.schedule(cfg.publishCron, guard("publish", publishJob), opts);
cron.schedule(cfg.reportCron,  guard("report",  reportJob),  opts);

listen(onDecision);

log(`curious-desk up · tz ${cfg.tz} · draft ${cfg.draftCron} · publish ${cfg.publishCron} · auto-approve ${cfg.autoApprove}`);
