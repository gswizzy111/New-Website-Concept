---
name: The Card Doc
description: Card restoration, grading prep and DIY kits, dispensed like a clean clinic's prescription label.
colors:
  rx: "oklch(0.47 0.095 165)"
  rx-soft: "oklch(0.955 0.025 165)"
  ink: "oklch(0.2 0.02 170)"
  paper: "oklch(0.99 0.003 165)"
  panel: "oklch(1 0 0)"
  rule: "oklch(0.88 0.01 165)"
  input-stroke: "oklch(0.86 0.01 165)"
  muted-surface: "oklch(0.965 0.005 165)"
  muted-ink: "oklch(0.45 0.015 165)"
  selection: "oklch(0.87 0.07 165)"
  destructive: "oklch(0.52 0.19 27)"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(3rem, 7vw, 4.5rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.035em"
    fontVariation: "'wdth' 80"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 82"
  section:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 88"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 88"
  figure:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontFeature: "'tnum' 1"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.625
    fontVariation: "'wdth' 100"
  lead:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1rem
    letterSpacing: "0.06em"
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1rem
rounded:
  swatch: "3.6px"
  control: "4.8px"
  panel: "6px"
  pill: "9999px"
spacing:
  row: "10px"
  row-lg: "20px"
  panel: "24px"
  gutter-phone: "16px"
  gutter-desk: "40px"
  section-phone: "64px"
  section-desk: "96px"
components:
  button-primary:
    backgroundColor: "{colors.rx}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "44px"
  button-primary-compact:
    backgroundColor: "{colors.rx}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "44px"
  button-unavailable:
    backgroundColor: "{colors.muted-surface}"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.control}"
    height: "44px"
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
  nav-bar:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    height: "64px"
---

# Design System: The Card Doc

## Overview

**Creative North Star: "The Prescription Label"**

Every service is dispensed like an Rx: a white label, a band of clinical green across the top, a heavy ink rule under it, and hairline rows of precise facts in a monospace data face. The page reads like something a careful pharmacist printed, not like a promotion. Headings are a tight, narrowed grotesque; data and labels are mono; everything sits on near-white label paper or pure white panels.

Density is moderate and structured. Information is carried by rows and rules rather than by floating cards, so a phone visitor scanning a tier or a price sees a stack of labelled lines. Color is scarce on purpose: one green does the band, the primary action, the focus ring and the occasional link; everything else is ink, grey ink and hairline.

The system is flat. Depth comes from rules and strokes, with a faint lift only on hover and a real shadow only on things that genuinely float (modal, mobile booking bubble). There is one light theme.

**Key Characteristics:**
- One committed clinical green, used for band, primary action, focus and links only.
- Hairline (1px) rows under a heavier ink rule, like a pharmacy label.
- Narrowed Archivo (width axis 80 to 88) for headings; Geist Mono for labels, prices and codes.
- Small radius (6px panels, about 5px controls); pill shape reserved for status.
- Flat surfaces; no gradients, no glow, no emoji as icons.
- Single light theme, including browser chrome (caret, selection, scrollbar).

## Colors

A near-monochrome clinic palette of green-tinted neutrals with one deep clinical green; status hues (red, amber) keep their conventional meaning and are never used as decoration.

### Primary
- **Clinical Green** (rx): the label band (6px top border), the filled primary action, focus outline, caret, active nav underline, text links, icons in service rows and add-on rows, cart count badge. It is the only chromatic brand color.
- **Green Wash** (rx-soft): background of the default status pill and the hover/accent surface. Never a large fill.

### Neutral
- **Clinical Ink** (ink): all headings, primary text, the heavy rule above data lists (usually at 70 to 80 percent opacity), the secondary button stroke and numbered step markers.
- **Label Paper** (paper): page ground for hero bands, alternating sections, nav and footer.
- **Pure Panel** (panel): cards, tier panels, pricing panels, inputs, the specimen frame.
- **Hairline** (rule): every 1px divider, row separator, panel border and image ring. It is also the shadcn `border` token.
- **Input Stroke** (input-stroke): text field borders, a step darker than a hairline.
- **Muted Surface** (muted-surface): disabled and unavailable actions, ghost hover.
- **Grey Ink** (muted-ink): body copy under headings, captions, rx-labels, secondary links.
- **Selection Mint** (selection): text selection highlight only.

### Status (functional, not brand)
- **Destructive red** (destructive) and Tailwind red for errors, "cannot fix" marks and low-stock pills (red-50 fill, red-700 text, red-200 ring).
- **Amber** (amber-50 fill, amber-200/300 border, amber-900/950 text) for notices: preview banner, closed state, terms summary, turnaround disclaimer.

