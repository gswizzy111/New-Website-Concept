# The Card Doc: material inventory for the photo-led rebuild

Compiled 2026-11-15 from this repo (`/home/user/Card_doc-draft-gavin`). Purpose:
everything a designer needs to rebuild the public site as a premium, photo-led
site (pixel / "Pokémon hospital" look dropped entirely), without changing the
owner's wording, prices, routes or flows.

Ground rules carried over (CLAUDE.md, `lib/about.ts`):

- **Real photos only.** No stock, AI or placeholder photos. An empty photo slot
  renders nothing. A before/after must be the same card, correctly paired.
- **Owner's wording verbatim**, including punctuation. Reviews are word for
  word, always attributed "Repeat customer" (no customer names).
- **No Nintendo / Pokémon Company IP** in our own graphics (characters, balls,
  logos, fonts, screenshots). Real customer card photos stay as they are.
- Appearance only: no logic, data, route, price, policy or flow changes.

---

## 1. Image inventory

All files are in `public/` unless noted. Sizes are pixels.

### 1a. Real card photos (the core material)

| File | Size | What it shows | Quality | Baked-in extras | Best use |
|---|---|---|---|---|---|
| `before-after-mickey-mantle.png` | 1446 x 1087, 2.0 MB | 1966 Topps Mickey Mantle: left, cracked card in a **black nitrile glove**; right, the same card restored in a **blue nitrile glove**. White background. | Good, sharp, real phone photo; strong "hands of a craftsman" feel | **Hand-drawn red arrow** across the top (left to right). Cutout on white | Big editorial before/after image; crop the top 15% to lose the arrow. Source of the two specimen crops below |
| `specimen-mantle-before.jpg` | 1000 x 965, 208 KB | Square crop of the Mantle **before**: cracks across face, cap, jersey, banner | Good; a little soft (upscaled from the composite) | None | **Hero drag slider (before side)**. Aligned to the after crop |
| `specimen-mantle-after.jpg` | 1000 x 965, 224 KB | Same crop **after**: face, cap and jersey clean; faint fine lines remain | Good; slight softness/sharpening halo | None | **Hero drag slider (after side)**; also a reel cover placeholder |
| `about/mantle-in-hand.jpg` | 701 x 922, 128 KB | Restored Mantle in a blue glove, tilted, white background (right half of the composite) | Good; small for a full-bleed hero (max ~700 px wide) | None (cut above the arrow) | Portrait detail tile, About hero, "craft" moment. Not big enough for a full-bleed desktop hero |
| `about/mantle-detail-before.jpg` | 880 x 760, 128 KB | Tight close-up of the cracked Mantle (cap, face, jersey) | Soft / visibly upscaled, but the cracking texture reads well | None | Texture/detail crop, "Behind the restoration" lead image, dark-overlay backgrounds |
| `specimen-charmander.png` | 576 x 601, 796 KB | Base Set Charmander 46/102, before (left, worn, bent) and after (right) overlapping, black background | Fair; small, scanned look | **"Before -> After" text in cartoon yellow/blue lettering styled like the Pokémon logo**, black matte | Composite before/after tile at small size only. Crop the lettering off (bottom ~90%); the lettering mimics Pokémon logo type, so avoid showing it |
| `before-after-hero.png` | 960 x 1280, 628 KB | Same Charmander composite as above on a large transparent canvas (card occupies the middle ~55%) | Same as above, lots of empty transparent space | Same "Before -> After" lettering, transparency | Duplicate of the Charmander composite. Use `specimen-charmander.png` instead; only used as reel-4 cover placeholder |
| `before-after-garchomp.png` | 538 x 520, 336 KB | Garchomp LV.X corner: two overlapping crops of the top-right corner, before (front, small) and after (back, large), holo sparkle visible | Fair; small, cutout edges | **Yellow arrow** pointing at the corner ding; transparent/white | Small detail tile ("corner lifts"). Too small for anything larger than ~400 px |

### 1b. Customer review screenshots (`testimonial-*`, loaded via `lib/testimonials.ts`; Supabase `app-config/testimonials.json` can override the list)

All are Instagram / iMessage DM screenshots, dark mode except #2, names and avatars blacked out by the owner. Text content matches `lib/reviews.ts` in several cases.

