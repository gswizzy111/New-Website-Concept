-- Per-bag return labels: "Ship each bag when done" (the owner, Nov 25 2026).
-- A mixed-tier order is in several tier bags, and each bag ships back on its
-- own as soon as its cards are done: one Shippo return label per bag
-- (lib/intake/shipping/*, the packing page, POST
-- /api/admin/intake/bags/<id>/ship-label and /shipped).
--
-- Claim before buying (like stripe_webhook_claims): a 'claimed' row is
-- inserted BEFORE Shippo is called, and only one live row (claimed,
-- purchased, shipped, delivered) may exist per bag, so two taps never buy two
-- labels. A purchase Shippo refuses marks the claim 'failed' (failed and
-- voided rows don't count), so tapping again retries.
--
-- Compatibility: the old site (thecarddoc1.com, repo card-restoration) shares
-- this database and only knows the order's single return label. The FIRST
-- label of an order is also written to orders.return_label_url and the
-- outbound_* columns (order_label = true here); orders.tracking_number and
-- the status follow when the order is shipped back (every bag with live
-- cards shipped). A single-bag order ends exactly as it does today.
--
-- Additive and rerunnable ("if not exists", "drop trigger if exists",
-- "create or replace"). RLS on with no policies: service role only. The
-- trigger function sets its own search_path. Apply before deploying the code
-- that writes this table (until then the bag label routes refuse to buy and
-- say so; nothing else changes).

create table if not exists bag_shipments (
  id uuid primary key default gen_random_uuid(),
  bag_id uuid not null references tier_bags(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  status text not null default 'claimed'
    check (status in ('claimed', 'purchased', 'shipped', 'delivered', 'failed', 'voided')),
  carrier text,                                   -- "USPS" (Shippo provider)
  service text,                                   -- "Priority Mail"
  tracking_number text,
  tracking_url text,                              -- the carrier's tracking page
  label_url text,                                 -- Shippo label PDF (4x6)
  shippo_transaction_id text,
  shippo_rate_id text,
  cost_cents int check (cost_cents is null or cost_cents >= 0),
  insurance_cents int check (insurance_cents is null or insurance_cents >= 0),
  -- This label is also the order's return label (orders.return_label_url): the order's first
  order_label boolean not null default false,
  claimed_at timestamptz not null default now(),
  purchased_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  email_sent_at timestamptz,                      -- the customer's shipped email went out
  created_by text,
  shipped_by text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A bought label has its file
  constraint bag_shipments_label_shape check (status in ('claimed', 'failed', 'voided') or label_url is not null)
);

-- One live shipment per bag: the claim that stops a second purchase
create unique index if not exists bag_shipments_one_live_per_bag
  on bag_shipments (bag_id) where status in ('claimed', 'purchased', 'shipped', 'delivered');
-- One shipment per order carries the order's return_* fields
create unique index if not exists bag_shipments_one_order_label
  on bag_shipments (order_id) where order_label;
create index if not exists bag_shipments_order_idx on bag_shipments (order_id, claimed_at);
create index if not exists bag_shipments_open_idx on bag_shipments (status) where status in ('purchased', 'shipped');

alter table bag_shipments enable row level security;

-- The bag must belong to the order; updated_at on every change
create or replace function bag_shipments_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.bag_id is distinct from old.bag_id or new.order_id is distinct from old.order_id then
    if not exists (select 1 from public.tier_bags b where b.id = new.bag_id and b.order_id = new.order_id) then
      raise exception 'bag % is not a bag of order %', new.bag_id, new.order_id using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bag_shipments_guard on bag_shipments;
create trigger bag_shipments_guard before insert or update on bag_shipments
  for each row execute function bag_shipments_guard();

comment on table bag_shipments is
  'One return label per tier bag (ship each bag when done). Claimed before Shippo is called; one live row per bag. The order''s first label is mirrored to orders.return_label_url / outbound_* (order_label).';

-- ── Rollback (run by hand only if this has to be undone) ─────────────────────
--   drop table if exists bag_shipments;
--   drop function if exists bag_shipments_guard();
