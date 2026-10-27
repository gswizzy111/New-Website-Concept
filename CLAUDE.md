# The Card Doc (redesign)

@AGENTS.md

Redesigned copy of The Card Doc site (source: `gswizzy111/card-restoration`,
imported unchanged at commit 5019f00). Next.js 16 App Router, Tailwind v4,
shadcn/ui, Supabase, Stripe, Shippo, Resend. Product facts live in
`PRODUCT.md`; the visual system lives in `DESIGN.md` and `app/globals.css`.

Rules for this repo:

- **Appearance only.** Do not change logic, data, routes, prices, policies or
  flows. **Never change the owner's wording**, including punctuation.
- **Production is live.** The Netlify site (nimble-chebakia-ecb45c) gets
  every key from its Netlify environment variables; never put keys in
  `netlify.toml`. It shares the Supabase database and Stripe account with
  the old site (thecarddoc1.com, repo `gswizzy111/card-restoration`).
  `NEXT_PUBLIC_*` values are baked in at build time: after changing one in
  Netlify, production needs a new build. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
  is a browser key (Places API (New) + Maps JavaScript API), restricted to the
  site's domains in Google Cloud; it is not marked secret because it ships in
  the page. The live Stripe webhook runs on the old site and serves both
  until the switch. Links, Stripe return URLs and metadata use `siteUrl()`
  (`lib/site-url.ts`: `NEXT_PUBLIC_APP_URL`, else https://thecarddoc1.com).
- **Preview mode** (`NEXT_PUBLIC_PREVIEW_MODE=true`) is on for branch deploys
  and deploy previews only (`netlify.toml`). It runs the site without
  checkout or accounts: `/api/*` returns "not functional yet" and private
  areas show `/not-available`. Supabase is read-only: reads show real data,
  every write is refused in `lib/preview.ts`. See `lib/preview.ts` and
  `middleware.ts`.
- **Admin logins** are per person: `admin_users` (username + PBKDF2 hash from
  `lib/crypto.ts`) in the shared database, so the same logins work on both
  sites; accountants sign in with their email (`accountant_access`). The
  cookie (`admin_session`) holds a random session ID whose SHA-256 is in
  `admin_sessions`; it ends with the browser, on sign-out, or after 12 hours
  (`lib/admin-session.ts`). Pages and routes check with `isAdmin()` /
  `requireAdmin()` from `lib/admin-auth.ts`; never compare cookies to an env
  var. `ADMIN_PASSWORD` is no longer used. Admins change their password and
  recovery email on `/admin/profile`; "Forgot password?" emails a one-time,
  1-hour link (SHA-256 in `admin_password_resets`) to that recovery email or
  the accountant's email, and using it signs that person out everywhere
  (`lib/admin-password.ts`).
- **Creator portal** (`/affiliates`, linked in the footer): creators sign in
  with their code and a password they set from a one-time, 7-day setup link
  the admin makes on the Affiliates page (codes are public, so a code alone
  opens nothing). Sessions are random IDs hashed in `affiliate_sessions`. The
  dashboard shows totals for the code (sales, revenue, commission, by
  service and month, recent sales) and never customer details; the admin
  Affiliates page counts sales the same way (`lib/creator-portal.ts`).
  Commission is set per code on the Affiliates page (default 10%, coupons
  0%); `affiliate_commission_rates` keeps each rate's start, and a sale earns
  the rate in effect when it was placed, so "from now on" changes never
  reprice past sales.
- **Terms of Service (v1.1 current) and signing.** The Terms text is
  `legal/terms-v<version>.md`, word for word (never edit it: a wording
  change is a new file and a new `TERMS_VERSION` in
  `lib/legal/current-terms.ts`). `scripts/legal-texts.mjs` turns
  `legal/*.md` into `lib/legal/generated-texts.ts` before every build and
  dev run. Each version is stored once in `terms_versions` (immutable) and
  stays at `/terms/v<version>`; `/terms` shows the current one with its
  PDF. Checkout stays short on purpose (the owner's call): picking slab
  cracking pops up that card's Slab Removal Authorization, signed there
  with a checkbox and typed name (closing it unsigned takes the slab and its
  $7 off); at the end "Sign to confirm your order" has a Terms link, two
  required boxes (the Terms, electronic records), the certification behind
  a tap, and Full legal name (`components/checkout/`). Restoration, prep and
  add-cards checkouts require the master signature, E-SIGN consent and an
  insurance buy-or-decline choice; the master signature's text holds the
  certification, the e-sign consent, both boxes, exactly what was
  authorized (each card's details, declared value, services and prices, the
  order's charges and total) and the optional choices
  (`authorizedOrderText` in `lib/checkout-signing.ts`), and its PDF prints
  all of it after the Terms. v1.1 (October 23, 2026) removed the separate
  High-Value Agreement for cards over $5,000 (the owner's call); v1.0 stays
  at `/terms/v1.0` for orders signed under it, and the unused
  `high_value_agreements` table is kept for history. `signatures` and `consents` can't be
  edited or deleted and the database sets the signing time; orders with
  signed records can't be deleted. Start cleaning / slab opening and
  per-card refunds follow `lib/work-gates.ts`. Up to 3 photos per card.
  Same code in both repos
  (the old site has its own page styling). Schema:
  `supabase/migrations/20261022_terms_v1.sql`. v1.0 was corrected once,
  before anyone signed it (`20261022_terms_v1_heading_fix.sql`).
- **Dashboard numbers** come from the database (`supabase/migrations/
  20261023_dashboard_metrics.sql`, read through `lib/dashboard-metrics.ts`), in
  New York days, never from client-side bucketing or unpaged selects (the API
  returns at most 1,000 rows; page with `lib/fetch-all.ts`). Refunds are the
  `refunds` ledger, dated when the money went back (`lib/refund-ledger.ts`): the
  admin refund routes record each refund, and `syncRefunds()` (dashboard load,
  daily job) adds refunds made in the Stripe Dashboard and updates pending ones.
  A partial refund keeps `payment_status` 'paid' (the column only allows
  pending/paid/refunded/failed). The backlog counts unfinished cards, not orders;
  triggers log every order status change and card tick in `backlog_events`
  (exact history from October 23, 2026; earlier days are rebuilt from
  `order_events` and flagged), and `backlog_daily` keeps each finished day. Tabs:
  `/admin/backlog` and `/admin/services` (PSA Prep vs Full Restoration).
  Reports (Tax, Sales Statement, P&L) count through `lib/sales-report.ts`, and
  every CSV is built with `lib/csv.ts`.
- **Daily jobs** run as Netlify scheduled functions in `netlify/functions/`,
  which call `/api/cron/*` with `CRON_SECRET`.
- **Email** goes through Resend from `FROM_EMAIL` (orders@thecarddoc1.com, no
  mailbox), so `lib/resend.ts` gives every email a reply-to (`CONTACT_EMAIL`,
  else thecarddoc1@gmail.com) unless it sets its own. Account links (confirm,
  reset) are minted with `generateLink` and sent by us (`lib/account-links.ts`),
  never by Supabase's mailer. Resend's webhook (`/api/webhooks/resend`, this
  site only, `RESEND_WEBHOOK_SECRET`) records bounced, spam-complaint,
  suppressed and failed emails in `email_problems`; both sites' admins show
  them on `/admin/email-problems`, as a nav badge and on the order page
  (`lib/email-problems.ts`). Resend's `send()` returns `{ error }` and never
  throws: always check it.
- **Marketing email** (Email Blast, waitlist notice, `lib/email-unsubscribe.ts`):
  each send stores a fresh unsubscribe token per address (SHA-256 only), links
  `/email/unsubscribe?token=`, sends one-click `List-Unsubscribe` headers and
  skips unsubscribed, invalid, bouncing and complaining addresses. It refuses to
  send (`marketingSendProblem()`) unless the `BUSINESS_SHIPPING_*` postal address
  is complete and `siteUrl()`'s host is the admin's. Progress: `email_blasts`.
- **Stripe webhook** (`app/api/webhooks/stripe/route.ts`) handles each checkout
  session once: it claims it in `stripe_webhook_claims` before any label, gift
  card charge, card or total change, or email. A repeat gets 200 `{duplicate}`;
  an unfinished claim under 2 minutes old gets 409; an older one alerts once. A
  failure before any side effect releases the claim and answers 500 (Stripe
  retries); after one, it alerts and answers 200, so no second label is bought.
  Data checks (orders turn paid only from pending/failed/null, unique session or
  subscription IDs, the event's `metadata.stripe_session_id`) also catch the old
  site's webhook. Alerts go to the checkout error log (`/admin/checkout-errors`,
  emailed to `ADMIN_NOTIFICATION_EMAIL` or the fallbacks in
  `lib/checkout-error-log.ts`): WEBHOOK_FAILED, WEBHOOK_UNFINISHED,
  WEBHOOK_RETRYING, OLD_SITE_HANDLED, ORDER_INCOMPLETE, GIFT_CARD_NOT_CHARGED,
  GIFT_CARD_SHORT, GIFT_CARD_EMAIL_FAILED, LABEL_NOT_SAVED, KIT_LABEL_NOT_SAVED,
  KIT_CLUB_ORDER_NOT_SAVED, ADD_CARDS_INCOMPLETE, TIER_UPGRADE_INCOMPLETE. Event
  descriptions never change (the dashboard SQL parses them). Never enable the
  old and new endpoints at once: the old one is not idempotent.
- **Gift cards**: only the webhook's `redeem_gift_card()` takes balance (locked,
  never below 0, once per session, `gift_card_redemptions`); never
  read-then-write `remaining_cents`. Restoration and kit checkouts hold what
  they take off (`lib/gift-card-holds.ts`) until paid, released or 30 minutes
  after their 60-minute session expires, and never leave 1-49 cents to pay.
- **Tier slots** (`lib/tier-slots.ts`): one slot is one order and `max_slots`
  counts orders; a mixed-tier order counts once in each of its tiers. Counted
  since `slots_opened_at`: paid orders, plus pending checkouts under 30 minutes
  old for new orders. An upgrade takes a slot in the new tier; added cards take
  none, except the first Bronze card on a mixed-tier order (one Bronze slot).
  Prices come from `restoration_settings` (`getLiveTiers()`).
- **Tip** (optional, restoration checkout): in `orders.total_cents`, the Stripe
  line and the signed text; gift cards never cover it, and the webhook must
  never overwrite `total_cents` on new orders.
- **Attempt limits** (`lib/attempt-limit.ts`, `auth_attempts`): per name or email
  (or everyone), never per IP, stored as SHA-256; `takeAttempt()` reserves first
  and limits fail open. Admin, accountant and creator sign-ins: 10 per name per
  15 minutes; partner sign-in 20 and loyalty lookup 60 per 15 minutes in all;
  confirmation, reset and Kit Club link emails: 3 per address per hour.
- **Kit Club** (`/subscribe/manage`, `lib/kit-club-link.ts`): viewing or
  cancelling needs the emailed one-time, 1-hour link (`kit_club_manage_links`,
  SHA-256) or a signed-in account with the same confirmed email. The price is
  the subscriber's last billed kit, else the admin setting ($89.99 fallback).
- **Partner portal** (`lib/partner-portal.ts`): passcodes are PBKDF2 hashes
  (`passcode_hash`, 10+ characters, never shown); sessions are SHA-256 in
  `partner_sessions` (30 days). `KEEP_PLAINTEXT_PASSCODE` keeps writing the
  plaintext `passcode` for the old site until the switch, then set it false.
- **Analytics**: GA4 and the Meta pixel load only from `trackingGuardScript()`
  (`lib/tracking-guard.ts`, first in `<head>`); pixel events go through
  `lib/pixel.ts`. Global Privacy Control keeps the pixel off. Stripe return pages
  drop `session_id` from the address. Private pages (`KEY_PATH`, token or email
  parameters, "@") turn both off for the tab; add new token or email pages there.
- **Admin refunds** (`lib/order-payments.ts`, order and per card): split across
  the order's payments (original, then add-cards and upgrades), each recorded
  with `recordRefund`; a per-click `requestId` is the Stripe idempotency key.
  Stripe refunds the ledger lacks are recorded first and the request gets 409.
- **Completion notes email** (`lib/completion-notes-email.ts`) goes once per
  order: notes saved before the order is done are held and sent when it becomes
  completed, shipped_back or delivered; notes saved after go at once.
- **Kit orders**: a trigger stamps `shop_orders.shipped_at`. Cancel & Refund
  (`/api/admin/shop-orders/[id]/cancel`) claims the order as cancelled, refunds
  what Stripe still holds and restores the status if that fails (never voids a
  label); cancelled kits refuse status and label changes. Customers can't cancel.
- **Product costs** change only by PATCH `/api/admin/product-costs` (one change,
  applied on the server). **Prep** is US and Puerto Rico only.
- **Migrations `20261027_*.sql`** are additive and rerunnable; apply them to
  production before the code (`attempt_limits` before `security_data`). A new
  function in `public` sets its own `search_path`.

## Design skills: who owns what

Several design skills live in `.claude/skills/` (sources in
`.claude/skills/SOURCES.md`). They overlap, so use them in these roles:

1. **Look and feel: `design-md`.** Pick the design direction from its catalog
   (or the one the user names) and keep it in `DESIGN.md` at the repo root.
   `DESIGN.md` is the single source of truth for colors, type, spacing, radii
   and components. Product facts (audience, goals, voice) go in `PRODUCT.md`.
   Impeccable reads both files, so keep them current.
2. **Build quality: `design-taste-frontend` + `impeccable`.** Use the taste
   skill's design read, dials and final pre-flight check when building pages.
   Use `/impeccable` subcommands for critique, audit, polish, typeset,
   bolder/quieter, harden and optimize passes.
3. **Motion: Emil Kowalski's skills.** `animate` to build animations,
   `review-animations` / `improve-animations` to check them,
   `find-animation-opportunities` before adding motion, `emil-design-eng` for
   general polish, `pick-ui-library` when choosing a library.
4. **Verification: `playwright-cli`.** Open the running site, check desktop
   (1440px) and phone (390px) widths in light and dark mode, and look at the
   screenshots before calling UI work done.

## When the skills disagree

Apply this order, highest first:

1. The user's explicit instructions in the conversation.
2. `DESIGN.md` (the chosen direction). If it names a font, color or pattern
   that another skill bans by default (serif, Inter, a purple accent), the
   design wins, as long as it is a deliberate choice.
3. Accessibility and performance: WCAG AA contrast, `prefers-reduced-motion`,
   keyboard focus, Core Web Vitals. These are never traded away for style.
4. `design-taste-frontend` bans and pre-flight check.
5. `impeccable` and Emil's guidance.

Other tie-breakers:

- **Proprietary fonts** named in a design file (SF Pro, Söhne, brand faces)
  are not licensed. Swap in a close free font via `next/font` and note it in
  `DESIGN.md`.
- **Never copy** another company's logo, name, imagery or marketing copy. The
  design files are inspiration, not a template.
- **Em-dash ban** (taste skill) applies to visible site copy only, not to code
  comments or docs.
- **Stack:** Tailwind v4 + shadcn/ui (customized, never default styling) +
  Motion (`motion/react`). Add GSAP only for real scroll pinning or scrubbing,
  and never mix it with Motion in the same component.
- **Icons:** one library per project: `lucide-react` (already used here), stroke 1.75.
- **Polish in bounded passes:** build, check once at both widths, fix
  everything in one batch, check at most once more, stop.

## Tooling notes

- Impeccable's automatic hooks are not committed. Enable per machine with
  `/impeccable hooks on` (writes the gitignored `.claude/settings.local.json`).
- `playwright-cli` needs the `@playwright/cli` package (not installed yet).
  In cloud sessions Chromium is
  preinstalled at `/opt/pw-browsers`; do not run `playwright install`.
