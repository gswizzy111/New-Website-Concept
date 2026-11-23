-- Show drop-offs (Nov 23, 2026): an order made from a show drop-off shows its
-- total $ on the order, but the owner wants it left out of revenue everywhere
-- ("Leave them out entirely", "Leave them out everywhere"). Those drop-offs'
-- revenue has its own place: the Show Dropoffs tab (/admin/show-dropoffs,
-- lib/show-dropoff-revenue.ts).
--
-- A show drop-off order is one whose id is in show_dropoffs.order_id (set when
-- the admin enters the drop-off as an order; app/api/admin/orders/route.ts).
-- Its own row is left out: it adds $0 and does not count as an order (or its
-- cards, in service_report). Money paid on it later through Stripe (added
-- cards, a tier upgrade: their own sales rows, from the cards_added /
-- tier_upgraded order_events) is real Stripe income and counts as before.
-- Refunds (the refund ledger) count as before. Every other order counts exactly
-- as before, including in-person drop-off orders entered without a show
-- drop-off.
--
-- Additive and rerunnable: two "create or replace function", each copied from
-- its live text (pg_get_functiondef on production, Nov 23 2026, identical to
-- 20261023_dashboard_metrics.sql) with only the show drop-off change. No tables,
-- columns, grants or data change; replacing a function keeps its grants
-- (service_role) and the revoke below is the one already in force. Needs
-- 20261122_show_dropoffs.sql (the show_dropoffs table) applied first.
--
-- Both sites read these (shared database, same functions):
--   revenue_series()  the dashboard's "Total Revenue" chart (24 hours, 7 and 30
--                     days, all time by month), its "Orders This Month" and
--                     "Net Revenue This Month" tiles, the P&L page's revenue
--                     chart, and the "Kit Sales" charts (kit columns: unchanged)
--   service_report()  /admin/services (PSA Prep vs Full Restoration)
-- The Tax, Sales Statement (and its CSV) and P&L tables count in
-- lib/sales-report.ts (loadReport), which leaves the same orders out.

-- ── PSA Prep vs Full Restoration, per day ────────────────────────────────────
-- Paid orders on the day payment arrived. Cards added to an order later, and tier
-- upgrades, are counted on the day they were paid, under the order's service, and
-- taken out of the order's own day so no dollar is counted twice. An order made from
-- a show drop-off is left out; money paid on it later still counts.
create or replace function service_report(p_from date, p_to date) returns jsonb language sql stable
set search_path = public
as $$
with
o as (
  select o.id, o.total_cents, order_service(o.id, o.restoration_tier) svc,
    coalesce((select min(e.created_at) from order_events e where e.order_id = o.id and e.event_type = 'payment_received'), o.created_at) paid_at,
    order_card_count(o.id) ncards,
    -- Made from a show drop-off (/admin/show-dropoffs): its own row is left out (migration 20261123_dropoff_revenue.sql)
    o.id in (select sd.order_id from show_dropoffs sd where sd.order_id is not null) show_dropoff
  from orders o
  where o.payment_status in ('paid', 'refunded') and o.status <> 'awaiting_payment'
),
addon as (
  select e.order_id, e.created_at t,
    coalesce(round(replace(substring(e.description from '\$([0-9,]+\.[0-9]{2})'), ',', '')::numeric * 100)::int, 0) cents,
    coalesce(substring(e.description from 'added ([0-9]+) card')::int, 0) ncards
  from order_events e
  where e.event_type in ('cards_added', 'tier_upgraded')
),
rows as (
  select (o.paid_at at time zone 'America/New_York')::date d, o.svc, 1 orders,
    case when o.ncards is null then null else o.ncards - coalesce((select sum(a.ncards) from addon a where a.order_id = o.id), 0) end cards,
    o.total_cents - coalesce((select sum(a.cents) from addon a where a.order_id = o.id), 0) cents
  from o
  where not o.show_dropoff
  union all
  select (a.t at time zone 'America/New_York')::date, o.svc, 0, a.ncards, a.cents
  from addon a join o on o.id = a.order_id
),
days as (
  select g::date d from generate_series(p_from, least(p_to, (now() at time zone 'America/New_York')::date), interval '1 day') g
),
per_day as (
  select dd.d,
    coalesce(sum(r.orders) filter (where r.svc = 'prep'), 0) prep_orders,
    coalesce(sum(r.cards) filter (where r.svc = 'prep'), 0) prep_cards,
    coalesce(sum(r.cents) filter (where r.svc = 'prep'), 0) prep_cents,
    coalesce(sum(r.orders) filter (where r.svc = 'restoration'), 0) restoration_orders,
    coalesce(sum(r.cards) filter (where r.svc = 'restoration'), 0) restoration_cards,
    coalesce(sum(r.cents) filter (where r.svc = 'restoration'), 0) restoration_cents,
    count(*) filter (where r.orders = 1 and r.cards is null) unknown_card_orders
  from days dd
  left join rows r on r.d = dd.d
  group by dd.d
)
select coalesce(jsonb_agg(jsonb_build_object(
    'day', d,
    'prep_orders', prep_orders, 'prep_cards', prep_cards, 'prep_cents', prep_cents,
    'restoration_orders', restoration_orders, 'restoration_cards', restoration_cards, 'restoration_cents', restoration_cents,
    'unknown_card_orders', unknown_card_orders
  ) order by d), '[]'::jsonb)
