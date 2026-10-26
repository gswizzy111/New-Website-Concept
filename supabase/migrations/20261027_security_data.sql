-- Security fixes for photo uploads and the partner portal (fix list items 41
-- and 42). Additive and idempotent. The old site shares this database and
-- keeps working: it uploads only the image types allowed below (plus the
-- upsell list JSON), and still signs partners in by the plaintext
-- partners.passcode, which the new site keeps writing until the switch.

-- ── Card photos bucket (app/api/upload/route.ts) ─────────────────────────────
-- The bucket is public and uploads need no sign-in (checkout photos come
-- before an order exists). Supabase enforces these limits on every upload,
-- including the direct signed-URL uploads the API can't inspect: 20 MB, and
-- only the image types the uploaders accept (no SVG, HTML or other files).
-- application/json is for _config/upsell.json, which both sites keep in this
-- bucket (app/api/shop/upsell-products/route.ts).
update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
      'image/avif', 'image/heic', 'image/heif',
      'application/json'
    ]
where id = 'card-photos';

-- ── Partner portal (lib/partner-portal.ts) ───────────────────────────────────
-- Passcodes are checked against a PBKDF2 hash (lib/crypto.ts). The plaintext
-- passcode column stays (NOT NULL, UNIQUE) because the old site signs in with
-- it; a partner without a hash gets one at their first sign-in on the new site.
alter table public.partners add column if not exists passcode_hash text;

-- Sign-in sessions: the cookie holds a random ID, only its SHA-256 is kept.
-- No IP addresses or device details. Expired rows are deleted as new sessions
-- start; setting a new passcode deletes that partner's sessions.
create table if not exists public.partner_sessions (
  token_hash text primary key,
  partner_id uuid not null references public.partners(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists partner_sessions_partner_idx on public.partner_sessions (partner_id);
create index if not exists partner_sessions_expires_idx on public.partner_sessions (expires_at);
-- Service role only (no policies)
alter table public.partner_sessions enable row level security;

-- Logging a sale checks the partner's allocation and inserts in one step, with
-- the partner's row locked, so two sales at once can't go over it
-- (app/api/partners/kit-sales/route.ts). Returns 'ok', 'over_allocation',
-- 'not_found' or 'invalid'.
create or replace function public.partner_log_sale(
  p_partner_id uuid,
  p_product_type text,
  p_quantity integer,
  p_notes text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocated integer;
  v_sold bigint;
begin
  if p_quantity is null or p_quantity < 1 or p_product_type not in ('kit', 'polish', 'spray') then
    return 'invalid';
  end if;

  select case p_product_type
           when 'kit' then p.kits_allocated
           when 'polish' then p.polish_allocated
           else p.spray_allocated
         end
    into v_allocated
    from public.partners p
   where p.id = p_partner_id
     for update;
  if not found then
    return 'not_found';
  end if;

  select coalesce(sum(s.quantity), 0)
    into v_sold
    from public.partner_kit_sales s
   where s.partner_id = p_partner_id
     and s.product_type = p_product_type;

  if v_sold + p_quantity > coalesce(v_allocated, 0) then
    return 'over_allocation';
  end if;

  insert into public.partner_kit_sales (partner_id, quantity, notes, product_type)
  values (p_partner_id, p_quantity, nullif(btrim(p_notes), ''), p_product_type);
  return 'ok';
end;
$$;
revoke execute on function public.partner_log_sale(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.partner_log_sale(uuid, text, integer, text) to service_role;
