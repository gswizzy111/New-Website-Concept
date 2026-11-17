---
name: The Card Doc, Hobby Shop Poster
description: Photo-led card restoration site with the energy of a card-show booth. Saturated cobalt and wax-pack sun yellow blocks on cool chalk and ink, condensed Big Shoulders headlines over a clean Schibsted Grotesk body, real customer cards shown as white-bordered physical prints, the hero slider inside a clear acrylic one-touch holder, die-cut sticker labels, full-pill buttons with a lift, 22px panels, soft layered shadows and calm, eased motion.
colors:
  cobalt: "#2141D8"
  cobalt-deep: "#1830B0"
  cobalt-tint: "#C9D3FF"
  cobalt-wash: "#E4E9FF"
  ink: "#0D1233"
  ink-2: "#171E4A"
  ink-soft: "#4A5275"
  chalk: "#EEF1F7"
  white: "#FFFFFF"
  sun: "#FFCE2E"
  sun-deep: "#F2B600"
  sun-tint: "#FFF4CC"
  line: "rgba(13,18,51,.14)"
  line-dark: "rgba(255,255,255,.14)"
  on-dark-muted: "#C9CFEA"
  success: "#1D7349"
  danger: "#B42318"
typography:
  display: Big Shoulders (Google, variable wght + opsz; the merged family that replaces "Big Shoulders Display", opsz 72 is the Display cut)
  body: Schibsted Grotesk (Google, variable 400-900)
radii: { print: 8px, print-image: 3px, sticker: 6px, field: 12px, review-card: 14px, holder: 18px, panel: 22px, button: pill }
---

# The Card Doc: design system

Chosen Nov 16, 2026 (`docs/redesign/direction.md`, mock
`docs/redesign/directions/bold-graphic/index.html`, tokens in
`docs/redesign/judging.json`). The pixel / healing-center look is retired.
Code lives in `app/globals.css` (tokens and classes), `components/brand/*`
(primitives), `components/ui/*` (shadcn, restyled) and
`components/marketing/{nav,footer,page-hero}.tsx` (chrome).

## 1. Colour

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `cobalt` | #2141D8 | hero, reviews, Restoration surface; links and focus on light | white on it 7.1:1; on chalk 6.3:1 |
| `cobalt-deep` | #1830B0 | pressed cobalt, cobalt text on tints | |
| `cobalt-tint` | #C9D3FF | soft text on cobalt | 4.6:1 on cobalt |
| `cobalt-wash` | #E4E9FF | pale fills, menu highlight | cobalt text 5.9:1 |
| `ink` | #0D1233 | text, dark sections, footer, primary dark button | 17:1 on white |
| `ink-2` | #171E4A | raised panels on ink | |
| `ink-soft` (= `muted-foreground`) | #4A5275 | secondary text on chalk/white | 7.6:1 white, 6.6:1 chalk |
| `chalk` | #EEF1F7 | the page, light sections | |
| `white` | #FFFFFF | print borders, cards, panels, header | |
| `sun` | #FFCE2E | the single action colour: CTAs, prices on dark, stickers, step numerals, closing block. Ink text only | ink on it 12.9:1 |
| `sun-deep` | #F2B600 | sun hover edge, underline hover | |
| `sun-tint` | #FFF4CC | important-note background | |
| `on-dark-muted` | #C9CFEA | secondary text on ink | 12:1 |
| `line` / `line-dark` | 14% ink / 14% white | hairlines | |

Rules:
- Cobalt, sun and ink each lead **at most one block in a row**. Alternate
  with chalk and white. Reviews sit on chalk/white with cobalt accents.
- Small text on cobalt: white or `cobalt-tint` only. On sun: ink only.
  Never white on sun, never sun text on white.
- Focus ring: 3px cobalt on light, sun on cobalt/ink (`.surface-*` and
  `.stage` switch it automatically).
- Halftone dot texture (`.halftone-dots`) on cobalt surfaces only.
- Shadcn roles: `primary` = cobalt, `accent` = sun, `secondary` = cobalt-wash,
  `muted` = #E4E8F1 surface, `destructive` = #B42318.
- Note: Tailwind's `muted` is the shadcn **surface**; the mock's "muted" text
  colour is `text-muted-foreground` / `text-ink-soft`.

