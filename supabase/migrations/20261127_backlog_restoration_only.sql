-- Backlog: restoration cards we've received and haven't finished (owner, Nov 27 2026:
-- "the backlog is all of the restoration orders that are in progress or cards
-- recieved. I dont want it to be completed cards, completed orders or cards that we
-- havent recieved yet").
--
-- Additive and rerunnable: "create or replace", "add column if not exists", and the
-- recompute at the end only touches rows saved under the earlier rule. Shared database:
-- the old site (thecarddoc1.com, repo card-restoration) calls the same functions.
--
-- The rule, for today's number (backlog_now) and every day of the history
-- (backlog_compute / backlog_report) alike. A card is in the backlog when:
-- 1. its order is Cards Received ('received') or In Progress ('in_progress');
--    'awaiting_restoration' no longer counts (no order has ever been in it on
--    production: no status note and no backlog event says so);
-- 2. the order is paid: payment_status 'paid' (a partial refund keeps 'paid'); an
--    order refunded in full leaves the backlog when it was refunded (the refund
--    ledger's last refund, else its last 'refund_issued' event, else its last update);
-- 3. it's a restoration card, not PSA Prep. Prep is decided the way the Services tab
--    and backlog_now's old 'prep' figure decide it (order_service()), card by card:
--    the card's effective tier (its own tier, else the order's; 'prep_standard' is
--    prep, lib/intake/codes.ts effectiveTier) when there is one, else the order's
--    service (the May 2026 orders with only "PSA Prep" lines are prep). So a mixed
--    order counts only its restoration cards. Cards deleted since, and manual orders
--    counted by quantity, have no card tier: the order's service decides;
-- 4. it isn't ticked done and isn't refunded (as before);
-- 5. it's here: not flagged awaiting_arrival (as before: the flips are logged as
--    card_removed / card_added), and not a card added after its order arrived that
--    hasn't been received yet. That second part is the intake rule
--    (lib/intake/prepare-labels.ts arrivedBy + inShopSetupPlan, lib/intake/migration.ts
--    recordedArrival + planOrderSetup's addedLater): no bag and no received_at, and
--    created after the moment the order's cards were known to be here (its first
--    'Status updated to: Cards Received' event; for a drop-off, the hand-over, or the
--    order's entry plus an hour for the cards typed in with it; with neither, the
--    order's first bag), or on a later New York day than the recorded arrival day.
--    As in intake, it only applies while the order isn't finished: a finished order's
--    late cards were worked and shipped, so they count as before.
--
-- What the functions return (lib/dashboard-metrics.ts):
--   backlog_now()   total / orders / unknown_orders: restoration only;
--                   prep: always 0 now (it meant "of which PSA Prep");
--                   prep_cards / prep_orders: PSA Prep cards that would otherwise be in
--                   (received, unfinished), NOT part of total;
--                   not_received: restoration cards on those orders not here yet;
--                   rule: 'restoration_received'.
--   backlog_report  per day as before, restoration only, plus orders (restoration orders
--                   with a card in the backlog at the end of the day), prep_cards (the
--                   prep figure as above), prep 0 and rule 'restoration_received'.
--
-- History. Every day is rebuilt under the new rule from the same records as before
-- (backlog_events from tracking start, Oct 23 2026; the order status notes before
-- that). What can't be rebuilt exactly, beyond what already couldn't (deleted orders
-- before tracking, cards ticked done before tracking, unlogged arrivals):
--   - a card's tier isn't logged, so each card counts under its tier today for every
--     day (a card moved between prep and a restoration tier moves for all days);
--   - a card added after its order arrived enters when it was received (cards.received_at,
--     or when its bag was made); Receiving only records that since Nov 23 2026, and a
--     receipt that is later undone loses its time (only the awaiting flag's flips are
--     logged), so such a card's days before its recorded receipt don't count it;
--   - the time an order was refunded in full comes from the refund ledger or the
--     order's events, not from a logged payment change.
-- backlog_daily keeps every row: a row saved under the earlier rule is recomputed under
-- this one, and the row as first saved is kept in the new column previous_rule_data.
-- Never deleted. backlog_report recomputes such rows the first time they're asked for,
-- and this migration does it once for all of them (last statement).
--
-- What the old site sees: the same functions, so the same numbers as the new site.
-- Its dashboard tile and Backlog page show total (now restoration only) and
-- "Full Restoration = total − prep" (still right: prep is 0), its "PSA Prep" tile and
-- "· N PSA Prep" show 0, and the day rows' extra fields are ignored. Its card and order
-- writes go through the same triggers, which are unchanged (they log raw changes; the
-- rule is applied when reading). No table it writes changes; backlog_daily only gains a
-- column. Event descriptions (order_events, the "Status updated to: ..." texts) are
-- only read, never changed.
--
-- Apply on production before deploying the code that reads the new fields (the code
-- also works before: the new fields default to 0).

-- ── Helpers ──────────────────────────────────────────────────────────────────
-- The tier a card is worked under: its own, else the order's; trimmed, blank = none,
-- 'prep_standard' = 'prep' (lib/intake/codes.ts effectiveTier / normalizeTier).
create or replace function public.card_effective_tier(p_card_tier text, p_order_tier text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case t when 'prep_standard' then 'prep' else t end
  from (select coalesce(nullif(btrim(p_card_tier), ''), nullif(btrim(p_order_tier), '')) t) x
$function$;

-- 'prep' or 'restoration' for one card: order_service()'s rule applied to the card's
-- effective tier. p_order_service is order_service(order, orders.restoration_tier),
-- which decides only when neither the card nor the order has a tier.
create or replace function public.card_service(p_card_tier text, p_order_tier text, p_order_service text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when card_effective_tier(p_card_tier, p_order_tier) is null then coalesce(p_order_service, 'restoration')
    when card_effective_tier(p_card_tier, p_order_tier) = 'prep' then 'prep'
    else 'restoration'
  end
$function$;

-- When an order's cards were known to be here, from its own records only:
--   arrived_by  lib/intake/prepare-labels.ts arrivedBy(): the first 'Status updated to:
--               Cards Received' event; for a drop-off, the hand-over (its show drop-off
--               form, else the order's entry) or the entry plus an hour, whichever is
--               later; with neither, the order's first bag. Null: nothing on record.
--   known_by    the New York day lib/intake/migration.ts planOrderSetup compares card
--               days with (recordedArrival: the event's day; a drop-off's hand-over day,
--               or its entry day when later). Null otherwise.
create or replace function public.order_arrival(p_order_id uuid)
 returns table (arrived_by timestamptz, known_by date)
 language sql
 stable
 set search_path to 'public'
as $function$
  with o as (
    select o.inbound_method, o.created_at,
      (select min(e.created_at) from order_events e
        where e.order_id = o.id and e.event_type = 'status_updated'
          and e.description = 'Status updated to: Cards Received') ev,
      (select min(sd.created_at) from show_dropoffs sd where sd.order_id = o.id) sd,
      (select min(b.created_at) from tier_bags b where b.order_id = o.id) fb
    from orders o
    where o.id = p_order_id
  )
  select
    case
      when ev is not null then ev
      when inbound_method = 'dropoff' then greatest(coalesce(sd, created_at), created_at + interval '1 hour')
      else fb
    end,
    case
      when ev is not null then (ev at time zone 'America/New_York')::date
      when inbound_method = 'dropoff' then greatest(
        (coalesce(sd, created_at) at time zone 'America/New_York')::date,
        (created_at at time zone 'America/New_York')::date)
    end
  from o
$function$;

-- A card created after its order's cards were known to be here (order_arrival()): to
-- the second, or on a later New York day than the recorded arrival day. Such a card
-- with no bag and no received_at hasn't been received yet (it may still be on its
-- way: Receiving takes it when it arrives).
create or replace function public.card_added_after_arrival(p_created_at timestamptz, p_arrived_by timestamptz, p_known_by date)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select coalesce(p_created_at > p_arrived_by, false)
      or coalesce((p_created_at at time zone 'America/New_York')::date > p_known_by, false)
$function$;

-- ── Saved days: keep the earlier rule's rows ─────────────────────────────────
alter table backlog_daily add column if not exists previous_rule_data jsonb;
comment on column backlog_daily.previous_rule_data is
  'The day''s row as first saved under the backlog rule before 20261127_backlog_restoration_only.sql (all paid cards Cards Received / In Progress, prep included); data holds the row under the current rule.';

-- ── Backlog: rebuild days ────────────────────────────────────────────────────
-- The rule at the top of this file, replayed day by day. Before backlog_tracking_start,
-- order statuses come from order_events (the status notes the site has always
-- written); from then on, from backlog_events. Changes from 20261023_dashboard_metrics.sql
-- are marked "(20261127)".
create or replace function public.backlog_compute(p_from date, p_to date)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
with
cfg as (
  select coalesce((select value_ts from metrics_settings where key = 'backlog_tracking_start'), now()) t0,
         (now() at time zone 'America/New_York')::date today
),
notes as (
  -- Order statuses the site wrote as notes before tracking started
  select e.order_id, e.created_at t,
    case
      when e.event_type = 'manual_order_created' then
        case when e.description ilike 'Drop-off order created%' then 'received' end
      when e.description = 'Status updated to: Awaiting Payment' then 'awaiting_payment'
      when e.description = 'Status updated to: Awaiting Cards' then 'awaiting_cards'
      when e.description = 'Status updated to: Cards Received' then 'received'
      when e.description = 'Status updated to: In Progress' then 'in_progress'
      when e.description = 'Status updated to: Awaiting Restoration' then 'awaiting_restoration'
      when e.description = 'Status updated to: Completed' then 'completed'
      when e.description ilike '%Shipped Back%' then 'shipped_back'
      when e.description ilike 'Marked Delivered%' or e.description = 'Status updated to: Delivered' then 'delivered'
      when e.description = 'Status updated to: Cancelled' then 'cancelled'
    end st
  from order_events e, cfg
  where e.event_type in ('status_updated', 'manual_order_created') and e.created_at < cfg.t0
),
last_note as (
  select distinct on (order_id) order_id, t, st from notes where st is not null order by order_id, t desc
),
pts as (
  select order_id, t, st, 'note' src from notes where st is not null
  union all
  -- Orders already cancelled when tracking started, with no note saying so: cancelled
  -- when last refunded, if that came after their last note
  select b.order_id,
    least(greatest(
      case when r.t is not null and (ln.t is null or r.t >= ln.t) then r.t else least(o.updated_at, cfg.t0) end,
      coalesce(ln.t + interval '1 millisecond', '-infinity'::timestamptz)
    ), cfg.t0 - interval '1 millisecond'),
    'cancelled', 'note'
  from backlog_events b
  cross join cfg
  left join orders o on o.id = b.order_id
  left join last_note ln on ln.order_id = b.order_id
  left join lateral (select max(e.created_at) t from order_events e
    where e.order_id = b.order_id and e.event_type = 'refund_issued' and e.created_at < cfg.t0) r on true
  where b.source = 'baseline' and b.event = 'order_status' and b.status = 'cancelled'
    and ln.st is distinct from 'cancelled'
  union all
  -- Recorded statuses from tracking start (the baseline row holds each order's status then)
  select b.order_id, b.at, b.status, b.source
  from backlog_events b, cfg
  where b.event = 'order_status' and b.at >= cfg.t0
),
ords as (
  -- Paid orders (refunded in full ones too: they were in until refunded), and orders
  -- since deleted (their recorded history is kept). (20261127) with the order's tier,
  -- whether it's finished now, and when the cards were known to be here.
  select o.id, o.created_at, order_service(o.id, o.restoration_tier) svc, o.restoration_tier,
    coalesce(o.status in ('completed', 'shipped_back', 'delivered'), false) finished,
    a.arrived_by, a.known_by
  from orders o
  left join lateral order_arrival(o.id) a on o.status is distinct from 'completed'
    and o.status is distinct from 'shipped_back' and o.status is distinct from 'delivered'
  where o.payment_status in ('paid', 'refunded')
  union all
  select d.order_id, min(d.at), 'restoration', null, false, null, null
  from backlog_events d
  where not exists (select 1 from orders o where o.id = d.order_id)
  group by d.order_id
),
order_refund as (
  -- (20261127) Orders refunded in full leave the backlog when the money went back
  select o.id order_id, coalesce(
    (select max(r.refunded_at) from refunds r
      where r.order_id = o.id and r.status in ('succeeded', 'pending', 'requires_action')),
    (select max(e.created_at) from order_events e where e.order_id = o.id and e.event_type = 'refund_issued'),
    o.updated_at) t
  from orders o
  where o.payment_status = 'refunded'
),
first_card as (
  select order_id, min(t) t from (
    select order_id, created_at t from cards
    union all
    select order_id, card_created_at from backlog_events
    where event in ('card_added', 'card_removed') and card_created_at is not null
  ) x group by order_id
),
late as (
  -- Orders whose card rows were entered after the order (manual orders entered without
  -- them): until then, their service-line quantity stands in for the cards
  select o.id, o.created_at, fc.t switch_at,
    (select coalesce(sum(s.quantity), 0)::int from order_services s where s.order_id = o.id
      and coalesce(s.service_id, '') not in ('pregrade', 'pre_grade_assessment', 'slab_crack', 'instagram_feature')) q
  from ords o left join first_card fc on fc.order_id = o.id
  where fc.t is null or fc.t > o.created_at + interval '10 minutes'
),
units as (
  -- One unit per card row, including cards since removed. (20261127) svc: the card's
  -- service; arrives: for a card added after its (unfinished) order arrived, when it
  -- was received ('infinity': not yet); null for every other unit (here from birth).
  select c.id::text uid, c.id card_id, c.order_id, c.created_at born, false unknown, null::timestamptz ends,
    case when l.switch_at = c.created_at then 'recount' end born_src,
    card_service(c.tier, o.restoration_tier, o.svc) svc,
    case
      when o.finished or not card_added_after_arrival(c.created_at, o.arrived_by, o.known_by) then null
      when c.received_at is null and c.bag_id is null then 'infinity'::timestamptz
      when coalesce(c.received_at, bg.created_at, c.created_at) <= c.created_at then null
      else coalesce(c.received_at, bg.created_at)
    end arrives
  from cards c
  join ords o on o.id = c.order_id
  left join late l on l.id = c.order_id
  left join tier_bags bg on bg.id = c.bag_id
  union all
  select r.*, case when l.switch_at = r.born then 'recount' end, o.svc, null::timestamptz
  from (
    select distinct on (b.card_id) b.card_id::text uid, b.card_id, b.order_id, b.card_created_at born, false unknown, null::timestamptz ends
    from backlog_events b join ords o on o.id = b.order_id
    where b.event = 'card_removed' and not exists (select 1 from cards c where c.id = b.card_id)
    order by b.card_id, b.at
  ) r join ords o on o.id = r.order_id left join late l on l.id = r.order_id
  union all
  -- Service-line quantity until the cards were entered
  select l.id::text || '#' || g, null::uuid, l.id, l.created_at, false, l.switch_at, null, o.svc, null::timestamptz
  from late l join ords o on o.id = l.id cross join lateral generate_series(1, l.q) g
  where l.q > 0
  union all
  -- ... and when that doesn't tell either, one placeholder so the day can say a count is unknown
  select l.id::text || '#?', null::uuid, l.id, l.created_at, true, l.switch_at, null, o.svc, null::timestamptz
  from late l join ords o on o.id = l.id where l.q = 0
),
card_ev as (
  select card_id, at, event, source from backlog_events
  where card_id is not null and event in ('card_added', 'card_removed', 'card_completed', 'card_uncompleted', 'card_refunded')
),
ev as (
  -- seq orders same-instant events: existence, then status, then card ticks, then refunds
  select u.uid, u.born t, 0 seq, 'born' kind, null::text st, u.born_src src from units u
  union all
  select u.uid, u.ends, 0, 'removed', null, 'recount' from units u where u.ends is not null
  union all
  -- a card moved between orders is removed from one and added to the other
  select u.uid, b.at, 0, case b.event when 'card_added' then 'born' else 'removed' end, null, null
  from units u join card_ev b on b.card_id = u.card_id and b.event in ('card_added', 'card_removed')
  union all
  select u.uid, p.t, 1, 'status', p.st, p.src from units u join pts p on p.order_id = u.order_id where p.st is not null
  union all
  select u.uid, b.at, 2, case b.event when 'card_completed' then 'done' else 'undone' end, null, b.source
  from units u join card_ev b on b.card_id = u.card_id and b.event in ('card_completed', 'card_uncompleted')
  union all
  select u.uid, coalesce(b.at, c.refunded_at, c.created_at), 3, 'refund', null, null
  from units u
  left join cards c on c.id = u.card_id and c.status = 'refunded'
  left join card_ev b on b.card_id = u.card_id and b.event = 'card_refunded'
  where u.card_id is not null and (c.id is not null or b.card_id is not null)
  union all
  -- (20261127) The whole order refunded
  select u.uid, r.t, 3, 'refund', null, null
  from units u join order_refund r on r.order_id = u.order_id
  union all
  -- (20261127) A card added after its order arrived: not here from its birth until received
  select u.uid, u.born, 0, 'not_here', null, null from units u where u.arrives is not null
  union all
  select u.uid, u.arrives, 0, 'arrived', null, null from units u where u.arrives is not null and u.arrives <> 'infinity'
),
grp as (
  select ev.*,
    row_number() over w rn,
    count(*) filter (where kind = 'status') over w gs,
    count(*) filter (where kind in ('born', 'removed')) over w ge,
    count(*) filter (where kind in ('done', 'undone')) over w gd,
    count(*) filter (where kind = 'refund') over w gr,
    count(*) filter (where kind in ('arrived', 'not_here')) over w ga
  from ev
  window w as (partition by uid order by t, seq, kind = 'born' rows unbounded preceding)
),
state as (
  select uid, t, rn, kind, src,
    max(st) over (partition by uid, gs) cur_status,
    coalesce(max(case kind when 'born' then 1 when 'removed' then 0 end) over (partition by uid, ge), 0) = 1 present,
    coalesce(max(case kind when 'done' then 1 when 'undone' then 0 end) over (partition by uid, gd), 0) = 1 done,
    gr > 0 refunded,
    coalesce(max(case kind when 'arrived' then 1 when 'not_here' then 0 end) over (partition by uid, ga), 1) = 1 here
  from grp
),
per_t as (
  -- State after every event at one instant, and which kinds of events happened then
  select uid, t,
    (array_agg(cur_status order by rn desc))[1] cur_status,
    bool_or(kind = 'status') has_status, bool_or(kind = 'status' and src = 'baseline') has_baseline,
    bool_or(kind = 'born') has_born, bool_or(kind = 'removed') has_removed, bool_or(src = 'recount') has_recount,
    bool_or(kind = 'done' and src = 'baseline') has_done_untracked, bool_or(kind = 'done' and coalesce(src, 'live') = 'live') has_done,
    bool_or(kind = 'refund') has_refund,
    bool_or(kind = 'arrived') has_arrived,
    -- (20261127) Cards Received or In Progress only, and here
    coalesce((array_agg(cur_status order by rn desc))[1] in ('received', 'in_progress'), false)
      and (array_agg(present order by rn desc))[1]
      and not (array_agg(done order by rn desc))[1]
      and not (array_agg(refunded order by rn desc))[1]
      and (array_agg(here order by rn desc))[1] inb
  from state
  group by uid, t
),
seqd as (
  select p.*,
    lag(inb, 1, false) over (partition by uid order by t) prev_inb,
    lag(cur_status) over (partition by uid order by t) prev_status
  from per_t p
),
tr as (
  -- Every move into or out of the backlog, with its reason
  select s.uid, s.t, (s.t at time zone 'America/New_York')::date d, s.inb up, s.cur_status, s.prev_status,
    case
      when s.has_recount then 'recount'
      when s.inb and s.has_baseline then 'recount'
      when s.inb and s.has_status and s.prev_status in ('completed', 'shipped_back', 'delivered') then 'reopened'
      when s.inb and s.has_status then 'received'
      when s.inb and s.has_arrived then 'arrived'
      when s.inb and s.has_born then 'added'
      when s.inb then 'reopened'
      when s.has_refund then 'removed'
      when s.has_done then 'completed'
      when s.has_done_untracked then 'untracked'
      when s.has_status and s.cur_status in ('completed', 'shipped_back', 'delivered') then 'completed'
      when s.has_status and s.cur_status in ('awaiting_cards', 'awaiting_payment') then 'sent_back'
      else 'removed'
    end reason
  from seqd s
  where s.inb is distinct from s.prev_inb
),
unit_info as (
  select u.uid, u.unknown, u.svc = 'prep' prep, o.created_at order_created, u.order_id
  from units u join ords o on o.id = u.order_id
),
-- Possible undercount: cards whose arrival wasn't logged (the order skipped "Cards
-- Received", first showed up open when tracking began, or closed without ever being
-- open) could have been in the shop from the order date until the first logged status.
uncertain as (
  select f.uid, ui.order_created a, f.t b
  from (select distinct on (uid) uid, t, cur_status, reason from tr where up order by uid, t) f
  join unit_info ui on ui.uid = f.uid
  cross join cfg
  where not ui.unknown and not ui.prep
    and ((f.reason = 'received' and f.cur_status <> 'received') or (f.reason = 'recount' and f.t = cfg.t0))
  union all
  select ui.uid, ui.order_created, min(p.t)
  from unit_info ui
  join pts p on p.order_id = ui.order_id and p.st in ('completed', 'shipped_back', 'delivered')
  where not ui.unknown and not ui.prep and not exists (select 1 from tr where tr.uid = ui.uid and tr.up)
  group by ui.uid, ui.order_created
),
deltas as (
  -- (20261127) Restoration cards only; prep cards in prep_cards
  select t.d,
    count(*) filter (where t.up and t.reason in ('received', 'added', 'arrived') and not ui.unknown and not ui.prep) added,
    count(*) filter (where not t.up and t.reason = 'completed' and not ui.unknown and not ui.prep) completed,
    count(*) filter (where t.up and t.reason = 'reopened' and not ui.unknown and not ui.prep) reopened,
    count(*) filter (where not t.up and t.reason = 'sent_back' and not ui.unknown and not ui.prep) sent_back,
    count(*) filter (where not t.up and t.reason = 'removed' and not ui.unknown and not ui.prep) removed,
    count(*) filter (where not t.up and t.reason = 'untracked' and not ui.unknown and not ui.prep) untracked,
    coalesce(sum(case when t.up then 1 else -1 end) filter (where t.reason = 'recount' and not ui.unknown and not ui.prep), 0) recount,
    coalesce(sum(case when t.up then 1 else -1 end) filter (where not ui.unknown and not ui.prep), 0) dtotal,
    coalesce(sum(case when t.up then 1 else -1 end) filter (where not ui.unknown and ui.prep), 0) dprep,
    coalesce(sum(case when t.up then 1 else -1 end) filter (where ui.unknown and not ui.prep), 0) dunknown
  from tr t join unit_info ui on ui.uid = t.uid
  group by t.d
),
alldays as (
  select g::date d, cfg.t0, cfg.today
  from cfg, generate_series(least(p_from, (select min(d) from tr)), least(p_to, cfg.today), interval '1 day') g
),
cum as (
  select a.d, a.t0, a.today,
    coalesce(x.added, 0) added, coalesce(x.completed, 0) completed, coalesce(x.reopened, 0) reopened,
    coalesce(x.sent_back, 0) sent_back, coalesce(x.removed, 0) removed, coalesce(x.untracked, 0) untracked,
    coalesce(x.recount, 0) recount,
    sum(coalesce(x.dtotal, 0)) over (order by a.d) total,
    sum(coalesce(x.dprep, 0)) over (order by a.d) prep_cards,
    sum(coalesce(x.dunknown, 0)) over (order by a.d) unknown_orders
  from alldays a left join deltas x on x.d = a.d
),
-- (20261127) Restoration orders with at least one card in the backlog at the end of each day
order_moves as (
  select ui.order_id, t.d, sum(case when t.up then 1 else -1 end) delta
  from tr t join unit_info ui on ui.uid = t.uid
  where not ui.unknown and not ui.prep
  group by ui.order_id, t.d
),
order_levels as (
  select order_id, d, sum(delta) over (partition by order_id order by d) n,
    lead(d) over (partition by order_id order by d) next_d
  from order_moves
),
ord_days as (
  select c.d, count(*) n
  from cum c join order_levels l on l.d <= c.d and (l.next_d is null or l.next_d > c.d) and l.n > 0
  where c.d between p_from and p_to
  group by c.d
),
unc as (
  select c.d, count(*) n
  from cum c join uncertain u on u.a < et_day_start(c.d + 1) and u.b >= et_day_start(c.d + 1)
  where c.d between p_from and p_to
  group by c.d
),
-- Possible overcount: cards whose order went from Cards Received / In Progress straight
-- to Delivered more than a week later; when they were really finished wasn't logged.
stale as (
  select x.uid, x.a, x.t b
  from (select tr.*, lag(tr.t) over (partition by tr.uid order by tr.t) a from tr) x
  join unit_info ui on ui.uid = x.uid
  where not x.up and not ui.unknown and not ui.prep and x.reason = 'completed' and x.cur_status = 'delivered'
    and x.prev_status in ('received', 'in_progress') and x.t - x.a > interval '7 days'
),
stl as (
  select c.d, count(*) n
  from cum c join stale s on s.a < et_day_start(c.d + 1) and s.b >= et_day_start(c.d + 1)
  where c.d between p_from and p_to
  group by c.d
),
first_point as (
  select min((t at time zone 'America/New_York')::date) d from pts where st is not null
)
select coalesce(jsonb_agg(jsonb_build_object(
    'day', c.d,
    'total', c.total,
    'orders', coalesce(od.n, 0),
    'prep', 0,
    'prep_cards', c.prep_cards,
    'added', c.added,
    'completed', c.completed,
    'reopened', c.reopened,
    'sent_back', c.sent_back,
    'removed', c.removed,
    'untracked', c.untracked,
    'recount', c.recount,
    'unknown_orders', c.unknown_orders,
    'uncertain', coalesce(un.n, 0),
    'stale', coalesce(sl.n, 0),
    'quality', case
      when fp.d is null or c.d < fp.d then 'no_data'
      when coalesce(un.n, 0)::numeric / greatest(c.total + coalesce(un.n, 0), 1) > 0.10 then 'insufficient'
      when coalesce(un.n, 0)::numeric / greatest(c.total + coalesce(un.n, 0), 1) > 0.03 then 'approximate'
      when coalesce(sl.n, 0)::numeric / greatest(c.total, 1) > 0.03 then 'approximate'
      when et_day_start(c.d + 1) <= c.t0 then 'reconstructed'
      when c.d = c.today then 'live'
      else 'recorded'
    end,
    'rule', 'restoration_received'
  ) order by c.d), '[]'::jsonb)
from cum c
cross join first_point fp
left join unc un on un.d = c.d
left join stl sl on sl.d = c.d
left join ord_days od on od.d = c.d
where c.d between p_from and p_to
$function$;

-- ── Backlog: saved days ──────────────────────────────────────────────────────
-- Saved rows for finished days (saving any not yet saved, and recomputing any saved
-- under an earlier rule: the row as first saved moves to previous_rule_data), a live
-- row for today.
create or replace function public.backlog_report(p_from date, p_to date)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  today date := (now() at time zone 'America/New_York')::date;
  missing date;
  computed jsonb;
begin
  select min(g::date) into missing
  from generate_series(p_from, least(p_to, today), interval '1 day') g
  where g::date = today
     or not exists (select 1 from backlog_daily b where b.day = g::date and b.data->>'rule' = 'restoration_received');
  if missing is not null then
    computed := backlog_compute(missing, least(p_to, today));
    insert into backlog_daily (day, data)
    select (r->>'day')::date, r from jsonb_array_elements(computed) r
    where (r->>'day')::date < today
    on conflict (day) do update
      set data = excluded.data,
          computed_at = now(),
          previous_rule_data = coalesce(backlog_daily.previous_rule_data, backlog_daily.data)
      where backlog_daily.data->>'rule' is distinct from 'restoration_received';
  end if;
  return (
    select coalesce(jsonb_agg(row_data order by day), '[]'::jsonb) from (
      select b.day, b.data row_data from backlog_daily b where b.day between p_from and least(p_to, today - 1)
      union all
      select (r->>'day')::date, r from jsonb_array_elements(coalesce(computed, '[]'::jsonb)) r where (r->>'day')::date = today
    ) x
  );
end $function$;

-- ── The backlog right now (the same rule as backlog_compute's live row) ──────
create or replace function public.backlog_now()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
with open_orders as (
  select o.id, o.restoration_tier, order_service(o.id, o.restoration_tier) svc, a.arrived_by, a.known_by
  from orders o
  left join lateral order_arrival(o.id) a on true
  where o.status in ('received', 'in_progress') and o.payment_status = 'paid'
),
card_rows as (
  select c.order_id,
    card_service(c.tier, oo.restoration_tier, oo.svc) svc,
    not c.completed and coalesce(c.status, '') <> 'refunded' unfinished,
    not c.awaiting_arrival
      and not (c.bag_id is null and c.received_at is null and card_added_after_arrival(c.created_at, oo.arrived_by, oo.known_by)) here
  from open_orders oo join cards c on c.order_id = oo.id
),
per_order as (
  select oo.id, oo.svc,
    count(c.order_id) ncards,
    count(*) filter (where c.unfinished and c.here and c.svc = 'restoration') rest,
    count(*) filter (where c.unfinished and c.here and c.svc = 'prep') prep,
    count(*) filter (where c.unfinished and not c.here and c.svc = 'restoration') not_here
  from open_orders oo left join card_rows c on c.order_id = oo.id
  group by oo.id, oo.svc
),
counts as (
  -- Orders without card rows: 0 when every card row was deleted, else the quantity on
  -- their service lines (null when that doesn't tell either), under the order's service
  select p.id, p.not_here,
    case when p.ncards > 0 then p.rest when p.svc = 'prep' then 0 else q.n end n,
    case when p.ncards > 0 then p.prep when p.svc = 'prep' then coalesce(q.n, 0) else 0 end n_prep
  from per_order p
  left join lateral (
    select case
      when exists (select 1 from backlog_events b where b.order_id = p.id and b.event in ('card_added', 'card_removed')) then 0
      else order_card_count(p.id)
    end n
  ) q on p.ncards = 0
)
select jsonb_build_object(
  'total', coalesce(sum(n), 0),
  'orders', count(*) filter (where n > 0),
  'unknown_orders', count(*) filter (where n is null),
  'prep', 0,
  'prep_cards', coalesce(sum(n_prep), 0),
  'prep_orders', count(*) filter (where n_prep > 0),
  'not_received', coalesce(sum(not_here), 0),
  'rule', 'restoration_received',
  'as_of', now(),
  'tracking_start', (select value_ts from metrics_settings where key = 'backlog_tracking_start')
) from counts
$function$;

-- Only the server (service role) calls these ("create or replace" keeps the grants of
-- the functions that existed; the new helpers get the same).
revoke execute on function backlog_compute(date, date), backlog_report(date, date), backlog_now(),
  card_effective_tier(text, text), card_service(text, text, text), order_arrival(uuid),
  card_added_after_arrival(timestamptz, timestamptz, date)
  from public, anon, authenticated;

-- ── Recompute the saved days under this rule, once ───────────────────────────
-- Every row saved under the earlier rule (and every day after the first of them) is
-- rebuilt; the rows as first saved stay in previous_rule_data. On a second run nothing
-- is left to recompute and this does nothing.
do $$
declare
  first_old date;
begin
  select min(day) into first_old from backlog_daily where data->>'rule' is distinct from 'restoration_received';
  if first_old is not null then
    perform backlog_report(first_old, (now() at time zone 'America/New_York')::date);
  end if;
end $$;

-- ── Rollback (by hand only) ──────────────────────────────────────────────────
-- Restore backlog_compute, backlog_report and backlog_now from 20261023_dashboard_metrics.sql
-- (backlog_now as amended by 20261123_intake_tracking.sql; set search_path to 'public'
-- as 20261027_infra.sql did), then put the earlier rows back and drop what this added:
--   update backlog_daily set data = previous_rule_data where previous_rule_data is not null;
--   delete from backlog_daily where data->>'rule' = 'restoration_received';  -- days first saved under this rule
--   alter table backlog_daily drop column if exists previous_rule_data;
--   drop function if exists card_service(text, text, text);
--   drop function if exists card_effective_tier(text, text);
--   drop function if exists card_added_after_arrival(timestamptz, timestamptz, date);
--   drop function if exists order_arrival(uuid);
