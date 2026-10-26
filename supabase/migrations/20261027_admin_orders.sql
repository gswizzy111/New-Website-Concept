-- Return labels bought from the admin order page save their carrier with the
-- tracking number, so tracking is looked up with the right carrier (UPS and
-- FedEx labels were always checked as USPS). These columns already exist in
-- the production and TEST databases (from the original schema, unused until
-- now); this only documents them and adds them where they're missing.
-- Additive and idempotent: safe to run more than once, and the old site
-- neither reads nor writes them.
alter table public.orders add column if not exists outbound_tracking_number text;
alter table public.orders add column if not exists outbound_carrier text;
alter table public.orders add column if not exists outbound_service_level text;
alter table public.orders add column if not exists outbound_tracking_url text;