### Legacy names (un-migrated pages)
Every old clinic token still resolves, onto the new palette: `paper`,
`floor`, `cream` -> chalk; `panel`, `bone` -> white; `ink` -> new ink;
`ink-soft` -> #4A5275; `rx`, `coral`, `coral-deep`, `frame-deep`, `rx-pop`
-> cobalt; `coral-fill`, `butter`, `rx-bright` -> sun; `rx-soft`, `powder`
-> cobalt-wash; `mint` -> success tint, `mint-deep` -> success green;
`night`, `stage` -> ink; `night-raise`, `stage-raise` -> ink-2;
`stage-fg` -> white; `stage-muted` -> on-dark-muted; `wall`, `peach` ->
#E3E8F5; `tile` #DDE2EE; `rule` #D5DAE7; `frame` #7A84A8.
Tailwind scales are remapped too: blue/sky/indigo/violet/purple/fuchsia/
pink/orange -> cobalt ramp; slate/gray/zinc/neutral/stone/cyan/teal -> cool
ink grey; amber/yellow -> sun ramp (400 = sun); green/emerald/lime -> green;
red/rose -> red. `white` is pure #FFF, `black` is ink. **New code uses the
brand names, not these.**

## 2. Type

- **Big Shoulders** (`font-heading`, `font-display`, `--display`): all
  display type, stickers, step numerals, eyebrows. Weight 800-900. Mixed
  case for headlines; uppercase only for short card-style labels.
  Optical sizing is automatic (condensed Display cut at headline sizes).
- **Schibsted Grotesk** (`font-sans`, `--body`): body, UI, buttons, forms,
  legal. Body 16-17px, line-height 1.6.
- `font-mono` resolves to the body sans (admin codes and tracking numbers).

| Class | Size | Notes |
|---|---|---|
| `.display-xl` | clamp(56px, 10.4vw, 156px), lh .86 | hero, closing headline |
| `.display-lg` | clamp(48px, 7.4vw, 112px), lh .9 | section h2 |
| `.display-md` | clamp(36px, 4.2vw, 60px), lh .95 | inner sections, CTA panels |
| `.display-sm` | clamp(26px, 2.6vw, 40px), 800 | card h3 |
| `.lead` | clamp(17px, 1.5vw, 20px), lh 1.55, 56ch | intro paragraphs |
| `.eyebrow` | 18px Big Shoulders 800, .06em, uppercase | at most twice per page |
| `.label-caps` / `rx-label` | Big Shoulders 800 uppercase | small labels, table heads |
| `.caps` | uppercase | **use on headings instead of `uppercase`** (a global rule strips `uppercase` from h1-h4 left by old pages) |

All headings get `text-wrap: balance`.

## 3. Shape, depth, layout

- Radii: prints 8px (image 3px), stickers 6px, fields 12px, review cards
  14px (`rounded-lg`), holder 18px (`rounded-xl`), panels and tiles 22px
  (`rounded-2xl`), buttons and chips full pill.
- Shadows (CSS vars): `--print-shadow`, `--print-shadow-dark`,
  `--panel-shadow`, `--pop-shadow`, `--cut-edge` (3px white die-cut ring).
  **No zero-blur offset shadows.**
- Layout: `.wrap` (1280px max, gutter clamp(20px, 4vw, 40px)),
  `.section-y` (clamp(72px, 9vw, 128px) block padding). Header 64px phone,
  74px desktop (`--header-h`).
- Surfaces: `.surface-cobalt`, `.surface-ink`, `.surface-sun`,
  `.surface-chalk`, `.surface-white` set background, text colour, focus
  ring and selection for the block.

## 4. Components

### Buttons
`cta({ tone, size, className })` (`components/brand`) returns the class
string for links; `<Button variant size>` (`components/ui/button`) for real
buttons. Both use `.btn`.
- Tones: `sun` (default action, ink text, white die-cut edge), `ink` (dark
  primary), `cobalt`, `outline` (2px ink ring, on light), `outline-light`
  (white ring, on cobalt/ink), `white`, `ghost`; Button also has `secondary`
  (white), `destructive`, `link`.
- Sizes: cta `sm` 44px, `md` 48px, `lg` 58px. Button `default` 44px, `lg`
  52px, `sm`/`xs`/`icon-sm` keep a 44px hit area.
- Hover (mouse only): lift -2px, deeper shadow, a trailing svg nudges 3px.
  Press: scale .98. Reduced motion: no lift.

### Brand primitives (`import { ... } from "@/components/brand"`)
- **Print**: a real photo as a white-bordered physical print, optional
  tilt, the layered print shadow, `surface="dark"` deepens it.
- **AcrylicHolder**: the clear one-touch holder (frosted edge, four screws,
  glare streak with `pointer-events: none`, caption). Wraps the hero
  `<BeforeAfter/>` slider without breaking drag or keys.
- **Sticker**: die-cut label (sun/cobalt/ink/white), optional tilt and pop.
- **SectionHead**: eyebrow + h2 + lead, tones light/dark/cobalt/sun,
  optional actions on the right.
- **Marquee**: seamless CSS loop, pauses on hover/focus, static wrapped row
  under reduced motion, screen readers read one copy.
- **CtaPanel**: solid sun/cobalt/ink 22px block with headline, lead,
  actions, optional aside.
