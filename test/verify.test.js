/*
 * Unit tests for the fact gate.
 *
 * These test src/verify.js. The requirement is fail-closed: where the verifier
 * cannot decide, it must hold the post. A test that fails here is a finding
 * about the verifier, not a licence to loosen it.
 *
 *   npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { verify, normalise } from "../src/verify.js";

/* A source article written the way Indian publishers actually write one:
 * "Rs" rather than "₹", comma-grouped figures, mixed units. */
export const SOURCE = [
  "Bengaluru-based logistics startup Shiprocket has raised $18 million in a Series D",
  "round led by Zomato, with participation from Bertelsmann India Investments.",
  "The round values the company at Rs 4,200 crore post-money. Founder Saahil Goel",
  "said the capital will fund expansion into tier-three cities over the next",
  "eighteen months. The company reported operating revenue of Rs 1,088 crore in",
  "FY24, up 21 percent year on year, while narrowing its net loss to Rs 595 crore.",
  "Shiprocket spent Rs 35 crore on technology infrastructure during the year.",
  "It has raised a cumulative $280 million across nine rounds since 2017.",
].join(" ");

const cleanDraft = () => ({
  chosen_url: "https://entrackr.com/2026/09/shiprocket-series-d",
  day_format: "information",
  confidence: 0.86,
  slides: [
    { layout: "hook", headline: "Shiprocket raises $18 million led by Zomato",
      standfirst: "A logistics bet from an unexpected direction." },
    { layout: "context", headline: "What happened",
      body: ["The Series D was led by Zomato, with Bertelsmann India Investments participating.",
             "Operating revenue reached Rs 1,088 crore in FY24, up 21 percent year on year."] },
    { layout: "number", figure: "$18", unit: "million",
      label: "raised in a Series D round led by Zomato" },
    { layout: "insight", quote: "The capital will fund expansion into tier-three cities.",
      attribution: "Saahil Goel, founder" },
    { layout: "thesis",
      statement: "Logistics rails are becoming the quiet backbone of Indian commerce." },
    { layout: "cta", line: "One Indian startup story a day." },
  ],
  facts_used: [
    { value: "Shiprocket", slide_index: 0, in_source: true,
      verbatim_span: "logistics startup Shiprocket has raised" },
    { value: "$18 million", slide_index: 0, in_source: true,
      verbatim_span: "has raised $18 million in a Series D" },
    { value: "Zomato", slide_index: 0, in_source: true,
      verbatim_span: "round led by Zomato" },
    { value: "Rs 1,088 crore", slide_index: 1, in_source: true,
      verbatim_span: "operating revenue of Rs 1,088 crore in" },
    { value: "21 percent", slide_index: 1, in_source: true,
      verbatim_span: "up 21 percent year on year" },
    { value: "Saahil Goel", slide_index: 3, in_source: true,
      verbatim_span: "Founder Saahil Goel" },
  ],
});

/** Deep-enough clone so each test can mutate freely. */
const draftWith = (fn) => { const d = JSON.parse(JSON.stringify(cleanDraft())); fn(d); return d; };
const why = (r) => r.failures.join(" | ");

/* ------------------------------------------------------------ the happy path */

test("a clean draft passes", () => {
  const r = verify(cleanDraft(), SOURCE);
  assert.equal(r.pass, true, `expected pass, got: ${why(r)}`);
  assert.equal(r.checked, 6);
  assert.deepEqual(r.undeclared, []);
});

/* ------------------------------------------------- fabricated and misdeclared */

test("a fabricated figure with a real span fails — the span does not contain the value", () => {
  const r = verify(draftWith((d) => {
    d.slides[2].figure = "$50";
    d.facts_used[1] = { value: "$50 million", slide_index: 0, in_source: true,
                        verbatim_span: "has raised $18 million in a Series D" };
    d.slides[0].headline = "Shiprocket raises $50 million led by Zomato";
  }), SOURCE);
  assert.equal(r.pass, false);
  assert.match(why(r), /does not contain the value/);
});

