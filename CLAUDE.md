# Curious Desk — context for Claude Code

## What this is

An autonomous daily Instagram carousel for **Curious Ventures**, a ~$10M pre-seed
Indian VC fund. Partner and decision-maker is **Ashish**. One post a day about the
Indian startup/VC market, same visual template every time, published with no one
touching it. Built by an external contractor (the user), not by the fund.

Read `README.md` first — it is the setup runbook. This file is the *why*, and the
list of things that are still undecided.

## Status

Scaffolded, never executed. No `npm install` has been run, no API has been called.
Every file passes `node --check`. Expect the first real run to surface feed URLs
that have moved and at least one publisher whose article body will not extract.

**First session goal: get `npm run draft` to complete end to end and put a real
card in Telegram. Publish nothing yet.**

## Architecture decisions already made — do not relitigate without asking

- **No n8n.** The original plan used n8n Cloud. Rejected: the fact check is custom
  string logic, the Telegram approve/skip is a state machine, and the Graph API
  publish needs polling between steps. All of that becomes Code nodes anyway, minus
  git history and stack traces. One Node service with cron instead.
- **No Cloudinary.** htmlcsstoimage already returns a public CDN URL, which was the
  only reason Cloudinary was in the stack. Meta fetches straight from hcti.io.
- **htmlcsstoimage over Placid.** The template will be edited constantly for two
  months. Placid puts it in a drag-and-drop editor with no diff and no way to
  auto-fit variable-length headlines. HCTI runs our own HTML/CSS and executes JS.
  Local Puppeteer is the escape hatch and uses the identical template file.
- **No AI image generation.** The format is typographic. Generated images destroy
  the consistency that makes a daily grid readable.
- **No Google News RSS.** Its items link to `news.google.com` redirects with an
  encoded target, so dedupe-on-URL never matches and the body fetch returns a
  consent page. Direct publisher feeds only. See the comment in `src/ingest.js`.
- **SQLite, not Supabase.** One writer, under a hundred rows a day, and no browser
  ever touches the data. A hosted Postgres bought a signup, a service-role key and a
  second thing that can be down at 21:05. `node:sqlite` is built into Node, so the
  dependency count went down. The tradeoff is that the data lives on the host's disk:
  use an absolute `DB_PATH` and a mounted volume if the filesystem is ephemeral.
- **Article bodies are fetched, not just RSS summaries.** Without the body, the
  fact gate has nothing to check against and is decorative.

## The thing that must not break

`src/verify.js`. A fund publishing an invented number about a named company is a
legal problem, not a quality problem.

The model declares, for every fact on a slide, a span of source text containing it,
copied character for character. The verifier substring-matches each span against the
stored article body, checks the span actually contains the claimed value, and then
independently sweeps the slides for figures the model never declared. Any failure
holds the post.

The model's own `in_source` boolean is recorded and **decides nothing**. A model that
invents a figure will flag it as sourced. Do not "simplify" the verifier by trusting it.

Related editorial rule, enforced in the prompt: Wednesday is post-mortem, not gossip.
Only shutdowns already reported as fact by a source. No claim about any named person's
conduct, honesty or private life, ever.

## Known traps

- Instagram must be a **Business** account (not Creator), linked to a Facebook Page
  Curious controls, with Page Publishing Authorization complete.
- The Meta app needs the IG account added as an **Instagram Tester**. This skips app
  review entirely, saving 2–4 weeks. Review is only mandatory for publishing to
  accounts you do not own.
- Graph carousel containers are **not ready when the API returns their id**. Meta is
  still fetching the image. `waitFinished()` polls each child and the parent. Do not
  remove it — the failure is intermittent, so it passes testing and breaks in week three.
- Long-lived Page tokens expire in ~60 days.
- `IG_USER_ID` is the numeric Instagram Business account ID, not the handle.
- Telegram group chat IDs are negative numbers.
- HCTI renders at 2x by default. `device_scale: 1` is set deliberately because the
  template is already at final pixel size (1080×1350).

## Still undecided — ask the user, do not choose

1. **The Instagram handle for the new Curious page.** Never decided. Goes in `.env`
   as `IG_HANDLE` and renders on slide 6 of every post. Nothing publishes without it.
2. **Brand red and the display serif.** Currently placeholders (`--red: #D11A1A`,
   Instrument Serif) at the top of `template/slide.html`. Needs the real values from
   the existing Curious grid.
3. **Wednesday fallback** when no shutdown qualifies. Currently skips the day and
   pings Telegram. Alternative is falling back to another day's format.

## Sequencing note for the wider project (not code)

There is a separate rebrand job: the existing `curiousventures.xyz` Instagram (512
followers) becomes Ashish's personal page at `thesood.ashish`. **Create and reserve
the new Curious handle first, then rename the old one** — otherwise the freed handle
can be squatted. Existing thesis posts get archived and reposted to the new page so
it is not empty on day one.

## Working style

The user wants concrete output, argued decisions rather than option lists, and no
padding. Plain English, no jargon for its own sake. When explaining something, trace
the flow rather than list facts. Push back with reasoning when a request would produce
something worse.
