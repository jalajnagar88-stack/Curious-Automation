/*
 * The fact gate.
 *
 * The model reports, for every fact it put on a slide, a span of source text it
 * claims contains that fact. We do not trust the report. We check each span by
 * exact substring match against the stored article body, then independently sweep
 * the slides for numbers the model forgot to declare.
 *
 * Any failure holds the post. Nothing here publishes on the model's own word.
 */

const NUM = /(?:₹|Rs\.?|\$|€|£)?\s?\d[\d,.]*\s?(?:%|percent|crore|cr\b|lakh|lakhs|million|mn\b|billion|bn\b|k\b|x\b)?/gi;

/** Fold away the differences that are formatting, not fact. */
export function normalise(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\brs\.?\b/g, "₹")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    // Indian publishers write "Rs 35 crore"; a slide writes "₹35 crore". Once Rs
    // has become ₹ the only difference left is the space the currency word used
    // to need, so close it up on both sides of every comparison.
    .replace(/([₹$€£])\s+/g, "$1")
    .trim();
}

function slideText(slides) {
  return (slides || []).map((s) =>
    [s.headline, s.standfirst, s.figure, s.unit, s.label,
     s.quote, s.attribution, s.statement, s.line, ...(s.body || [])]
      .filter(Boolean).join(" ")
  ).join(" ");
}

/*
 * The caption is published alongside the images, so an invented figure there is
 * the same problem as one on a slide. The attribution line the prompt requires
 * ("Source: Entrackr, 12 September 2026") is our own boilerplate rather than a
 * claim about anyone, and its date would otherwise sweep as an undeclared
 * figure, so it is dropped before the sweep.
 */
function captionText(caption) {
  return String(caption || "")
    .split("\n")
    .filter((line) => !/^\s*source\s*:/i.test(line))
    .join(" ");
}

/**
 * @returns {{pass:boolean, failures:string[], checked:number,
 *            undeclared:string[], fabricated:string[]}}
 */
export function verify(draft, sourceText) {
  const src = normalise(sourceText);
  const failures = [];
  const facts = Array.isArray(draft.facts_used) ? draft.facts_used : [];

  if (!src || src.length < 300) {
    return { pass: false, failures: ["source body missing or too short to verify against"],
             checked: 0, undeclared: [], fabricated: [] };
  }

  // A malformed draft is one the gate cannot reason about, so it holds. The
  // schema requires exactly six slides; anything else is a truncated or mangled
  // model response, not something to render and publish.
  const slides = Array.isArray(draft.slides) ? draft.slides : [];
  if (slides.length !== 6) {
    failures.push(`expected 6 slides, got ${slides.length}`);
  }

  for (const f of facts) {
    if (f.in_source === false) {
      failures.push(`model flagged as unsupported: "${f.value}"`);
      continue;
    }
    const span = normalise(f.verbatim_span);
    if (!span || span.length < 8) {
      failures.push(`no usable source span for "${f.value}"`);
      continue;
    }
    if (!src.includes(span)) {
      failures.push(`span not found in source for "${f.value}": "${String(f.verbatim_span).slice(0, 80)}"`);
      continue;
    }
    if (!normalise(span).includes(normalise(f.value))) {
      failures.push(`declared span does not contain the value "${f.value}"`);
    }
  }

  /*
   * Independent sweep over everything that gets published — slides and caption.
   *
   * Two different failures, deliberately kept apart. A figure that is nowhere in
   * the article was invented. A figure that IS in the article but was never
   * declared is the more dangerous case: the number is real, so a check that only
   * asks "does this appear in the source" waves it through, while nothing ties it
   * to the claim it was attached to. A net loss printed as revenue passes that
   * weaker test. Both hold the post.
   */
  const declared = new Set(facts.map((f) => normalise(f.value)));
  const undeclared = [];
  const fabricated = [];
  const published = `${slideText(slides)} ${captionText(draft.caption)}`;

  for (const m of published.matchAll(NUM)) {
    const tok = normalise(m[0]);
    if (!tok || tok.length < 2) continue;
    if (/^\d{1,2}$/.test(tok)) continue;              // ordinary small integers in prose
    if ([...declared].some((d) => d.includes(tok) || tok.includes(d))) continue;
    (src.includes(tok) ? undeclared : fabricated).push(m[0].trim());
  }

  if (fabricated.length) {
    failures.push(`figures that appear nowhere in the source: ${fabricated.join(", ")}`);
  }
  if (undeclared.length) {
    failures.push(
      `figures never declared in facts_used: ${undeclared.join(", ")} — each appears ` +
      `somewhere in the article, but nothing ties it to the claim it is attached to`);
  }

  return { pass: failures.length === 0, failures, checked: facts.length, undeclared, fabricated };
}
