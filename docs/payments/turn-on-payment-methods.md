# Turning on Apple Pay, Google Pay, Link and pay-later options

For the owner. Checked against Stripe's documentation and this site's code on
November 17, 2026.

## The short version

The site's checkout pages never say which payment methods to show. Stripe shows
whatever is switched on in the Stripe Dashboard, so this is a settings job: no
developer is needed.

1. **Check these are on:** Apple Pay, Google Pay, Link.
2. **Turn on:** Affirm. Optionally Cash App Pay.
3. **Turn on later:** Klarna and Afterpay, once the old site no longer sells
   gift cards (see "The Stripe account is shared" below).
4. **Keep off:** ACH Direct Debit, bank transfers and every other bank debit or
   bank transfer method.

The Stripe account is shared with the old site (thecarddoc.netlify.app), so
every switch you flip applies there too.

## What each method does here

| Method | Turn on? | Where it shows | Amounts (US) | Refund window |
|---|---|---|---|---|
| Apple Pay | Yes | Every checkout, iPhone/iPad/Mac in Safari or iOS Chrome | Any | Same as cards |
| Google Pay | Yes | Every checkout, Chrome and Android | Any | Same as cards |
| Link (incl. its bank option) | Yes | Every checkout | Any; bank option under about $7,500 | Same as cards |
| Affirm | Yes | Orders, prep, kits, add cards, upgrades, gift cards. Not Kit Club | $35 to $30,000 | 120 days |
| Cash App Pay | Optional | Every checkout, including Kit Club | From $0.50; works best under $2,000 | **90 days** |
| Klarna | Later | Orders, prep, kits, add cards, upgrades, Kit Club. Never gift cards | Pay in 4: $1 to $2,000; Financing: $45 to $10,000 | 180 days |
| Afterpay | Later | Orders, prep, kits, add cards, upgrades. Never gift cards or Kit Club | Pay in 4: $1 to $2,000; Monthly: $400 to $4,000 | 120 days |
| ACH Direct Debit | **No** | | | |
| Bank transfers | **No** | | | |

For scale: in the last 180 days the middle paid restoration order was $162,
nine in ten were under $444 and the largest was $2,636. Kit orders ran up to
$406. So Affirm, Klarna and Afterpay cover almost every order; Affirm's 0%
interest plans start at $500, which is where Fast Pass, Diamond and big
multi-card orders sit.

Stripe decides, for each customer, which of the switched-on methods to show:
by amount, the customer's country, and whether it is a subscription. For a US
business, pay-later methods and Cash App Pay only show to customers in the US.

## Step by step in the Stripe Dashboard

1. Log in at dashboard.stripe.com. Make sure you are in the live account, not
   test mode or a sandbox (the switch or banner at the top of the page).
2. Click the **gear icon** (Settings, top right). Under **Payments**, click
   **Payment methods**. Direct link:
   https://dashboard.stripe.com/settings/payment_methods
3. Near the top is the **configuration** picker. The site uses Stripe's
   default configuration, so pick the one named **Default** (it may say
   "Default Config"). If there is only one, that is it. Do not create a new
   configuration: the site would not use it.
4. Find the **Wallets** section.
   - **Apple Pay**: on. No domain setup is needed. Stripe's own payment page
     shows Apple Pay "with no additional configuration". If Stripe offers to
     add domains on the "Payment method domains" page, you can skip it: that
     is only for payment forms built into a website, and this site sends
     customers to Stripe's page.
   - **Google Pay**: on.
   - **Link**: on. Its "Instant Bank Payments" option comes with it and is
     fine (it confirms instantly, unlike ACH).
   - **Cash App Pay**: on if you want it (read the refund note below first).
   Each row has a switch, or a **Turn on** button (sometimes inside the
   **⋯** menu on the right).
5. Find the **Buy now, pay later** section.
   - **Affirm**: Turn on. Stripe may run a quick eligibility check or say it
     is reviewing. If it says the account is not eligible, stop there; nothing
     else is needed. Leave the financing package on **Standard** unless you
     decide otherwise (Enhanced gives customers more 0% plans and costs you
     more).
   - **Klarna** and **Afterpay / Clearpay**: leave off for now. Turn them on
     once the old site's gift card page is retired or fixed (next section).
