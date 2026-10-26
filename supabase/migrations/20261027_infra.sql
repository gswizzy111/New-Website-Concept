-- Fix list item 66 (Supabase advisors). Additive and safe to run more than once.
--
-- 1. Indexes on the order foreign keys that every order page, the dashboard
--    functions and order deletes look up by (unindexed_foreign_keys).
create index if not exists cards_order_id_idx on public.cards (order_id);
create index if not exists order_events_order_id_created_at_idx on public.order_events (order_id, created_at);
create index if not exists order_services_order_id_idx on public.order_services (order_id);

-- 2. A fixed search_path on the 16 functions the advisor flags
--    (function_search_path_mutable). Their bodies only use tables and
--    functions in public and built-ins in pg_catalog (no pgcrypto or other
--    extension functions; checked on TEST and production), so public is
--    enough. Behaviour is unchanged. A function that doesn't exist is skipped.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.backlog_compute(date, date)',
    'public.backlog_now()',
    'public.backlog_report(date, date)',
    'public.consents_guard()',
    'public.consents_stamp()',
    'public.et_day_start(date)',
    'public.forbid_change()',
    'public.hva_guard()',
    'public.log_card_change()',
    'public.log_order_status()',
    'public.order_card_count(uuid)',
    'public.order_service(uuid, text)',
    'public.revenue_series()',
    'public.service_report(date, date)',
    'public.signatures_stamp()',
    'public.stamp_card_completed()'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('alter function %s set search_path = public', fn);
    end if;
  end loop;
end $$;
