# Design study: The Mint Workshop (themintworkshop.com)

Studied 2026-11-15 as a normal visitor with Playwright (Chromium, 1440x900 and
390x844, deviceScaleFactor 1). No private APIs were called.

- Screenshots: `docs/redesign/mint-shots/<page>/desktop-NN.png` and
  `mobile-NN.png` (one frame per viewport height, top to bottom). Pages: home,
  services, pricing, how-it-works, about, our-work, faq, contact, submit,
  pack-ship, tracker, sports. Extra detail crops in `mint-shots/home/detail-*`.
- Raw computed-style data: `docs/redesign/mint-measurements-home.json` and
  `docs/redesign/mint-measurements-components.json`.

This file drives the Card Doc rebuild. Part (c) is what to adopt; part (d) is
what to leave alone. The goal is a site that feels as good, not one that looks
like theirs.

---

## (a) Why it looks great and converts

### 1. Real cards are the hero of almost every screen

- **Photo density is very high.** On the home page at 1440px, roughly 9 of 15
  viewport-frames contain real card photography. The single biggest section is
  the "work log": a 6-column grid of 24+ real customer cards (198x277px each,
  2118px tall section) with a counter ("1,433 CARDS") and filter chips (All,
  Pokémon, Sports, One Piece, Magic, Other TCG). It reads as overwhelming
  proof: "we have done this a thousand times."