6. Check the **Bank debits** and **Bank transfers** sections. **ACH Direct
   Debit** and every bank transfer method must show **Off**. If one is on,
   turn it off.
7. If the page shows a **Save** button, click it. Changes can take a few
   minutes to reach the checkout page.
8. Optional: the **Review** tool shows what a customer would see without
   making a checkout: https://dashboard.stripe.com/settings/payment_methods/review
   Enter an amount (try 450 USD) and a US customer.

Check the list again every few months. If ACH Direct Debit or a bank transfer
method ever shows On, turn it off.

## Check it on your iPhone without paying

1. Use an iPhone with a card in Apple Wallet and Face ID or Touch ID set up.
   Open **Safari** in a normal tab (not a private tab, and not the browser
   inside Instagram or Facebook).
2. Go to thecarddoc1.com/shop, add any kit to the cart, open the cart, fill
   in your details and tap the button that goes to payment.
   Use the kit cart (or the gift card page) for this test. **Do not use the
   restoration or prep order form**: it creates an order and permanent signed
   records before payment.
3. You land on Stripe's payment page (checkout.stripe.com). Look for the black
   **Apple Pay** button at the top. Further down, the pay-later options you
   turned on appear as choices (Affirm needs at least $35, so pick a kit over
   that or add two).
4. **Do not tap Apple Pay.** Leave with the back arrow at the top left, or
   close the tab. Nothing is charged, and the unpaid page expires on its own.
5. Google Pay: the same steps on an Android phone in Chrome, with a card in
   Google Wallet.

If Apple Pay does not show: make sure you are in Safari and not a private tab,
that Wallet has a card, and that Safari is allowed to check for Apple Pay
(iPhone Settings, Safari, Advanced, "Check for Apple Pay"). Then check that
Apple Pay is on in the **Default** configuration.

The gift card page never shows Klarna or Afterpay. That is on purpose (next
section).

## The Stripe account is shared with the old site

Both sites use the same Stripe account, so every switch applies to
thecarddoc.netlify.app too.

- **Gift cards.** Klarna's and Afterpay's rules forbid selling gift cards with
  them. The new site's gift card checkout now hides both of them. The old
  site's gift card checkout does not. Turn on Klarna and Afterpay only when the
  old site no longer sells gift cards, or after a developer copies the same
  one-line change into the old site's `app/api/gift-cards/checkout/route.ts`.
  Affirm allows gift cards like ours (under $2,000), so it is fine now.
- **Webhook.** The old site's payment webhook treats every finished checkout
  as paid. That is fine for cards, wallets, Link and pay-later (they confirm
  instantly), and it is the main reason ACH must stay off (below).

## What changes for refunds

Refund from the admin pages exactly as now. Full, partial and per-card refunds
work for every method above. Nothing in the site's refund code changes.

| Method | Refund window | Time to reach the customer |
|---|---|---|
| Cards, Apple Pay, Google Pay, Link | As today | As today |
| Klarna | 180 days | Usually 5 to 7 business days |
| Affirm | 120 days | Up to 2 days |
| Afterpay | 120 days | Up to 10 business days |
| Cash App Pay | **90 days** | Up to 10 business days |

- **Pay-later refunds** cancel the customer's remaining installments and pay
  back what they already paid. Customers see it in their Klarna, Affirm or
  Afterpay app.
- **Refunds take a while to finish.** The admin refund log shows them as
  pending and updates them on its own (after admin dashboard and report loads, every 10 minutes, and in the daily job).
- **A refund can fail.** If Stripe reports one as failed, the money goes back
  to your Stripe balance and you need to pay the customer back another way.
  The order page still shows the amount as refunded, so add an admin note.
- **After the window**, Stripe refuses the refund and the admin page shows
  Stripe's error. Pay the customer back another way. In the last year there
  were 128 refunds on orders (95 of them partial); one came more than 90 days
  after the order and none after 120 days. The window that matters is Cash
  App Pay's 90 days on slow Bronze orders (2 to 3 months), which is why Cash
  App Pay is optional.
