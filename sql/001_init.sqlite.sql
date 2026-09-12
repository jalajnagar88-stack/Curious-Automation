-- Curious Desk — single table, one row per candidate story. SQLite dialect.
--
-- Differences from the Postgres original, and why they are safe here:
--   bigserial      -> integer primary key autoincrement
--   timestamptz    -> text holding an ISO-8601 UTC string. Every comparison in
--                     src/db.js is a range scan on that format, and ISO UTC
--                     sorts correctly as plain text, so BETWEEN and >= behave.
--   jsonb, text[]  -> text holding JSON. src/db.js encodes on write and decodes
--                     on read, so callers still see objects and arrays.
--   numeric        -> real
-- The check constraint and the unique index on source_url carry over unchanged;
-- the unique index is what makes dedupe-on-URL work.

create table if not exists posts (
  id            integer primary key autoincrement,
  source_url    text not null unique,
  source_title  text,
  source_domain text,
  source_date   text,
  raw_summary   text,
  raw_text      text,                 -- full article body; the fact check runs against this
  status        text not null default 'new'
                check (status in ('new','selected','drafted','held','approved','posted','skipped','failed')),
  day_format    text,
  reason        text,
  slides_json   text,                 -- json
  caption       text,
  hashtags      text,                 -- json array
  facts_used    text,                 -- json
  confidence    real,
  fact_report   text,                 -- json
  image_urls    text,                 -- json array
  ig_post_id    text,
  ig_permalink  text,
  insights      text,                 -- json
  error         text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  posted_at     text
);

create index if not exists posts_status_idx      on posts (status);
create index if not exists posts_created_idx     on posts (created_at desc);
create index if not exists posts_source_date_idx on posts (source_date desc);