| File | Size | Content (customer side) | Notes |
|---|---|---|---|
| `testimonial-1.jpeg` | 1206 x 1165 | "Umbreon just came in and wow! looks so much better. You guys killed it, thank you!" | Dark IG DM, owner's reply visible |
| `testimonial-2.jpeg` | 1206 x 1020 | "Yeah of course, where should I go to leave the review. The card looks new I'm stoked." + photo of a holo Gyarados in hand | **Light mode**; owner's message contains the customer's first name ("Hey Blake"). Embedded customer photo of a card in hand |
| `testimonial-3.jpeg` | 1206 x 1159 | Charmander: "...genuinely can't believe the transformation. You are a master of your work my man!" / "Going to refer you to my friends" | Dark |
| `testimonial-4.jpeg` | 1206 x 947 | "Just got her back today looks way better! Appreciate you expediting the shipping. Hoping for a PSA 8-9" | Dark |
| `testimonial-5.png` | 2258 x 1422 | "Sending out the Charizard tmrw morning! ... I think your restoration made all the difference !" | iMessage, dated "Wed, May 13" |
| `testimonial-6.png` | 1254 x 1254 | "I just wanted to say your kit is amazing! ... your polish took them all out! Thank you Card Doc:)" | Kit review |
| `testimonial-11.png` | 1612 x 1542 | "Dude incredible work on the charizard!!!" / "It looks fantastic" / owner: "It's within PSA 10 standards..." | Customer avatar visible (not blacked out) |
| `testimonial-12.png` | 1942 x 1544 | "Sounds good" / "Just got here" / "Looks great, thank you again" | Customer avatar visible |
| `testimonial-13.png` | 1622 x 848 | "Hey Owen- saw the video you posted on my Brady card. Amazing work!!!" | Customer avatar visible; names Owen |

