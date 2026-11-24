-- Scan-anywhere card tracking (admin Scan page, lib/intake/tracking/*):
-- every card, tier bag and place has a QR; scanning a place then cards or
-- bags moves them there (a station also sets the step).
--
-- Additive and rerunnable: "if not exists", "on conflict do nothing" and
-- "drop trigger if exists" throughout. Shared database: the old site
-- (thecarddoc1.com, repo card-restoration) uses the same cards and orders
-- tables; it never names the new columns, so its inserts and updates keep
-- them null and nothing it does changes.
--
-- 1. locations   the places: one station per step, due-date shelf slots
--                (created on demand, LOC-SHELF-YYYYMMDD), the Done shelf,
--                Shipping and any other place staff add. Codes never change
--                (signs are printed); places are deactivated, not deleted.
-- 2. card_moves  insert-only history of every card move (from/to place,
--                step before/after, who, which scan session).
-- 3. cards.location_id / located_at, tier_bags.location_id / located_at:
--                where each card and bag is now.
-- 4. Seed: the 8 stations, LOC-DONE and LOC-SHIP.
--
-- Backlog: log_card_change() only logs order, awaiting, completed and
-- refunded changes, so setting a card's location writes no backlog event.
--
-- Run it on production before deploying the code that reads these tables.

-- ── 1. Places ────────────────────────────────────────────────────────────────
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    check (code ~ '^LOC-[A-Z0-9]+(-[A-Z0-9]+)*$' and length(code) <= 40),   -- LOC-HUMIDOR
  name text not null check (btrim(name) <> '' and length(name) <= 60),     -- "Humidor", "DUE MON DEC 7"
  kind text not null check (kind in ('station', 'shelf', 'done', 'shipping', 'other')),
  stage text check (stage is null or stage in (
    'Ready for Slab Crack', 'Humidor', 'Humidity Press', 'Book', 'Heat Press',
    'Clamp Work', 'Book with Weights', 'Final Dry')),                     -- the step a station sets
  due_date date,                                                          -- a shelf slot's due date
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now(),
  created_by text,
  constraint locations_station_stage check ((kind = 'station') = (stage is not null))
);
create index if not exists locations_kind_idx on locations (kind, sort);
create index if not exists locations_due_date_idx on locations (due_date) where kind = 'shelf';

-- Server-side only (service role); no browser access
alter table locations enable row level security;

-- ── 2. Card moves (insert-only) ──────────────────────────────────────────────
-- No foreign key action may update a row here (the trigger refuses updates):
-- bag_id is a plain uuid (bags can be deleted while empty), and a place with
-- history can't be deleted (deactivate it). Deleting a card or its order
-- still deletes its moves (deletes are allowed).
create table if not exists card_moves (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  order_id uuid,
  bag_id uuid,
  from_location_id uuid references locations(id),
  to_location_id uuid references locations(id),
  stage_before text,                                                      -- stored stage name, 'done', or null (not started)
  stage_after text,
  action text not null check (action in ('move', 'receive', 'ship_check', 'done')),
  by text,
  session_id uuid,
  created_at timestamptz default now()
);
create index if not exists card_moves_card_idx on card_moves (card_id, created_at desc);
create index if not exists card_moves_to_location_idx on card_moves (to_location_id, created_at desc);
create index if not exists card_moves_from_location_idx on card_moves (from_location_id);
alter table card_moves enable row level security;
drop trigger if exists card_moves_immutable on card_moves;
create trigger card_moves_immutable before update on card_moves
  for each row execute function forbid_change();

-- ── 3. Where each card and bag is now ────────────────────────────────────────
alter table cards add column if not exists location_id uuid references locations(id) on delete set null;
alter table cards add column if not exists located_at timestamptz;
create index if not exists cards_location_id_idx on cards (location_id);

alter table tier_bags add column if not exists location_id uuid references locations(id) on delete set null;
alter table tier_bags add column if not exists located_at timestamptz;
create index if not exists tier_bags_location_id_idx on tier_bags (location_id);

-- ── 4. Default places ────────────────────────────────────────────────────────
-- Shelf slots (LOC-SHELF-YYYYMMDD, "DUE MON DEC 7") are created on demand.
insert into locations (code, name, kind, stage, sort, created_by) values
  ('LOC-SLAB-CRACK',     'Slab Crack',        'station',  'Ready for Slab Crack', 10, 'setup'),
  ('LOC-HUMIDOR',        'Humidor',           'station',  'Humidor',              20, 'setup'),
  ('LOC-HUMIDITY-PRESS', 'Humidity Press',    'station',  'Humidity Press',       30, 'setup'),
  ('LOC-DRYING',         'Drying',            'station',  'Book',                 40, 'setup'),
  ('LOC-HEAT-PRESS',     'Heat Press',        'station',  'Heat Press',           50, 'setup'),
  ('LOC-CLAMP',          'Clamp Work',        'station',  'Clamp Work',           60, 'setup'),
  ('LOC-BOOK-WEIGHTS',   'Book with Weights', 'station',  'Book with Weights',    70, 'setup'),
  ('LOC-FINAL-DRY',      'Final Dry',         'station',  'Final Dry',            80, 'setup'),
  ('LOC-DONE',           'Done',              'done',     null,                  900, 'setup'),
  ('LOC-SHIP',           'Shipping',          'shipping', null,                 1000, 'setup')
on conflict (code) do nothing;

-- ── Rollback (run by hand only if this has to be undone) ─────────────────────
--   alter table tier_bags drop column if exists located_at, drop column if exists location_id;
--   alter table cards drop column if exists located_at, drop column if exists location_id;
--   drop table if exists card_moves;
--   drop table if exists locations;