### Named Rules
**The One Green Rule.** Clinical Green marks exactly four things: the label band, the primary action, focus, and links/service icons. If green appears anywhere else, it is wrong.

**The Remap Rule.** Tailwind's blue, sky and indigo scales are remapped to the green (hue 165) ramp and slate, gray and zinc to the green-tinted neutral ramp, so legacy utility classes render on-brand. New code should use the named tokens (rx, ink, rule, paper) rather than relying on the remap.

**The No Rainbow Rule.** Tiers are identified by a small metal swatch (32 x 12px) and the tier name, never by recoloring the panel. Swatch fills: bronze #a86b3c, silver #a7b0b5, gold #c9a227, platinum #8e9aa6, diamond #cfdde4, Fast Pass Clinical Green.

## Typography

**Display Font:** Archivo (variable, width axis enabled), fallback ui-sans-serif, system-ui
**Body Font:** Archivo at normal width (wdth 100)
**Label/Mono Font:** Geist Mono, fallback ui-monospace

**Character:** A narrowed, heavy grotesque for headings that reads like the printed name on a label, paired with a small uppercase mono for the codes and data beneath it. Both are free Google Fonts loaded through `next/font/google` (no licensing substitution needed).

### Hierarchy
- **Display** (800, 48 / 60 / 72px across breakpoints, line-height 0.95, -0.035em, wdth 80): the home "The Card Doc" headline and the About page headline only.
- **Headline** (800, 36px phone / 60px desktop, -0.03em, wdth 82): page titles on tier selection, prep, how it works.
- **Section** (800, 30 to 36px, up to 48px on About, tracking tight, wdth 88 from the base heading rule): section h2s.
- **Title** (700, 18 to 24px, wdth 88): tier names, panel titles, terms item titles, service names (20px).
- **Figure** (700, 30 to 36px, tabular numerals): prices and stats, set in the heading face.
- **Body** (400, 15px, line-height 1.625, max 65ch in long answers): answers, descriptions. 14px for row descriptions.
- **Lead** (400, 18 to 20px, relaxed, Grey Ink, max ~28 to 42rem): the line under a page title.
- **Label** (Geist Mono 11px, uppercase, 0.06em, Grey Ink): the rx-label; data-row keys, codes, specimen caption, "Contact".
- **Data** (Geist Mono 12px, sentence case): price notes ("per card"), from-prices, copyright line.

### Named Rules
**The Narrow Heading Rule.** All h1 to h4 are Archivo 700+ at -0.02em or tighter with the width axis narrowed (88 by default, 80 to 82 at display and page-title scale). Body text stays at full width 100.

**The Mono Is Data Rule.** Monospace is for facts: keys, codes, prices, units, status. Never for sentences or headings.

**The Tabular Rule.** Tables and any `[data-numeric]` element use tabular numerals; prices and stats always do.

## Layout

A centered column with generous gutters: `max-w-7xl` (1280px) for nav and home hero, `max-w-6xl` (1152px) for most sections, `max-w-5xl` (1024px) for prep and how it works. Gutters are 16px on phone and 40px from md up. Sections breathe at 64px vertical padding on phone, 96px on desktop, alternating Label Paper and white grounds divided by a hairline.

Two-column splits are asymmetric (1.05fr / 1fr in the hero, 1.2fr / 1fr for proof, 1fr / 1.6fr for FAQ with a sticky heading). Tier panels sit on one 1 / 2 / 3 column track so edges align; the Fast Pass panel runs full width below, introduced by an rx-label and a hairline that fills the rest of the line. On phone everything stacks in reading order: headline, subline, specimen image, then the service rows.

Two-column fact grids (terms, add-ons, how it works) are divided by rules, not gaps: each cell has a bottom hairline and the right-hand cell a left hairline with 40px inner padding.

Breakpoints are Tailwind defaults: sm 640, md 768, lg 1024.

## Elevation & Depth

Flat by default. Depth is drawn with strokes: a 1px hairline for ordinary panels, a 70 to 80 percent ink stroke for the featured panel (specimen frame, Diamond, prep pricing), and the heavy ink rule over data lists. Shadows are green-tinted, soft and negative-spread.

### Shadow Vocabulary
- **Hover lift** (`box-shadow: 0 16px 32px -20px oklch(0.3 0.04 165 / 0.35)`): tier panels on hover only, 200ms.
- **Floating** (`box-shadow: 0 10px 24px -8px oklch(0.3 0.06 165 / 0.45)`): the fixed mobile "Book a Restoration" bubble.
- **Dialog** (`box-shadow: 0 24px 60px -20px oklch(0.2 0.03 165 / 0.5)`): the waitlist modal.

