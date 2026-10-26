-- Stripe webhook: handle each paid checkout session once, and take gift card
-- balance in one atomic, capped step. Additive and safe to run more than once.
-- The old site (thecarddoc1.com, same database) doesn't use any of this.

-- ── One claim per checkout session ───────────────────────────────────────────
-- Stripe sends an event again after a timeout or an error. The webhook inserts
-- the session here (on conflict do nothing) before it buys a label, takes a gift
-- card balance, adds cards or totals, or sends an email; a repeat finds the row
-- and stops. completed_at is set when the run ends; a claim that never finished
-- (the function timed out part-way) is reported to the admin once, through the
-- checkout error log, when Stripe sends the session again (alerted_at).
-- A run that failed before doing anything (a read or save failed) lets the
-- claim go (released_at, last_error) and answers non-2xx, so Stripe's next
-- delivery takes it over (attempts counts the deliveries). A failure that
-- lasts is reported to the admin once (retry_alerted_at). claim_token is
-- written by the run that holds the claim, so a run only lets go of its own.
create table if not exists public.stripe_webhook_claims (
  stripe_session_id text primary key,
  kind text not null,             -- restoration, prep, gift_card, shop, subscription, add_cards, tier_upgrade
  order_id text,                  -- the order the session pays for, when there is one
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  alerted_at timestamptz,
  note text,                      -- why a run stopped early, or what it found already done
  claim_token uuid,
  attempts integer not null default 1,
  released_at timestamptz,
  last_error text,
  retry_alerted_at timestamptz
);

alter table public.stripe_webhook_claims add column if not exists claim_token uuid;
alter table public.stripe_webhook_claims add column if not exists attempts integer not null default 1;
alter table public.stripe_webhook_claims add column if not exists released_at timestamptz;
alter table public.stripe_webhook_claims add column if not exists last_error text;
alter table public.stripe_webhook_claims add column if not exists retry_alerted_at timestamptz;

alter table public.stripe_webhook_claims enable row level security;
revoke all on table public.stripe_webhook_claims from anon, authenticated;

-- ── Gift card redemptions ────────────────────────────────────────────────────
-- One row per payment that used a gift card (reference = the Stripe checkout
-- session id), so the same payment can never take the balance twice.
create table if not exists public.gift_card_redemptions (
  reference text primary key,
  gift_card_id uuid references public.gift_cards(id) on delete set null,
  requested_cents integer not null,
  applied_cents integer not null,
  created_at timestamptz not null default now()
);

create index if not exists gift_card_redemptions_gift_card_id_idx
  on public.gift_card_redemptions (gift_card_id);

alter table public.gift_card_redemptions enable row level security;
revoke all on table public.gift_card_redemptions from anon, authenticated;

-- Takes up to p_cents off the card, never below zero, once per p_reference.
-- The card row is locked for the update, so two payments can't both spend the
-- same balance. Returns what was taken (applied), the balance left (remaining,
-- null when the card doesn't exist) and whether this reference was already
-- redeemed (repeated: the first result is returned and nothing changes).
create or replace function public.redeem_gift_card(p_gift_card_id uuid, p_cents integer, p_reference text)
returns table (applied integer, remaining integer, repeated boolean)
language plpgsql
set search_path = public
as $$
declare
  v_remaining integer;
  v_applied integer;
begin
  if p_reference is null or p_reference = '' then
    raise exception 'redeem_gift_card needs a reference';
  end if;

  select r.applied_cents into v_applied
    from public.gift_card_redemptions r
   where r.reference = p_reference;
  if found then
    return query
      select v_applied, (select g.remaining_cents from public.gift_cards g where g.id = p_gift_card_id), true;
    return;
  end if;

  if p_cents is null or p_cents <= 0 then
    return query select 0, (select g.remaining_cents from public.gift_cards g where g.id = p_gift_card_id), false;
    return;
  end if;

  select g.remaining_cents into v_remaining
    from public.gift_cards g
   where g.id = p_gift_card_id
     for update;

  if not found then
    insert into public.gift_card_redemptions (reference, gift_card_id, requested_cents, applied_cents)
    values (p_reference, null, p_cents, 0)
    on conflict (reference) do nothing;
    return query select 0, null::integer, false;
    return;
  end if;

  v_applied := least(p_cents, greatest(coalesce(v_remaining, 0), 0));

  insert into public.gift_card_redemptions (reference, gift_card_id, requested_cents, applied_cents)
  values (p_reference, p_gift_card_id, p_cents, v_applied)
  on conflict (reference) do nothing;
  if not found then
    -- A concurrent call for the same payment got there first
    return query
      select r.applied_cents, v_remaining, true
        from public.gift_card_redemptions r
       where r.reference = p_reference;
    return;
  end if;

  update public.gift_cards g
     set remaining_cents = greatest(0, g.remaining_cents - v_applied),
         status = case when g.remaining_cents - v_applied <= 0 then 'depleted' else g.status end
   where g.id = p_gift_card_id
  returning g.remaining_cents into v_remaining;

  return query select v_applied, v_remaining, false;
end $$;

revoke execute on function public.redeem_gift_card(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.redeem_gift_card(uuid, integer, text) to service_role;
