-- Sold-out pop-up waitlist: people who answered "yes" to the site-wide
-- "All restoration tiers sold out, want to join the waitlist?" pop-up and left
-- their full name and email. Its own list, separate from restoration_waitlist.
-- Additive and rerunnable.

create table if not exists sold_out_waitlist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  -- Kept for the shared waitlist notifier (texts); the pop-up never asks for it
  phone text,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);

create index if not exists sold_out_waitlist_created_idx on sold_out_waitlist(created_at desc);

-- Server-side only (service role); no browser access
alter table sold_out_waitlist enable row level security;

-- The pop-up shows while this is 'true' (Admin > Store Settings)
insert into store_config (key, value, updated_at)
values ('sold_out_popup', 'true', now())
on conflict (key) do nothing;