### Named Rules
**The Stroke Not Shadow Rule.** At rest, nothing casts a shadow. Emphasis is a darker stroke; shadow is only for hover or for elements that truly float above the page.

## Shapes

Small, even corners throughout. Base radius is 6px (`--radius: 0.375rem`): panels, cards, the specimen frame and modals use it. Buttons, inputs, image thumbnails, notices and the brand mark use the slightly smaller control radius (about 5px). Tier swatches use about 3.6px. The full pill is reserved for status: slot counts, sold out, badges, the cart count and radio dots.

Images sit inside a 1px hairline ring. The hero before/after image is framed as a specimen: white panel, ink stroke, 8 to 16px inner padding, and a Clinical Green caption strip carrying an rx-label.

### Named Rules
**The Pill Is Status Rule.** A fully rounded shape means "state": count, availability, badge. Actions and containers are never pills.

## Components

### Buttons
Calm, solid and exact; they press down 1px on click (`translateY(1px)` on `:active`, globally).
- **Shape:** control radius (about 5px).
- **Primary:** Clinical Green fill, paper text, semibold 14 to 15px, 44px tall with 24px side padding (48px tall full-width on pricing panels; 36px compact in service rows). Hover drops to 90 percent green.
- **Secondary:** white or transparent, 1px ink stroke at 70 percent, ink text; hover firms the stroke to full ink and fills Muted Surface. In the nav, "My Account" uses a hairline stroke that darkens to ink/40 on hover.
- **Unavailable:** Muted Surface fill, Grey Ink text, not-allowed cursor ("Sold Out", "Currently Closed").
- **Text link action:** Clinical Green semibold with an arrow character, underline on hover.
- **Focus:** 2px Clinical Green outline, 2px offset, on every focusable element.
- **On green band (About CTA):** inverted: white fill with green text, and a white/80 outline secondary.

### Status Pills
- **Style:** Geist Mono 11px uppercase, wide tracking, pill radius, 2px x 10px.
- **States:** default Green Wash with green text; low stock (3 or fewer) red-50 with red-700 text and red-200 ring; sold out Muted Surface with Grey Ink.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** Pure Panel on Label Paper.
- **Shadow Strategy:** none at rest; hover lift on selectable tiers (see Elevation).
- **Border:** hairline; featured panels use ink at 70 percent.
- **Internal Padding:** 24px (20px top on tier panels, where the swatch and pill sit).
- Unavailable tiers drop to 70 percent opacity.

### Inputs / Fields
- **Style:** white fill, Input Stroke 1px, control radius, 44px tall, 16px text on phone (14px desktop), tabular numerals for money. Labels are rx-labels above the field.
- **Focus:** stroke turns Clinical Green with a 2px green ring at 20 percent.
- **Error:** red text and destructive stroke; amber-800 semibold for soft validation hints.

### Navigation
- 64px bar on Label Paper at 95 percent with a light backdrop blur and a hairline bottom.
- Left: 32px brand image (control radius, hairline ring) and "The Card Doc" in Archivo 800.
- Center (md+): three service tabs, 15px semibold; inactive Grey Ink, hover ink; active ink with a 2px Clinical Green underline flush to the bar bottom.
- Right: secondary links 14px Grey Ink, cart icon button with green count pill, "My Account" hairline button.
- Phone: cart and menu icon buttons (36px); the drawer lists tabs as 18px bold heading rows divided by hairlines (active tab in green), then secondary links.

