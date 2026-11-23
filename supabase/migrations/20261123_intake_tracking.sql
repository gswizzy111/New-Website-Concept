-- Receiving, tier bags, QR codes and per-card restoration tracking
-- (admin Receiving section, lib/intake/*).
--
-- Additive and rerunnable: "if not exists", "on conflict do nothing" and
-- "create or replace" throughout. Shared database: the old site
-- (thecarddoc1.com, repo card-restoration) uses the same tables.
--
-- 1. tier_bags             one physical bag per tier per arrival batch of an
--                          order (Bag ID e.g. CD-2549-P, CD-2549-P2), with
--                          its received date and absolute due date.
-- 2. tier_bag_due_changes  insert-only log of manual due date changes (reason
--                          required).
-- 3. business_holidays     days that are not business days (weekends never
--                          are); seeded 2026-2028, editable in the admin.
-- 4. cards                 Card ID (card_seq, card_code), bag, who received
--                          it and when, awaiting_arrival, receiving photos.
-- 5. backlog               cards still awaiting arrival leave the backlog:
--                          backlog_now() skips them and log_card_change()
--                          logs the flips as card_removed / card_added.
--
-- What changes for the old site: nothing it can see. Its card inserts and
-- updates don't name the new columns, so they keep their defaults
-- (awaiting_arrival false, no bag, no code) and every backlog event it causes
-- is written exactly as before. backlog_now() and log_card_change() only
-- differ for cards with awaiting_arrival = true, which only the new site's
-- receiving sets; from then on both dashboards show the same, corrected
-- backlog. backlog_compute() is unchanged: it already replays card_removed /
-- card_added, so history stays exact. Order statuses, order_events texts and
-- the 'Status updated to: Cards Received' event are untouched. Deleting an
-- order still works: its bags go with it (on delete cascade) and a deleted
-- bag only clears cards.bag_id (on delete set null).
--
-- Run it on production before deploying the code that reads these columns.

-- ── 1. Tier bags ─────────────────────────────────────────────────────────────
create table if not exists tier_bags (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  tier text not null,                                   -- effective tier ('prep' for prep_standard)
  batch int not null default 1 check (batch >= 1),      -- 2+ = the same tier arrived on another day
  bag_code text not null unique,                        -- '<order_number>-<letter><batch if > 1>'
  received_on date,                                     -- New York day the cards arrived; null = missing
  due_date date,                                        -- absolute due date; never silently recalculated
  due_status text not null default 'pending'
    check (due_status in ('calculated', 'manual', 'needs_review', 'missing_received_date', 'pending')),
  turnaround_days int,                                  -- the tier's max turnaround used (snapshot)
  due_note text,
  completed_at timestamptz,                             -- every non-refunded card in the bag is done
  completion_seen_at timestamptz,                       -- an admin dismissed the "bag completed" alert
  label_printed_at timestamptz,
  source text not null default 'receiving' check (source in ('receiving', 'migration')),
  created_at timestamptz not null default now(),
  created_by text,
  unique (order_id, tier, batch)
);
create index if not exists tier_bags_order_id_idx on tier_bags (order_id);
create index if not exists tier_bags_completed_at_idx on tier_bags (completed_at);
create index if not exists tier_bags_open_due_idx on tier_bags (due_date) where completed_at is null;

-- Server-side only (service role); no browser access
alter table tier_bags enable row level security;

-- ── 2. Manual due date changes ───────────────────────────────────────────────
create table if not exists tier_bag_due_changes (
  id uuid primary key default gen_random_uuid(),
  bag_id uuid not null references tier_bags(id) on delete cascade,
  old_due date,
  new_due date,
  reason text not null check (btrim(reason) <> ''),
  changed_by text,
  created_at timestamptz not null default now()
);
create index if not exists tier_bag_due_changes_bag_idx on tier_bag_due_changes (bag_id, created_at);
alter table tier_bag_due_changes enable row level security;
-- Rows never change. (Deletes stay allowed so deleting a bag or an order
-- still cascades.)
drop trigger if exists tier_bag_due_changes_immutable on tier_bag_due_changes;
create trigger tier_bag_due_changes_immutable before update on tier_bag_due_changes
  for each row execute function forbid_change();

-- ── 3. Business holidays ─────────────────────────────────────────────────────
create table if not exists business_holidays (
  day date primary key,
  name text not null,
  created_at timestamptz not null default now()
);
alter table business_holidays enable row level security;

-- US federal holidays the shop closes for; the observed day when one falls
-- on a weekend (Sat -> Fri, Sun -> Mon). Same list as DEFAULT_HOLIDAYS in
-- lib/intake/business-days.ts.
insert into business_holidays (day, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-05-25', 'Memorial Day'),
  ('2026-07-03', 'Independence Day (observed)'),
  ('2026-09-07', 'Labor Day'),
  ('2026-11-26', 'Thanksgiving'),
  ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-05-31', 'Memorial Day'),
  ('2027-07-05', 'Independence Day (observed)'),
  ('2027-09-06', 'Labor Day'),
  ('2027-11-25', 'Thanksgiving'),
  ('2027-12-24', 'Christmas Day (observed)'),
  ('2027-12-31', 'New Year''s Day (observed)'),
  ('2028-05-29', 'Memorial Day'),
  ('2028-07-04', 'Independence Day'),
  ('2028-09-04', 'Labor Day'),
  ('2028-11-23', 'Thanksgiving'),
  ('2028-12-25', 'Christmas Day')
on conflict (day) do nothing;

-- ── 4. Cards ─────────────────────────────────────────────────────────────────
alter table cards add column if not exists card_seq int check (card_seq >= 1);  -- 1, 2, 3... within the order; never reused
alter table cards add column if not exists card_code text;                       -- Card ID, e.g. CD-2549-03
alter table cards add column if not exists bag_id uuid references tier_bags(id) on delete set null;
alter table cards add column if not exists received_at timestamptz;
alter table cards add column if not exists received_by text;
alter table cards add column if not exists awaiting_arrival boolean not null default false;
alter table cards add column if not exists receiving_photo_urls text[] not null default '{}';

create unique index if not exists cards_card_code_key on cards (card_code) where card_code is not null;
create unique index if not exists cards_order_seq_key on cards (order_id, card_seq) where card_seq is not null;
create index if not exists cards_bag_id_idx on cards (bag_id);

-- ── 5. Backlog: cards still awaiting arrival are not in it ───────────────────
-- From the live definition (pg_get_functiondef, Nov 23 2026); the only change
-- is "and not c.awaiting_arrival" in the card count.
create or replace function public.backlog_now()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
with open_orders as (
  select o.id, order_service(o.id, o.restoration_tier) svc
  from orders o
  where o.status in ('received', 'in_progress', 'awaiting_restoration') and o.payment_status in ('paid', 'refunded')
),
counts as (
  select oo.id, oo.svc,
    case
      when exists (select 1 from cards c where c.order_id = oo.id)
        then (select count(*) from cards c where c.order_id = oo.id and not c.completed and coalesce(c.status, '') <> 'refunded' and not c.awaiting_arrival)
      when exists (select 1 from backlog_events b where b.order_id = oo.id and b.event in ('card_added', 'card_removed')) then 0
      else order_card_count(oo.id)
    end n
  from open_orders oo
)
select jsonb_build_object(
  'total', coalesce(sum(n), 0),
  'prep', coalesce(sum(n) filter (where svc = 'prep'), 0),
  'orders', count(*) filter (where n > 0),
  'unknown_orders', count(*) filter (where n is null),
  'as_of', now(),
  'tracking_start', (select value_ts from metrics_settings where key = 'backlog_tracking_start')
) from counts
$function$;

-- Only the server (service role) calls it (as before; create or replace keeps grants).
revoke execute on function backlog_now() from public, anon, authenticated;

-- From the live definition (pg_get_functiondef, Nov 23 2026). backlog_compute()
-- decides whether a card is in the building from its card_added ("born") and
-- card_removed events, latest wins, so an awaiting flip is logged as exactly
-- those events and replay matches backlog_now():
--   awaiting_arrival false -> true   card_removed (as if the card were deleted)
--   awaiting_arrival true  -> false  card_added   (as if the card were added)
-- Changes, all of which only matter when awaiting_arrival is true:
--   INSERT of an awaiting card: also card_removed, stamped clock_timestamp()
--     so it sorts after the card's birth (at the same instant backlog_compute
--     puts removals first). The site never inserts awaiting cards (receiving
--     flags them with an UPDATE); this keeps any other path exact.
--   UPDATE moving a card to another order: card_added on the new order is
--     skipped while the card is awaiting (the two rows were one insert before;
--     for non-awaiting cards they are written as before).
--   UPDATE flipping awaiting_arrival (same order): the event above.
-- Everything else is the live text unchanged; errors still only warn.
create or replace function public.log_card_change()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    insert into backlog_events (order_id, card_id, event, card_created_at)
      values (new.order_id, new.id, 'card_added', new.created_at);
    if new.completed then
      insert into backlog_events (order_id, card_id, event, card_created_at)
        values (new.order_id, new.id, 'card_completed', new.created_at);
    end if;
    if new.awaiting_arrival then
      insert into backlog_events (at, order_id, card_id, event, card_created_at)
        values (clock_timestamp(), new.order_id, new.id, 'card_removed', new.created_at);
    end if;
  elsif tg_op = 'DELETE' then
    insert into backlog_events (order_id, card_id, event, card_created_at)
      values (old.order_id, old.id, 'card_removed', old.created_at);
  else
    if new.order_id is distinct from old.order_id then
      insert into backlog_events (order_id, card_id, event, card_created_at)
        values (old.order_id, old.id, 'card_removed', old.created_at);
      if not new.awaiting_arrival then
        insert into backlog_events (order_id, card_id, event, card_created_at)
          values (new.order_id, new.id, 'card_added', new.created_at);
      end if;
    elsif new.awaiting_arrival is distinct from old.awaiting_arrival then
      insert into backlog_events (order_id, card_id, event, card_created_at)
        values (new.order_id, new.id, case when new.awaiting_arrival then 'card_removed' else 'card_added' end, new.created_at);
    end if;
    if new.completed is distinct from old.completed then
      insert into backlog_events (order_id, card_id, event, card_created_at)
        values (new.order_id, new.id, case when new.completed then 'card_completed' else 'card_uncompleted' end, new.created_at);
    end if;
    if new.status = 'refunded' and old.status is distinct from 'refunded' then
      insert into backlog_events (order_id, card_id, event, card_created_at)
        values (new.order_id, new.id, 'card_refunded', new.created_at);
    end if;
  end if;
  return null;
exception when others then
  raise warning 'backlog_events: card % not logged: %', tg_op, sqlerrm;
  return null;
end $function$;
-- The trigger itself (cards_backlog_history, after insert/update/delete, for
-- each row) is unchanged.

-- ── Rollback (run by hand only if this has to be undone) ─────────────────────
-- Restore the two functions first (their previous text is in
-- 20261023_dashboard_metrics.sql, with search_path from 20261027_infra.sql):
--   backlog_now(): remove "and not c.awaiting_arrival".
--   log_card_change(): remove the three awaiting_arrival branches and write
--     the order move as one insert of both rows again.
-- Backlog events already written stay (backlog_events is insert-only); before
-- dropping awaiting_arrival, clear it so the last event per card is card_added:
--   update cards set awaiting_arrival = false where awaiting_arrival;
-- Then:
--   drop index if exists cards_bag_id_idx;
--   drop index if exists cards_order_seq_key;
--   drop index if exists cards_card_code_key;
--   alter table cards drop column if exists receiving_photo_urls;
--   alter table cards drop column if exists awaiting_arrival;
--   alter table cards drop column if exists received_by;
--   alter table cards drop column if exists received_at;
--   alter table cards drop column if exists bag_id;
--   alter table cards drop column if exists card_code;
--   alter table cards drop column if exists card_seq;
--   drop table if exists tier_bag_due_changes;
--   drop table if exists tier_bags;
--   drop table if exists business_holidays;
