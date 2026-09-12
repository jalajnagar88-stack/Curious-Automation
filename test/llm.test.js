/*
 * Transport tests for src/llm.js.
 *
 * A local server stands in for Gemini and for the OpenAI-compatible shape, so
 * the request we send and the reply we parse are checked without a key, without
 * network access and without spending anything. This proves the plumbing, not
 * the model: whether a given provider writes good slides is a judgement you make
 * on real output, not something a fixture can tell you.
 *
 *   npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let lastRequest = null;
let reply = null;   // { status, body } the fake provider should answer with

const srv = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(raw || "{}") };
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
  });
});

await new Promise((r) => srv.listen(8732, "127.0.0.1", r));
const BASE = "http://127.0.0.1:8732";

process.env.GEMINI_BASE_URL = `${BASE}/v1beta`;
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.OPENAI_BASE_URL = `${BASE}/v1`;
process.env.OPENAI_API_KEY = "test-openai-key";

const { complete, describe: describeProvider } = await import("../src/llm.js");

const useGemini = () => { process.env.LLM_PROVIDER = "gemini"; process.env.GEMINI_MODEL = "gemini-2.0-flash"; };
const useOpenAI = () => { process.env.LLM_PROVIDER = "openai"; process.env.OPENAI_MODEL = "llama-3.3-70b"; };
const ask = () => complete({ system: "be terse", user: "hello" });

const geminiOk = (text) => ({
  status: 200,
  body: { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] },
});
const openaiOk = (content) => ({
  status: 200,
  body: { choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] },
});

/* --------------------------------------------------------------------- Gemini */

test("gemini: sends system and user separately, asks for JSON, returns the text", async () => {
  useGemini();
  reply = geminiOk('{"ok":true}');
  const out = await ask();

  assert.equal(out, '{"ok":true}');
  assert.match(lastRequest.url, /\/v1beta\/models\/gemini-2\.0-flash:generateContent/);
  assert.equal(lastRequest.headers["x-goog-api-key"], "test-gemini-key");
  assert.equal(lastRequest.body.system_instruction.parts[0].text, "be terse");
  assert.equal(lastRequest.body.contents[0].parts[0].text, "hello");
  assert.equal(lastRequest.body.generationConfig.responseMimeType, "application/json");
});

test("gemini: the key travels in a header, never in the query string", async () => {
  // A key in the URL lands in access logs and proxy logs on the way.
  useGemini();
  reply = geminiOk("{}");
  await ask();
  assert.ok(!lastRequest.url.includes("test-gemini-key"), `url was ${lastRequest.url}`);
});

test("gemini: a truncated answer is an error, not a half draft", async () => {
  useGemini();
  reply = { status: 200, body: { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"partial"' }] } }] } };
  await assert.rejects(ask, /max.?output.?tokens|LLM_MAX_TOKENS/i);
});

test("gemini: a safety block is reported as a block", async () => {
  useGemini();
  reply = { status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } };
  await assert.rejects(ask, /blocked the prompt: SAFETY/);
});

test("gemini: no candidates is an error rather than an empty draft", async () => {
  useGemini();
  reply = { status: 200, body: {} };
  await assert.rejects(ask, /no candidates/);
});

/* ------------------------------------------------------- OpenAI-compatible shape */

test("openai: sends system and user as messages and asks for a JSON object", async () => {
  useOpenAI();
  reply = openaiOk('{"ok":true}');
  const out = await ask();

  assert.equal(out, '{"ok":true}');
  assert.equal(lastRequest.url, "/v1/chat/completions");
  assert.equal(lastRequest.headers.authorization, "Bearer test-openai-key");
  assert.equal(lastRequest.body.model, "llama-3.3-70b");
  assert.deepEqual(lastRequest.body.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(lastRequest.body.messages[0].content, "be terse");
  assert.equal(lastRequest.body.response_format.type, "json_object");
});

test("openai: a length cutoff is an error", async () => {
  useOpenAI();
  reply = { status: 200, body: { choices: [{ finish_reason: "length", message: { content: '{"partial"' } }] } };
  await assert.rejects(ask, /max_tokens|LLM_MAX_TOKENS/i);
});

test("openai: an empty message is an error", async () => {
  useOpenAI();
  reply = openaiOk("");
  await assert.rejects(ask, /empty message/);
});

/* ------------------------------------------------------------ shared behaviour */

test("an HTTP error surfaces the provider's own explanation", async () => {
  useOpenAI();
  reply = { status: 401, body: { error: { message: "Incorrect API key provided" } } };
  await assert.rejects(ask, /401.*Incorrect API key provided/s);
});

test("a non-JSON body is reported as such, not as a parse crash", async () => {
  useOpenAI();
  reply = { status: 200, body: "<html>gateway timeout</html>" };
  await assert.rejects(ask, /non-JSON/);
});

test("an unknown provider names the ones that exist", async () => {
  process.env.LLM_PROVIDER = "gpt5-turbo-max";
  await assert.rejects(ask, /unknown LLM_PROVIDER.*anthropic, gemini, openai/s);
});

test("describe() names the provider and the model that will be called", () => {
  useGemini();
  assert.equal(describeProvider(), "gemini/gemini-2.0-flash");
  useOpenAI();
  assert.equal(describeProvider(), "openai/llama-3.3-70b");
});

test.after(() => srv.close());