Use: proof wall / "receipts" strip. Better as typeset quotes (`lib/reviews.ts`) with a few screenshots as texture. Not photos of cards (except the small Gyarados in #2).

### 1c. Brand images (problems)

| File | Size | What it shows | Status |
|---|---|---|---|
| `card-doctor.jpg` | 880 x 629 | **A frame from the Pokémon anime** (a doctor opening his lab coat full of syringes). Used as the site logo (`lib/seo.ts` Organization logo, `components/pixel/doc-portrait.tsx`, `restoration-bubble.tsx`) | **Nintendo / The Pokémon Company IP. Do not use in the redesign.** The logo needs replacing (wordmark) and `lib/seo.ts` logo URL should point at a new file |
| `og-image.png` | 1254 x 1254 | Illustrated circular badge of an anime-style doctor (redrawn from the frame above) with text **"THE DOC'S CLEANING / TRADING CARD CLEANING SUPPLIES"** | Looks AI-generated, derivative of the anime frame, and carries a different business name. Used as OG/Twitter image and in JSON-LD. Replace with a real-photo OG image (e.g. Mantle before/after + wordmark) |
| `app/icon.png`, `app/apple-icon.png` | 1254 x 1254 each | Same badge as `og-image.png` | Same problem; replace with a simple wordmark/monogram favicon |

### 1d. Non-photo assets to retire

- `public/pixel/**` (clinic scene, tiles, frame, 17 pixel icons, sprites: doc-a, doc-b, card-hurt/healed/sleeve/slab, sparkle sheet): the pixel-hospital look. Drop.
- `public/next.svg`, `vercel.svg`, `window.svg`, `globe.svg`, `file.svg`: create-next-app leftovers, unused.

### 1e. Other real images that exist outside `public/`

- **Shop product photos** come from the Supabase `products` table (`images[]` URLs; categories Kits, Tools, Supplies/Cleaning/Storage), read live even in preview mode. They are not in the repo; check what the live table holds before designing the shop grid.
- **Customer card photos** uploaded with orders live in Supabase storage (private; not for marketing use without consent).

---

## 2. Content sources (owner's wording, use verbatim)

### 2a. `lib/about.ts`

- **HERO.headline**: "Built by Collectors." / "Trusted with Collections."
- **HERO.subheadline**: "30+ years of combined collecting experience. A shared passion for preserving the cards that matter."
- HERO.photo caption: "Mickey Mantle, after restoration"
- **STORY.title** "How it all started"; lead: "The Card Doc didn't start as a business. It started with two collectors and their own cards."
  Chapters: "Two collectors" / "Our own cards, first" / "Sharing the results" / "Collectors started asking" / "The Card Doc" (bodies in the file). Two empty photo slots: workshop (2400x1600) and in-progress (1600x2000).
- **FOUNDERS**: Owen, Gavin ("Co-founder", "Collector", "Works on customer cards"), portraits null. FOUNDERS_MESSAGE: "The same collectors who started The Card Doc are still the ones working on your cards."
  Rule: no founding year, surnames, credentials, team size or roles unless the owner confirms.
- **REASONS.title** "Why collectors choose us"; lead "What changes when the collectors who started the business are the ones doing the work."
  1. "Founder-operated restoration": "Owen and Gavin started The Card Doc, and they still work on customer cards themselves."
  2. "30+ years of combined collecting": "Collectors first. We know why a card matters before we pick up a tool."
  3. "Individual assessment and care": "Each card is looked at for what it is and what it needs. If restoration isn't right for it, we say so."
  4. "Genuine work, transparent expectations": "The results we show are our own work. We're upfront about what restoration can do, and what it can't."
- **PROCESS.title** "Behind the restoration"; lead "Restoration here is careful, hands-on work. We choose the methods card by card, and not every card needs every one."
  Methods (photo slots all null, 1600x1200 each): Surface cleaning ("Lifting dirt, grime and residue from the card's surface."), Crease reduction ("Reducing the look of creases and dents."), Controlled humidity treatment ("Measured moisture that helps the card's fibers settle back into place."), Precision heat pressing ("Heat and pressure, applied with care, to flatten and settle the card."), Precision tool work ("Fine hand tools for dents, and for edge and corner lifts.").
  **never**: "Recolor or repaint", "Apply adhesives", "Add or replace material" (shown under "We never" in the home hero).
  **honesty**: "Every card responds differently. Results vary, and restoration is never risk-free."
- **RESULTS**: Mickey Mantle (slider; detail "Banner, cap, face and jersey"; caption "Cracking across the face, cap and jersey, before and after. Fine lines are still visible up close: restoration reduces damage, it doesn't erase a card's history."), Charmander (composite; detail "Base Set, 46/102"; caption "Before and after restoration, side by side.").

### 2b. `lib/reviews.ts`

- **FEATURED_REVIEW**: "…you are " + emphasis "the best of the best when it comes to card restoration." from "Repeat customer" (home, Restorations, Prep).
- **CASE_STUDY** (Charizard): "Bought for" $400, "Came back" PSA 10, "Worth over" $2,500 (labels from `components/marketing/comic-reviews.tsx`).
- **REVIEWS** (9, each "Repeat customer"; `card` label in brackets):
  - [Charmander] "Hey, just got the Charmander back in the mail today and I genuinely can’t believe the transformation. You are a master of your work my man! 🙌🙌 … Going to refer you to my friends ❤️"
  - [Sold on TCGplayer] "The card sold almost instantly on TCG player with pictures. I appreciate your brother. I’m gonna definitely be sending you more cards."
  - [Umbreon] "Umbreon just came in and wow! Looks so much better. You guys killed it, thank you!"
  - [Charmeleon] "Awesome. Thanks! The cards look great and I know the Charmeleon was a tough one. I’ll be looking out for the video. Keep up the hustle!"
  - [Ray] "What’s up man! Card came back today and she looks great. The cleaning definitely brought out the natural shine of the holo. I’m sending in another Ray to you tomorrow!"
  - [Crease restoration] "Oh wow thanks man! I see one of the crease restoration photos on there. Miraculous work."
  - [7 cards to grading] "First rd of cards came back! They are looking amazing. Sending in 7 of them for grading! Thanks again! Will continue to have you service my cards going forward."
  - [Charizard] "Dude incredible work on the charizard!!! It looks fantastic."
  - [Two Rays] "Bro. The two rays came back today. Y’all snapped!! Absolutely amazing work bro thank you sm."
  - Compact set (Prep/Restorations pages): Charmander, Sold on TCGplayer, 7 cards to grading.
- **KIT_REVIEW** (shop): "Love the kit works great." "Repeat customer".

### 2c. `lib/trusted-by.ts` (section "Trusted by", hidden when empty)

- Joey Valence, @joeyvalence, "Rapper, Joey Valence & Brae", Instagram, 420K, https://www.instagram.com/joeyvalence/
- Boston Scott, @bnsvi_, "Former Philadelphia Eagles running back", Instagram, 98K, https://www.instagram.com/bnsvi_/
- No photos of them in the repo. Do not use their likeness without permission; name, role, handle and follower count only.

### 2d. `lib/service-cards.ts` (home Services, nav, /start)

| Name | Line | Price | Action | Link |
|---|---|---|---|---|
| Restoration | "Surfaces, corners & edges — cleaned and restored to their best." | "From $75 / card" | "View Tiers" | /tier-selection |
| Prep | "Grade-ready submission prep for PSA, BGS & CGC." | "From $25 / card" | "View Pricing" | /prep |
| DIY Kits | "The same pro-grade tools The Card Doc uses — delivered to you." | "US shipping at cost + $2 handling" | "Shop Now" | /shop |

(Note: these lines contain em dashes; the taste skill's em-dash ban applies to visible copy, but CLAUDE.md "Never change the owner's wording, including punctuation" outranks it. Keep them.)

### 2e. `lib/reels.ts` ("Watch the work", 4 tiles)

All four are **placeholders** linking to the profile https://www.instagram.com/the_card_doc/ with existing photos as covers: "Mickey Mantle" (mantle after), "Charmander" (charmander composite), "Garchomp" (garchomp), "Before → After" (before-after-hero). TODO(owner): 4 latest reel URLs + 9:16 cover photos in `public/reels/`. A `/reel/` link plays in a dialog (`components/marketing/watch-the-work.tsx`).

### 2f. `lib/seo.ts`

- INSTAGRAM_URL https://www.instagram.com/the_card_doc
- Organization description: "Expert card restoration & PSA prep — every card treated like it's worth a fortune." (same as the home TAGLINE)
- logo `card-doctor.jpg` and image `og-image.png` (both need replacing, see 1c). `breadcrumbs()`, `canonical()` helpers.

### 2g. Home page constants (`app/(public)/page.tsx`)

- TAGLINE (hero sub): "Expert card restoration & PSA prep — every card treated like it's worth a fortune."
- Hero CTAs: "Restoration Pricing" (/tier-selection), "PSA Prep Pricing" (/prep). Under them: "We never" + PROCESS.never.
- **CARD_KINDS**: Pokémon, Magic: The Gathering, Yu-Gi-Oh!, Baseball, Basketball, Football, Hockey, Vintage, Modern, Raw, Graded. Heading "We do all cards." with the FAQ answer "All trading cards — Pokémon, sports cards (baseball, basketball, football, hockey), Magic: The Gathering, Yu-Gi-Oh!, and more. Vintage or modern, raw or graded." CTA "Book a Restoration".
- **FIXES** (ticker): Creases, Dents, Dimples, Edge lifts, Corner lifts, Minor bends, Holo polishing, Surface cleaning.
- Results: eyebrow "Why Collectors Trust Us", H2 "Proven Results", "Hundreds of cards restored and prepped. We don't just claim results, we show them." CTA "See Our Services". Stats: "5000+" "Cards Restored", "Free" "Photo Review".
- "Watch the work" + "@the_card_doc"; "Restoration results vary by card condition."; "Book a Restoration".
- Reviews band "What our customers say"; Trusted by.
- "Free Photo Review" card slot (aria "Place card here. The Doc will see you now. Start your order." — clinic wording written by us, not the owner; can go).
- "Services" list (2d). REASONS (2a).
- FAQ (eyebrow "Before You Order", "Frequently asked questions", "See all FAQs"), 5 items:
  - "What's the difference between Restoration and Prep?" / "Restoration improves how your card looks — cleaning surfaces, softening corners, reducing scuffs and scratches. PSA Prep is specifically for submitting to graders: we clean, sleeve, and organize your submission for the best possible grade. Most collectors do prep before grading, restoration before or after."
  - "Will restoration affect my card's PSA grade?" / "There is a risk — we're fully transparent about that. If you plan to grade your card, restoration may affect how it's received. We'll always be upfront with you about what's realistic for your card."
  - "How do I ship my cards to you?" / "You can choose to have us generate a prepaid label (we email it to you — print and drop off), or ship on your own using any tracked, insured method. We recommend USPS Priority Mail."
  - "What types of cards do you work on?" / (as above)
  - "How long does it take?" / "Prep typically turns around in 10–15 business days. Restorations range from 2–3 months (Bronze) down to 5–10 business days (Diamond) depending on the tier you choose, or skip the queue with Fast Pass."
- Terms of Service block: "By placing an order you agree to these terms. Key points are summarized below." "Read the full terms". TOS_HIGHLIGHTS: "Turnaround times are estimates", "You assume shipping risk", "Alteration Risk", "No refunds after work begins" (bodies in file lines 80-101). "Important:" paragraph (lines 569-572) incl. "The Card Doc LLC is not responsible for loss or damage during transit."
- Closing: "Your Collection Means Something." / "We Understand Why." / "From childhood favorites to prized collectibles, every card deserves thoughtful care." CTAs "Explore Restoration Services", "Contact Us" (Instagram).

### 2h. Trust strip (`components/marketing/trust-pills.tsx`)

`CARDS_RESTORED_DISPLAY = "5000+"` (owner's figure; `lib/site-stats.ts` keeps a live count, unused for display). Pills: "5000+ Cards Restored", "Free Photo Review", "We reply within 1 business day.", "30+ years of combined collecting" (REASONS.items[1].title). `TrustMarquee` slides; pauses on hover; static under reduced motion.

### 2i. FAQ (`app/(public)/faq/faq-data.ts`, page has search)

Sections: Before You Order (5), Cards We Work On (3), Pricing & Tiers (6), Prep vs Restoration (4), Grading & PSA (4), Shipping & Returns (5), Drop-off & Local (1). Facts of note: located in **Ridgewood, New Jersey**; mail-in for the whole US, local drop-off; US and Puerto Rico only; slab cracking $7/card with a Slab Removal Authorization; bulk 10% at 10+, 15% at 20+ (Diamond excluded, no stacking); returned "in a fresh penny sleeve and Card Saver, wrapped in a bubble mailer between two protective "ding defender" plates"; cancel by emailing thecarddoc1@gmail.com before cleaning starts. "@the_card_doc" in answers becomes an Instagram link.

### 2j. Tiers and prices (`lib/restoration-tiers.ts` defaults, live values via `getLiveTiers()` in `lib/live-tiers.ts` from Supabase `restoration_settings`; slots via `lib/tier-slots.ts`)

| Tier (id) | Price | Turnaround | Card value | Badge | Description |
|---|---|---|---|---|---|
| Bronze (regular) | $75 | 2–3 months | Up to $1,000 | | "Standard restoration for everyday collectors" |
| Silver (expedited) | $99.99 | 1–1.5 months | Up to $2,000 | | "Faster service for cards worth protecting" |
| Gold (premium) | $119.99 | 15–20 business days | Up to $3,500 | Most Popular | "Priority handling with rapid turnaround" |
| Platinum (ultra_premium) | $150 | 10–15 business days | Up to $5,000 | Front of Queue | "VIP treatment with front-of-queue service" |
| Diamond (elite) | 7% of declared value | 5–10 business days | $5,000 and up | White Glove | "White-glove service for high-value cards" |
| Fast Pass (fast_pass) | $250 | "Skip the queue" | Under $5,000 | Fastest | "Speed restoration — any card under $5,000" |

The admin can rename/reprice any tier in the database, so **never hard-code these in the design**: render from `getLiveTiers()`. Page copy: "Choose Your Restoration Level", "Select the tier that best fits your cards' needs.", closed state "Restorations are currently closed." / "We're temporarily closed. Browse our pricing below and join the waitlist to be notified when we reopen.", "Express Option" (Fast Pass), "per card · cards under $5,000", "Skips the restoration queue", details "About our turnaround time estimates" ("rough estimates only", "The Card Doc cannot be held liable", Terms link). Slots per tier show remaining count; sold-out state; waitlist modal. Bulk switch: "Individual" / "10+ cards" / "20+ cards" with "Bulk pricing is applied automatically at checkout for every tier except Diamond. Discounts don't combine: you get the biggest one."

### 2k. Prep pricing (`app/(public)/prep/page.tsx`, values from `store_config`)

- Standard $25/card under $1,500 (`prep_standard_price_cents`, default 2500); cards $1,500 and over 2% of declared value (1.8% / 1.7% with bulk).
- Add-ons: Pre-Grade Assessment $5 (`prep_pre_grade_price_cents`; "We estimate each card's grade before you submit — so you know what to expect."), Slab Crack $7 (`prep_slab_crack_price_cents`). "Add-ons are selected during the order process." `prep_open` toggle.
- Copy: H1 "Get Your Cards Grade-Ready"; "We surface-clean and prep your cards so they're submission-ready. Graders make their own call, so no grade is ever guaranteed."; "Prep Pricing" / "Per card — price based on declared value" / "Surface clean, penny sleeve + semi-rigid holder"; "Prep does not include:" Crease work, Edge & corner work, Dent removal, Any restorative work; bulk note "Bulk pricing is applied automatically at checkout to every card. Add-ons and shipping aren't discounted."

### 2l. Shop (`app/(public)/shop/page.tsx`)

Supabase `products` (id, name, slug, description, price_cents, images, category, inventory_count), grouped Kits / Tools / Supplies (Supplies + Cleaning + Storage). Empty state "Products coming soon."; "Sold Out" / "Sold Out — Back Soon" / "Out of stock". KIT_REVIEW under Kits. Product page: gallery thumbnails, size select ("Select Size", "Please select a size before adding to cart."), add to cart. Kit Club subscription: `store_config.subscription_price_cents` (fallback $89.99): "Monthly Kit Club", "1 Restoration Kit every month", "Automatic billing — cancel anytime", "Free US shipping included".

### 2m. Other page copy worth keeping verbatim

- **/start**: "What are you sending?"; "Pick Restoration or Prep based on your card's current declared value (what it's worth right now, not its projected graded value)."; service cards (2d); How It Works steps; "Free Photo Review", "We reply within 1 business day."
- **/how-it-works**: intro "The Card Doc is a trading card restoration and grading-prep shop in Ridgewood, New Jersey. Mail us your cards from anywhere in the US, we do the work by hand in our shop, and we ship them back ready for grading or your personal collection."; "The Step-by-Step Process" with steps "Choose Your Service, Tier, and Add-Ons", "Book Your Order at theonethatsaveditall.com", "Pack and Ship Your Cards" (packing list), "Arrival, Check-In, and Evaluation" (Evaluation Promises: "No upside, no charge:", "No unnecessary work:", "No surprise charges:"), "Hands-On Work" ("Cards go through gentle rounds of humidity, specialized tool work, pressing, and resting in clamps to coax the card's original fibers back into place. ..."), "Return Shipping"; status table (Awaiting Cards, Cards Received, In Progress, Completed, Shipped Back, Delivered with meanings); "Getting updates:", "Turnaround times:", "Alteration risk:"; closing "Ready to restore your collection?".
- **/what-we-can-fix**: "What we can (and can't) fix", "Restoration has real limits. Here's an honest breakdown."; sports list "Things We CAN Work on" / "Things we CANNOT fix" and TCG list "(Pokémon, One Piece, Magic, Yu-Gi-Oh!, etc.)" (items in file).
- **/about**: all of 2a, plus "About Us", "Meet the founders", "Real results", "What our customers say", "Cards restored and prepped" + "Counted live from finished website orders." (`getCardsFinishedStat()`), same closing as home.
- **Nav** (`components/marketing/nav.tsx`): Services (Restorations "From $75 / card", Prep "From $25 / card", Kits "US shipping at cost + $2 handling"), Before You Order (How It Works, What We Can Fix, FAQ), About Us, Gift Cards, Orders & Account (Track Order, My Account), Cart, Instagram; Terms of Service, Privacy Policy.
- **Footer**: "The Card Doc" wordmark, "Contact" (Instagram) "We reply within 1 business day.", links /terms, /privacy, /affiliates (creator portal).
- Floating "Book a Restoration" bubble (`restoration-bubble.tsx`; uses the anime logo, must change).
- Order/restoration closed: "Restoration Services", "Currently Unavailable", "We're at capacity right now. Check back soon — we'll be accepting new restoration orders again shortly."; waitlist "You're on the list!" / "We'll reach out as soon as we're accepting restorations again."
- Success pages: "Order Confirmed!", "Your payment was received successfully.", "Gift Card Purchased!", shop "Thanks for your order. We'll ship it out shortly and send you a tracking number."
- Legal: `/terms` renders `legal/terms-v1.1.md` (never edit), `/privacy` (710-line page; text must not change).

---

## 3. Public routes and what must survive

Preview mode: `/api/*` answers "not functional yet"; `/admin`, `/accountant`, `/account`, `/affiliates`, `/partners`, `/cases`, `/orders` rewrite to `/not-available`. Restyle those private areas only if asked; the public ones below are the rebuild scope.

| Route | Must contain / do |
|---|---|
| `/` | Trust marquee, hero with Mantle drag slider + headline + 2 CTAs + "We never", We do all cards, symptoms ticker, results, stats, Watch the work, reviews, Trusted by, services, reasons, FAQ (5), Terms highlights, closing CTA. JSON-LD (Organization + Service offers). `force-dynamic` |
| `/start` | "What are you sending?" chooser: Restoration, Prep, Kits; free photo review via Instagram |
| `/tier-selection` | Live tiers (`getLiveTiers`), slots remaining / sold out, Diamond card with **card value input** computing 7%, **bulk switch** (Individual / 10+ / 20+), Fast Pass "Express Option", closed state + **waitlist modal** (`waitlist-modal.tsx`, `waitlist-form.tsx`), turnaround disclaimer, compact reviews. Each tier links to `/restoration?tier=<id>` |
| `/restoration` (and `/order`) | Redirects to `/tier-selection` when closed or no tier; otherwise the **order builder** (`components/order-builder/*`: customer step, cards step with card identity fields, declared value, up to 3 photos per card (`photo-uploader`), shipping step (prepaid label or self-ship, signature fee, address autocomplete, insurance election), review step with **checkout signing** (`components/checkout/signing-section.tsx`: Terms link, 2 required boxes, certification, full legal name; slab removal authorization dialog), tip, creator/gift codes). `restoration-waitlist-form.tsx` for closed state |
| `/services` | Redirects to `/restoration` |
| `/prep` | Prep pricing (live from `store_config`), bulk switch, add-ons, "does not include", reviews, CTA to `/prep/order` |
| `/prep/order` | **Prep order form** (`prep-order-form.tsx`, 794 lines): info, cards with value, slab checkbox + authorization dialog, photos, Pre-Grade add-on, shipping (US/PR only), return shipping, insurance, "Want to be featured?", summary with NJ tax 6.625%, signing section |
| `/how-it-works` | Step walkthrough (6 steps), packing guide, evaluation promises, order status table, notes |
| `/what-we-can-fix` | Can / cannot lists for sports and TCG |
| `/faq` | Grouped FAQ with **search** (`faq-search.tsx`), accordion |
| `/about` | Hero, story chapters, founders, reasons, process + methods + never + honesty, results gallery (slider + composite), reviews, live "Cards restored and prepped" stat, closing |
| `/shop`, `/shop/[slug]` | Product grid by category from Supabase, add-to-cart (size select), sold-out states, product JSON-LD |
| `/cart`, `/cart/upsell`, `/cart/checkout` | **Cart** (`lib/cart-context.tsx`), upsell, kit checkout form (contact, address autocomplete, international country list, live shipping speeds, creator code, gift card, tax, total) |
| `/shop/order-confirmed`, `/checkout/success`, `/checkout/cancel` | Return pages (drop `session_id`, purchase pixel, clear cart) |
| `/gift-cards`, `/gift-cards/success` | Amount select (min $10), buyer info, "Send the gift card directly to someone else" |
| `/subscribe`, `/subscribe/success`, `/subscribe/manage` | Kit Club sign-up form; manage via emailed one-time link |
| `/track` | **Track form** (order number + email) showing status timeline |
| `/terms`, `/terms/[version]`, `/terms/[version]/pdf` | Terms text + PDF; untouched wording |
| `/agreements/slab-removal` | Slab Removal Authorization text |
| `/privacy` | Privacy policy (wording untouched) |
| `/not-available`, not-found, loading | Preview/private and 404 states |

Global: nav (mega menu), footer, preview banner, restoration bubble, reveal observer, `trackingGuardScript()` first in `<head>`, view-transition experiment on.

---

## 4. Owner-requested pieces that must stay

1. **Before/after drag slider of the Mickey Mantle as the hero card** (`components/motion/before-after.tsx` with `specimen-mantle-before/after.jpg`). Keep the drag interaction, keyboard support and alts; restyle the frame (drop the "patient chart", HP bars and ADMITTED/DISCHARGED chips).
2. **Sliding trust strip**: "5000+ Cards Restored", "Free Photo Review", "We reply within 1 business day.", "30+ years of combined collecting" (`TrustMarquee`).
3. **Symptoms ticker**: Creases, Dents, Dimples, Edge lifts, Corner lifts, Minor bends, Holo polishing, Surface cleaning (`VelocityMarquee`; replace the pixel heart separators).
4. **"We do all cards."** section with the category list (2g).
5. **"Watch the work"**: 4 reel tiles from `lib/reels.ts` (placeholders until the owner supplies reels), Instagram dialog playback.
6. **Trusted by**: Joey Valence, Boston Scott.
7. **Customer reviews word for word**, attributed "Repeat customer"; featured quote and Charizard case study ($400 / PSA 10 / $2,500).

---

## 5. Photo gaps (ask the owner)

What we have is essentially **one great before/after (Mantle), one small Charmander composite and one small Garchomp corner**. A photo-led site needs much more. In priority order:

1. **More before/after pairs (most important)**: 8-12 cards, each shot twice with identical framing, light and angle (same tripod position), at least 2000 px on the long side, no arrows or text. Mix: vintage baseball, modern chrome, Pokémon holo, a crease, a corner lift, a dent, surface grime, holo scratches. The Charizard (PSA 10 case study), Brady, Umbreon, Ray, Charmeleon cards named in reviews would be ideal.
2. **Clean card hero shots**: restored cards alone on a neutral background (and raking light to show surface), 3000 px+, for full-bleed hero and section backgrounds.
3. **Hands at work**: gloved hands with tools on a card (the Mantle glove shots show this works). Close-ups of humidity, pressing/clamps, hand tools, loupe/magnifier inspection.
4. **The workspace / bench**: wide shot of the workshop, tools laid out, lighting (slot already defined: `about/workshop.jpg` 2400x1600; `about/in-progress.jpg` 1600x2000).
5. **Founders at work**: Owen and Gavin portraits, 4:5 (`about/owen.jpg`, `about/gavin.jpg`), plus candid bench shots.
6. **Method photos**: one per method (5 slots, `about/method-<id>.jpg`, 1600x1200).
7. **Kits product photography**: each kit and tool on a clean background plus in-use shots (check what the Supabase `products.images` already hold).
8. **Packaging and shipping**: penny sleeve + Card Saver, the "ding defender" plates, bubble mailer; inbound packing guide photos (matches How It Works).
9. **Slabs**: a slab before cracking, the cracked slab, the card returned raw (slab-crack add-on, graded-card customers).
10. **Grading results**: restored cards back in PSA/BGS/CGC slabs (especially the PSA 10 Charizard), with permission.
11. **Reels**: the 4 newest reel URLs and 9:16 cover frames (`public/reels/reel-1..4.jpg`).
12. **Brand mark**: a real logo/wordmark owned by the business to replace the anime frame (`card-doctor.jpg`) and the "THE DOC'S CLEANING" badge (`og-image.png`, `app/icon.png`, `app/apple-icon.png`). Until then use a typeset wordmark.
13. Optional: Trusted-by photos (only with written permission from Joey Valence / Boston Scott), Ridgewood drop-off location shot.

Photo spec to give the owner: JPEG, sRGB, quality ~85, long side 2000-3000 px; before/after pairs shot without moving camera or card position; no arrows, captions or filters baked in; neutral or dark seamless background.