from per_day
$$;

-- ── Revenue and refunds for the dashboard charts ─────────────────────────────
-- Sales: paid service orders on the day paid (add-on payments on their own day) and
-- kit orders on the day placed. An order made from a show drop-off is left out (no
-- order, $0); money paid on it later through Stripe still counts. Refunds: the refund
-- ledger, on the day refunded (pending refunds included, failed and canceled ones not).
create or replace function revenue_series() returns jsonb language sql stable
set search_path = public
as $$
with
o as (
  select o.id, o.total_cents,
    coalesce((select min(e.created_at) from order_events e where e.order_id = o.id and e.event_type = 'payment_received'), o.created_at) paid_at,
    -- Made from a show drop-off (/admin/show-dropoffs): its own row is left out (migration 20261123_dropoff_revenue.sql)
    o.id in (select sd.order_id from show_dropoffs sd where sd.order_id is not null) show_dropoff
  from orders o
  where o.payment_status in ('paid', 'refunded') and o.status <> 'awaiting_payment'
),
addon as (
  select e.order_id, e.created_at t,
    coalesce(round(replace(substring(e.description from '\$([0-9,]+\.[0-9]{2})'), ',', '')::numeric * 100)::int, 0) cents
  from order_events e
  where e.event_type in ('cards_added', 'tier_upgraded')
),
sales as (
  select o.paid_at t, 'service' kind, 1 orders,
    o.total_cents - coalesce((select sum(a.cents) from addon a where a.order_id = o.id), 0) cents
  from o
  where not o.show_dropoff
  union all
  select a.t, 'service', 0, a.cents from addon a join o on o.id = a.order_id
  union all
  select s.created_at, 'kit', 1, s.total_cents from shop_orders s
),
refs as (
  select r.refunded_at t, case when r.kind in ('kit', 'kit_club') then 'kit' else 'service' end kind,
    r.amount_cents cents, r.status = 'pending' pending
  from refunds r where r.status in ('succeeded', 'pending', 'requires_action')
),
daily as (
  select d,
    sum(sales_cents) sales_cents, sum(orders) orders, sum(refund_cents) refund_cents, sum(pending_cents) pending_cents,
    sum(kit_sales_cents) kit_sales_cents, sum(kit_orders) kit_orders, sum(kit_refund_cents) kit_refund_cents
  from (
    select (t at time zone 'America/New_York')::date d, cents sales_cents, orders, 0 refund_cents, 0 pending_cents,
      case when kind = 'kit' then cents else 0 end kit_sales_cents, case when kind = 'kit' then orders else 0 end kit_orders, 0 kit_refund_cents
    from sales
    union all
    select (t at time zone 'America/New_York')::date, 0, 0, cents, case when pending then cents else 0 end,
      0, 0, case when kind = 'kit' then cents else 0 end
    from refs
  ) x
  group by d
),
hourly as (
  select h,
    sum(sales_cents) sales_cents, sum(orders) orders, sum(refund_cents) refund_cents,
    sum(kit_sales_cents) kit_sales_cents, sum(kit_orders) kit_orders, sum(kit_refund_cents) kit_refund_cents
  from (
    select date_trunc('hour', t at time zone 'America/New_York') h, cents sales_cents, orders, 0 refund_cents,
      case when kind = 'kit' then cents else 0 end kit_sales_cents, case when kind = 'kit' then orders else 0 end kit_orders, 0 kit_refund_cents
    from sales where t >= now() - interval '25 hours'
    union all
    select date_trunc('hour', t at time zone 'America/New_York'), 0, 0, cents, 0, 0, case when kind = 'kit' then cents else 0 end
    from refs where t >= now() - interval '25 hours'
  ) x
  group by h
)
select jsonb_build_object(
  'today', (now() at time zone 'America/New_York')::date,
  'now_hour', date_trunc('hour', now() at time zone 'America/New_York'),
  'daily', coalesce((select jsonb_agg(jsonb_build_object(
      'day', d, 'sales_cents', sales_cents, 'orders', orders, 'refund_cents', refund_cents, 'pending_refund_cents', pending_cents,
      'kit_sales_cents', kit_sales_cents, 'kit_orders', kit_orders, 'kit_refund_cents', kit_refund_cents) order by d) from daily), '[]'::jsonb),
  'hourly', coalesce((select jsonb_agg(jsonb_build_object(
      'hour', h, 'sales_cents', sales_cents, 'orders', orders, 'refund_cents', refund_cents,
      'kit_sales_cents', kit_sales_cents, 'kit_orders', kit_orders, 'kit_refund_cents', kit_refund_cents) order by h) from hourly), '[]'::jsonb),
  'refunds_this_month', (
    select jsonb_build_object('count', count(*), 'cents', coalesce(sum(cents), 0), 'pending_cents', coalesce(sum(cents) filter (where pending), 0))
    from refs where t >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York'
  )
)
$$;

-- Only the server (service role) calls these (as before).
revoke execute on function service_report(date, date), revenue_series() from public, anon, authenticated;
