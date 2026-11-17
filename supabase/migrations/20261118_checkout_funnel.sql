-- Checkout funnel: where customers leave each checkout, and what stops them.
-- Additive and safe to run more than once. Apply before the code that writes it.
--
-- 1. checkout_funnel_events  one row per checkout moment. Browser rows come from
--    trackCheckout() (lib/checkout-funnel.ts) through POST /api/checkout/funnel;
--    server rows are refusals recorded by the checkout routes
--    (lib/checkout-funnel-server.ts). Counts only: no name, email, address,
--    card detail or IP address. `sid` is a random ID for one browser tab.
-- 2. checkout_funnel_report(from, to)  the admin Checkout Funnel page's numbers
--    for a range of America/New_York calendar days, per flow and step.
-- 3. checkout_unpaid_orders(from, to)  restoration and prep checkouts still
--    waiting for payment, for the same page.
-- Both return jsonb so PostgREST's row limit never cuts a report short. Only the
-- server (service role) reads or writes any of it.

-- ── Events ───────────────────────────────────────────────────────────────────
create table if not exists public.checkout_funnel_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  flow text not null check (flow in ('restoration', 'prep', 'kits', 'gift_card', 'kit_club')),
  -- The CheckoutEvent values in lib/checkout-funnel.ts
  event text not null check (event in ('step_view', 'photo_added', 'photo_failed', 'blocked',
                                       'submit', 'redirect', 'rejected', 'in_app_notice')),
  step smallint check (step between 1 and 9),
  code text check (char_length(code) <= 64 and code ~ '^[A-Za-z0-9_-]+$'),
  tier text check (char_length(tier) <= 32),
  cards smallint check (cards between 0 and 500),
  sid text check (char_length(sid) <= 64),
  device text check (device in ('phone', 'desktop')),
  in_app boolean,
  source text not null default 'browser' check (source in ('browser', 'server'))
);
create index if not exists checkout_funnel_events_created_at_idx on public.checkout_funnel_events (created_at);
create index if not exists checkout_funnel_events_flow_created_at_idx on public.checkout_funnel_events (flow, created_at);
-- The beacon route's per-tab daily cap counts by sid
create index if not exists checkout_funnel_events_sid_created_at_idx on public.checkout_funnel_events (sid, created_at)
  where sid is not null;
alter table public.checkout_funnel_events enable row level security;
revoke all on table public.checkout_funnel_events from anon, authenticated;
revoke all on sequence public.checkout_funnel_events_id_seq from anon, authenticated;

