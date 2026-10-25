---
name: The Card Doc
description: Card restoration, grading prep and DIY kits, dispensed like a prescription label in vintage card print, neutral greys with one signal orange, presented like a specimen on a light table.
colors:
  rx: "oklch(0.555 0.176 39)"
  rx-soft: "oklch(0.962 0.02 55)"
  rx-bright: "oklch(0.75 0.155 52)"
  ink: "oklch(0.19 0.004 70)"
  paper: "oklch(0.97 0.0035 85)"
  panel: "oklch(1 0 0)"
  rule: "oklch(0.885 0.004 80)"
  input-stroke: "oklch(0.85 0.005 80)"
  muted-surface: "oklch(0.955 0.003 80)"
  muted-ink: "oklch(0.475 0.006 70)"
  selection: "oklch(0.89 0.06 55)"
  destructive: "oklch(0.52 0.19 27)"
  stage: "oklch(0.185 0.004 70)"
  stage-raise: "oklch(0.23 0.005 70)"
  stage-fg: "oklch(0.97 0.003 85)"
  stage-muted: "oklch(0.75 0.006 80)"
typography:
  display:
    fontFamily: "Young Serif, ui-serif, Georgia, serif"
    fontSize: "clamp(6rem, 8.6vw, 8.25rem)"
    fontWeight: 400
    lineHeight: 0.84
    letterSpacing: "-0.025em"
    fontFeature: "'lnum' 1"
  headline:
    fontFamily: "Young Serif, ui-serif, Georgia, serif"
    fontSize: "clamp(2.9rem, 6vw, 5.75rem)"
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: "-0.022em"
    fontFeature: "'lnum' 1"
  section:
    fontFamily: "Young Serif, ui-serif, Georgia, serif"
    fontSize: "clamp(2.25rem, 5vw, 3.75rem)"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "-0.02em"
    fontFeature: "'lnum' 1"
  title:
    fontFamily: "Young Serif, ui-serif, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.01em"
    fontFeature: "'lnum' 1"
  figure:
    fontFamily: "Young Serif, ui-serif, Georgia, serif"
    fontSize: "3rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "'lnum' 1, 'tnum' 1"
  stat:
    fontFamily: "Young Serif, ui-serif, Georgia, serif"
    fontSize: "clamp(4.5rem, 9vw, 7.5rem)"
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: "-0.01em"
    fontFeature: "'lnum' 1"
  body:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.625
  lead:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1rem
    letterSpacing: "0.08em"
  data:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1rem
    fontFeature: "'tnum' 1"
rounded:
  swatch: "3px"
  control: "4.8px"
  panel: "8.4px"
  stage-panel: "10.8px"
  pill: "9999px"
spacing:
  row: "10px"
  row-lg: "20px"
  panel: "24px"
  gutter-phone: "16px"
  gutter-desk: "40px"
  section-phone: "80px"
  section-desk: "128px"
components:
  button-primary:
    backgroundColor: "{colors.rx}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 28px"
    height: "48px"
  button-primary-compact:
    backgroundColor: "{colors.rx}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "44px"
  button-secondary-on-stage:
    backgroundColor: "transparent"
    textColor: "{colors.stage-fg}"
    rounded: "{rounded.control}"
    padding: "0 32px"
    height: "48px"
  button-unavailable:
    backgroundColor: "{colors.muted-surface}"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.control}"
    height: "48px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  status-pill:
    backgroundColor: "{colors.rx-soft}"
    textColor: "{colors.rx}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  tier-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel}"
  ink-stage:
    backgroundColor: "{colors.stage}"
    textColor: "{colors.stage-fg}"
  nav-bar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    height: "64px"
---

# Design System: The Card Doc

## Overview

**Creative North Star: "The Prescription Label, on the Light Table"**

Every service is still dispensed like an Rx: a white label, a band of signal orange across the top, a heavy ink rule under it, and hairline rows of precise facts in small grotesque caps. What changed is the room it sits in. The label now lies on a lit table next to the specimen it describes: the card photos float with real depth, catch a holo foil sheen, and the proof is shown in a dark "light box" where a scan beam develops the before/after photo as you scroll.

