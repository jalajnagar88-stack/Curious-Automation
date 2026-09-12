import Parser from "rss-parser";
import { extract } from "@extractus/article-extractor";
import { insertCandidates } from "./db.js";
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

const parser = new Parser({ timeout: 20000 });
const MAX_BODY = 6000;

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

async function body(url) {
  try {
    const a = await extract(url, {}, { signal: AbortSignal.timeout(25000) });
    const text = (a?.content || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 400 ? text.slice(0, MAX_BODY) : null;
  } catch (e) {
    log("body fetch failed", url, e.message);
    return null;
  }
}

/** Pull every feed, keep the last `hours`, fetch article bodies, store new rows. */
export async function ingest(hours = 48) {
  const cutoff = Date.now() - hours * 3600e3;
  const seen = new Set();
  const items = [];

  for (const f of FEEDS) {
    try {
      const feed = await parser.parseURL(f.url);
      for (const it of feed.items || []) {
        const url = canonical(it.link || "");
        if (!url || seen.has(url)) continue;
        const when = new Date(it.isoDate || it.pubDate || Date.now());
        if (isNaN(when) || when.getTime() < cutoff) continue;
        seen.add(url);
        items.push({
          source_url: url,
          source_title: (it.title || "").trim(),
          source_domain: domainOf(url),
          source_date: when.toISOString(),
          raw_summary: (it.contentSnippet || "").slice(0, 800),
        });
      }
    } catch (e) {
      log("feed failed", f.name, e.message);
    }
  }

  log(`ingest: ${items.length} items inside ${hours}h from ${FEEDS.length} feeds`);

  // Only fetch bodies for URLs we have not stored before.
  const fresh = await insertCandidates(items);
  log(`ingest: ${fresh.length} new after dedupe`);

  let filled = 0;
  for (const row of fresh) {
    const text = await body(row.source_url);
    if (text) {
      const { update } = await import("./db.js");
      await update(row.id, { raw_text: text });
      filled++;
    }
    await new Promise((r) => setTimeout(r, 700)); // be polite to publishers
  }
  log(`ingest: ${filled} bodies extracted`);
  return filled;
}
