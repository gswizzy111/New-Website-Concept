---
name: design-md
description: Library of 74 ready-made DESIGN.md design systems (colors, typography, spacing, components, do's and don'ts) analyzed from real websites such as Apple, Stripe, Linear, Vercel, Notion, Airbnb and Tesla. Use when building, restyling, or polishing any website UI or page, when the user names a site or brand whose look they want ("make it feel like Stripe"), or asks for a design system, color palette, or typography direction.
---

# DESIGN.md library

Each file in `designs/` is a complete design system for one website: YAML
front matter with design tokens (colors, typography, spacing, radii), then
sections for Overview, Colors, Typography, Layout, Elevation & Depth, Shapes,
Components, Do's and Don'ts, Responsive Behavior, Iteration Guide and Known
Gaps.

## How to use

1. **Pick a design.** If the user named a site or brand, use that file. If not,
   choose one or two from the catalog below that fit the project's audience
   and mood, and confirm the choice with the user before building a lot on it.
2. **Adopt it as the project's design system.** Copy the chosen file to
   `DESIGN.md` at the project root (or merge tokens from several into one
   `DESIGN.md` if the user wants a blend), then adapt the name, description
   and any brand-specific details so it describes *this* project.
3. **Turn tokens into code.** Map the colors, type scale, spacing and radii
   into the stack's theme (CSS custom properties, `tailwind.config`, or
   shadcn/ui theme variables) instead of hard-coding values in components.
4. **Build to the rules.** Follow the Components, Do's and Don'ts and
   Responsive Behavior sections while building. Re-read `DESIGN.md` before
   each new page or component so the site stays consistent.
5. **Check visually.** Render the page and compare it to the design's rules
   (spacing rhythm, type hierarchy, single accent color, etc.) at phone and
   desktop widths.

## Rules

- These are *inspired-by* analyses for learning and styling direction. Never
  copy another company's logo, trademarked name, product imagery or exact
  marketing copy onto the user's site, and don't make the site look like it
  *is* that company.
- Proprietary fonts named in a file (e.g. SF Pro, Söhne, custom brand faces)
  are usually not licensed for use. Substitute a close free font (Inter,
  Geist, Manrope, IBM Plex, Fraunces, etc. from Google Fonts or npm) and note
  the swap in `DESIGN.md`.
- Keep accessibility: ensure text/background contrast meets WCAG AA even when
  the source design is low-contrast.
- Only load the one or two design files you need; they are long.

## Catalog

### AI & LLM Platforms
- `designs/claude.md` — **Claude**: Anthropic's AI assistant. Warm terracotta accent, clean editorial layout
- `designs/cohere.md` — **Cohere**: Enterprise AI platform. Vibrant gradients, data-rich dashboard aesthetic
- `designs/elevenlabs.md` — **ElevenLabs**: AI voice platform. Dark cinematic UI, audio-waveform aesthetics
- `designs/minimax.md` — **Minimax**: AI model provider. Bold dark interface with neon accents
- `designs/mistral.ai.md` — **Mistral AI**: Open-weight LLM provider. French-engineered minimalism, purple-toned
- `designs/ollama.md` — **Ollama**: Run LLMs locally. Terminal-first, monochrome simplicity
- `designs/opencode.ai.md` — **OpenCode AI**: AI coding platform. Developer-centric dark theme
- `designs/replicate.md` — **Replicate**: Run ML models via API. Clean white canvas, code-forward
- `designs/runwayml.md` — **Runway**: AI creative-tools platform with an editorial film-festival aesthetic — cinematic dark heroes, paper-white reading bands, single proprietary sans, and pure black pill CTAs.
- `designs/together.ai.md` — **Together AI**: Open-source AI infrastructure. Technical, blueprint-style design
- `designs/voltagent.md` — **VoltAgent**: AI agent framework. Void-black canvas, emerald accent, terminal-native
- `designs/x.ai.md` — **xAI**: Elon Musk's AI lab. Stark monochrome, futuristic minimalism

