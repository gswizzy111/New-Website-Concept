-- Unsubscribing from marketing email (the admin Email Blast and the restoration
-- waitlist notice, lib/email-unsubscribe.ts), and Email Blast progress.
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

-- Email Blast sends (app/api/admin/email-blast). Progress lives here, not in
-- the admin's browser, so a lost reply, a closed tab or a second tab never
-- sends a part twice. Recipients go out in address order; last_email is the
-- last address handled, saved right after each batch Resend accepts.
-- locked_until is held while a request is sending ('epoch' when free).
create table if not exists email_blasts (
  -- Made by the page, so a retried first request finds the same send
  id uuid primary key,
  subject text not null,
  body text not null,
  last_email text not null default '',
  sent integer not null default 0,
  -- [{ email, reason }] for addresses Resend refused
  failed_emails jsonb not null default '[]'::jsonb,
  locked_until timestamptz not null default 'epoch',
  -- The admin's username
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Set aside unfinished ("Write a new email instead")
  discarded_at timestamptz
);
create index if not exists email_blasts_open_idx on email_blasts (created_at desc)
  where finished_at is null and discarded_at is null;
-- Service role only (no policies)
alter table email_blasts enable row level security;