-- ── Funnel report ────────────────────────────────────────────────────────────
-- Days are America/New_York calendar days, p_from to p_to inclusive.
-- A visit is one browser tab (sid) in one flow. Per flow:
--   visits, phone / desktop / unknown (each visit's first device), in_app,
--   submits, redirects and refusals (events and visits),
--   steps[]: per step, visits that viewed it, blocked events and visits,
--            photos added / failed, submits, redirects, refusals seen in the browser,
--   codes[]: blocked and refused, by step, source and code (events and visits).
create or replace function public.checkout_funnel_report(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public
as $$
with
ev as (
  select e.id, e.flow, e.event, e.step, e.code, e.sid, e.device, e.in_app, e.source
    from public.checkout_funnel_events e
   where e.created_at >= (p_from::timestamp at time zone 'America/New_York')
     and e.created_at < ((p_to + 1)::timestamp at time zone 'America/New_York')
),
visits as (
  select distinct on (v.flow, v.sid) v.flow, v.sid, v.device, v.in_app
    from ev v
   where v.source = 'browser' and v.sid is not null
   order by v.flow, v.sid, v.id
),
flow_visits as (
  select v.flow,
         count(*) visits,
         count(*) filter (where v.device = 'phone') phone,
         count(*) filter (where v.device = 'desktop') desktop,
         count(*) filter (where v.device is null) unknown_device,
         count(*) filter (where v.in_app) in_app
    from visits v
   group by v.flow
),
flow_events as (
  select e.flow,
         count(*) filter (where e.event = 'submit') submits,
         count(distinct e.sid) filter (where e.event = 'submit') submit_visits,
         count(*) filter (where e.event = 'redirect') redirects,
         count(distinct e.sid) filter (where e.event = 'redirect') redirect_visits,
         count(*) filter (where e.event = 'rejected' and e.source = 'browser') rejected,
         count(distinct e.sid) filter (where e.event = 'rejected' and e.source = 'browser') rejected_visits,
         count(*) filter (where e.event = 'rejected' and e.source = 'server') server_rejected,
         count(*) filter (where e.event = 'rejected' and e.source = 'server' and e.in_app) server_rejected_in_app,
         count(*) filter (where e.event = 'in_app_notice') in_app_notices
    from ev e
   group by e.flow
),
steps as (
  select e.flow, e.step,
         count(distinct e.sid) filter (where e.event = 'step_view') views,
         count(*) filter (where e.event = 'blocked') blocked,
         count(distinct e.sid) filter (where e.event = 'blocked') blocked_visits,
         count(*) filter (where e.event = 'photo_added') photos_added,
         count(*) filter (where e.event = 'photo_failed') photos_failed,
         count(*) filter (where e.event = 'submit') submits,
         count(*) filter (where e.event = 'redirect') redirects,
         count(*) filter (where e.event = 'rejected') rejected
    from ev e
   where e.source = 'browser' and e.step is not null
   group by e.flow, e.step
),
codes as (
  select e.flow, e.step, e.event, e.source, coalesce(e.code, 'none') code,
         count(*) n, count(distinct e.sid) visits
    from ev e
   where e.event in ('blocked', 'rejected')
   group by e.flow, e.step, e.event, e.source, coalesce(e.code, 'none')
),
flows as (
  select f.flow from flow_visits f
  union
  select f.flow from flow_events f
)
select jsonb_build_object(
  'from', p_from,
  'to', p_to,
  'first_event_at', (select min(e.created_at) from public.checkout_funnel_events e),
  'flows', coalesce((
    select jsonb_agg(jsonb_build_object(
        'flow', fl.flow,
        'visits', coalesce(fv.visits, 0),
        'phone', coalesce(fv.phone, 0),
        'desktop', coalesce(fv.desktop, 0),
        'unknown_device', coalesce(fv.unknown_device, 0),
        'in_app', coalesce(fv.in_app, 0),
        'submits', coalesce(fe.submits, 0),
        'submit_visits', coalesce(fe.submit_visits, 0),
        'redirects', coalesce(fe.redirects, 0),
        'redirect_visits', coalesce(fe.redirect_visits, 0),
        'rejected', coalesce(fe.rejected, 0),
        'rejected_visits', coalesce(fe.rejected_visits, 0),
        'server_rejected', coalesce(fe.server_rejected, 0),
        'server_rejected_in_app', coalesce(fe.server_rejected_in_app, 0),
        'in_app_notices', coalesce(fe.in_app_notices, 0),
        'steps', coalesce((
          select jsonb_agg(jsonb_build_object(
              'step', s.step, 'views', s.views, 'blocked', s.blocked, 'blocked_visits', s.blocked_visits,
              'photos_added', s.photos_added, 'photos_failed', s.photos_failed,
              'submits', s.submits, 'redirects', s.redirects, 'rejected', s.rejected
            ) order by s.step)
            from steps s where s.flow = fl.flow), '[]'::jsonb),
        'codes', coalesce((
          select jsonb_agg(jsonb_build_object(
              'step', c.step, 'event', c.event, 'source', c.source, 'code', c.code, 'count', c.n, 'visits', c.visits
            ) order by c.event, c.source, c.step nulls last, c.n desc, c.code)
            from codes c where c.flow = fl.flow), '[]'::jsonb)
      ) order by fl.flow)
      from flows fl
      left join flow_visits fv on fv.flow = fl.flow
      left join flow_events fe on fe.flow = fl.flow
  ), '[]'::jsonb)
)
$$;

-- ── Unpaid checkouts ─────────────────────────────────────────────────────────
-- Restoration and prep orders still waiting for payment (payment pending,
-- status Awaiting Payment), placed in the range (New York days) and more than
-- 15 minutes ago, newest first, at most 500 (`total` counts them all).
-- `reminder_sent_at` is orders.payment_reminder_sent_at, read through to_jsonb
-- so this works before and after the reminders migration adds that column
-- (`reminder_tracked` says whether it exists yet).
create or replace function public.checkout_unpaid_orders(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public
as $$
with o as (
  select o.id, o.order_number, o.created_at, o.restoration_tier, o.total_cents,
         public.order_service(o.id, o.restoration_tier) svc,
         public.order_card_count(o.id) ncards,
         to_jsonb(o) ->> 'payment_reminder_sent_at' reminder_sent_at
    from public.orders o
   where o.payment_status = 'pending'
     and o.status = 'awaiting_payment'
     and o.created_at >= (p_from::timestamp at time zone 'America/New_York')
     and o.created_at < ((p_to + 1)::timestamp at time zone 'America/New_York')
     and o.created_at < now() - interval '15 minutes'
)
select jsonb_build_object(
  'total', (select count(*) from o),
  'reminder_tracked', exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.orders'::regclass and a.attname = 'payment_reminder_sent_at' and not a.attisdropped
  ),
  'orders', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', x.id, 'order_number', x.order_number, 'created_at', x.created_at,
        'service', x.svc, 'tier', x.restoration_tier, 'cards', x.ncards,
        'total_cents', x.total_cents, 'reminder_sent_at', x.reminder_sent_at
      ) order by x.created_at desc)
      from (select * from o order by o.created_at desc limit 500) x
  ), '[]'::jsonb)
)
$$;

-- Only the server (service role) calls these.
revoke execute on function public.checkout_funnel_report(date, date) from public, anon, authenticated;
grant execute on function public.checkout_funnel_report(date, date) to service_role;
revoke execute on function public.checkout_unpaid_orders(date, date) from public, anon, authenticated;
grant execute on function public.checkout_unpaid_orders(date, date) to service_role;
