# First Claude Code session

Work in this order. Do not skip to publishing.

## 0 · Repo

```bash
git init && git add -A && git commit -m "scaffold"
cp .env.example .env
```

## 1 · Install and typo-check

```bash
npm install
node --check src/*.js
```

`puppeteer` is an optional dependency and downloads Chromium. If you are on
`RENDERER=hcti` and do not want the download:
`npm install --omit=optional`.

## 2 · Supabase

Run `sql/001_init.sql`. Fill `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.

Prove it: a one-off script that inserts and reads back a row. Do not move on
until that works — every later failure will otherwise look like a Supabase failure.

## 3 · Ingest alone

Add a `--once=ingest` branch to `src/index.js` and run just the ingest step.
Expected problems and what to do:

- **A feed 404s or times out.** Find the current URL or drop the publisher. Do not
  add Google News back.
- **Bodies extract as null for a publisher.** `@extractus/article-extractor` fails on
  some Indian news sites. Log the raw HTML length first: zero means the site blocked
  the request (try a browser User-Agent header), non-zero means the extractor could
  not find the article node (add a site-specific selector fallback).
- **Everything dedupes to nothing on the second run.** That is correct behaviour.

Do not proceed until at least 5 rows have a non-null `raw_text`.

## 4 · Claude call alone

Run the model call against the stored candidates and dump the JSON to a file. Check
by hand:
- Did it return exactly six slides in the right order?
- Do the `verbatim_span` values actually appear in the article? Grep for one.
- Is the tone right, or is it writing LinkedIn copy?

Prompt lives in `prompt/select_and_write.md`. Expect to edit it several times here.
This is the step that determines whether the whole thing is worth running.

## 5 · Verifier

Write unit tests for `src/verify.js` before trusting it. At minimum:
- a clean draft passes
- a fabricated figure fails
- `₹35 crore` in the slide matches `Rs 35 crore` in the source
- a number on a slide with no `facts_used` entry is caught by the sweep
- an empty or truncated `raw_text` fails closed

Fail-closed is the requirement. If the verifier cannot decide, it holds.

## 6 · Render

`npm run preview` and look at the six layouts before wiring HCTI. Fix the design
first — it is cheaper now than after 30 posts.

Then one HCTI call with one slide. Check the returned PNG is 1080×1350 and the
webfonts actually loaded (if the serif fell back to Georgia, raise `ms_delay`).

## 7 · Telegram

Draft card end to end. Confirm the six images arrive as an album and the buttons
update the row status.

## 8 · Instagram — last

Only after 1–7 work. Publish one test carousel manually to a throwaway Business
account before pointing it at Curious.

## Deploy

`pm2 start src/index.js --name curious-desk` on a small box, or a Railway service.
It needs no inbound ports — Telegram is long-polled, not webhooked.