- **Consistent capture.** Every work-log photo is a flat, front-on intake scan
  at the same aspect (0.71, i.e. card proportions), same lighting, same
  dark sleeve edge. Uniformity makes 24 photos look like a curated gallery
  instead of a messy feed. Captions are two lines: card name + set number in
  regular weight, then a tiny uppercase gray service label ("FULL SERVICE
  RESTORATION").
- **Hover reveals the before.** Each work-log tile holds a before and after
  image stacked; on hover the after fades out (opacity 0.45s
  cubic-bezier(.16,1,.3,1)) and the tile lifts (translateY -6px, scale 1.02).
  Proof without extra UI.
- **Drag-to-compare slider** ("SEE THE DIFFERENCE", "SAME CARD, BEFORE AND
  AFTER"): a 4:3 macro shot of a damaged card, BEFORE / AFTER pills in the top
  corners, a round red handle with a double-arrow, and a tiny uppercase
  disclaimer under it ("Representative result. We don't guarantee grades.").
- **Hero uses physical cards, not illustration.** Four real cards (vintage
  basketball, holo Charizard, anime TCG, Disney TCG) bleed off the edges of
  the hero at -12, 8, 10 and -7 degree rotations with a soft long drop shadow
  (`0 26px 48px -20px rgba(20,30,22,.55)`), floating in on load
  (`mw-float-in`, 0.8 to 1.1s staggered, cubic-bezier(.16,1,.3,1)). Center
  right is a tilted "playmat" card slot ("Place card here for restoration
  magic.") on a dark branded mat texture.
- **Workshop context photos**: cards on their branded playmat, gloved hands
  holding a card in a sleeve, cards in a slab, a card on a lit bench with a
  clamp jig, a card under a lamp. These are 4:3 crops, 12px radius, used in
  alternating split sections (image left / text right, then flipped).
- **Category tiles** (Pokémon / Every other TCG / Sports) are dark photo
  cards (16px radius, 3px ink border, 4px offset hard shadow) with the photo
  dimmed under a gradient, a big bold title, small outline chips for
  sub-categories and a colored "Submit a card ->" text link.
- **Instagram reels strip**: five 9:16 thumbnails (242x430, 14px radius) with
  view counts in a dark pill (eye icon + "500,785"), a play button and the
  reel's own bold caption baked into the image. Social proof that shows
  audience size and personality. Mobile turns it into a swipe row with
  "Swipe for more ->".

### 2. Honesty is the main persuasion device

They lead with what they will NOT do, which makes everything else credible:

- A full dark callout "WHAT WE WILL NOT DO / We don't fix whitening." with a
  big red prohibition icon, two sentences of plain reasoning and two CTAs.
- Services are framed "Every service, and what it honestly can't fix." Each
  service card lists improves (filled green squares) and won't-fix (hollow
  squares), with a key: "Solid squares are what a service improves. Hollow
  squares are what it won't."
- Repeated small-print disclaimers right next to the proof: "Grading outcomes
  are determined solely by the grading company. We do not guarantee grades."
- CTA copy carries the honesty too: "If your card isn't a good candidate,
  we'll tell you before you ship it." / "We'd rather talk you out of a bad
  candidate than take your money."
- Trust facts are specific and checkable: "Returns insured up to $50K",
  "24-30 business days", "Every card photographed at intake", "Box opening
  recorded on video", named insurers, prices to the cent.

### 3. Section order (home page, 1440px)

| # | Section | Background | Content type |
|---|---|---|---|
| 0 | Announcement bar: tracker + pro login + scrolling category ticker | ink #1f1f1f | utility |
| 1 | Sticky header: logo, 5 nav items, outlined "Card tracker" + red "Get started" | sage, 95% + blur | nav |
| 2 | Five outline trust pills (US-based, secure payment, insured returns, turnaround, non-destructive) | sage | trust |
| 3 | Hero: 3-line stacked headline in 3 colors, one sentence, primary CTA with handwritten "Get a quote" arrow, 3-cell guarantee strip; right half = branded mat + floating real cards | sage + grain | photo + promise |
| 4 | "What we restore": 3 dark photo category tiles | off-white | photo |
| 5 | 5-column dark feature band (technicians, tools, value preserved, insured, turnaround) | sage | facts |
| 6 | Giant marquee of damage words (CREASES / DENTS / SCRATCHES) alternating solid, outline and gradient-fade type with red dots | ink | rhythm break |
| 7 | "We don't fix whitening" honesty callout | sage | honesty |
| 8 | "Claims we can back": 4 sticker badges (starbursts, circle seal, tilted ribbon) + disclaimer | off-white | trust |
| 9 | "Watch the work": 5 Instagram reels | off-white | social proof |
| 10 | "See the difference": copy + drag compare slider | off-white | proof |
| 11 | "Priced by your card's value": dark panel, 5 sample tier cards with red prices, "See all 12 tiers" | sage | pricing |
| 12 | "Our process": 6 numbered icon steps on a dotted connector line, inside an outlined box | off-white | process |
| 13 | "Insure the trip to us": photo + detailed insurance copy + bullet list + CTA | sage | reassurance |
| 14 | Dark 4-cell trust strip (photographed at intake, box opening on video, non-destructive, collector owned) | sage | trust |
| 15 | "Every card that's been on the bench": filterable work-log grid, counter, "Show more" + "See all our work" | sage | massive proof |
| 16 | "Every service, and what it honestly can't fix": 6 service cards | off-white | services |
| 17 | "The things people ask before shipping": accordion FAQ (6) | sage | objections |
| 18 | Final CTA: big red panel "Send us the one you stopped showing people." | sage around red | close |
| 19 | Footer: logo + one-line description + socials; 4 link columns; legal disclaimer naming non-affiliation | ink | utility |

Pattern: **promise -> categories -> facts -> honesty -> proof (social, slider)
-> price -> process -> risk removal -> mass proof -> detail -> objections ->
close.** Proof appears in four different formats before the services detail.

### 4. CTA cadence

About 20 CTAs on the home page, roughly one per 1 to 1.5 viewports:
header "Get started" (always visible, sticky), hero "Start your restoration",
"Submit a card ->" on every category tile and every service card, "Watch us
explain it" / "What we do fix", "See all 12 tiers", "How to pack and ship",
"Show more cards" / "See all our work", "See full service list", and the final
"Submit my cards". Every inner page ends with the same red CTA panel with a
page-specific headline ("Pick a tier and we'll take it from there.", "Ready
when you are.", "Still not sure?", "Packed and ready?", "Yours could be next in
the log."). Primary CTA is always red with ink border; the secondary is white
with ink border (or white with a red offset shadow).

### 5. Pricing presentation

- Home shows only 5 of 12 tiers as a teaser on a dark panel: tier name in
  bold uppercase, value range under it, price in big red bold, "per card",
  one note line ("Most popular", "Free slab cracking").
- The pricing page shows all 12 as a 4-column grid of outlined cards: name
  (uppercase bold), value range, price in large red regular weight + tiny
  "PER CARD", full-width "Submit a card" button. "MOST POPULAR" is a red pill
  sitting on the top border, plus a red offset shadow and a red button on that
  one card only.
- Then a dark "More cards, lower per-card price" bulk table (5 cells: 1-4
  standard, 5-9 10% off, 10-24 15%, 25-49 20%, 50+ 25%), then an "Add-ons"
  table (name, one-line explanation, red price right-aligned, "Included" in
  red where it applies), then a pricing FAQ, then CTA.
- Pricing explains the logic in one sentence before showing numbers: "Your
  card's value sets its tier. Every card gets the same Full Service
  restoration; the tier only sets the price."

### 6. Copy brevity and voice

- Headlines are short, declarative, end with a period, all caps:
  "SEE THE DIFFERENCE.", "CLAIMS WE CAN BACK.", "A WORKSHOP, NOT A FACTORY.",
  "PACK IT ONCE. PACK IT RIGHT.", "FIVE STEPS, NO GUESSWORK."
- Every section = eyebrow (red, tiny, uppercase, with a 26x2px red rule) +
  2-3 line headline + one supporting paragraph set to the right at about
  50% width (desktop) and aligned to the headline's baseline area.
- Body copy is specific and slightly wry: "not a press and a prayer",
  "Boring engineering, but it's the reason results repeat." Bullets are 3 to 5
  words each.

### 7. Pacing and color alternation

- Three surfaces rotate: **sage** (#a9c9ad, 41% of painted area), **off-white
  paper** (#f7f5f1, 31%), **ink** (#1f1f1f, 13%). Red (#e4483d / #df3e35) is
  only about 2-3% of area but carries every CTA, price and eyebrow.
- No two adjacent sections share a background for long; dark panels are
  inset cards (1280px, 12-16px radius) floating on sage, so dark never touches
  the viewport edge except the marquee band and the footer.
- Rhythm breakers between content blocks: the giant marquee, sticker badges,
  the dark trust strip. The eye never sees three similar sections in a row.
- Section padding is generous and uniform: 128px top and bottom on desktop,
  32 to 64px on mobile. Container 1280px.

### 8. Personality without clutter

- Hard offset shadows on buttons and key cards (4px 4px 0 ink) give a
  tactile, sticker/toy feel; on hover the button moves -2px,-2px and the
  shadow grows to 6px 6px (0.14s cubic-bezier(.2,.8,.2,1)), so it feels
  pressable.
- Handwritten script accent ("Get a quote" + a hand-drawn arrow, animated
  with a stroke draw `mwQaDraw` 0.7s) used exactly once.
- Starburst stickers and a tilted ribbon banner for trust claims.
- Subtle film grain over the hero (SVG fractalNoise at 5% opacity).
- Branded loader (logo bandage drops in with an overshoot, 0.78s) before the
  page reveals.

### 9. Mobile patterns (390px)

- Header: logo left, two round icon buttons (tracker in white, start in red,
  both with offset shadows), cart, hamburger. Sticky.
- Trust pills become a horizontal scroll row (cut off at the edge to hint
  scroll).
- Hero headline 32px, CTA full width, guarantee strip stacks vertically.
  Hero cards and the mat move under the copy.
- Feature band and trust strip stack as list rows with icons.
- Reels become a swipe row; work log becomes 2 columns; pricing tiers become
  single column full-width cards; the 6-step process becomes a 2-column grid.
- Section side gutter 20px; section padding 32 to 64px.
- Footer collapses to 2 columns of links.

### 10. Weak spots to do better than

- The final CTA panel has a second white button with no visible label on
  every page (an empty pill next to "Submit my cards"). Looks broken.
- The home page is very long (about 13,000px desktop, 20,000px mobile). The
  services and FAQ repeat content from inner pages.
- Some small text is very small (9.6px uppercase labels, 10.9px chips) and
  gray on sage, which is borderline for contrast.
- Hero headline is only 57.6px at 1440px, while section h2s are 56px: the
  hero does not out-rank the sections typographically; the photos carry it.
- Several stock-ish images are the same playmat shot reused 4+ times.

---

## (b) Measured design system

### Typography

| Role | Family | Size (desktop / mobile) | Weight | Line-height | Tracking | Case |
|---|---|---|---|---|---|---|
| Hero h1 | Poppins | 57.6px / 32px | 800 | 0.92 | -0.035em (-2.0px) | upper |
| Section h2 | Poppins | 56px / 32px | 800 | 1.04 | -0.02em (-1.12px) | upper |
| Callout h2 (notice) | Poppins | 41.6px | 800 | 1.02 | -0.03em | sentence |
| Card h3 | Poppins | 20px | 700 | 1.15 | +0.01em | upper |
| Marquee words | Poppins | 115.2px | 800 | 0.95 | -0.035em | upper |
| Big numbers (stats) | Poppins | ~44px | 300-400 | 1 | 0 | n/a |
| Prices (tier grid) | Poppins | ~40px regular (pricing page) / 27.2px 800 (home teaser) | 400 / 800 | 1 | 0 | n/a |
| Lead paragraph (beside h2) | Poppins | 20px | 400 | 1.55 | 0 | sentence |
| Hero sub | Poppins | 18.4px | 400 | 1.5 | 0 | sentence |
| Body | Poppins | 13.6-15.2px | 400 | 1.45-1.7 | 0 | sentence |
| Eyebrow | Poppins | 11px | 700 | 1.4 | 0.08em | upper, red, 26x2px rule before |
| Button | Inter Tight (heavy) / Poppins | 11.2-14px | 900 | 1 | 0.04em | upper |
| Micro labels / captions | Poppins | 9.6-11.5px | 600-700 | 1.4 | 0.09em | upper, gray |
| Script accent | Yellowtail | ~28px | 400 | n/a | n/a | once only |

Notes: one family does nearly everything (Poppins: 381 text nodes vs 22 Inter
Tight). Hierarchy comes from weight (800 vs 400), case (upper vs sentence) and
size jumps (56 -> 20 -> 14), not from many fonts. Theme vars also name Archivo
as display, but Poppins renders.

### Color (measured, by painted area and text count)

| Token | Value | Use |
|---|---|---|
| Sage surface | #a9c9ad (rgb 169,201,173) | dominant section bg, header (95% + 10px blur) |
| Sage light | #b8d4bc | image frames behind photos, compare slider bg |
| Paper | #f7f5f1 | alternate section bg |
| Ink | #1f1f1f / #181816 | dark panels, footer, borders, offset shadows |
| Text ink | #161a17 | headlines |
| Text body | #47514a | paragraphs (most frequent text color) |
| Text muted | #74806f | captions, micro labels |
| Red | #e4483d (text) / #df3e35 (buttons) / #c5372d (deep) | CTAs, prices, eyebrows, final panel |
| Mint accent | #a2c7af, #cbe5cf | "Most popular" chip, text on dark |
| Dark green tints | #243128, #1d2420 | photo tile and reel backgrounds |
| White | #ffffff | cards on paper/sage |
| Red tint | #fdeceb | "Most requested" chip bg |

Ratio: about 41% sage, 31% paper, 13% ink, 3% red, rest white/photo.

### Spacing and layout

- Container: max-width 1280px, centered; header/footer inner 1280 with 72px
  padding. Mobile gutter 20px.
- Section padding: 128px top/bottom (main), 56px (stickers), 32-40px (bands,
  notice). Mobile 32-64px.
- Grid gaps: 56px between the two columns of a split section; 57.6px
  (3.6rem) large flex gaps; 8-12px for chip and button groups; about 18-20px
  between cards in grids.
- Section header layout: headline left (about 55%), lead paragraph right
  (about 40%), bottoms roughly aligned.

### Radii

`50%` (icon circles, 69 uses), `999px` (pills/chips, 36), `14px` (buttons,
price cards, reels, 31), `12px` (photo frames, compare, work-log tiles, 27),
`8px` (21), `16px` (category tiles, service cards, 12).

### Borders and shadows

- Borders: 3px ink (primary buttons, category tiles), 2px ink (service and
  price cards, nav buttons), 1px rgba(22,26,23,.16) (dividers, accordion
  rules), 1px #3f5844 (trust pills on sage), 1px rgba(255,255,255,.28)
  (chips on dark).
- Hard offset shadows: `4px 4px 0 #181816` (14 uses), `3px 3px 0` (small
  buttons), `4px 4px 0 #df3e35` (secondary button, "most popular" card).
- Soft shadows: `0 12px 28px -18px rgba(36,49,40,.5)` (work-log tiles, 24
  uses), `0 26px 48px -20px rgba(20,30,22,.55)` (floating hero cards).

### Image treatments

| Context | Aspect | Frame | Notes |
|---|---|---|---|
| Hero floating cards | ~0.78 (card) | 10px radius, long soft shadow | rotated -12 to +10 deg, bleed off viewport edges, float-in on load |
| Category tiles | 1.21 | 16px radius, 3px ink border, offset shadow | dark gradient overlay, text on image |
| Split section photos | 1.33 (4:3) | 12px radius on sage-light bg | workshop context shots |
| Compare slider | 1.33 | 12px radius, sage-light bg | BEFORE/AFTER pills, red round handle |
| Work-log tiles | 0.71 (card) | 12px radius, soft shadow, dark sleeve edge in photo | before/after crossfade on hover |
| Reels | 0.56 (9:16) | 14px radius, dark bg | view-count pill, play button |
| Hero texture | n/a | dark branded mat with repeated logo, rotated ~16 deg | plus 5% noise grain |

All `object-fit: cover`, lazy-loaded, srcset 352/500w for tiles.

### Buttons, chips, components

- Primary button: red #df3e35, white 900-weight uppercase 13px text, padding
  16px 30px, 14px radius, 3px ink border, `4px 4px 0` ink shadow, arrow glyph.
  Hover: translate(-2px,-2px), shadow 6px 6px. Transition 0.14s
  cubic-bezier(.2,.8,.2,1).
- Secondary: white bg, ink text, same border; shadow ink or red.
- Text link CTA: tiny uppercase red bold "SUBMIT A CARD ->".
- Trust pill: transparent, 1px dark-green border, 13px/500, padding
  9.6px 18.4px, icon left.
- Chips on photos: 10.9px, 1px white 28% border, white 80% text.
- Status chips: "MOST POPULAR" mint bg, "MOST REQUESTED" red-tint bg with red
  text, "ADD-ON" same.
- Accordion: full-width rows, 1px rules, question 18px regular, red "+" at
  right; 6 items max per group.
- Process rail: 64px outlined circles with line icons, dotted connector,
  numbered uppercase labels, 3-line descriptions.
- Numbered step table (how-it-works, pack-ship): 5 columns in a 2px outlined
  box, big light sage numerals "01".."05", uppercase title, paragraph, red
  uppercase micro meta ("WITHIN 1 BUSINESS DAY", "TOP LOADERS ONLY").
- Stat band: dark full-width, 4 big light-weight numbers with tiny uppercase
  captions.
- Footer: ink, 5 columns (brand + 4 link groups with tiny uppercase
  letter-spaced headers in mint), legal non-affiliation disclaimer in small
  gray.

### Motion

- Scroll reveal on nearly every block (`.mw-reveal` -> `.is-in`): opacity +
  transform, 0.5s cubic-bezier(.22,1,.36,1) (67 elements), also 0.7s and
  0.42s variants; grid items stagger by about 34ms each.
- Hero cards: `mw-float-in` 0.8-1.1s cubic-bezier(.16,1,.3,1), staggered.
- Loader: logo lands with overshoot (rotate -16 deg, scale .7 -> 1.06 -> 1),
  0.78s; words fade up 7px, 0.46s; whole loader fades out 0.38s.
- Button press feel: 0.14s; card lift: 0.3s cubic-bezier(.16,1,.3,1);
  image crossfade 0.45s; link color 0.125-0.2s.
- Infinite marquees: announcement ticker, red keyword strips on inner pages
  (INTAKE PHOTOS * RESTORATION * QUALITY CHECK...), giant damage-word band.
- Hand-drawn arrow stroke draw 0.7s ease-out.
- Dominant easing: expo-out style curves (.16,1,.3,1) and (.22,1,.36,1).
  Nothing bounces except the loader logo.

### Inner page template

Every inner page uses the same skeleton: sage page header (eyebrow + 2-3 line
uppercase headline, optionally with the last line in red, + lead paragraph to
the right) -> optional red keyword marquee strip -> paper content sections
alternating with sage -> accordion of 3 to 6 page-specific questions -> red
CTA panel with a page-specific line -> ink footer. This consistency makes a
12-page site feel like one product.

---

## (c) Principles and techniques The Card Doc should adopt

1. **Let real card photos carry the page.** Aim for a card photo in at least
   two of every three screens. Use The Card Doc's own customer cards and
   workshop shots; no illustrations standing in for cards.
2. **Shoot or crop to one consistent format.** Every gallery card: same
   aspect (5:7), same flat front-on scan, same background, same caption
   pattern (card name + set on line 1, small uppercase service on line 2).
3. **Before/after is the core proof.** Build (a) a drag-compare slider for
   one hero result and (b) a big filterable gallery where each tile reveals
   its before on hover/tap, with a live count of cards done. Add a small
   honest disclaimer under it.
4. **Make physical cards the hero.** A few real cards, slightly rotated
   (within about +/-12 degrees), with long soft shadows, bleeding off the
   edges, floating in on load (with a reduced-motion fallback that just shows
   them).
5. **Lead with honesty.** A section on what The Card Doc will not do or
   cannot fix, with plain reasons; improves/won't-fix lists on every service;
   a "we'll tell you before you ship" promise in the CTA copy. Use only
   claims The Card Doc can back, worded by the owner.
6. **One section grammar.** Eyebrow + short declarative headline with a
   period + one lead paragraph beside it on desktop. Repeat it everywhere.
7. **Three-surface rhythm plus one action color.** A light, a mid tone and a
   dark, alternating section by section, with a single saturated action color
   reserved for CTAs, prices and eyebrows (about 3% of area). Dark blocks as
   inset rounded panels, not full-bleed slabs.
8. **CTA every one to two screens**, sticky header CTA, a text-link CTA on
   every tile and service card, and a closing CTA panel on every page with a
   page-specific line.
9. **Show pricing as a teaser first, full table second.** A few sample tiers
   on the home page, the logic in one sentence, then a full page with all
   tiers, bulk discounts and add-ons as clean tables. Prices large, in the
   action color. (Card Doc's actual prices and rules only.)
10. **Process as a short numbered rail** (5 to 6 steps, icon + 3-line
    description) and, on the how-it-works page, a numbered table with a
    timing note per step.
11. **Proof in several formats**: gallery, slider, social clips (with view
    counts if real), stat band (only true numbers), trust strip of
    verifiable practices.
12. **Tactile buttons**: bold uppercase label, clear border, a hard or
    pronounced shadow that moves on hover and press (around 140ms). Pick
    Card Doc's own shape and shadow language.
13. **Generous, uniform spacing**: about 120-128px section padding desktop,
    56-64px mobile, 1280px container, 20px mobile gutter.
14. **Type hierarchy from weight and case, with few families**: one heavy
    display style for headlines, one readable body face, tiny tracked
    uppercase labels. Keep body text at 15-16px minimum (do better than
    their 13.6px), labels at 11px minimum with AA contrast.
15. **Rhythm breakers**: one big kinetic type band, a sticker/badge moment, a
    dark stat band, so long pages never feel repetitive.
16. **Expo-out motion, short and quiet**: reveals 0.4-0.6s with small
    translate, stagger about 30-40ms, hover lifts 0.3s, all disabled under
    `prefers-reduced-motion`.
17. **Shared inner-page template**: page header, optional marquee, alternating
    content, page-specific FAQ (3-6), closing CTA, footer.
18. **Mobile**: horizontal scroll rows for pills and social clips, 2-column
    gallery, single-column pricing cards, full-width CTAs, sticky compact
    header with icon buttons.
19. **Fix their mistakes**: no empty buttons, a hero headline clearly larger
    than section headlines, AA contrast on small gray text, a shorter home
    page that links out instead of duplicating every inner page.

---

## (d) Their signatures: do NOT copy

- **Name and marks**: "The Mint Workshop", "Mint Workshop Pro", "MINT
  WORKSHOP SPORTS", the script logo with the green card/bandage mark, the
  loader animation of that mark, the repeated-logo playmat texture, their
  Instagram handle and reels.
- **Exact palette pairing**: sage green #a9c9ad + off-white #f7f5f1 + ink
  #1f1f1f + tomato red #df3e35/#e4483d. The Card Doc must choose its own
  colors (a different hue family for the main surface and the action color).
- **Exact type pairing**: Poppins 800 all-caps headlines + Yellowtail script
  accent + Inter Tight 900 buttons. Pick different faces.
- **Tier names and price grid**: MINT, MINT+, GEM MINT, PRISTINE, PRISTINE+,
  GRAIL, GRAIL+, VAULT, VAULT+, ULTRA GRAIL(TM), ULTRA GRAIL+, ULTRA GRAIL++,
  their prices and value bands, their bulk discount steps and add-on prices.
  The Card Doc keeps its own pricing and tier names unchanged.
- **Layout signatures**:
  - the hero with a "Place card here for restoration magic." card slot on a
    dark mat, floating cards around it and a handwritten "Get a quote" arrow;
  - the three-color stacked hero headline (black / gray-green / red);
  - the giant CREASES / DENTS / SCRATCHES marquee with solid, outline and
    faded words and red dots;
  - starburst stickers plus the tilted black ribbon banner;
  - the "We don't fix whitening." prohibition-sign callout;
  - the solid vs hollow square improves/won't-fix key;
  - the red final CTA panel with the corner glow;
  - the exact work-log naming ("The work log", "Every card that's been on
    the bench", "Straight off the intake scanner").
  The Card Doc can use the same kinds of devices (honesty callout, compare
  slider, gallery, marquee, badges) but in its own form, shape and words.
- **Copy**: every headline and line, including "Restore. Preserve. Keep the
  magic.", "Claims we can back.", "Send us the one you stopped showing
  people.", "A workshop, not a factory.", "Pack it once. Pack it right.",
  "From your binder to the bench and back.", "Five steps, no guesswork.",
  "Same bench, same standards...". The Card Doc keeps the owner's own wording
  (project rule: never change the owner's wording).
- **Their business facts** as claims: New Jersey / Cranford bench, The
  Hartford and Cabrella insurance figures, $50K return cover, 24-30 day
  turnaround, 1,433 cards, CGC dealer rate, box-opening on video, 2026
  founding, "1997+ cards a month". The Card Doc states only its own facts.
- **Imagery**: any of their photos, scans, reels, the playmat, the gloved-hand
  and bench shots. The Card Doc uses its own customer card photos and its own
  workshop photography.
- **Third-party IP**: as on the current redesign brief, no Pokémon or other
  franchise logos, characters as decoration, Poké Balls or game fonts. Real
  customer card photos are fine as they are.