- **StatBlock**: oversized number over its label on a 22px tile.
- **Seamless**: studio sweep backdrop with `mix-blend-mode: multiply` for
  cut-out-on-white photos (Mantle glove pair, Garchomp corner).
- **BrandLogo**: `/card-doctor.jpg` cropped to the head in a rounded-square
  frame plus the "THE CARD DOC" wordmark.

### UI kit (`components/ui/*`)
Props and behaviour unchanged; restyled: white 22px cards with a hairline
and soft shadow; inputs/selects/textareas 44px, 12px corners, 1.5px grey
edge, cobalt border + 2px cobalt outline on focus; checkboxes 6px rounded,
radios round, cobalt when checked; popovers and menus 14px white with
`--pop-shadow`, cobalt-wash highlight; tabs are a pill track with a white
active pill; badges are pills; dialogs 22px with an ink/55 blurred overlay.

### Chrome
- **Nav**: sticky white header (94% + blur), framed logo + wordmark,
  Restorations / Prep / Kits / Explore (dropdown: What We Can Fix featured,
  Services, Before You Order, Orders & Account, Terms, Privacy), cart,
  account, sun "Book a Restoration". Under 640px the CTA is a compact
  "Book" pill beside the cart and menu. Full nav from 1024px; below it a
  full-screen ink menu. A chalk hover pill slides between tabs; the active
  tab gets a 3px sun underline.
- **Footer**: ink; logo, the owner's line, "Contact" with the Instagram DM
  line and reply time, Terms / Privacy / Creator Portal, copyright, and an
  oversized "THE CARD DOC" sign-off that rises in and lights sun under the
  pointer.
- **PageHero** (inner pages): eyebrow with a rule, big Big Shoulders h1 with
  a word rise, lead; `tone="dark"` for ink/cobalt sections, `actions` row.

## 5. Motion

Easing `cubic-bezier(.16,1,.3,1)` (`--ease-out`). Button lift 180ms; print
and reel lift 450ms; reveals 640-760ms rise of 18px, staggered 60ms; page
transitions fade out 160ms, new page rises 10px in 360ms; FAQ disclosures
open by height in 320ms; marquees linear (trust strip 38s, symptoms 44s).
Hero load: holder rises, back prints fly in (`enterDelay`), sticker pops
(`pop`), slider wipes from 12% to 58%. **No `steps()` anywhere.**
`prefers-reduced-motion`: every entrance, loop, marquee, lift and sweep is
off; the page still looks finished.

## 6. Do

- Lead with real customer card photos in most screens; vary crops (the same
  Mantle framing never more than twice on a page).
- Put a call to action every one or two screens; sun is the action.
- Keep the owner's wording verbatim, em dashes included. New words only
  where the owner asked ("We do all cards.", "Watch the work").
- BEFORE label over the damaged side, AFTER over the restored side
  (`.ba-label`; AFTER is sun, BEFORE is ink); never clipped by the holder.
- At most about two stickers per screen, never over a headline or the
  holder. Sticker text is the owner's words.
- 44px targets, visible focus, no horizontal scroll at 390px, phone first.

## 7. Don't (not allowed)

- Don't copy The Mint Workshop (`docs/redesign/mint-study.md` section d):
  no name or marks, no sage / off-white / near-black / tomato palette, no
  Poppins 800 caps + Yellowtail + Inter Tight, no tier names or prices, no
  copy, photos, reels or layout signatures (card-slot playmat hero with
  floating cards and handwritten arrow, three-colour stacked headline,
  solid/outline/faded CREASES marquee with red dots, starbursts and tilted
  ribbon, prohibition-sign callout, solid/hollow square key, red corner-glow
  final panel, "work log" naming).
- The symptoms ticker stays (owner asked) but flat and quiet, not a tilted
  tape over the hero.
- No stock or AI card photos; no invented claims, numbers, reviews or view
  counts.
- No Pokémon names, characters, Poké Balls, logos or game fonts as
  decoration (customer card photos are fine as they are). The Charmander
  composite's "Before -> After" lettering is cropped off.
- No pixel UI: no stepped corners, hard offset shadows, tile floors, pixel
  sprites, ▶ cursors or `steps()` motion. The old pixel components, assets,
  classes and clinic colour names (`px-*`, `comic-*`, `stage`, `wall-band`,
  `hp-bar`, `paper`, `rx`, `coral` ...) were removed; use the tokens above.
- No cobalt flood: never two cobalt blocks in a row.
- Don't swap the logo: `/card-doctor.jpg` stays the brand mark (an owned
  "CD" monogram is only an option to offer the owner).

## 8. Fonts note

Big Shoulders Display is published on Google Fonts as the merged variable
family "Big Shoulders" with an `opsz` axis (10-72); `next/font/google`
loads `Big_Shoulders` with `axes: ["opsz"]`. Both faces are free (OFL).
