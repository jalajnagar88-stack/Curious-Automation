import { cfg, log } from "./config.js";

/*
 * One model call, three transports.
 *
 * The pipeline does not care which model wrote the draft. It asks for strict
 * JSON, and src/verify.js then checks every figure against the stored article
 * body regardless of where the JSON came from. That makes the provider a
 * swappable detail rather than an architectural commitment, which is the whole
 * reason this file exists: you can see a real result on a free key today and
 * move to Claude for production without touching the prompt, the schema or
 * the fact gate.
 *
 * Quality is NOT a swappable detail. A weaker model declares fewer of its
 * figures in facts_used, and the gate holds the post when it cannot anchor one.
 * Use a free provider to prove the plumbing; judge the writing on Claude.
 *
 *   LLM_PROVIDER=anthropic   ANTHROPIC_API_KEY, CLAUDE_MODEL
 *   LLM_PROVIDER=gemini      GEMINI_API_KEY, GEMINI_MODEL
 *   LLM_PROVIDER=openai      OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
 *
 * The `openai` transport is the OpenAI /chat/completions shape, which Groq,
 * OpenRouter, Cerebras, Together, Mistral and a local Ollama all speak. Point
 * OPENAI_BASE_URL at whichever one you have a key for.
 */

const TIMEOUT = 120000;

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  if (!res.ok) {
    // Providers put the useful part in the body, not the status line.
    throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`provider returned non-JSON: ${text.slice(0, 300)}`);
  }
}

/* ------------------------------------------------------------------ Anthropic */

let _anthropic = null;
async function anthropic({ system, user, maxTokens, temperature }) {
  if (!_anthropic) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _anthropic = new Anthropic({ apiKey: cfg.anthropicKey });
  }
  const res = await _anthropic.messages.create({
    model: cfg.model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "max_tokens")
    throw new Error(`output hit max_tokens (${maxTokens}) — raise LLM_MAX_TOKENS`);
  return res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

/* --------------------------------------------------------------------- Gemini */

async function gemini({ system, user, maxTokens, temperature }) {
  const url =
    `${cfg.geminiBase.replace(/\/$/, "")}/models/` +
    `${encodeURIComponent(cfg.geminiModel)}:generateContent`;

  const data = await post(url, {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",   // ask for raw JSON, no prose wrapper
    },
  }, { "x-goog-api-key": cfg.geminiKey });

  // A prompt the safety filters reject comes back 200 with no candidates.
  if (data.promptFeedback?.blockReason)
    throw new Error(`gemini blocked the prompt: ${data.promptFeedback.blockReason}`);

  const cand = data.candidates?.[0];
  if (!cand) throw new Error(`gemini returned no candidates: ${JSON.stringify(data).slice(0, 300)}`);
  if (cand.finishReason === "MAX_TOKENS")
    throw new Error(`output hit maxOutputTokens (${maxTokens}) — raise LLM_MAX_TOKENS`);
  if (cand.finishReason && !["STOP", "MAX_TOKENS"].includes(cand.finishReason))
    throw new Error(`gemini stopped early: ${cand.finishReason}`);

  const text = (cand.content?.parts || []).map((p) => p.text).filter(Boolean).join("\n");
  if (!text) throw new Error("gemini returned an empty response");
  return text;
}

/* ------------------------------------------- anything speaking the OpenAI shape */

async function openaiCompatible({ system, user, maxTokens, temperature }) {
  const base = cfg.openaiBase.replace(/\/$/, "");
  const data = await post(`${base}/chat/completions`, {
    model: cfg.openaiModel,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  }, { authorization: `Bearer ${cfg.openaiKey}` });

  const choice = data.choices?.[0];
  if (!choice) throw new Error(`no choices returned: ${JSON.stringify(data).slice(0, 300)}`);
  if (choice.finish_reason === "length")
    throw new Error(`output hit max_tokens (${maxTokens}) — raise LLM_MAX_TOKENS`);

  const text = choice.message?.content;
  if (!text) throw new Error("provider returned an empty message");
  return text;
}

const PROVIDERS = { anthropic, gemini, openai: openaiCompatible };

/** The model that will actually be called, for logs and for the startup banner. */
export function describe() {
  const model = { anthropic: cfg.model, gemini: cfg.geminiModel, openai: cfg.openaiModel };
  return `${cfg.provider}/${model[cfg.provider] || "?"}`;
}

/** Send one system+user pair, get raw text back. Nothing here parses JSON. */
export async function complete({ system, user }) {
  const fn = PROVIDERS[cfg.provider];
  if (!fn) {
    throw new Error(
      `unknown LLM_PROVIDER "${cfg.provider}" — expected one of ${Object.keys(PROVIDERS).join(", ")}`);
  }
  const started = Date.now();
  const text = await fn({
    system, user,
    maxTokens: cfg.llmMaxTokens,
    temperature: cfg.llmTemperature,
  });
  log(`llm: ${describe()} replied with ${text.length} chars in ${Date.now() - started}ms`);
  return text;
}
