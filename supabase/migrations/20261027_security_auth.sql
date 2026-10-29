-- Security fixes for sign-up, sign-in and the Kit Club manage page (fix list
-- items 38 and 43). Additive and idempotent; the old site never reads these.

-- ── Kit Club manage links (lib/kit-club-link.ts) ─────────────────────────────
-- /subscribe/manage shows a subscription and cancels it only for someone who
-- proves they own the inbox: the page emails a one-time link
-- (/subscribe/manage?token=...). Only the token's SHA-256 is kept. A link works
-- for an hour, and stops working once it has cancelled a subscription. Rows
-- are deleted once they expire (as new links are made).
create table if not exists kit_club_manage_links (
  token_hash text primary key,
  -- The subscriber's email, lowercased: the link manages that email's subscription
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists kit_club_manage_links_expires_idx on kit_club_manage_links (expires_at);
-- Service role only (no policies)
alter table kit_club_manage_links enable row level security;

-- ── Sign-up state without minting a link (app/api/account/auth/signup) ──────
-- When an address has had too many confirmation emails, sign-up sends nothing
-- and must not mint a new confirm token either (that would cancel the link
-- already in the inbox). It still has to know whether the account is
-- confirmed, and flag a repeat sign-up with a different password
-- (app_metadata.signup_conflict), so it reads the account here. Service role
-- only: never callable from the browser.
create or replace function public.account_signup_state(p_email text)
returns table (user_id uuid, confirmed boolean, app_metadata jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email_confirmed_at is not null, coalesce(u.raw_app_meta_data, '{}'::jsonb)
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.is_sso_user, u.created_at
  limit 1
$$;
revoke execute on function public.account_signup_state(text) from public, anon, authenticated;
grant execute on function public.account_signup_state(text) to service_role;