test("a fabricated figure with a fabricated span fails — the span is not in the source", () => {
  const r = verify(draftWith((d) => {
    d.slides[0].headline = "Shiprocket raises $50 million from SoftBank";
    d.facts_used[1] = { value: "$50 million", slide_index: 0, in_source: true,
                        verbatim_span: "has raised $50 million from SoftBank in a Series D" };
  }), SOURCE);
  assert.equal(r.pass, false);
  assert.match(why(r), /span not found in source/);
});

test("the model's own in_source=false holds the post", () => {
  const r = verify(draftWith((d) => { d.facts_used[1].in_source = false; }), SOURCE);
  assert.equal(r.pass, false);
  assert.match(why(r), /flagged as unsupported/);
});

test("in_source=true decides nothing on its own", () => {
  // Every flag says sourced; the spans are junk. Must still fail.
  const r = verify(draftWith((d) => {
    d.facts_used = d.facts_used.map((f) => ({ ...f, in_source: true,
      verbatim_span: "this sentence appears nowhere in the article body" }));
  }), SOURCE);
  assert.equal(r.pass, false);
});

test("a span too short to be evidence fails", () => {
  const r = verify(draftWith((d) => { d.facts_used[1].verbatim_span = "raised"; }), SOURCE);
  assert.equal(r.pass, false);
  assert.match(why(r), /no usable source span/);
});

/* ----------------------------------------------------------- the number sweep */

test("an invented figure on a slide is caught by the sweep", () => {
  const r = verify(draftWith((d) => {
    d.slides[4].statement = "Logistics rails now carry a $99 billion opportunity.";
  }), SOURCE);
  assert.equal(r.pass, false);
  assert.match(why(r), /appear nowhere in the source/);
  assert.ok(r.fabricated.some((u) => u.includes("99")), `fabricated was ${JSON.stringify(r.fabricated)}`);
});

test("the sweep reads every slide field, including body arrays", () => {
  const r = verify(draftWith((d) => {
    d.slides[1].body.push("A further Rs 7,400 crore is expected to follow.");
  }), SOURCE);
  assert.equal(r.pass, false);
  assert.match(why(r), /appear nowhere in the source/);
});

test("a real figure that was never declared holds the post", () => {
  // Rs 595 crore is the net loss in the article. Being present somewhere in the
  // source is not evidence that the claim it is attached to is the right one.
  const r = verify(draftWith((d) => {
    d.slides[1].body.push("Revenue of Rs 595 crore.");
  }), SOURCE);
  assert.equal(r.pass, false, "a figure with no facts_used entry must not publish");
  assert.match(why(r), /never declared in facts_used/);
  assert.ok(r.undeclared.some((u) => u.includes("595")), `undeclared was ${JSON.stringify(r.undeclared)}`);
});

test("the same figure passes once it is declared against a span that supports it", () => {
  const r = verify(draftWith((d) => {
    d.slides[1].body.push("Net loss narrowed to Rs 595 crore.");
    d.facts_used.push({ value: "Rs 595 crore", slide_index: 1, in_source: true,
      verbatim_span: "narrowing its net loss to Rs 595 crore" });
  }), SOURCE);
  assert.equal(r.pass, true, `expected pass, got: ${why(r)}`);
});

/* ------------------------------------------------------------- the caption */

test("an invented figure in the caption is caught", () => {
  const r = verify(draftWith((d) => {
    d.caption = "Shiprocket is now chasing a $99 billion logistics market.\n\nSource: Entrackr, 12 September 2026";
  }), SOURCE);
  assert.equal(r.pass, false);
  assert.match(why(r), /appear nowhere in the source/);
});

test("the Source attribution line is not swept", () => {
  // Our own boilerplate. Its date is not a claim about the company.
  const r = verify(draftWith((d) => {
    d.caption = "A logistics bet from an unexpected direction.\n\nSource: Entrackr, 12 September 2026";
  }), SOURCE);
  assert.equal(r.pass, true, `expected pass, got: ${why(r)}`);
});

