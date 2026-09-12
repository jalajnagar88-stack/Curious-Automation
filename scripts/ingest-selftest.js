/*
 * Offline self-test for the ingest step.
 *
 * Serves fixture RSS and article HTML on 127.0.0.1 and runs the real ingest()
 * against it, so the feed window, URL canonicalisation, cross-feed dedupe and
 * both body-failure modes can be checked without the open internet, without a
 * publisher's rate limit, and without Supabase.
 *
 * This proves the logic, not the feeds. Only a real `npm run ingest -- --dry`
 * tells you whether a publisher's feed URL has moved.
 *
 *   node scripts/ingest-selftest.js
 */
import http from "node:http";
import { ingest, printReport } from "../src/ingest.js";

const now = Date.now();
const iso = (hoursAgo) => new Date(now - hoursAgo * 3600e3).toUTCString();

const PARA = "Bengaluru-based logistics startup Shiprocket has raised $18 million in a Series D round led by Zomato, with participation from Bertelsmann India Investments. The round values the company at roughly ₹4,200 crore post-money. Founder Saahil Goel said the capital will fund expansion into tier-three cities over the next eighteen months. The company reported operating revenue of ₹1,088 crore in FY24, up 21 percent year on year, while narrowing its net loss to ₹595 crore from ₹341 crore a year earlier. Shiprocket has now raised a cumulative $280 million across nine rounds since it was founded in 2017. ".repeat(3);

const article = (title) => `<!doctype html><html><head><title>${title}</title>
<meta property="og:title" content="${title}"></head><body><header>nav</header>
<article><h1>${title}</h1><p>${PARA}</p><p>${PARA}</p></article>
<footer>footer</footer></body></html>`;

const stories = {
  "/a/story-1": "Shiprocket raises $18M Series D",
  "/a/story-2": "Zepto posts first positive contribution margin",
  "/a/story-3": "Accel closes $650M India fund VIII",
  "/a/story-4": "Byju's lenders move NCLT over $1.2B loan",
  "/b/story-5": "Groww files DRHP for ₹6,000 crore IPO",
  "/b/story-6": "Ola Electric cuts 500 roles across three units",
};

const srv = http.createServer((req, res) => {
  const p = req.url.split("?")[0];

  if (p === "/feed-a") {                                  // healthy feed
    const items = [
      ...Object.keys(stories).filter((k) => k.startsWith("/a/")).map((k, i) => [k, 2 + i]),
      ["/a/story-1", 6],                                  // duplicate inside the same feed
      ["/a/stale", 200],                                  // outside the 48h window
    ];
    return rss(res, items);
  }
  if (p === "/feed-b") {                                  // overlaps feed A on story-1
    return rss(res, [["/b/story-5", 3], ["/b/story-6", 4], ["/b/blocked", 5], ["/b/no-article", 6], ["/a/story-1", 7]]);
  }
  if (p === "/feed-dead") { res.writeHead(404); return res.end("Not Found"); }

  if (p === "/b/blocked") {                               // publisher refuses us: zero bytes
    res.writeHead(403, { "content-type": "text/html" });
    return res.end("");
  }
  if (p === "/b/no-article") {                            // served fine, no article node
    res.writeHead(200, { "content-type": "text/html" });
    return res.end("<!doctype html><html><body><div id=app></div><script>window.__DATA__={}</script></body></html>");
  }
  if (stories[p] || p === "/a/stale") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(article(stories[p] || "Stale story"));
  }
  res.writeHead(404); res.end("nope");
});

function rss(res, items) {
  const body = `<?xml version="1.0"?><rss version="2.0"><channel><title>fixture</title>
${items.map(([path, h]) => `<item><title>${(stories[path] || path).replace(/&/g, "&amp;")}</title>
<link>http://127.0.0.1:8731${path}?utm_source=rss&amp;utm_medium=feed</link>
<pubDate>${iso(h)}</pubDate><description>summary text</description></item>`).join("\n")}
</channel></rss>`;
  res.writeHead(200, { "content-type": "application/rss+xml" });
  res.end(body);
}

await new Promise((r) => srv.listen(8731, "127.0.0.1", r));

const report = await ingest(48, {
  dry: true,
  feeds: [
    { name: "TestWire",  url: "http://127.0.0.1:8731/feed-a" },
    { name: "TestDaily", url: "http://127.0.0.1:8731/feed-b" },
    { name: "DeadFeed",  url: "http://127.0.0.1:8731/feed-dead" },
  ],
});
printReport(report);

const urls = report.bodies.map((b) => b.url);
console.log("\n--- assertions ---");
let failed = 0;
const check = (name, cond) => {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}`);
};
check("tracking params stripped", urls.every((u) => !u.includes("utm_")));
check("cross-feed duplicate collapsed to one row", urls.filter((u) => u.endsWith("/a/story-1")).length === 1);
check("story outside 48h window excluded", !urls.some((u) => u.includes("/a/stale")));
check("dead feed reported, not silently dropped", report.feeds.find((f) => f.name === "DeadFeed")?.error?.includes("404"));
check("403 with zero bytes reported as http 403",
  report.bodies.find((b) => b.url.includes("blocked"))?.reason === "http 403");
check("200 with no article node reported with html length",
  /no article node in \d+ bytes/.test(report.bodies.find((b) => b.url.includes("no-article"))?.reason || ""));
check("at least 5 bodies extracted", report.withBody >= 5);

srv.close();
if (failed) { console.error(`\n${failed} assertion(s) failed.`); process.exit(1); }
console.log("\ningest self-test passed.");
