-- Kit orders: when each one was marked shipped.
--
-- The Ship Queue's "Recently Shipped (last 48h)" list filtered on
-- shop_orders.updated_at, a column that doesn't exist, so it never showed.
-- shipped_at is stamped by a trigger whenever an order's status becomes
-- 'shipped', whichever site or route makes the change (the old site keeps
-- working unchanged: it never writes this column). Moving the order back to
-- processing and shipping it again stamps it again. Orders shipped before this
-- migration keep shipped_at empty.
--
-- Additive and safe to run more than once.

alter table public.shop_orders add column if not exists shipped_at timestamptz;

create or replace function public.shop_orders_stamp_shipped_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'shipped' then
    if tg_op = 'INSERT' then
      new.shipped_at := coalesce(new.shipped_at, now());
    elsif old.status is distinct from 'shipped' then
      new.shipped_at := now();
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger shop_orders_stamp_shipped_at
  before insert or update of status on public.shop_orders
  for each row execute function public.shop_orders_stamp_shipped_at();

-- The Ship Queue reads shipped kits by this time
create index if not exists shop_orders_shipped_at_idx
  on public.shop_orders (shipped_at)
  where shipped_at is not null;
