-- Unpaid order reminders (lib/checkout-reminder.ts, app/api/cron/checkout-reminders,
-- every 5 minutes from netlify/functions/cron-checkout-reminders.mjs).
--
-- A restoration or prep customer who reaches Stripe but doesn't pay gets one
-- email, 10 to 25 minutes after the order was created, with a button back to
-- the same Stripe payment page. payment_reminder_sent_at is the claim: the job
-- sets it (only while it is still null) before it looks at Stripe or sends,
-- so overlapping runs never email anyone twice. It stays set when the job
-- then decides not to send (the Stripe page had closed or was paid).
--
-- Restoration and prep orders both live in orders (prep: restoration_tier
-- 'prep'). Shared database with the old site, which never reads the column:
-- additive and safe to run more than once. Nothing else about the order
-- (status, total, tier slot, gift card hold) is touched by the reminder.

alter table public.orders add column if not exists payment_reminder_sent_at timestamptz;

comment on column public.orders.payment_reminder_sent_at is
  'When the unpaid-order reminder job claimed this order (lib/checkout-reminder.ts). Set once, before sending; null means no reminder yet.';

-- The job's every-5-minutes lookup: unpaid orders not yet reminded, by age.
-- Small, since paid and reminded orders drop out of it.
create index if not exists orders_payment_reminder_due_idx
  on public.orders (created_at)
  where payment_status = 'pending' and payment_reminder_sent_at is null;
