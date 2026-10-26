-- Unsubscribing from marketing email (the admin Email Blast, lib/email-unsubscribe.ts).
-- Shared database; only the new site reads or writes these tables. Additive and
-- safe to run more than once.
--
-- Every blast gives each address a fresh random token: the email links
-- /email/unsubscribe?token=<token> and carries List-Unsubscribe headers that
-- POST to /api/email/unsubscribe?token=<token> (one-click in Gmail and Yahoo).
-- Only the token's SHA-256 is stored, so the table can't be used to make links.
-- Old links keep working. Using one adds the address to email_unsubscribes,
-- and every later blast skips it. Order, shipping and account emails are not
-- marketing and still go out.

create table if not exists email_unsubscribe_tokens (
  token_hash text primary key,
  -- The recipient, lowercased
  email text not null,
  created_at timestamptz not null default now()
);
create index if not exists email_unsubscribe_tokens_email_idx on email_unsubscribe_tokens (email);
-- Service role only (no policies)
alter table email_unsubscribe_tokens enable row level security;

create table if not exists email_unsubscribes (
  -- The address, lowercased
  email text primary key,
  unsubscribed_at timestamptz not null default now()
);
-- Service role only (no policies)
alter table email_unsubscribes enable row level security;
