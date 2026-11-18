-- Admin speed (Nov 18, 2026): indexes for the staff admin's most frequent reads.
--
-- Additive and rerunnable: indexes only, each CREATE INDEX IF NOT EXISTS. No
-- tables, functions, grants or data change. The tables are small (orders 1.4k
-- rows, shop_orders 619, cases 64), so each index builds in milliseconds; a
-- plain CREATE INDEX holds a short write lock on its table while it builds.
--
-- What each one serves (pg_stat_statements, Nov 18):
--
-- 1. orders: paid orders of a restoration tier since a date. The single most
--    frequent orders read (about 101k calls, 13 ms mean): "select
--    restoration_tier from orders where payment_status = $1 and
--    restoration_tier is not null and created_at >= $2". Partial on the same
--    predicate, carrying restoration_tier so it can answer from the index.
create index if not exists orders_tier_paid_created_idx
  on public.orders (payment_status, created_at)
  include (restoration_tier)
  where restoration_tier is not null;

-- 2. orders by status: admin lists that filter on one status ("where status
--    = $1 ...", about 8.2k and 9.6k calls for the two most frequent shapes).
create index if not exists orders_status_idx
  on public.orders (status);

-- 3. shop_orders newest first: Kit Orders reads every kit order "order by
--    created_at desc, id" in pages, and the revenue chart reads "order by
--    created_at desc" (about 9.4k calls, 18 ms mean). The id breaks ties, so
--    the index gives both orders without a sort.
create index if not exists shop_orders_created_at_desc_idx
  on public.shop_orders (created_at desc, id);

-- 4. cases by type and status: the admin layout's open-case badges and the
--    dashboard's update requests ("type = $1 and status in (...)"). The table
--    is tiny today; this keeps those counts cheap as it grows.
create index if not exists cases_type_status_idx
  on public.cases (type, status);