### Developer Tools & IDEs
- `designs/cursor.md` — **Cursor**: AI-first code editor. Sleek dark interface, gradient accents
- `designs/expo.md` — **Expo**: React Native platform. Dark theme, tight letter-spacing, code-centric
- `designs/lovable.md` — **Lovable**: AI full-stack builder. Playful gradients, friendly dev aesthetic
- `designs/raycast.md` — **Raycast**: Productivity launcher. Sleek dark chrome, vibrant gradient accents
- `designs/superhuman.md` — **Superhuman**: Fast email client. Premium dark UI, keyboard-first, purple glow
- `designs/vercel.md` — **Vercel**: Frontend deployment platform. Black and white precision, Geist font
- `designs/warp.md` — **Warp**: Modern terminal. Dark IDE-like interface, block-based command UI

### Backend, Database & DevOps
- `designs/clickhouse.md` — **ClickHouse**: Fast analytics database. Yellow-accented, technical documentation style
- `designs/composio.md` — **Composio**: Tool integration platform. Modern dark with colorful integration icons
- `designs/hashicorp.md` — **HashiCorp**: Infrastructure automation. Enterprise-clean, black and white
- `designs/mongodb.md` — **MongoDB**: Document database. Green leaf branding, developer documentation focus
- `designs/posthog.md` — **PostHog**: Product analytics. Playful hedgehog branding, developer-friendly dark UI
- `designs/sanity.md` — **Sanity**: Headless content platform with a dark-first editorial marketing surface — 112px display type, IBM Plex Mono technical eyebrows, and a single coral-red accent reserved for the highest-priority CTA.
- `designs/sentry.md` — **Sentry**: Error monitoring. Dark dashboard, data-dense, pink-purple accent
- `designs/supabase.md` — **Supabase**: Open-source Firebase alternative. Dark emerald theme, code-first

### Productivity & SaaS
- `designs/slack.md` — **Slack**: Workplace messaging. Deep aubergine primary, cream-lavender hero gradients, pill CTAs
- `designs/cal.md` — **Cal.com**: Open-source scheduling. Clean neutral UI, developer-oriented simplicity
- `designs/intercom.md` — **Intercom**: Customer messaging. Friendly blue palette, conversational UI patterns
- `designs/linear.app.md` — **Linear**: Project management for engineers. Ultra-minimal, precise, purple accent
- `designs/mintlify.md` — **Mintlify**: Documentation platform. Clean, green-accented, reading-optimized
- `designs/notion.md` — **Notion**: All-in-one workspace. Warm minimalism, serif headings, soft surfaces
- `designs/resend.md` — **Resend**: Email API for developers. Minimal dark theme, monospace accents
- `designs/zapier.md` — **Zapier**: Automation platform. Warm orange, friendly illustration-driven

### Design & Creative Tools
- `designs/airtable.md` — **Airtable**: Spreadsheet-database hybrid. Colorful, friendly, structured data aesthetic
- `designs/clay.md` — **Clay**: Creative agency. Organic shapes, soft gradients, art-directed layout
- `designs/figma.md` — **Figma**: Collaborative design tool. Vibrant multi-color, playful yet professional
- `designs/framer.md` — **Framer**: Website builder. Bold black and blue, motion-first, design-forward
- `designs/miro.md` — **Miro**: Visual collaboration. Bright yellow accent, infinite canvas aesthetic
- `designs/webflow.md` — **Webflow**: Visual web builder. Blue-accented, polished marketing site aesthetic

### Fintech & Crypto
- `designs/binance.md` — **Binance**: Crypto exchange. Bold Binance Yellow on monochrome, trading-floor urgency
- `designs/coinbase.md` — **Coinbase**: Crypto exchange. Clean blue identity, trust-focused, institutional feel
- `designs/kraken.md` — **Kraken**: Crypto trading platform. Purple-accented dark UI, data-dense dashboards
- `designs/mastercard.md` — **Mastercard**: Global payments network. Warm cream canvas, orbital pill shapes, editorial warmth
- `designs/revolut.md` — **Revolut**: Digital banking. Sleek dark interface, gradient cards, fintech precision
- `designs/stripe.md` — **Stripe**: Payment infrastructure. Signature purple gradients, weight-300 elegance
- `designs/wise.md` — **Wise**: International money transfer. Bright green accent, friendly and clear

