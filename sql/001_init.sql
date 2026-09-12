-- Curious Desk — single table, one row per candidate story.

create table if not exists posts (
  id            bigserial primary key,
  source_url    text not null unique,
  source_title  text,
  source_domain text,
  source_date   timestamptz,
  raw_summary   text,
  raw_text      text,                 -- full article body; the fact check runs against this
  status        text not null default 'new'
                check (status in ('new','selected','drafted','held','approved','posted','skipped','failed')),
  day_format    text,
  reason        text,
  slides_json   jsonb,
  caption       text,
  hashtags      text[],
  facts_used    jsonb,
  confidence    numeric,
  fact_report   jsonb,
  image_urls    text[],
  ig_post_id    text,
  ig_permalink  text,
  insights      jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  posted_at     timestamptz
);

create index if not exists posts_status_idx      on posts (status);
create index if not exists posts_created_idx     on posts (created_at desc);
create index if not exists posts_source_date_idx on posts (source_date desc);
