-- Scan-anywhere card tracking with serial-numbered slots (admin Scan page,
-- lib/intake/tracking/*). Cards carry no sticker: every physical holder (each
-- clamp, heat press spot, humidor spot ...) is a numbered slot with a QR
-- label (CLAMP 07 = LOC-CLAMP-07). Putting a card in a slot records where it
-- is and sets its step to the slot's step. Bags wait on due-date shelf
-- slots (LOC-SHELF-YYYYMMDD); LOC-DONE and LOC-SHIP are places too.
--
-- Additive and rerunnable: "if not exists", "on conflict do nothing" and
-- "drop trigger if exists" throughout. Shared database: the old site
-- (thecarddoc1.com, repo card-restoration) uses the same cards and orders
-- tables; it never names the new columns, so its inserts and updates keep
-- them null and nothing it does changes.
--
-- 1. locations   slots and places: numbered slots of a station type
--                (kind 'station', station + serial + stage + capacity, made
--                in Places: "Add 20 clamps"), due-date shelf slots (made on
--                demand), the Done place, Shipping, any other place. Codes
--                never change (labels are printed); places are switched
--                off, not deleted.
-- 2. card_moves  insert-only history of every card move (from/to place,
--                step before/after, who, which scan session).
-- 3. cards.location_id / located_at: the slot or place a card is in now
--    (one at a time: putting it somewhere else frees the old slot);
--    tier_bags.location_id / located_at: the shelf slot a bag waits on.
-- 4. Seed: LOC-DONE and LOC-SHIP only (staff make the slots).
--
-- Backlog: log_card_change() only logs order, awaiting, completed and
-- refunded changes, so setting a card's location writes no backlog event.
--
-- Run it on production before deploying the code that reads these tables.

-- ── 1. Slots and places ─────────────────────────────────────────────────────
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    check (code ~ '^LOC-[A-Z0-9]+(-[A-Z0-9]+)*$' and length(code) <= 40),   -- LOC-CLAMP-07
  name text not null check (btrim(name) <> '' and length(name) <= 60),     -- "CLAMP 07", "DUE MON DEC 7"
  kind text not null check (kind in ('station', 'shelf', 'done', 'shipping', 'other')),
  station text check (station ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),               -- station type key ('clamp')
  serial int check (serial between 1 and 9999),                           -- the slot's number (7)
  capacity int check (capacity >= 1),                                     -- cards it holds; null = no limit
  stage text check (stage is null or stage in (
    'Ready for Slab Crack', 'Humidor', 'Humidity Press', 'Book', 'Heat Press',
    'Clamp Work', 'Book with Weights', 'Final Dry')),                     -- the step a card gets in this slot
  due_date date,                                                          -- a shelf slot's due date
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now(),
  created_by text,
  -- A slot (kind 'station') has its type, number and step; nothing else has a step
  constraint locations_slot_shape check (
    (kind = 'station') = (stage is not null)
    and (kind <> 'station' or (station is not null and serial is not null)))
);
create unique index if not exists locations_station_serial_key on locations (station, serial) where station is not null;
create index if not exists locations_kind_idx on locations (kind, station, serial);
create index if not exists locations_due_date_idx on locations (due_date) where kind = 'shelf';

-- Server-side only (service role); no browser access
alter table locations enable row level security;

-- ── 2. Card moves (insert-only) ──────────────────────────────────────────────
-- No foreign key action may update a row here (the trigger refuses updates):
-- bag_id is a plain uuid (bags can be deleted while empty), and a place with
-- history can't be deleted (switch it off). Deleting a card or its order
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
  action text not null check (action in ('assign', 'move', 'release', 'done', 'receive', 'ship_check')),
  by text,
  session_id uuid,
  created_at timestamptz default now()
);
create index if not exists card_moves_card_idx on card_moves (card_id, created_at desc);
create index if not exists card_moves_to_location_idx on card_moves (to_location_id, created_at desc);
create index if not exists card_moves_from_location_idx on card_moves (from_location_id);
create index if not exists card_moves_order_idx on card_moves (order_id, created_at desc);
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
-- Slots (CLAMP 01..N, HEAT PRESS 01..N ...) are made in Places; shelf slots
-- (LOC-SHELF-YYYYMMDD, "DUE MON DEC 7") when a bag first needs one.
insert into locations (code, name, kind, sort, created_by) values
  ('LOC-DONE', 'Done',     'done',      900, 'setup'),
  ('LOC-SHIP', 'Shipping', 'shipping', 1000, 'setup')
on conflict (code) do nothing;

-- ── Rollback (run by hand only if this has to be undone) ─────────────────────
--   alter table tier_bags drop column if exists located_at, drop column if exists location_id;
--   alter table cards drop column if exists located_at, drop column if exists location_id;
--   drop table if exists card_moves;
--   drop table if exists locations;
