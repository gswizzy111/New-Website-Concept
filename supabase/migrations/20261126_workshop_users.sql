-- Workshop logins: hired help who scan cards, work the Desk and receive
-- orders (print bag labels, take photos), and nothing else. A fourth kind of
-- admin sign-in next to admins (admin_users), accountants (accountant_access)
-- and support staff (support_access). They sign in on /admin/login with a
-- username and password like admins, but they are deliberately NOT in
-- admin_users: the other site (thecarddoc1.com, repo card-restoration)
-- shares this database and treats every admin_users row as a full admin.
-- Its session lookup doesn't know the 'workshop' role and refuses those
-- sessions. What they may open: lib/workshop-access.ts (default deny).
--
-- Also: who printed a bag's labels (tier_bags.label_printed_by) and who
-- took each receiving photo (card_photo_events), so every action a worker
-- can take records who did it; and indexes for the Team activity page,
-- which reads card_moves, stage events and receiving by date range.
--
-- Additive and rerunnable ("if not exists", "drop ... if exists" before each
-- constraint and trigger). RLS on, no policies: service role only. Functions
-- set their own search_path. Apply on production before the code that uses
-- it (the code also works before it: workshop sign-in and the new logs are
-- simply off until then).

-- ── 1. Workshop logins ──────────────────────────────────────────────────────
create table if not exists public.workshop_users (
  id uuid primary key default gen_random_uuid(),
  -- What every log records (card_moves.by, stage events metadata.by,
  -- cards.received_by ...). Lower case; never an admin's username (trigger below).
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  name text check (name is null or (btrim(name) <> '' and length(name) <= 60)),
  password_hash text,                       -- PBKDF2 (lib/crypto.ts); null until set, and after Reset
  active boolean not null default true,     -- false: turned off, can't sign in
  -- One-time setup link (7 days): only its SHA-256 is kept
  setup_token_hash text unique check (setup_token_hash is null or setup_token_hash ~ '^[a-f0-9]{64}$'),
  setup_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text,                          -- the admin who added them
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  deactivated_at timestamptz
);
alter table public.workshop_users enable row level security;

-- A username is an admin's or a worker's, never both (any letter case):
-- the sign-in form takes either, and the logs name people by it
create or replace function public.workshop_username_free()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.admin_users a where lower(a.username) = lower(new.username)) then
    raise exception 'workshop username "%" is an admin username', new.username using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists workshop_users_username_free on public.workshop_users;
create trigger workshop_users_username_free
  before insert or update of username on public.workshop_users
  for each row execute function public.workshop_username_free();

-- ── 2. Sessions: role 'workshop' with its own owner column ──────────────────
alter table public.admin_sessions
  add column if not exists workshop_id uuid references public.workshop_users(id) on delete cascade;
create index if not exists admin_sessions_workshop_id_idx on public.admin_sessions (workshop_id) where workshop_id is not null;
alter table public.admin_sessions drop constraint if exists admin_sessions_role_check;
alter table public.admin_sessions add constraint admin_sessions_role_check
  check (role = any (array['admin'::text, 'accountant'::text, 'support'::text, 'workshop'::text]));
alter table public.admin_sessions drop constraint if exists admin_sessions_check;
alter table public.admin_sessions add constraint admin_sessions_check check (
  (role = 'admin' and admin_user_id is not null and accountant_id is null and support_id is null and workshop_id is null)
  or (role = 'accountant' and accountant_id is not null and admin_user_id is null and support_id is null and workshop_id is null)
  or (role = 'support' and support_id is not null and admin_user_id is null and accountant_id is null and workshop_id is null)
  or (role = 'workshop' and workshop_id is not null and admin_user_id is null and accountant_id is null and support_id is null)
);

-- Turning a worker off, or changing or clearing their password (Reset, the
-- setup link), ends every session of theirs, whatever wrote the change. The
-- code deletes them too; this makes it hold for a change made by hand.
create or replace function public.workshop_users_end_sessions()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (old.active and not new.active) or (new.password_hash is distinct from old.password_hash) then
    delete from public.admin_sessions where workshop_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists workshop_users_end_sessions on public.workshop_users;
create trigger workshop_users_end_sessions
  after update of active, password_hash on public.workshop_users
  for each row execute function public.workshop_users_end_sessions();

-- ── 3. Who did it: labels and photos ─────────────────────────────────────────
-- Who sent a bag's labels to the printer last (next to label_printed_at)
alter table public.tier_bags add column if not exists label_printed_by text;

-- Who took, replaced or removed each receiving photo (insert-only)
create table if not exists public.card_photo_events (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  order_id uuid,
  action text not null check (action in ('add', 'replace', 'remove')),
  photo_url text,
  old_photo_url text,                       -- replace: the photo it took the place of
  by text,
  created_at timestamptz not null default now()
);
create index if not exists card_photo_events_card_idx on public.card_photo_events (card_id, created_at desc);
create index if not exists card_photo_events_created_idx on public.card_photo_events (created_at desc);
create index if not exists card_photo_events_by_idx on public.card_photo_events (by, created_at desc);
alter table public.card_photo_events enable row level security;
drop trigger if exists card_photo_events_immutable on public.card_photo_events;
create trigger card_photo_events_immutable before update on public.card_photo_events
  for each row execute function public.forbid_change();

-- ── 4. Indexes for the Team activity page (date ranges, per person) ──────────
create index if not exists card_moves_created_idx on public.card_moves (created_at desc);
create index if not exists card_moves_by_idx on public.card_moves (by, created_at desc);
create index if not exists order_events_stage_update_created_idx on public.order_events (created_at desc)
  where event_type = 'stage_update';
create index if not exists cards_received_at_idx on public.cards (received_at desc)
  where received_at is not null;

-- ── Rollback (run by hand only if this has to be undone) ─────────────────────
--   drop index if exists public.cards_received_at_idx;
--   drop index if exists public.order_events_stage_update_created_idx;
--   drop index if exists public.card_moves_by_idx;
--   drop index if exists public.card_moves_created_idx;
--   drop table if exists public.card_photo_events;
--   alter table public.tier_bags drop column if exists label_printed_by;
--   delete from public.admin_sessions where role = 'workshop';
--   alter table public.admin_sessions drop constraint if exists admin_sessions_check;
--   alter table public.admin_sessions add constraint admin_sessions_check check (
--     (role = 'admin' and admin_user_id is not null and accountant_id is null and support_id is null)
--     or (role = 'accountant' and accountant_id is not null and admin_user_id is null and support_id is null)
--     or (role = 'support' and support_id is not null and admin_user_id is null and accountant_id is null));
--   alter table public.admin_sessions drop constraint if exists admin_sessions_role_check;
--   alter table public.admin_sessions add constraint admin_sessions_role_check
--     check (role = any (array['admin'::text, 'accountant'::text, 'support'::text]));
--   alter table public.admin_sessions drop column if exists workshop_id;
--   drop table if exists public.workshop_users;
--   drop function if exists public.workshop_users_end_sessions();
--   drop function if exists public.workshop_username_free();
