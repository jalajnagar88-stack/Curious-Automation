# Curious Desk

One Instagram carousel a day for Curious Ventures. Picks the story, writes six
slides, verifies every fact against the source, renders, asks for one tap, publishes
at 08:00, reports the numbers the next morning.

```
21:05  ingest -> fetch bodies -> Claude picks + writes -> fact gate -> render -> Telegram
 ~any  you tap Approve or Skip
08:00  publish carousel -> Telegram confirmation with the live link
08:05  yesterday's reach / saves / shares
```

## Layout

```
prompt/select_and_write.md     the system prompt (edited as prose, loaded at runtime)
prompt/slides.schema.json      the contract the model output must satisfy
template/slide.html            one file, six layouts, brand tokens at the top
template/preview.html          open this to iterate on the design, no pipeline needed
sql/001_init.sql               the single Supabase table
src/ingest.js                  feeds, dedupe, article body extraction
src/claude.js                  the one model call
src/verify.js                  the fact gate — read this one carefully
src/render.js                  htmlcsstoimage, with a local Puppeteer fallback
src/telegram.js                approval card and long-poll listener
src/instagram.js               Graph API carousel flow with container polling
src/pipeline.js                the three jobs
src/index.js                   cron + entrypoint
```

## Setup

**1. Supabase.** Create a project. Run `sql/001_init.sql` in the SQL editor. Copy the
project URL and the *service role* key into `.env`.

**2. Instagram.** The account must be a **Business** account, not Creator — Creator
accounts cannot be linked to a Page cleanly and content publishing will fail. Link it
to a Facebook Page that Curious controls, and complete Page Publishing Authorization
on that Page before you go near the API.

**3. Meta app.** Create an app at developers.facebook.com, add the Instagram product,
then add the Instagram account as an **Instagram Tester** and accept the invite from
the account's settings. This is the step that skips app review: review is only required
to publish to accounts you do not own. Generate a long-lived Page access token and put
the token and the Instagram Business account ID (a numeric ID, not the handle) in `.env`.

**4. Telegram.** Talk to @BotFather, create a bot, take the token. Add the bot to a
group with Ashish, then read the group's chat ID (send a message and hit
`https://api.telegram.org/bot<TOKEN>/getUpdates`). Group IDs are negative numbers.

**5. htmlcsstoimage.** Sign up, take the user ID and API key. Essentials covers this
at roughly 186 renders a month.

**6. Run.**

```bash
cp .env.example .env      # fill it in
npm install
npm run draft             # does everything up to the Telegram card, publishes nothing
```

`npm start` runs the scheduler. `npm run publish` and `npm run report` fire those jobs
by hand.

## The fact gate

This is the part that protects the fund, so it is worth understanding.

The model must declare, for every number and name it puts on a slide, a span of source
text containing it, copied character for character. `src/verify.js` then:

1. normalises both sides (case, curly quotes, `Rs` to `₹`, commas, whitespace),
2. checks each declared span appears in the stored article body by exact substring match,
3. checks the declared span actually contains the value it claims to support,
4. independently sweeps the slides for figures the model never declared.

Any failure sets the row to `held`, sends the failures to Telegram, and publishes nothing.
The model's own `in_source` boolean is recorded but never decides anything — a model that
invents a figure will happily flag it as sourced.

## Going hands-off

Leave `AUTO_APPROVE=false` for the first 30 days. Every night you get a card and tap once.
Keep the drafts you would have rejected; on day 30, read them back and tighten the prompt
against the specific failures, then flip `AUTO_APPROVE=true`. Even then, low-confidence
drafts still wait for a human — `MIN_CONFIDENCE` overrides auto-approve.

## Known constraints

- Carousels take 2–10 images. Every slide crops to the first image's ratio, so all six
  render at 1080×1350.
- Meta allows 50 posts per 24 hours. This uses one.
- Long-lived Page tokens expire in about 60 days. Refresh them or the 08:00 job starts
  failing silently into Telegram. Put a reminder in the calendar now.
- Google News RSS is deliberately not in the feed list. See the comment in `src/ingest.js`.
- Sunday is not handled here. The prompt returns `blocked: true` for it by design.
