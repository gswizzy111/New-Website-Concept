-- Text messages through Telnyx (lib/sms/*, docs/sms.md): order update texts
-- for customers who ticked the box at checkout (cards received, finished,
-- shipped back), the restoration waitlist "we're open" text, STOP / START /
-- HELP, delivery status and customer replies.
--
-- 1. sms_consents     append-only: who agreed to texts, the exact wording
--                     they saw (consent_text + consent_version), for which
--                     order or waitlist signup. A trigger refuses UPDATE and
--                     DELETE (one exception: deleting an order nulls its
--                     order_id through the foreign key).
-- 2. sms_opt_events   append-only: STOP / START per phone. The latest event
--                     is the current state; sms_opted_out(phone) reads it.
-- 3. sms_messages     outbox and log of every text: queued by the orders
--                     trigger below (order texts) or written by the site
--                     (replies, waitlist). Unique (order_id, kind) for the
--                     three order texts, so an order text is never queued or
--                     sent twice.
-- 4. sms_inbound      texts customers send us (Telnyx webhook).
-- 5. orders trigger   status changes into received / completed /
--                     shipped_back queue that order's text when the order
--                     has a consent. Never for cancelled or refunded orders.
--                     It can never make an order update fail (the old site,
--                     thecarddoc1.com, shares this table): any error only
--                     raises a warning.
-- 6. claim_sms_messages(p_limit): the send job (/api/cron/sms-send) takes
--    due texts atomically (FOR UPDATE SKIP LOCKED).
--
-- Additive and rerunnable: "if not exists", "create or replace" and
-- "drop trigger if exists" throughout. RLS on with no policies: server-side
-- only (service role). Every function sets its own search_path. The site
-- works without this migration (texts just stay off); run it on production
-- before turning texts on.

-- ── 1. Consents (append-only) ───────────────────────────────────────────────
create table if not exists sms_consents (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  phone_raw text,
  email text,
  order_id uuid references orders(id) on delete set null,
  -- The restoration_waitlist row (uuid). No foreign key, so the waitlist can
  -- still be cleaned up; the consent stays.
  waitlist_id uuid,
  source text not null check (source in
    ('restoration_checkout', 'prep_checkout', 'show_dropoff', 'manual_order', 'waitlist')),
  consent_text text not null check (btrim(consent_text) <> ''),
  consent_version text not null,
  created_at timestamptz not null default now()
);
create index if not exists sms_consents_order_idx on sms_consents (order_id, created_at desc) where order_id is not null;
create index if not exists sms_consents_phone_idx on sms_consents (phone_e164, created_at desc);
alter table sms_consents enable row level security;
revoke all on table sms_consents from anon, authenticated;

-- ── 2. Opt-out / opt-in events (append-only) ────────────────────────────────
create table if not exists sms_opt_events (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  event text not null check (event in ('opt_out', 'opt_in')),
  keyword text,
  source text not null check (source in ('keyword', 'carrier', 'admin')),
  created_at timestamptz not null default now()
);
create index if not exists sms_opt_events_phone_idx on sms_opt_events (phone_e164, created_at desc);
create index if not exists sms_opt_events_created_idx on sms_opt_events (created_at desc);
alter table sms_opt_events enable row level security;
revoke all on table sms_opt_events from anon, authenticated;

-- Refuses every UPDATE and DELETE on the two append-only tables, except the
-- foreign key's own "set null" when an order is deleted (only order_id
-- changes, from a value to null), so deleting an order keeps working.
create or replace function public.sms_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE'
     and tg_table_name = 'sms_consents'
     and old.order_id is not null
     and new.order_id is null
     and (to_jsonb(new) - 'order_id') = (to_jsonb(old) - 'order_id') then
    return new;
  end if;
  raise exception '% rows are permanent and cannot be %d', tg_table_name, lower(tg_op)
    using errcode = 'check_violation';
end $function$;

drop trigger if exists sms_consents_append_only on sms_consents;
create trigger sms_consents_append_only before update or delete on sms_consents
  for each row execute function public.sms_append_only();
drop trigger if exists sms_opt_events_append_only on sms_opt_events;
create trigger sms_opt_events_append_only before update or delete on sms_opt_events
  for each row execute function public.sms_append_only();

-- True when the phone's latest event is an opt-out (no events: false).
create or replace function public.sms_opted_out(p_phone text)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select coalesce((
    select e.event = 'opt_out'
      from sms_opt_events e
     where e.phone_e164 = p_phone
     order by e.created_at desc, e.id desc
     limit 1
  ), false);
$function$;
revoke execute on function public.sms_opted_out(text) from public, anon, authenticated;
grant execute on function public.sms_opted_out(text) to service_role;

-- ── 3. Outbox and log ───────────────────────────────────────────────────────
create table if not exists sms_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  kind text not null check (kind in ('received', 'completed', 'shipped', 'waitlist_open', 'reply')),
  to_phone text not null,
  body text,                     -- the exact text, filled when it is sent
  status text not null default 'queued' check (status in
    ('queued', 'sending', 'sent', 'delivered', 'failed', 'unknown', 'skipped', 'expired')),
  skip_reason text,
  send_after timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  attempts int not null default 0,
  telnyx_message_id text unique,
  error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One of each order text per order, ever
create unique index if not exists sms_messages_order_kind_key on sms_messages (order_id, kind)
  where order_id is not null and kind in ('received', 'completed', 'shipped');
create index if not exists sms_messages_due_idx on sms_messages (send_after) where status = 'queued';
create index if not exists sms_messages_sending_idx on sms_messages (claimed_at) where status = 'sending';
create index if not exists sms_messages_created_idx on sms_messages (created_at desc);
create index if not exists sms_messages_order_idx on sms_messages (order_id, created_at desc) where order_id is not null;
create index if not exists sms_messages_phone_idx on sms_messages (to_phone, created_at desc);
alter table sms_messages enable row level security;
revoke all on table sms_messages from anon, authenticated;

create or replace function public.sms_messages_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end $function$;
drop trigger if exists sms_messages_updated_at on sms_messages;
create trigger sms_messages_updated_at before update on sms_messages
  for each row execute function public.sms_messages_touch();

-- ── 4. Texts customers send us ──────────────────────────────────────────────
create table if not exists sms_inbound (
  id uuid primary key default gen_random_uuid(),
  from_phone text not null,
  to_phone text,
  body text,
  telnyx_message_id text unique,
  keyword text,                  -- 'opt_out' | 'opt_in' | 'help' when the text was one
  order_id uuid references orders(id) on delete set null,   -- best match: latest consenting order
  forwarded_at timestamptz,      -- emailed to the shop
  handled_at timestamptz,        -- answered or dismissed in admin
  created_at timestamptz not null default now()
);
create index if not exists sms_inbound_created_idx on sms_inbound (created_at desc);
create index if not exists sms_inbound_from_idx on sms_inbound (from_phone, created_at desc);
alter table sms_inbound enable row level security;
revoke all on table sms_inbound from anon, authenticated;

-- ── 5. Queue an order's text when its status changes ────────────────────────
-- received -> 'received', completed -> 'completed', shipped_back -> 'shipped'
-- (lib/order-status.ts, orders_status_check). Only for orders with a
-- consent; the phone is the latest consent's. The shipped text waits two
-- minutes so a tracking number saved just after the status is in it. The
-- send job re-checks consent, opt-out, cancellation and refunds before
-- anything goes out. Security definer so the insert works whoever updates
-- the order (the old site too); any error only warns.
create or replace function public.queue_order_sms()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_kind text;
  v_phone text;
begin
  begin
    v_kind := case new.status
      when 'received' then 'received'
      when 'completed' then 'completed'
      when 'shipped_back' then 'shipped'
      else null
    end;
    if v_kind is null or coalesce(new.payment_status, '') = 'refunded' then
      return null;
    end if;

    select c.phone_e164 into v_phone
      from sms_consents c
     where c.order_id = new.id
     order by c.created_at desc, c.id desc
     limit 1;
    if v_phone is null then
      return null;
    end if;

    insert into sms_messages (order_id, kind, to_phone, send_after, created_by)
    values (new.id, v_kind, v_phone,
            now() + case when v_kind = 'shipped' then interval '2 minutes' else interval '0' end,
            'status_change')
    on conflict do nothing;
  exception when others then
    raise warning 'queue_order_sms: order % text not queued: %', new.id, sqlerrm;
  end;
  return null;
end $function$;
revoke execute on function public.queue_order_sms() from public, anon, authenticated;

drop trigger if exists orders_queue_sms on public.orders;
create trigger orders_queue_sms
  after update of status on public.orders
  for each row
  when (new.status in ('received', 'completed', 'shipped_back') and new.status is distinct from old.status)
  execute function public.queue_order_sms();

-- ── 6. The send job's claim ─────────────────────────────────────────────────
-- Takes up to p_limit due order texts (queued, send_after passed), oldest
-- first, marks them 'sending' (claimed_at now, attempts + 1) and returns
-- them. Two jobs at once never take the same row. Replies and waitlist texts
-- are sent at once by the site and never queued here.
create or replace function public.claim_sms_messages(p_limit int)
returns setof sms_messages
language plpgsql
set search_path to 'public'
as $function$
begin
  return query
  update sms_messages m
     set status = 'sending',
         claimed_at = now(),
         attempts = m.attempts + 1
   where m.id in (
     select q.id
       from sms_messages q
      where q.status = 'queued'
        and q.send_after <= now()
        and q.kind in ('received', 'completed', 'shipped')
      order by q.send_after, q.created_at
      limit greatest(1, least(coalesce(p_limit, 20), 100))
      for update skip locked
   )
  returning m.*;
end $function$;
revoke execute on function public.claim_sms_messages(int) from public, anon, authenticated;
grant execute on function public.claim_sms_messages(int) to service_role;