- **Klarna** cannot refund a payment once the customer has opened a dispute.
  Answer the dispute in Stripe instead.
- **Disputes** work like card disputes: Stripe emails you and holds the
  amount. You have about two weeks to answer (Afterpay 14 days, Affirm 15,
  Cash App Pay 13). If Stripe asks you, on a pay-later provider's behalf, to
  pause shipping an order, do it.
- **The admin order list shows "Card"** for every Stripe payment, including
  Apple Pay and Klarna. To see the real method, open the payment in Stripe.

## Why some methods must stay off

ACH Direct Debit and bank transfers are "delayed" methods: Stripe's checkout
finishes before the money arrives, and the money lands days later or fails.

- The new site's webhook ignores such a checkout: it emails an alert
  (PAYMENT_PENDING) and never finishes the order, even after the money
  arrives. Every one would be manual work.
- The old site's webhook does the opposite: it marks the order paid, buys the
  prepaid label, issues gift cards and sends emails straight away, before any
  money has arrived. If the debit then fails, the work and the label are
  already paid for.
- Turning on ACH also hides Link's instant bank option.

They need webhook work before they can be turned on. Leave every other method
off too unless a developer has checked it.

## Costs (Stripe's US prices)

| Method | Fee per payment |
|---|---|
| Cards, Apple Pay, Google Pay, Link (card) | Your normal card rate |
| Link instant bank payment | 2.6% + 30¢ |
| Cash App Pay | 2.9% + 30¢ |
| Klarna | 5.99% + 30¢ |
| Affirm | 6% + 30¢ (Standard), 7.99% + 30¢ (Enhanced) |
| Afterpay | 6% + 30¢ |

Klarna's rules forbid charging customers more for paying with Klarna.

## For developers

### Every Stripe Checkout session (new site, commit 4ecb73b)

None sets `payment_method_types`, `payment_method_configuration`,
`payment_intent_data.capture_method`, `setup_future_usage`, `customer`,
`customer_creation`, `shipping_address_collection` or `shipping_options`.
So: dynamic payment methods from the account's default configuration,
automatic capture, guest customers prefilled with `customer_email`, no
shipping collected by Stripe (addresses are collected on the site and sent in
metadata). All are USD and use the hosted page.

| Flow | File | Mode | Expiry | Amounts | `payment_intent_data` |
|---|---|---|---|---|---|
| Restoration | `app/api/checkout/route.ts` | payment | 60 min with a gift card, else 24 h | median $162, max $2,636 (180 days) | none |
| Prep | `app/api/prep/checkout/route.ts` | payment | 24 h | in the restoration figures | none |
| Kits | `app/api/shop/checkout/route.ts` | payment | 60 min with a gift card, else 24 h | $20 to $406, median $76 | none |
| Gift cards | `app/api/gift-cards/checkout/route.ts` | payment | 24 h | $10 to $1,000 | none; now `excluded_payment_method_types: ["klarna", "afterpay_clearpay"]` |
| Kit Club | `app/api/subscribe/checkout/route.ts` | subscription, monthly | 24 h | admin setting ($89.99 fallback) | n/a |
| Add cards | `app/api/orders/[orderNumber]/add-cards/route.ts` | payment | 24 h | tier price × cards + tax | `metadata` (order_id, type) |
| Tier upgrade | `app/api/orders/[orderNumber]/upgrade/route.ts` | payment | 24 h | price difference + tax | `metadata` (order_id, type) |

The old site (`gswizzy111/card-restoration`, `Desktop/POKEMON/card-restoration`)
has the same seven sessions, also without payment method options, and without
the gift card exclusion.

### Compatibility

- **Webhook, new site** (`app/api/webhooks/stripe/route.ts`): returns early on
  `payment_status === "unpaid"` with a PAYMENT_PENDING alert and does not
  handle `checkout.session.async_payment_succeeded` or `_failed`. Every method
  marked "turn on" above confirms immediately (Stripe: Affirm, Afterpay and
  Cash App Pay "Payment confirmation timing: Immediate"; Afterpay is an
  "immediate notification payment method"; Link bank payments "deliver instant
  confirmation"; Klarna has no `processing` state: the PaymentIntent goes from
  `requires_action` to `succeeded` or back to `requires_payment_method`, and
  Stripe pays the full amount once Klarna accepts). So
  `checkout.session.completed` arrives with `payment_status: "paid"` and the
  claim logic runs as for cards. Stripe's fulfillment guide names ACH Direct
  Debit and other bank transfers as the delayed methods.
