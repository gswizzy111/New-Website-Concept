-- Takes kit stock in one step, so two kit payments at the same moment (or two
-- sizes of one product in the same order) can't overwrite each other's
-- decrement. Called by the Stripe webhook's shop branch; until this is
-- applied, the webhook falls back to a compare-and-set update. Never goes
-- below 0. Additive and safe to run again.
create or replace function public.decrement_product_inventory(p_product_id text, p_qty integer)
returns integer
language sql
volatile
set search_path = public
as $$
  update public.products
     set inventory_count = greatest(coalesce(inventory_count, 0) - greatest(p_qty, 0), 0)
   where id::text = p_product_id
  returning inventory_count;
$$;

revoke all on function public.decrement_product_inventory(text, integer) from public, anon, authenticated;
grant execute on function public.decrement_product_inventory(text, integer) to service_role;
