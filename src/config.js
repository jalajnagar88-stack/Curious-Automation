import "dotenv/config";

/*
 * Credentials are resolved lazily, on first access, not at import time.
 *
 * Every module in the pipeline imports this file, so an eager check meant that
 * running one step in isolation (`--once=ingest`, which touches only the feeds
 * and the database) demanded a Telegram token and a Graph API token it never used.
 * A getter throws at the moment a step actually reaches for a key it is missing,
 * and names the step in the error.
 */
const req = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var: ${k}`);
  return v;
};

export const cfg = {
  get anthropicKey() { return req("ANTHROPIC_API_KEY"); },
  model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",

  // One SQLite file. Relative paths resolve against the working directory, so
  // set an absolute path in .env when running under pm2 or a container.
  dbPath: process.env.DB_PATH || "./data/curious.db",

  renderer: process.env.RENDERER || "hcti",
  hctiUser: process.env.HCTI_USER_ID,
  hctiKey: process.env.HCTI_API_KEY,
  publicImageBase: process.env.PUBLIC_IMAGE_BASE,

  get tgToken() { return req("TELEGRAM_BOT_TOKEN"); },
  get tgChat() { return req("TELEGRAM_CHAT_ID"); },

  get igUserId() { return req("IG_USER_ID"); },
  get igToken() { return req("IG_ACCESS_TOKEN"); },
  graph: `https://graph.facebook.com/${process.env.GRAPH_VERSION || "v21.0"}`,

  handle: process.env.IG_HANDLE || "@curiousventures",
  tz: process.env.TIMEZONE || "Asia/Kolkata",
  draftCron: process.env.DRAFT_CRON || "5 21 * * *",
  publishCron: process.env.PUBLISH_CRON || "0 8 * * *",
  reportCron: process.env.REPORT_CRON || "5 8 * * *",

  autoApprove: process.env.AUTO_APPROVE === "true",
  minConfidence: Number(process.env.MIN_CONFIDENCE || 0.7),
};

export const log = (...a) =>
  console.log(new Date().toISOString(), ...a);
