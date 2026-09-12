import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { cfg, log } from "./config.js";

const client = new Anthropic({ apiKey: cfg.anthropicKey });


let SYSTEM = null;
async function system() {
  if (SYSTEM) return SYSTEM;
  const md = await readFile(new URL("../prompt/select_and_write.md", import.meta.url), "utf8");
  // everything between the SYSTEM heading and the USER heading is the system prompt
  SYSTEM = md.split("## SYSTEM")[1].split("## USER")[0].trim();
  return SYSTEM;
}

function buildUser(candidates, dayName, dateISO) {
  const blocks = candidates.map((c, i) =>
    `[${i + 1}] ${c.source_title}\n` +
    `    url: ${c.source_url}\n` +
    `    published: ${c.source_date}\n` +
    `    source: ${c.source_domain}\n` +
    `    body:\n    ${c.raw_text}`
  ).join("\n\n");
  return `day_of_week: ${dayName}\ndate: ${dateISO}\n\nCANDIDATES\n\n${blocks}`;
}

/** Strip fences if the model wraps its JSON despite instructions. */
function parseJson(text) {
  const clean = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no JSON object in model output");
  return JSON.parse(clean.slice(start, end + 1));
}

export async function selectAndWrite(candidates, when = new Date()) {
  const dayName = new Intl.DateTimeFormat("en-US", {
    timeZone: cfg.tz, weekday: "long",
  }).format(when);

  const dateISO = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.tz }).format(when);

  const res = await client.messages.create({
    model: cfg.model,
    max_tokens: 4000,
    temperature: 0.4,
    system: await system(),
    messages: [{ role: "user", content: buildUser(candidates, dayName, dateISO) }],
  });

  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const out = parseJson(text);
  log(`claude: chose ${out.chosen_url || "(blocked)"} confidence ${out.confidence}`);
  return { ...out, day_of_week: dayName, date: dateISO };
}