### Rx Label (signature)
The system's defining pattern, used for the home service strip and echoed in every data list.
- A list with a **6px Clinical Green top band**, an **ink bottom rule** (ink at 80 percent), and **hairline rows** between items.
- Each row: a 20px green icon, the name in Title type with an rx-label code beside it, a one-line description in 14px Grey Ink, a from-price in Data mono (the amount in ink semibold), and a compact primary button aligned right (below on phone).
- Lighter variant for facts (tier panels, stats, FAQ, can/can't lists, terms grids): an ink or hairline top rule and hairline rows with an rx-label key on the left and an ink value on the right.

### FAQ Disclosure
Native details rows between hairlines under an ink rule: 15px semibold question in ink (green on hover), a green plus that rotates 45 degrees when open (200ms), answer in 15px Grey Ink at max 65ch.

### Notices
Amber notice boxes (amber-50 fill, amber-200/300 stroke, control radius, amber-900/950 text) for legal summaries, closures and the preview banner. They carry the owner's warnings; never restyle them as brand elements.

### Icons
One family: lucide-react. Pictorial icons are 16 to 20px at stroke 1.75 in Clinical Green or Grey Ink; small status marks (check, cross, plus) use 2 to 2.25. Icons sit bare beside text. No emoji as icons (glyphs like the star in "4.9★" are part of the owner's copy, not iconography).

### Motion
Apple-style, marketing pages only. Cart, checkout, order builder and account screens get no new motion. Curves: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`. Transform and opacity only.
- **Hero entrance (`.hero-in`, `.specimen-in`):** headline block rises 8px over 800ms; the specimen rises 16px from scale 0.97 over 1000ms, 120ms later. Runs once on load.
- **Rx reveal (`.rx-reveal`):** service rows and tier cards fade up 8px, 600ms, 180ms base delay + 70ms per index (`--i`).
- **Scroll reveal (`data-reveal`, `data-reveal="stagger"`):** `components/motion/reveal-observer.tsx` arms only elements below the fold at load; they rise 24px (opacity 700ms, transform 900ms) once when 12% into view. Stagger children step 60ms (capped at 12). Content is visible without JavaScript.
- **Count-up (`<CountUp value="500+" />`):** stats count from 0 over 1400ms with a quartic ease-out the first time they scroll in, always ending on the owner's exact text. Server render and reduced motion show the final text.
- **Hover (mouse only, `(hover: hover) and (pointer: fine)`):** `.lift` cards rise 3px with a green-tinted shadow (220ms); `.nudge-arrow .arrow` slides 3px (200ms); `.draw-underline` links draw a 1px underline left to right (250ms). Service rows also tint to Green Wash.
- **FAQ disclosure:** `<details>` open and close animate height over 280ms where `interpolate-size` is supported; elsewhere they snap.
- **Masked headline (`<SplitReveal/>`):** each word of the home H1 rises out of its own clip, 900ms ease-out, 90ms apart. Screen readers get the plain text.
- **Holo specimen (`<HoloSpecimen/>`, Motion):** the hero card tilts up to 9° toward a mouse pointer on critically damped springs (bounce 0, 0.4s) with a pointer-tracked holo-foil sheen (soft-light, the one sanctioned gradient: it depicts card foil). On scroll it drifts up 60px and settles to scale 0.94. Touch and reduced motion: static.
- **Marquee (`<Marquee/>`, one per page):** home testimonials loop horizontally (80s, linear), edge-faded, paused on hover/focus; reduced motion turns it into a scrollable row.
- **Spotlight (`.spotlight` + `<SpotlightTracker/>`):** tier cards show a 420px Green Wash glow under a mouse pointer; nothing at rest.
- **Step walkthrough (`<StepWalkthrough/>`, Prep page):** sticky title with the current step's large numeral; a green progress rule fills with scroll (spring 0.3s) and the step in the middle of the viewport lights up.
- **Press:** buttons translate 1px down on active.
- **Ticker:** the countdown ticker scrolls linearly over 35s.
- **Reduced motion:** entrance, ticker, lift and arrow motion are removed; scroll reveals become a 400ms opacity fade with no movement; count-up is skipped.

## Do's and Don'ts

### Do:
- **Do** keep every visible word exactly as the owner wrote it, including existing em-dashes, punctuation and the lines styled as rx-labels above headings.
- **Do** reserve Clinical Green for the label band, primary actions, focus and links.
- **Do** carry facts in hairline rows under an ink rule, with rx-label keys and ink values.
- **Do** set prices and stats in the heading face with tabular numerals, and their units in Geist Mono.
- **Do** use 6px panels and about 5px controls; use the pill only for status.
- **Do** use lucide icons at stroke 1.75, bare, in green or Grey Ink.
- **Do** mark tiers with the metal swatch and name only.
- **Do** wrap every reveal animation in the reduced-motion guard and keep content visible without it.

### Don't:
- **Don't** use gradients anywhere: no gradient heroes, fills, text or borders.
- **Don't** put icons in tinted tiles or circles; icons sit bare beside their text.
- **Don't** use emoji as icons.
- **Don't** add a dark theme or dark sections; this is a single light theme (the About CTA green band is the only full-bleed color block).
- **Don't** recolor cards per tier or introduce new accent hues.
- **Don't** add shadows at rest, glows, or colored shadows under buttons.
- **Don't** mix icon libraries.
- **Don't** add new uppercase lines above headings; the ones present are the owner's copy.
