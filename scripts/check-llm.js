/*
 * Proves the model key and the provider wiring with one tiny call.
 *
 * Sends about thirty tokens and asks for strict JSON back, which is the only
 * thing the pipeline needs from a provider. Run this before `--once=draft` so a
 * bad key fails in one second rather than after a full ingest.
 *
 *   npm run check:llm
 *
 * Reads LLM_PROVIDER and the key for whichever provider that names.
 */
import { complete, describe } from "../src/llm.js";
import { cfg } from "../src/config.js";

const SYSTEM =
  "You convert a sentence into JSON. Reply with a JSON object only, no prose " +
  'and no code fences, in exactly this shape: {"company":string,"amount":string}';

const USER =
  "Sentence: Bengaluru-based Shiprocket has raised $18 million in a Series D " +
  "round led by Zomato.";

console.log(`provider  ${describe()}`);
console.log(`temp ${cfg.llmTemperature} · max tokens ${cfg.llmMaxTokens}\n`);

let text;
try {
  text = await complete({ system: SYSTEM, user: USER });
} catch (e) {
  console.error(`FAIL  the call did not come back\n\n${e.message}\n`);
  console.error("Common causes: wrong or unset key for this provider, a model " +
                "name the provider does not serve, or a base URL without /v1.");
  process.exit(1);
}

console.log("raw response:\n" + text.trim() + "\n");

// The pipeline parses the reply the same way; if that fails here it will fail there.
let parsed;
try {
  const clean = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
} catch {
  console.error("FAIL  the reply was not parseable JSON.");
  console.error("The provider answered, so the key is fine — but this model " +
                "wraps or narrates its output. Expect the draft step to need a " +
                "stricter prompt, or pick a model with a JSON mode.");
  process.exit(1);
}

if (!parsed.company || !parsed.amount) {
  console.error(`FAIL  JSON parsed but the keys are wrong: ${JSON.stringify(parsed)}`);
  console.error("Instruction-following is weak on this model. It will struggle " +
                "with the six-slide schema.");
  process.exit(1);
}

console.log(`parsed    company=${parsed.company}  amount=${parsed.amount}`);
console.log("\nProvider is good. It answers, and it returns strict JSON.");