- **Webhook, old site**: never reads `payment_status`. Safe for immediate
  methods only.
- **Refunds** (`lib/order-payments.ts`, `lib/refund-ledger.ts`): read the
  PaymentIntent's `latest_charge` (`amount_captured`, `amount_refunded`) and
  create refunds by `payment_intent` with an amount; method-agnostic. Pending
  and `requires_action` refunds count as live; `syncRefunds()` updates their
  final status. A refund that later fails leaves `orders.refunded_cents` as it
  was (existing behaviour for every method).
- **Gift card holds**: sessions with a gift card expire after 60 minutes.
  Affirm (12 h) and Afterpay (3 h) allow longer inside their own pages; if the
  Checkout session expires first, the payment is cancelled and the hold
  released as today. Nothing double-spends: only a completed session redeems.
- **Kit Club**: Stripe hides Affirm and Afterpay in subscription mode; Klarna
  and Cash App Pay renewals arrive as `invoice.paid` like cards.
- No code reads card-only fields (`payment_method_details.card`, brand,
  last4). `orders.payment_method` is set to "card" for every Stripe payment.

### The one code change

`app/api/gift-cards/checkout/route.ts`: `excluded_payment_method_types:
["klarna", "afterpay_clearpay"]`. Klarna's rules list "Stored value cards,
vouchers and gift cards" as prohibited; Afterpay's terms prohibit "Gift cards".
Affirm allows closed-loop gift cards up to $2,000, so it stays. The parameter
exists since API version 2025-09-30 (the SDK pins 2026-04-22.dahlia); Stripe's
own example excludes methods a US account cannot even enable, so excluding
methods that are switched off should be harmless. Check one gift card checkout
after deploying (it should open Stripe's page as before).

### Possible follow-ups (not done)

- Pass the customer's address as `payment_intent_data.shipping` on
  restoration, prep and kit sessions: Stripe says it "helps with loan
  acceptance rates" for Afterpay. Not required for it to appear.
- Exclude `us_bank_account` and `customer_balance` in code as a guard against
  someone turning ACH on, or handle `checkout.session.async_payment_succeeded`
  in the webhook before ever offering delayed methods.
- Record the real method (`latest_charge.payment_method_details.type`) instead
  of "card" in `orders.payment_method`.

### Sources (fetched November 17, 2026)

- Apple Pay: https://docs.stripe.com/apple-pay?platform=web ("For Payment Links or hosted Checkout, Apple Pay works with no additional configuration.")
- Domain registration is for Elements and embedded Checkout only: https://docs.stripe.com/payments/payment-methods/pmd-registration
- Google Pay: https://docs.stripe.com/google-pay?platform=web
- Link: https://docs.stripe.com/payments/link/checkout-link and https://docs.stripe.com/payments/link/instant-bank-payments
- Klarna: https://docs.stripe.com/payments/klarna and https://docs.stripe.com/payments/klarna/compliance
- Affirm: https://docs.stripe.com/payments/affirm
- Afterpay: https://docs.stripe.com/payments/afterpay-clearpay, https://docs.stripe.com/payments/afterpay-clearpay/accept-a-payment?payment-ui=checkout and https://stripe.com/afterpay-clearpay/legal
- Cash App Pay: https://docs.stripe.com/payments/cash-app-pay
- Product support by Checkout mode: https://docs.stripe.com/payments/payment-methods/payment-method-support
- Delayed methods and fulfillment: https://docs.stripe.com/checkout/fulfillment?ui=full-page
- Configurations and exclusions: https://docs.stripe.com/payments/payment-method-configurations and https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods
- Wallet troubleshooting: https://docs.stripe.com/testing/wallets?ui=embedded-page
- Fees: https://stripe.com/pricing/local-payment-methods
