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
  /*
   * Which transport src/llm.js uses. The prompt, the schema and the fact gate
   * are identical on all three; only the HTTP call differs.
   *
   * These are getters rather than fields so that a value read from the
   * environment is picked up whenever it is asked for, not frozen at import.
   * The base URLs are overridable so a test can point a provider at a local
   * server, and so a proxy or a regional endpoint needs no code change.
   */
  get provider() { return process.env.LLM_PROVIDER || "anthropic"; },
  get llmMaxTokens() { return Number(process.env.LLM_MAX_TOKENS || 4000); },
  get llmTemperature() { return Number(process.env.LLM_TEMPERATURE || 0.4); },

  get anthropicKey() { return req("ANTHROPIC_API_KEY"); },
  get model() { return process.env.CLAUDE_MODEL || "claude-sonnet-5"; },

  get geminiKey() { return req("GEMINI_API_KEY"); },
  get geminiModel() { return process.env.GEMINI_MODEL || "gemini-2.0-flash"; },
  get geminiBase() {
    return process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  },

  // Any OpenAI-compatible endpoint: Groq, OpenRouter, Cerebras, Together, Ollama.
  get openaiKey() { return req("OPENAI_API_KEY"); },
  get openaiBase() { return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"; },
  get openaiModel() { return process.env.OPENAI_MODEL || "gpt-4o-mini"; },

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