### E-commerce & Retail
- `designs/airbnb.md` — **Airbnb**: Travel marketplace. Warm coral accent, photography-driven, rounded UI
- `designs/meta.md` — **Meta**: Tech retail store. Photography-first, binary light/dark surfaces, Meta Blue CTAs
- `designs/nike.md` — **Nike**: Athletic retail. Monochrome UI, massive uppercase Futura, full-bleed photography
- `designs/shopify.md` — **Shopify**: E-commerce platform. Dark-first cinematic, neon green accent, ultra-light display type
- `designs/starbucks.md` — **Starbucks**: Coffee retail flagship. Four-tier earth-green system, warm cream canvas, proprietary SoDoSans typography

### Media & Consumer Tech
- `designs/apple.md` — **Apple**: Consumer electronics. Premium white space, SF Pro, cinematic imagery
- `designs/hp.md` — **HP**: PC and printer maker. Pure white canvas, HP Electric Blue signal CTA, geometric Forma DJR Micro, blue chevron decorations
- `designs/ibm.md` — **IBM**: Enterprise technology. Carbon design system, structured blue palette
- `designs/nvidia.md` — **NVIDIA**: GPU computing. Green-black energy, technical power aesthetic
- `designs/pinterest.md` — **Pinterest**: Visual discovery platform. Red accent, masonry grid, image-first
- `designs/playstation.md` — **PlayStation**: Gaming console retail. Three-surface channel layout, cyan hover-scale interaction
- `designs/spacex.md` — **SpaceX**: Space technology. Stark black and white, full-bleed imagery, futuristic
- `designs/spotify.md` — **Spotify**: Music streaming. Vibrant green on dark, bold type, album-art-driven
- `designs/theverge.md` — **The Verge**: Tech editorial media. Acid-mint and ultraviolet accents, Manuka display type
- `designs/uber.md` — **Uber**: Mobility platform. Bold black and white, tight type, urban energy
- `designs/vodafone.md` — **Vodafone**: Global telecom brand. Monumental uppercase display, Vodafone Red chapter bands
- `designs/wired.md` — **WIRED**: Tech magazine. Paper-white broadsheet density, custom serif, ink-blue links

### Automotive
- `designs/bmw.md` — **BMW**: Luxury automotive. Dark premium surfaces, precise German engineering aesthetic
- `designs/bmw-m.md` — **BMW M**: Performance automotive. Motorsport-inspired contrast, M color accents, precision-driven layout
- `designs/bugatti.md` — **Bugatti**: Luxury hypercar. Cinema-black canvas, monochrome austerity, monumental display type
- `designs/ferrari.md` — **Ferrari**: Luxury automotive. Chiaroscuro black-white editorial, Ferrari Red with extreme sparseness
- `designs/lamborghini.md` — **Lamborghini**: Luxury automotive. True black cathedral, gold accent, LamboType custom Neo-Grotesk
- `designs/renault.md` — **Renault**: French automotive. Vivid aurora gradients, NouvelR proprietary typeface, zero-radius buttons
- `designs/tesla.md` — **Tesla**: Electric vehicles. Radical subtraction, cinematic full-viewport photography, Universal Sans

### Retro Web · DESIGN.md Nostalgia
- `designs/dell-1996.md` — **Dell (1996)**: Catalog-era enterprise web. Literal black page frame, flat color-block "ribbon cards", chunky Helvetica-Black titles over Times Roman body, and hand-cut GIF stickers (NEW! bursts, award seals, beveled product photos).
- `designs/nintendo-2001.md` — **Nintendo.com (2001)**: Y2K "console chrome" web. Brushed-periwinkle beveled metal panels, a halftone-dotted carbon nav glowing amber, outlined Arial-Black box-art wordmarks over circuit-board hero fields, and a pixel Mario welcome bubble.

## Source

Vendored from [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
(commit f696123, MIT license, see `LICENSE`). To refresh, re-copy each
`design-md/<name>/DESIGN.md` from that repo to `designs/<name>.md`.
