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
    .trim();
}

function slideText(slides) {
  return (slides || []).map((s) =>
    [s.headline, s.standfirst, s.figure, s.unit, s.label,
     s.quote, s.attribution, s.statement, s.line, ...(s.body || [])]
      .filter(Boolean).join(" ")
  ).join(" ");
}

/**
 * @returns {{pass:boolean, failures:string[], checked:number, undeclared:string[]}}
 */
export function verify(draft, sourceText) {
  const src = normalise(sourceText);
  const failures = [];
  const facts = Array.isArray(draft.facts_used) ? draft.facts_used : [];

  if (!src || src.length < 300) {
    return { pass: false, failures: ["source body missing or too short to verify against"],
             checked: 0, undeclared: [] };
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

  // Independent sweep: any figure on a slide that the model never declared.
  const declared = new Set(facts.map((f) => normalise(f.value)));
  const undeclared = [];
  for (const m of slideText(draft.slides).matchAll(NUM)) {
    const tok = normalise(m[0]);
    if (!tok || tok.length < 2) continue;
    if (/^\d{1,2}$/.test(tok)) continue;              // ordinary small integers in prose
    if ([...declared].some((d) => d.includes(tok) || tok.includes(d))) continue;
    if (src.includes(tok)) continue;                  // present in source anyway
    undeclared.push(m[0].trim());
  }
  if (undeclared.length) {
    failures.push(`figures on slides that are neither declared nor in the source: ${undeclared.join(", ")}`);
  }

  return { pass: failures.length === 0, failures, checked: facts.length, undeclared };
}
