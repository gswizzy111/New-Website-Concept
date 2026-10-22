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
  the page. The live Stripe webhook runs on the old site and serves both.
- **Preview mode** (`NEXT_PUBLIC_PREVIEW_MODE=true`) is on for branch deploys
  and deploy previews only (`netlify.toml`). It runs the site without
  checkout or accounts: `/api/*` returns "not functional yet" and private
  areas show `/not-available`. Supabase is read-only: reads show real data,
  every write is refused in `lib/preview.ts`. See `lib/preview.ts` and
  `middleware.ts`.
- **Daily jobs** run as Netlify scheduled functions in `netlify/functions/`,
  which call `/api/cron/*` with `CRON_SECRET`.

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
