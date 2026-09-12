import Parser from "rss-parser";
import { extractFromHtml, extract } from "@extractus/article-extractor";
import { insertCandidates, update, bodylessRows } from "./db.js";
import { log } from "./config.js";

/*
 * Direct publisher feeds only.
 *
 * Google News RSS is deliberately excluded. Its items link to news.google.com
 * redirects with an encoded target, so (a) dedupe-on-URL never matches the same
 * story arriving from a publisher feed, and (b) the body fetch returns a consent
 * page instead of an article. Add publishers here instead of standing queries.
 */
export const FEEDS = [
  { name: "Entrackr",       url: "https://entrackr.com/feed" },
  { name: "Inc42",          url: "https://inc42.com/feed/" },
  { name: "VCCircle",       url: "https://www.vccircle.com/rss/all" },
  { name: "YourStory",      url: "https://yourstory.com/feed" },
  { name: "Moneycontrol",   url: "https://www.moneycontrol.com/rss/startups.xml" },
  { name: "ET Tech",        url: "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms" },
];

/*
 * Several Indian publishers return an empty body, a consent interstitial or a
 * 403 to a default Node user agent, which surfaces as "extractor found no
 * article node" and sends you looking in the wrong place. Fetching the HTML
 * ourselves with a browser UA separates the two failures: zero bytes means the
 * site refused us, non-zero bytes with no extraction means the extractor could
 * not find the article node on that layout.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const FETCH_HEADERS = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-IN,en;q=0.9",
};

const parser = new Parser({
  timeout: 20000,
  headers: { "user-agent": UA, accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8" },
});

const MAX_BODY = 6000;
const MIN_BODY = 400;

const res_ok = (s) => s >= 200 && s < 300;

const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** Strip tracking params so the same story from two feeds dedupes to one row. */
export function canonical(url) {
  try {
    const u = new URL(url);
    [...u.searchParams.keys()]
      .filter((k) => /^(utm_|fbclid|gclid|ref|source)/i.test(k))
      .forEach((k) => u.searchParams.delete(k));
    u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch { return url; }
}

const clean = (html) =>
  (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Fetch and extract one article body.
 * Returns { text, reason, htmlLength, status } — text is null on failure and
 * `reason` says which of the two failure modes it was, for the ingest report.
 */
export async function body(url) {
  let html = "";
  let status = 0;
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    status = res.status;
    html = await res.text();
  } catch (e) {
    return { text: null, reason: `fetch failed: ${e.message}`, htmlLength: 0, status };
  }

  if (!res_ok(status)) return { text: null, reason: `http ${status}`, htmlLength: html.length, status };
  if (!html.length) return { text: null, reason: "empty response body", htmlLength: 0, status };

  // Our own fetch first (it carries the browser UA), then the library's own
  // fetch as a second chance in case the page needed different handling.
  for (const attempt of [
    () => extractFromHtml(html, url),
    () => extract(url, {}, { signal: AbortSignal.timeout(25000) }),
  ]) {
    try {
      const text = clean((await attempt())?.content);
      if (text.length > MIN_BODY) return { text: text.slice(0, MAX_BODY), reason: null, htmlLength: html.length, status };
    } catch { /* fall through to the next attempt */ }
  }

  return {
    text: null,
    reason: `extractor found no article node in ${html.length} bytes of html`,
    htmlLength: html.length,
    status,
  };
}

/**
 * Pull every feed, keep the last `hours`, fetch article bodies, store new rows.
 *
 * `dry` runs the whole thing without the database: feeds are parsed, deduped in
 * memory and bodies fetched, but nothing is written. Use it to prove the feeds
 * and the extractor before credentials exist.
 */
export async function ingest(hours = 48, { dry = false, feeds = FEEDS, limit = Infinity } = {}) {
  const cutoff = Date.now() - hours * 3600e3;
  const seen = new Set();
  const items = [];
  const report = { hours, dry, feeds: [], bodies: [] };

  for (const f of feeds) {
    const stat = { name: f.name, url: f.url, total: 0, inWindow: 0, kept: 0, error: null };
    try {
      const feed = await parser.parseURL(f.url);
      const list = feed.items || [];
      stat.total = list.length;
      for (const it of list) {
        const url = canonical(it.link || "");
        if (!url) continue;
        const when = new Date(it.isoDate || it.pubDate || Date.now());
        if (isNaN(when) || when.getTime() < cutoff) continue;
        stat.inWindow++;
        if (seen.has(url)) continue;          // same story already taken from an earlier feed
        seen.add(url);
        stat.kept++;
        items.push({
          source_url: url,
          source_title: (it.title || "").trim(),
          source_domain: domainOf(url),
          source_date: when.toISOString(),
          raw_summary: (it.contentSnippet || "").slice(0, 800),
          _feed: f.name,
        });
      }
    } catch (e) {
      stat.error = e.message;
      log("feed failed", f.name, e.message);
    }
    report.feeds.push(stat);
  }

  log(`ingest: ${items.length} items inside ${hours}h from ${feeds.length} feeds`);

  // Only fetch bodies for URLs we have not stored before.
  const fresh = dry
    ? items
    : await insertCandidates(items.map(({ _feed, ...row }) => row));
  log(`ingest: ${fresh.length} new after dedupe`);

  // `limit` caps how many bodies we fetch in one pass; the rows are already
  // stored, so an interrupted run just leaves raw_text null for the remainder.
  const targets = limit === Infinity ? fresh : fresh.slice(0, limit);

  const byUrl = new Map(items.map((i) => [i.source_url, i]));

  let filled = 0;
  for (const row of targets) {
    const src = byUrl.get(row.source_url);
    const r = await body(row.source_url);
    if (r.text && !dry) await update(row.id, { raw_text: r.text });
    if (r.text) filled++;
    else log("body fetch failed", row.source_url, r.reason);
    report.bodies.push({
      feed: src?._feed || domainOf(row.source_url),
      domain: row.source_domain || domainOf(row.source_url),
      url: row.source_url,
      title: row.source_title,
      chars: r.text ? r.text.length : 0,
      htmlLength: r.htmlLength,
      reason: r.reason,
    });
    await new Promise((r) => setTimeout(r, 700)); // be polite to publishers
  }
  log(`ingest: ${filled} bodies extracted`);

  report.itemsSeen = items.length;
  report.newRows = fresh.length;
  report.bodiesAttempted = targets.length;
  report.withBody = filled;
  return report;
}

/**
 * Re-attempt the body fetch for rows stored earlier that still have no raw_text.
 *
 * Worth running before you conclude a publisher cannot be extracted at all: a
 * single failed fetch tells you very little, the same failure twice tells you
 * whether to reach for a User-Agent or for a site-specific selector.
 */
export async function retryBodies(hours = 48, { limit = Infinity } = {}) {
  const rows = await bodylessRows(hours);
  const targets = limit === Infinity ? rows : rows.slice(0, limit);
  const report = { hours, dry: false, retry: true, feeds: [], bodies: [] };
  log(`retry: ${rows.length} stored rows in the last ${hours}h have no raw_text`);

  let filled = 0;
  for (const row of targets) {
    const r = await body(row.source_url);
    if (r.text) { await update(row.id, { raw_text: r.text }); filled++; }
    else log("body retry failed", row.source_url, r.reason);
    report.bodies.push({
      feed: row.source_domain || domainOf(row.source_url),
      domain: row.source_domain || domainOf(row.source_url),
      url: row.source_url,
      title: row.source_title,
      chars: r.text ? r.text.length : 0,
      htmlLength: r.htmlLength,
      reason: r.reason,
    });
    await new Promise((r) => setTimeout(r, 700));
  }
  log(`retry: ${filled} bodies recovered`);
  report.itemsSeen = rows.length;
  report.newRows = 0;
  report.bodiesAttempted = targets.length;
  report.withBody = filled;
  return report;
}

/** The table asked for at the end of step 3: rows per publisher, bodies per publisher. */
export function printReport(r) {
  const pad = (s, n) => String(s).padEnd(n);
  if (r.feeds.length) {
    console.log(`\n=== feeds (last ${r.hours}h)${r.dry ? " · DRY RUN, nothing written" : ""} ===`);
    console.log(pad("publisher", 14), pad("items", 7), pad("in window", 11), pad("kept", 6), "status");
    for (const f of r.feeds)
      console.log(pad(f.name, 14), pad(f.total, 7), pad(f.inWindow, 11), pad(f.kept, 6),
        f.error ? `FAILED — ${f.error}` : "ok");
  } else if (r.retry) {
    console.log(`\n=== retry (stored rows with no raw_text, last ${r.hours}h) ===`);
  }

  const groups = new Map();
  for (const b of r.bodies) {
    const g = groups.get(b.feed) || { ok: 0, fail: 0, reasons: [] };
    if (b.chars) g.ok++; else { g.fail++; g.reasons.push(b.reason); }
    groups.set(b.feed, g);
  }

  console.log(`\n=== article bodies ===`);
  console.log(pad("publisher", 14), pad("raw_text", 10), pad("null", 6), "first failure");
  for (const [name, g] of groups)
    console.log(pad(name, 14), pad(g.ok, 10), pad(g.fail, 6), g.reasons[0] || "");

  console.log(r.retry
    ? `\nrows retried ${r.bodiesAttempted} of ${r.itemsSeen} · recovered ${r.withBody}`
    : `\nitems in window ${r.itemsSeen} · new rows ${r.newRows} · non-null raw_text ${r.withBody}`);
  if (r.retry) return;
  if (r.withBody < 5)
    console.log(`\nStep 3 gate NOT met: NEXT.md requires at least 5 rows with a non-null raw_text.`);
  else
    console.log(`\nStep 3 gate met: ${r.withBody} rows have a non-null raw_text.`);
}
