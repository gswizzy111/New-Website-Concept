---
version: 1
slug: "app-public-page-tsx"
primary_target: "app/(public)/page.tsx"
related_targets: ["app/(public)/tier-selection/page.tsx","app/(public)/prep/page.tsx","app/(public)/shop/page.tsx"]
---

# Public site (The Card Doc)

Scope: all public routes under app/(public) plus shared marketing and
order-builder components. Mode: Persuade (home, tiers, prep, shop), Operate
(cart, checkout, order builder, track, account). Redesign of appearance only;
copy, prices, routes and behavior are fixed (owner's instruction).

Audience: first-time visitors from TikTok/IG/YouTube/Facebook, on a phone,
deciding whether to trust The Card Doc with a card. Action: pick Restoration,
Prep or Kits and order.

## Direction contract

THESIS: The site is a clean clinic's prescription label: every service is
dispensed like an Rx, with precise, structured facts. It refuses the
category default of a blue gradient hero with three equal emoji cards and
a rainbow of tier colors.

OWN-WORLD: White label paper (#fbfcfb) and pure panels, deep clinical ink
(green-black), one committed clinical green used for the label band, primary
actions and focus. Hairline rules (1px) divide data rows like a pharmacy
label; labels in a monospace data face, headings in a tight grotesque
(Archivo, width axis). Small radius (6px) everywhere, pill only for status.
No gradients, no emoji, no glow; shadows only as a faint lift on hover.
Tier identity by a small metal swatch and name, not by recoloring the card.

STORY: Visitor sees what The Card Doc does in one glance (three services,
starting prices), sees real before/after proof and real customer messages,
understands the honest terms, then picks a service. Ordering screens stay
calm and familiar.

FIRST VIEWPORT (home, desktop): left, compact brand mark and the existing
headline "The Card Doc" at display scale with the existing subline; right,
the before/after hero image framed as a specimen with a label strip. Below
the fold line, the three services as one Rx-label strip (three columns
divided by hairlines, each: label code, name, line, from-price, action) not
three floating cards. Primary action: View Tiers. Phone: headline, subline,
image, then the service strip stacked.

FORM: Prescription label / pharmacy dispensing system; user-pinned "clean
clinic" direction, grounded list position 6; seed key 28b254c6 (degraded
roll, no challengers). Code-led build (no image generation available).
Signature interaction: tier "label" rows reveal with a short stagger;
buttons press 1px; everything static under reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
