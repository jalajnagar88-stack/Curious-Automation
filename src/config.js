import "dotenv/config";

const req = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var: ${k}`);
  return v;
};

export const cfg = {
  anthropicKey: req("ANTHROPIC_API_KEY"),
  model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",

  supabaseUrl: req("SUPABASE_URL"),
  supabaseKey: req("SUPABASE_SERVICE_KEY"),

  renderer: process.env.RENDERER || "hcti",
  hctiUser: process.env.HCTI_USER_ID,
  hctiKey: process.env.HCTI_API_KEY,
  publicImageBase: process.env.PUBLIC_IMAGE_BASE,

  tgToken: req("TELEGRAM_BOT_TOKEN"),
  tgChat: req("TELEGRAM_CHAT_ID"),

  igUserId: req("IG_USER_ID"),
  igToken: req("IG_ACCESS_TOKEN"),
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