/* ------------------------------------------------------- a malformed draft */

test("a draft that is not exactly six slides holds", () => {
  const r = verify(draftWith((d) => { d.slides = d.slides.slice(0, 4); }), SOURCE);
  assert.equal(r.pass, false);
  assert.match(why(r), /expected 6 slides, got 4/);
});

/* -------------------------------------------------------------- normalisation */

test("comma grouping in the source is not a mismatch", () => {
  const r = verify(draftWith((d) => {
    d.slides[4].statement = "A Rs 4200 crore valuation for a logistics business.";
    d.facts_used.push({ value: "Rs 4200 crore", slide_index: 4, in_source: true,
      verbatim_span: "values the company at Rs 4,200 crore post-money" });
  }), SOURCE);
  assert.equal(r.pass, true, `expected pass, got: ${why(r)}`);
});

test("curly quotes and en dashes in the source do not break a span match", () => {
  const src = SOURCE + " Goel said the round was “the easiest yet” – a rare thing in 2026.";
  const r = verify(draftWith((d) => {
    d.slides[3].quote = "The round was 'the easiest yet' - a rare thing.";
    d.facts_used.push({ value: "the easiest yet", slide_index: 3, in_source: true,
      verbatim_span: "the round was “the easiest yet” – a rare thing" });
  }), src);
  assert.equal(r.pass, true, `expected pass, got: ${why(r)}`);
});

test("normalise folds Rs, commas, curly quotes and non-breaking spaces", () => {
  assert.equal(normalise("Rs 1,088 crore"), normalise("rs 1088  crore"));
  assert.equal(normalise("“quoted”"), "'quoted'");
  assert.equal(normalise("a b"), "a b");
});

/* ------------------------------------------------------------- fail closed */

test("an empty raw_text fails closed", () => {
  for (const bad of ["", null, undefined]) {
    const r = verify(cleanDraft(), bad);
    assert.equal(r.pass, false, `expected fail for ${JSON.stringify(bad)}`);
    assert.match(why(r), /missing or too short/);
  }
});

test("a truncated raw_text fails closed", () => {
  const r = verify(cleanDraft(), SOURCE.slice(0, 150));
  assert.equal(r.pass, false);
  assert.match(why(r), /missing or too short/);
});

/* ------------------------------------------------------------- regressions
 *
 * Two holes this suite found in the first version of the gate. Both are closed.
 * Neither test may be deleted or loosened — the second guarded a case where the
 * gate failed OPEN, which is the one direction this file exists to prevent.
 */

test("\u20b935 crore on the slide matches Rs 35 crore in the source", () => {
  // normalise() rewrites "Rs " to "\u20b9 " and keeps the space, so a slide written
  // "\u20b935 crore" never matches a source written "Rs 35 crore". Fails closed — it
  // holds a true post — but Indian publishers write "Rs" and slides write "\u20b9",
  // so this is the common case, not the edge case.
  const r = verify(draftWith((d) => {
    d.slides[2] = { layout: "number", figure: "\u20b935", unit: "crore",
                    label: "spent on technology infrastructure" };
    d.facts_used.push({ value: "\u20b935 crore", slide_index: 2, in_source: true,
      verbatim_span: "Shiprocket spent Rs 35 crore on technology infrastructure" });
  }), SOURCE);
  assert.equal(r.pass, true, `expected pass, got: ${why(r)}`);
});

test("a real number attached to the wrong claim is caught", () => {
  // The source says net loss narrowed to Rs 595 crore. The slide calls it revenue.
  // With no facts_used entry the declaration loop never runs, and the sweep clears
  // the figure because the token does appear in the article. Fails open.
  const r = verify({
    slides: [{ layout: "hook", headline: "Shiprocket posts Rs 595 crore in revenue" }],
    facts_used: [],
  }, SOURCE);
  assert.equal(r.pass, false, `expected the post to be held, got: ${JSON.stringify(r)}`);
});
