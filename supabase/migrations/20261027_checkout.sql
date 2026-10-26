-- Checkout: gift card holds, and tier slots counted in cards.
-- Additive and safe to run more than once. Nothing here changes a table the
-- old site (thecarddoc1.com, same database) uses.

-- ── Gift card holds ──────────────────────────────────────────────────────────
-- A new-site checkout that uses a gift card holds the amount it takes off, so
-- the same balance can't discount several open checkouts at once. The hold is
-- written by hold_gift_card (which locks the gift card row) before the order
-- and the Stripe session, and counts until one of these:
--   * it is released (released_at): the checkout failed, the customer started
--     a newer checkout with the same card (their older Stripe session is
--     expired first, so it can't be paid), or the payment took the balance;
--   * it expires (expires_at): 30 minutes after its Stripe session does
--     (sessions that use a gift card last 60 minutes);
--   * its payment took the balance: a gift_card_redemptions row for its
--     session (the new site's webhook, 20261027_webhook.sql), the order's
--     payment_received event (both sites' webhooks write it after taking the
--     balance), or a kit order saved for its session more than 2 minutes ago
--     (the old site's webhook takes the balance seconds after saving it).
-- The webhook's deduction stays the real spend. The old site's checkouts
-- don't know about holds (they read the balance as before); that is accepted
-- until the old site is retired.
create table if not exists public.gift_card_holds (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  kind text not null,              -- restoration or shop
  customer_email text,             -- lower-cased; a newer checkout by the same customer replaces the hold
  order_id uuid,                   -- restoration orders (set after the order is saved; no foreign key)
  stripe_session_id text,          -- set once the Stripe session exists
  expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text,             -- paid, replaced, abandoned, checkout_failed
  created_at timestamptz not null default now()
);

alter table public.gift_card_holds add column if not exists release_reason text;

create index if not exists gift_card_holds_open_idx
  on public.gift_card_holds (gift_card_id) where released_at is null;
create index if not exists gift_card_holds_session_idx
  on public.gift_card_holds (stripe_session_id);

alter table public.gift_card_holds enable row level security;
revoke all on table public.gift_card_holds from anon, authenticated;

-- What open checkouts hold on a gift card right now, in cents. Volatile on
-- purpose: hold_gift_card calls it after locking the gift card, and it must
-- see holds that other checkouts committed while it waited for the lock.
create or replace function public.gift_card_held_cents(p_gift_card_id uuid)
returns integer
language plpgsql
volatile
set search_path = public
as $$
declare
  v_held integer;
begin
  if to_regclass('public.gift_card_redemptions') is not null then
    select coalesce(sum(h.amount_cents), 0)::integer into v_held
      from public.gift_card_holds h
     where h.gift_card_id = p_gift_card_id
       and h.released_at is null
       and h.expires_at > now()
       and not (h.stripe_session_id is not null and exists (
             select 1 from public.gift_card_redemptions r where r.reference = h.stripe_session_id))
       and not (h.order_id is not null and exists (
             select 1 from public.order_events e where e.order_id = h.order_id and e.event_type = 'payment_received'))
       and not (h.stripe_session_id is not null and exists (
             select 1 from public.shop_orders s
              where s.stripe_session_id = h.stripe_session_id and s.created_at < now() - interval '2 minutes'));
  else
    -- Before 20261027_webhook.sql: the same without the redemptions check
    select coalesce(sum(h.amount_cents), 0)::integer into v_held
      from public.gift_card_holds h
     where h.gift_card_id = p_gift_card_id
       and h.released_at is null
       and h.expires_at > now()
       and not (h.order_id is not null and exists (
             select 1 from public.order_events e where e.order_id = h.order_id and e.event_type = 'payment_received'))
       and not (h.stripe_session_id is not null and exists (
             select 1 from public.shop_orders s
              where s.stripe_session_id = h.stripe_session_id and s.created_at < now() - interval '2 minutes'));
  end if;
  return v_held;
end $$;

-- Holds the gift card with this code for one checkout. p_max_cents is the most
-- the card may take off this order; p_due_cents is the order total before the
-- gift card. The gift card row is locked while this runs, so two checkouts
-- can't both take the same balance.
--   * No row: no gift card with that code.
--   * hold_id null, held_cents 0: nothing was held. Either the card is used up
--     or inactive (balance_cents 0), or there is nothing to take (wanted_cents
--     0), or other open checkouts hold part of what this order would take
--     (available_cents < wanted_cents).
--   * Otherwise the hold (held_cents = wanted_cents). Stripe can't charge 1-49
--     cents, so when the card would leave that little to pay it takes less,
--     leaving 50 cents to pay (an order it covers in full costs $0).
create or replace function public.hold_gift_card(
  p_code text,
  p_max_cents integer,
  p_due_cents integer,
  p_kind text,
  p_customer_email text,
  p_expires_at timestamptz
)
returns table (
  hold_id uuid,
  card_id uuid,
  held_cents integer,
  wanted_cents integer,
  balance_cents integer,
  available_cents integer
)
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  v_remaining integer;
  v_status text;
  v_available integer;
  v_amount integer;
  v_hold uuid;
begin
  select g.id, g.remaining_cents, g.status
    into v_id, v_remaining, v_status
    from public.gift_cards g
   where g.code = upper(btrim(p_code))
     for update;
  if not found then
    return;
  end if;

  v_remaining := greatest(coalesce(v_remaining, 0), 0);
  if v_status is distinct from 'active' or v_remaining = 0 then
    return query select null::uuid, v_id, 0, 0, 0, 0;
    return;
  end if;

  v_amount := least(greatest(coalesce(p_max_cents, 0), 0), v_remaining);
  if coalesce(p_due_cents, 0) - v_amount between 1 and 49 then
    v_amount := greatest(coalesce(p_due_cents, 0) - 50, 0);
  end if;
  if v_amount <= 0 then
    return query select null::uuid, v_id, 0, 0, v_remaining, v_remaining;
    return;
  end if;

  v_available := greatest(v_remaining - public.gift_card_held_cents(v_id), 0);
  if v_available < v_amount then
    return query select null::uuid, v_id, 0, v_amount, v_remaining, v_available;
    return;
  end if;

  insert into public.gift_card_holds (gift_card_id, amount_cents, kind, customer_email, expires_at)
  values (v_id, v_amount, p_kind, lower(btrim(p_customer_email)), p_expires_at)
  returning id into v_hold;

  return query select v_hold, v_id, v_amount, v_amount, v_remaining, v_available;
end $$;

revoke execute on function public.gift_card_held_cents(uuid) from public, anon, authenticated;
grant execute on function public.gift_card_held_cents(uuid) to service_role;
revoke execute on function public.hold_gift_card(text, integer, integer, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.hold_gift_card(text, integer, integer, text, text, timestamptz) to service_role;

-- ── Tier slots, counted in cards ─────────────────────────────────────────────
-- A tier's max_slots (restoration_settings) is a number of cards. Each card
-- counts toward its own tier (cards.tier; older cards without one: the order's
-- tier), on paid orders and on checkouts still in progress (pending, not
-- cancelled, started since p_pending_since), placed since p_since (store_config
-- slots_opened_at; null: all time). Refunded cards free their slot. Read by
-- the restoration checkout, add-cards, upgrades and the Restorations page
-- (lib/tier-slots.ts).
create or replace function public.tier_slot_usage(p_since timestamptz, p_pending_since timestamptz)
returns table (tier text, cards integer)
language sql
stable
set search_path = public
as $$
  select coalesce(c.tier, o.restoration_tier) as tier, count(*)::integer as cards
    from public.cards c
    join public.orders o on o.id = c.order_id
   where coalesce(c.tier, o.restoration_tier) is not null
     and c.status is distinct from 'refunded'
     and (p_since is null or o.created_at >= p_since)
     and (o.payment_status = 'paid'
          or (o.payment_status = 'pending'
              and o.created_at >= p_pending_since
              and o.status is distinct from 'cancelled'))
   group by 1
$$;

revoke execute on function public.tier_slot_usage(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.tier_slot_usage(timestamptz, timestamptz) to service_role;
