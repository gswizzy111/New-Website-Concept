-- The Shippo transaction behind an order's prepaid inbound label. The
-- permanent label link (lib/label-link.ts, /api/shipping/label/[orderId])
-- uses it to ask Shippo for a freshly signed label when the stored one
-- expires. thecarddoc1.com already writes this column (#35), so production
-- most likely has it; this file records it and is safe to run again.
alter table public.orders add column if not exists inbound_shippo_transaction_id text;
