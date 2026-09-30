# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: people who just watched a The Card Doc video on TikTok, Instagram,
YouTube or Facebook and tap through, usually on a phone, on their first visit.
They are deciding whether to trust a stranger with a card that matters to them
(sentimental or valuable), then picking a service and ordering.

Secondary (inferred from the codebase, not confirmed as a priority): returning
customers tracking orders or managing subscriptions, affiliates and partners
using their dashboards, and the business owner using the admin area.

## Product Purpose

The Card Doc sells three things for trading cards (Pokémon, sports, Magic,
Yu-Gi-Oh! and more):

1. **Restoration**: cleaning surfaces, softening corners, reducing scuffs and
   scratches, in tiers (Bronze, Silver, Gold, Platinum, Diamond, Fast Pass).
2. **Prep**: preparing cards for submission to graders (PSA, BGS, CGC).
3. **DIY kits**: the same tools used in the videos, sold in the shop.

Success: a first-time visitor from a video trusts the service enough to place
an order, and ordering, paying, shipping and tracking all work without help.

## Positioning

The Doc personally does the work. Customers are dealing with one hands-on
restorer, not a faceless shop.

## Operating Context

- All marketing happens on Instagram (@the_card_doc), TikTok, YouTube and
  Facebook; the site is where that audience converts.
- Customers ship physical cards in (prepaid label or their own tracked,
  insured shipping), then track progress online.
- Order flow: service or tier selection, multi-step order builder (cards,
  photo upload, customer details, shipping, review, signature), cart with
  upsell, Stripe checkout.

## Capabilities and Constraints

- Next.js 16 (App Router), Tailwind v4, shadcn/ui, Supabase, Stripe, Shippo,
  Resend. Deployed via Vercel/Netlify from `gswizzy111/card-restoration`.
- Functionality is complete and correct. **Redesign changes appearance only**:
  no changes to logic, data, routes, prices, policies or flows.
- **All visible wording stays exactly as it is** (owner's instruction). This
  includes existing em-dashes and punctuation in copy.
- Public pages: home, services, tier selection, restoration, prep, prep order,
  order builder, shop and product pages, cart, upsell, checkout, gift cards,
  subscriptions, tracking, account, FAQ, how it works, about, terms, privacy.
- Admin, affiliate, partner and accountant areas exist; they inherit the new
  theme but their layouts are out of scope.

## Brand Commitments

- Name: The Card Doc.
- `/public/card-doctor.jpg` is used as a logo image (brand mark), not a
  portrait to feature.

## Evidence on Hand

- Before/after images: `public/before-after-hero.png`,
  `public/before-after-garchomp.png`, `public/before-after-mickey-mantle.png`.
- Customer message screenshots: `public/testimonial-*.{png,jpeg}` plus
  testimonials loaded from the database.
- Stats already on the site ("500+ cards restored", "4.9★", "100%
  documented") are the owner's claims; do not add new numbers or claims.

## Product Principles

1. Trust first: a first-time visitor must feel the card is in careful hands.
2. Nothing breaks: every existing flow keeps working exactly as before.
3. The words are the owner's: design around the existing copy.
4. Phone first: most visitors arrive from social apps on a phone.

## Accessibility & Inclusion

WCAG AA contrast and keyboard access across all public pages; respect
`prefers-reduced-motion`.