The two moods alternate with purpose. **Paper** carries information (services, prices, FAQ, terms, forms). **Ink stage** carries evidence and decisions (proof and stats, customer messages, closing calls to action, the footer). The hero is paper, lit from behind the specimen.

Density is moderate. Headlines are much larger than body (up to ~8rem in the hero), set in a soft, heavy old-style serif that reads like the name printed on a vintage card. Information still lives in rows and rules, not floating cards.

**Key Characteristics:**
- Neutral greys and near-black, with one committed signal orange (plus its brighter twin for use on the ink stage) as the pop.
- Paper for information, ink stage for evidence; never more than one stage block per page plus the footer.
- Holo foil is the only rainbow and only ever sits on a card (an image of one, or a tier panel's edge).
- Oversized Young Serif display type; Schibsted Grotesk for body, labels, prices and codes. No monospace.
- Depth from key light, contact shadows and 3D tilt on specimens; flat, stroked panels elsewhere.
- Motion is scroll-choreographed and motivated (reveal, develop, fan out), and fully removed under reduced motion.

## Colors

Neutral with one pop: warm-leaning greys (chroma under 0.006, never cream) and a near-black ink, with a single signal orange, in two grounds: grey label paper and a charcoal ink stage. Status hues (red, amber, green for success) keep their conventional meaning and are never decoration.

### Primary
- **Signal Orange** (rx): the label band (6px top border), the filled primary action, focus outline on paper, caret, active nav underline, text links, service icons, cart count badge. It is dark enough to carry white text (5.2:1) and to be text on paper (4.7:1); keep it that dark.
- **Bright Orange** (rx-bright): the same role on the ink stage only: rx-labels, links, focus ring, the scan beam, the footer wordmark light (8:1 on stage). It is not used on paper.
- **Orange Wash** (rx-soft): default status pill (rx text on it is 4.6:1), hover/accent surface, the pointer spotlight on tier panels.

### Neutral
- **Ink** (ink): headings, primary text, heavy rules, numbered step markers.
- **Label Paper** (paper, #f6f5f2): page ground for heroes, alternating sections, nav.
- **Pure Panel** (panel): cards, tier panels, pricing panels, inputs, the specimen frame.
- **Hairline** (rule), **Input Stroke**, **Muted Surface**, **Grey Ink** (muted-ink), **Selection Peach**: unchanged roles.

### Ink stage
- **Stage** (stage): the ground of the proof section, the About results, reviews and close, the How It Works CTA panel and the footer.
- **Stage Raise** (stage-raise): reserved for raised panels on the stage.
- **Stage Ink** (stage-fg): headings and figures on the stage. **Stage Grey** (stage-muted, 8.9:1 on stage): body, captions and rx-labels on the stage.
- Lit by a soft neutral key light (`.stage-light`: two grey radial glows, top right and bottom left). A colored glow on charcoal turns brown, so the light stays neutral.
- Hairlines on the stage are white at 10 to 12 percent.

### Status (functional, not brand)
- **Destructive red** and Tailwind red for errors, "cannot fix" marks and low-stock pills.
- **Amber** for notices: preview banner, closed state, terms summary, turnaround disclaimer. Amber notices stay on paper and are never restyled.

### Named Rules
**The One Orange Rule.** Orange is the pop: it marks the label band, the primary action, focus, links/service icons and the scan beam. On paper it is rx; on the stage it is rx-bright. Nowhere else, so it stays loud.

**The Two Grounds Rule.** Paper carries information; the ink stage carries evidence and decisions. A page gets at most one stage block of content plus the footer. Forms, prices, terms and notices never sit on the stage.

**The Foil Rule.** Holo foil is the only multi-hue gradient on the site, and it only ever depicts card foil: over a specimen photo, as the Diamond tier's edge and wash, as the Diamond swatch. Never on text, buttons or backgrounds.

**The Light Rule.** Other gradients are light, not color: the light-table glow, the stage key light, the button top-edge highlight and sheen, polished metal swatches, edge fades on scrolling content, and the pointer light in the footer wordmark.

**The Remap Rule.** Older screens (account, order tracking, admin) use Tailwind's color scales directly, so `app/globals.css` remaps them: blue, sky, indigo, orange, purple, violet, fuchsia and pink go to the orange ramp (600 is rx); slate, gray and zinc to the neutral greys; cyan and teal to a charcoal ramp (600 to 900 are near ink). Red, amber, yellow, green and emerald keep their status meaning. New code uses named tokens.

**The Status Rule.** Order and kit statuses read as neutral, pop or status: awaiting payment grey; awaiting cards amber; received / paid orange wash; in progress solid orange (`bg-rx text-white`); completed green; shipped, shipped back and in transit solid ink (`bg-ink text-paper`); delivered emerald; cancelled red. Tier badges in the admin: Bronze amber, Silver light slate, Gold yellow, Platinum darker slate, Diamond solid ink, Fast Pass orange. Actions are always orange, never green.

**The No Rainbow Rule (tiers).** Tiers are identified by a polished metal swatch (44 x 14px) and the tier name, never by recoloring the panel. Metals: bronze, silver, gold, platinum, diamond (pearl/holo), Fast Pass (signal orange). Diamond alone gets a holo edge.

## Typography

**Display Font:** Young Serif (one weight, 400), fallback ui-serif, Georgia
**Body, Label and Data Font:** Schibsted Grotesk (variable 400 to 900), fallback ui-sans-serif, system-ui

**Character:** a soft, heavy old-style serif at poster scale for names and claims, with the feel of 1960s and 70s card print, paired with a newspaper grotesque for reading, small caps labels, prices and codes. There is no monospace: `font-mono` maps to the grotesque (with tabular numerals where it matters), because mono micro-labels read as generated. Both are free Google Fonts via `next/font/google`.

Young Serif ships one weight, so `html` sets `font-synthesis-weight: none`: `font-bold`/`font-extrabold` on a heading never fakes a heavier cut. Its default figures are old-style, so headings turn on lining figures (`"lnum" 1`).

### Hierarchy
- **Display** (up to ~8.25rem, line-height 0.84, -0.025em): the home "The Card Doc" only, broken as "The Card / Doc" (19.5vw on phones so "The Card" holds one line at 360px). On desktop the Doc's mark and the subline sit right-aligned on the "Doc" line; the subline is capped at `min(26.5rem, 30vw)` so it never runs into "Doc".
- **Headline** (2.9rem phone to 5.75rem desktop, -0.022em): every inner page title, via `<PageHero/>`.
- **Section** (2.25rem to 3.75rem, -0.02em): section h2s on paper and stage (the home proof headline is 4rem so "Proven Results," holds one line).
- **Stat** (4.5rem to 7.5rem, -0.01em): the proof stats on the stage.
- **Figure** (3rem, -0.02em, lining and tabular): prices on tier and prep panels.
- **Title** (1.75rem): tier names, service names (1.5rem), FAQ questions (1.25rem), link index rows.
- **Body / Lead** (Schibsted Grotesk): 15px body, 18 to 20px lead.
- **Label** (Schibsted Grotesk 600, 11px, uppercase, 0.08em): rx-labels and the before/after pills. **Data** (12px, tabular): from-prices, units, codes.

### Named Rules
**The Serif Heading Rule.** All headings are Young Serif with light negative tracking (-0.025em at display, easing to -0.01em at title size; never tighter, or the serifs collide). Body text is never set in the serif.

**The Label Is Data Rule.** Small caps labels and tabular figures are for facts: keys, codes, prices, units, status. Never for sentences or headings.

**The Tabular Rule.** Prices and stats always use tabular numerals.

## Layout

A centered column with generous gutters: `max-w-7xl` for nav, hero, footer and the review wall; `max-w-6xl` for most sections; `max-w-5xl` for prep and how it works. Gutters 16px phone, 40px from md. Sections breathe at 80px phone and 128px desktop.

The home hero is a 12-column grid: title and service rows on 7 columns, the specimen stack on 5, spanning both rows. On phone it stacks title, subline, specimen stack, service rows. The whole hero fits a 1440 x 900 viewport with all three service rows visible.

Two-column fact grids (terms on About, how it works) stay rule-divided. The home terms summary uses four panels with icons; the link index is a 3-column grid of large rows with an arrow at each row's end and a 56px column gap so arrows never read as belonging to the next column.

## Elevation & Depth

Depth is now light and lift, still restrained.

### Shadow Vocabulary
- **Specimen** (`0 40px 80px -40px oklch(0.25 0.05 165 / 0.55)` plus a blurred contact shadow that slides opposite the tilt): hero specimen.
- **Featured panel at rest** (`0 40px 70px -50px oklch(0.25 0.05 165 / 0.6)`): prep pricing panel; Diamond tier (`0 24px 50px -34px`).
- **Hover lift** (`0 18px 36px -22px oklch(0.3 0.04 165 / 0.45)`): tier panels, 220ms.
- **Floating** (`0 10px 24px -8px`): the mobile "Book a Restoration" bubble.
- **Header** gains `0 10px 30px -18px` once the page scrolls (scroll-driven CSS, no JS).
- **Button depth** (`.btn-depth`): a lit top edge, a darker bottom edge and a 1px drop, on every primary action.

### Named Rules
**The Featured Object Rule.** Only specimens and the one featured panel per page cast a shadow at rest. Everything else is stroked and flat until hovered.

## Shapes

Base radius stays 6px (`--radius: 0.375rem`); panels now use `rounded-xl` (about 8.4px), the How It Works CTA stage panel `rounded-2xl` (about 10.8px), controls about 5px, tier swatches 3px. The pill is for status, plus one documented exception: the circular FAQ disclosure toggle (36px ring that fills orange when open).

## Components

### Buttons
- **Primary:** Signal Orange fill, white text, semibold 15px, 48px tall (40px compact in service rows), `.btn-depth` and `.btn-sheen` (a light sweep crosses it once per hover, mouse only). Hover drops to 90 percent orange. Press translates 1px.
- **Secondary on paper:** white, ink stroke at 70 percent.
- **Secondary on stage:** transparent, white/25 stroke, stage-fg text; hover firms the stroke to white/60.
- **Unavailable:** Muted Surface fill, Grey Ink text, 48px.
- **Focus:** 2px rx outline on paper, rx-bright on the stage.

### Rx Label (signature)
Unchanged structure: 6px orange top band, ink bottom rule, hairline rows. On the home hero each row has a 24px serif service name, a 15px line, a small from-price and a compact primary action; rows tint to white on hover.

### Ink Stage (`.stage .stage-light`)
The dark light box. On home it arrives as an inset rounded panel and opens to full bleed as it scrolls up (`<ExpandingStage/>`). It holds the proof headline and CTA, the scan-developed before/after photo, the three stats and the customer reviews. The stats sit in a `1.25fr 1fr 1fr` row (the first figure is the longest) divided by white/12 hairlines, and their size comes from the row's width in container units (`clamp(2.75rem, 9cqi, 6.75rem)` from `sm`, stacked and `clamp(4rem, 21cqi, 6rem)` on phones), so a live figure like "2,321+" never runs into the next one. The screenshot wall (`<ParallaxWall/>`) is no longer on the home page.

### Customer Reviews (`<CustomerReviews/>`, on the stage)
Under "What our customers say": the featured quote ("…you are the best of the best when it comes to card restoration.") in Young Serif (1.85rem phone, 2.35rem tablet, 2.75rem desktop; a documented step between title and section), hanging open quote, a short white/30 rule before the attribution. Every attribution on the site reads "Repeat customer" (no individual names, the owner's call). It lights up word by word as it scrolls in (`<ScrollLitText/>`): every word starts at 18% opacity, the lead settles at 62% (stage grey) and the closing phrase at 100% (stage white), emphasis by brightness within one face, never orange. Forward only, so it stays lit when the page scrolls back; under reduced motion it rests in the final state. Beside it, the Charizard case: the page's one raised panel (`bg-stage-raise`, white/10 ring, the featured shadow), a 28px serif title, one line, then three rule-divided rows (small caps label left, 3 to 3.75rem serif figure right; the price paid in stage grey, the grade and value in white). The figures count up once on reveal (`<CountUp/>`). Below, the other messages as a 1/2/3-column masonry of flat hairline cards (white/12 ring, no shadow): small caps card tag, 16 to 17px quote, 13px attribution. Under a mouse the card's edge lights rx-bright at the pointer (`.lit-border`, stage variant) and the card lifts to white/2.5. Phones show the first six. Each rises in on scroll.

**On the service pages (`<ReviewsPanel/>`).** Restorations and Prep show the same reviews identically: an inset ink-stage panel (`rounded-2xl`, the light stage variant) at the same `max-w-6xl` width on both pages, with the 4xl/6xl "What Our Customers Say" heading, the lit featured quote and the Charizard case, then one even row of three quotes (Charmander, Sold on TCGplayer, 7 cards to grading) as equal-height hairline cards. No screenshots of messages anywhere on these pages.

### Specimen Stack (home hero)
The Mickey Mantle card as a before/after comparison (`<BeforeAfter/>`) in a white frame with an ink stroke and an orange caption strip. The card holds still (the owner asked for a static photo): no tilt, foil or glare. The damaged and restored photos are stacked and aligned: the restored one is wiped in from the left up to a white divider with a round handle, and small caps "After" / "Before" pills ride on each layer so they wipe with the photo. The pair (`public/specimen-mantle-before.jpg`, `-after.jpg`) was cut from `before-after-mickey-mantle.png`: the damaged card is warped onto the restored one by matching the printed artwork (about 1px apart), then both are squared to a straight-on view. The restored card's bottom-right corner is outside that photo, so the pair shows the top of the card (banner, cap, face, chest), where the cracks are worst. A straight-on photo pair of the whole card would replace it one for one. Behind it, rotated 8 degrees, the Charmander before/after (`public/specimen-charmander.png`, a trimmed copy of `before-after-hero.png`) in a matching frame.

### Tier Panels
White, hairline, `rounded-xl`. A fixed 48px header row holds the polished metal swatch and, in the corner, the tier's pill (the owner's badge, Fast Pass's "Express Option" with a bolt, or "SOLD OUT"), so cards with and without a pill line up. Then the 28px serif name with two lines reserved for the description, the 48px figure price, rule-divided facts (Turnaround, Card value, Slots left, plus Fast Pass's queue line and Diamond's value field as one more row), and the 48px primary action on the card's floor. Facts follow the price directly and only the action is anchored, so names, prices, facts and actions all sit at the same height across a row. Each fact is label left, value right; the facts list is a size container and stacks a row (label over value) only when the card is narrower than 16.5rem (`fact-row.ts`). The six tiers share one grid, in tier order: 3 x 2 from 67rem (1072px, where the facts fit side by side), 2 x 3 from `md`, the snap deck on phones (natural heights). `.lift`, `.spotlight` (soft orange glow under the pointer) and `.lit-border` (the edge lights orange under the pointer). Diamond: transparent border with `.holo-ring` (a slowly rotating foil edge) and a faint holo wash fading down from the top.

### Bulk Switch (`bulk-switch.tsx`, Restorations)
A segmented control above the tier grid: one white pill track (`border-rule`, `p-1`) holding three 48px segments, each a label over a 10px mono line ("Standard", "10% off", "15% off"). The chosen segment is solid ink with the percent in `rx-bright`. Full width on phones so it never reads as another row of tier chips. A real radio group (arrow keys, Home/End). Each eligible tier price renders every plan (`data-plan`) and CSS shows the chosen one, so the cards stay server-rendered; discounted prices show the full price struck through beside them.

### Option Cards (kit shipping speed)
Choices with a price (shipping speeds) are full-width label rows: native radio, name over a muted detail line, price right-aligned in `tabular-nums`. Chosen: `border-rx bg-rx-soft`, name and price in `text-rx`. The focus ring sits on the row (`has-[:focus-visible]`).

### Address suggestions (`address-autocomplete.tsx`)
The street field keeps the form's own input style; Google's suggestions open in a white list under it (`rounded-lg`, hairline border, `shadow-lg`): street in medium weight over the town in muted xs, the highlighted row on `bg-secondary`, and a quiet "powered by Google" footer (required attribution). An ARIA combobox: arrows move, Enter picks, Escape closes. Picking fills street, city, state and ZIP. Without a key it is a plain input for the browser's own autofill.

### Account pages (`auth-card.tsx`)
Sign in, sign up, confirm, forgot and reset password share one centered white card (`AuthCard`) with uppercase field labels and a full-width primary button; signed-in pages share `AccountHeader` (Orders, Settings, email, Sign out). Confirming an email or resetting a password takes a button press on our page, so link scanners can't spend the one-time token.

### Page Hero (`<PageHero/>`)
Optional rx-label, headline type with words rising out of their clips, lead line. Used on tier selection, prep, how it works, FAQ and shop (About has its own hero, below). Inner pages sit on `.page-glow` (the light-table glow at the top right only).

### About (`app/(public)/about/page.tsx`)
Every word, figure, photo and result comes from `lib/about.ts`, which also lists the photo slots (file names and sizes). Paper first, then one stage:
- **Hero** (paper, `.page-glow`): the owner's "About Us" label, then the headline as two sentences of two lines each ("Built by / Collectors." and "Trusted with / Collections.", the second indented 0.9em from `sm`), headline type up to 5.75rem, words rising out of their clips. On the right, the restored Mickey Mantle in a blue nitrile glove (cut from the owner's `before-after-mickey-mantle.png`) in a white print frame tipped 2.5 degrees, with the specimen shadow and `.specimen-land`; the frame's foot holds the serif card name and an "After restoration" label.
- **How it all started** (white): the title sticks on the left; five chapters on the right as hairline rows threaded by a 1px rule with a dot per chapter (hollow, the last solid ink).
- **Meet the founders** (paper): the two first names at up to 8.5rem side by side under an ink rule, divided by a hairline, each with one label line of facts; then the founders' message in serif at up to 3.25rem, offset three columns. No portraits until real ones exist (4:5 slots).
- **Why collectors choose us** (white): an Rx label (6px orange band, "The Card Doc" with the founders' names, a 2px ink rule, four hairline rows of a 24px serif title and a 15px line). Flat: no shadow.
- **Behind the restoration** (paper): a close-up of the damaged Mantle leads (sticky on desktop; on phones it sits between the intro and the methods), the five methods as hairline rows, "We never" with three items, then the honesty line and links to What We Can Fix, the FAQ and the Terms.
- **Stage** (`<ExpandingStage/>`): Real results (`<ResultsGallery/>`: case chips with a 1 / 2 count, a scroll-snap track where phones swipe and the next case peeks in; a slider case is `<BeforeAfter/>` in a white frame, a composite is the owner's side-by-side photo), What our customers say (the live finished-cards figure, right-aligned, over `<CustomerReviews compact/>`), and the close ("Your Collection Means Something. / We Understand Why.", centered, primary to /tier-selection, secondary "Contact Us" to Instagram).

### Footer
Ink stage. Brand block and contact links (20px serif, rx-bright on hover), then a full-width "The Card Doc" wordmark (14vw, capped at 14.5rem) in white at 9 percent that rises out of its clip once and lights orange under a mouse pointer. The wordmark is `aria-hidden`; the real name is in the brand block.

### FAQ Disclosure
Native details between hairlines under an ink rule; 18 to 20px serif question; circular toggle; an orange rule draws under the row on hover and stays while open.

### 404
`app/not-found.tsx` (unmatched URLs, with its own brand mark), `app/(public)/not-found.tsx` and `app/admin/not-found.tsx` (inside their layouts) share `<NotFoundPanel/>`: a display-size serif "404", a 6px orange band, Next's default line "This page could not be found." and a primary "Back to home".

### Toasts
Sonner toasts use Schibsted Grotesk and ink text with a hairline border (`[data-sonner-toaster]` in `globals.css`); rich success / error colors are status and stay.

### Emails
Transactional emails (HTML strings in `app/api/**` and `lib/checkout-error-log.ts`) follow the site in web-safe form: Helvetica/Arial body, Georgia headings, signal orange `#c34104` for buttons, links and code boxes (`#fff5f0` wash, `#7c2704` deep), charcoal `#1e1d1a` for tracking numbers. Error alerts stay red, notices amber, gift-card receipts green.

### Notices, Icons
Unchanged: amber notices carry the owner's warnings; lucide-react at stroke 1.75, bare beside text.

### Motion
Marketing pages only; cart, checkout, order builder and account screens get no new motion. Curves: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. Transform, opacity and clip-path only.

**The No Rewind Rule.** Scroll effects never play backwards when the page scrolls up. Reveals (stage opening, scan, progress rules) finish once and stay finished; hero exit motion (drift, tilt, fan) runs on the way down and settles back to rest on a spring as soon as the scroll turns around. Parallax (the review wall) and the foil sheen are depth and material, not choreography, so they still follow the scroll both ways.

- **Masked headline (`<SplitReveal/>`):** words rise out of their own clip, 900ms, 70 to 110ms apart; `lines` fixes the break. Screen readers get the plain text.
- **Before/after (`<BeforeAfter/>`):** while the card lands, the divider sweeps from fully damaged to 58% (through the face) over 1500ms, 750ms in, in CSS (`--split`), so it plays before hydration. After that it only moves when dragged: hovering does nothing; a mouse press or tap jumps it there (0.3s spring) and dragging follows the pointer 1:1 (grab cursor, handle grows 10% while held); a finger drags it sideways (vertical swipes still scroll); arrow keys step it 5% (Shift 20%). It stays where it's left. Reduced motion: rests at 58%, no sweep.
- **Specimen landing (`.specimen-land`):** the hero card tips down from a 24 degree 3D tilt over 1400ms; opacity resolves in 450ms so the image paints early. The back card fans in 300ms later (`.fan-in`).
- **Scroll fan (`<ScrollFan/>`):** the back card rotates 7 degrees further and slides out over the first 700px of scroll, outward on its own side (right from 640px up, left on phones). Same rule: it fans out on the way down and settles home on a spring when the page scrolls up.
- **Expanding stage (`<ExpandingStage/>`):** clip-path inset 48px (12px phone) and radius 28px resolve to full bleed as the stage top travels up the viewport. Once open it stays open.
- **Scan reveal (`<ScanReveal/>`):** a bright-orange beam sweeps left to right across the before/after photo, leaving full colour behind a dimmed greyscale copy; scroll-linked with a 0.35s spring. A developed photo stays developed.
- **Parallax wall (`<ParallaxWall/>`):** customer messages in 2/3/4 columns drifting at different speeds (40 to 140px of travel), edge-faded.
- **Count-up, scroll reveals, FAQ height, step walkthrough:** as before (step numeral now 9rem); the walkthrough's progress rule and step markers keep how far the reader got. The FAQ page's fix panels stagger in and each question group rises in.
- **Scrolling:** native browser scrolling everywhere (the owner asked for normal scrolling, so there is no smooth-scroll library). `scroll-padding-top: 8rem` on `html` keeps in-page links clear of the sticky header.
- **Page transitions (`app/(public)/template.tsx`):** React `<ViewTransition>` with Next's `experimental.viewTransition`. The old page lifts 12px and fades in 180ms; the new page rises 28px over 620ms, 110ms later. The header, phone menu, booking dock and grain are named only while a transition runs (a permanent name would flatten the header's frosted blur) and hold still above the page. The loading skeleton fills the screen, so the footer never flashes up, and dissolves into the page in 260ms.
- **Trusted by marquee (`<VelocityMarquee/>`):** a thin strip (about 150px desktop, 125px phone): serif names (24px phone, 36px desktop) each followed on the same baseline by one 13px meta line (role, bold handle, followers), an arrow and a short hairline divider; the name turns orange and the arrow nudges on hover. Each copy of the row repeats the list until it holds at least four names, so a short list still loops without a gap. Drifts one copy-width every 38s, always drifts left and surges with scroll speed in either direction (up to 5x); pauses under a mouse and while off screen; edge-faded. Reduced motion: still, one of each name, wrapping.
- **Nav:** a hover highlight glides between tabs and the active underline glides between routes (Motion `layoutId`, spring bounce 0.15, 0.45s); the phone menu is a full-screen ink sheet portaled to `<body>`, revealed by a clip-path circle growing from the menu button (600ms), with the three services set huge and rising out of their clips 70ms apart; the menu icon cross-fades with a 45 degree turn.
- **Hover details (mouse only):** `.lift`, `.nudge-arrow`, `.draw-underline`, `.btn-sheen`, metal swatch highlight slide (900ms), `.lit-border`, link-index arrow nudge.
- **Footer wordmark:** rises 65 percent out of its clip over 1400ms once in view (the observed parent never moves, so it always triggers).
- **Reduced motion:** every entrance, scroll-linked transform, foil, fan, scan, parallax, sheen and holo-ring spin is removed; reveals become a 400ms fade; the stage renders full bleed; page changes become a plain cross-fade; the marquee stands still and wraps. Client components read the preference through `usePrefersReducedMotion()` (`components/motion/use-reduced-motion.ts`), which is hydration-safe: Motion's own hook reads the media query during hydration and makes server and client trees disagree.

### Phone layer
Phones are the primary surface (social-media first visits).
- **Platform baseline:** `viewport-fit=cover`, `interactive-widget=resizes-content`, `theme-color` matching the paper header; no tap highlight; no text inflation; 16px inputs on coarse pointers (no focus zoom, zoom never disabled); `touch-action: manipulation` and `user-select: none` on controls only; `.press` scales to 0.97 on `:active`.
- **Booking dock (`RestorationBubble`):** a frosted ink bar pinned to the bottom with safe-area padding (logo, "Book a Restoration", "From $75 / card", orange arrow). It slides in once the hero is passed, hides over the footer, and is absent on the booking and checkout pages (`hidesBookingButton()`: tier selection, the restoration and prep order forms, cart, checkout, gift cards, subscriptions, the slab agreement and the order-confirmed page) and from `md` up.
- **Trust strip:** three facts the owner states (cards restored, rating, reply time) as bare icons with serif figures: the two figures side by side and the reply time across the row below on phones, one row of three on desktop.
- **Snap deck (`<SnapDeck/>`):** on phones, grids of options (tiers) become a horizontal scroll-snap track at 88% card width (cards keep their natural height), with tier-name chips above and dots below, both tracking the visible card. From `md` up it is the normal grid.
- **Route loading:** a thin orange progress bar plus skeleton blocks with a soft sheen (static under reduced motion).

## Do's and Don'ts

### Do:
- **Do** keep every visible word exactly as the owner wrote it, including em-dashes, punctuation and the rx-labels above headings.
- **Do** put information on paper and evidence on the ink stage.
- **Do** keep orange to the band, primary actions, focus, links and the scan beam (rx on paper, rx-bright on stage).
- **Do** set prices and stats in the heading face with lining figures, units in the small grotesque.
- **Do** keep holo foil on cards only, and light enough that the photo underneath stays legible.
- **Do** give every scroll-linked or perpetual effect a static reduced-motion state, and read the preference with `usePrefersReducedMotion()`.
- **Do** check the hero fits 1440 x 900 with all three service rows visible.

### Don't:
- **Don't** use colored gradients other than holo foil, and never on text, buttons or page backgrounds.
- **Don't** put forms, prices, terms or amber notices on the ink stage.
- **Don't** add more than one stage block of content per page (the footer is separate).
- **Don't** recolor cards per tier or introduce new accent hues.
- **Don't** add shadows at rest beyond specimens and one featured panel per page.
- **Don't** put icons in tinted tiles; don't use emoji as icons; don't mix icon libraries.
- **Don't** add new uppercase lines above headings; the ones present are the owner's copy.
- **Don't** run `next build` while `next dev` is running in the same checkout: it can leave the dev server serving a stale stylesheet. Stop dev first.
