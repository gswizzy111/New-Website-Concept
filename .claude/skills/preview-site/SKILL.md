---
name: preview-site
description: Start this site locally in preview mode and look at it - screenshots of any page at desktop and phone widths, full-page captures, scroll-through frame strips and short videos to check motion, plus a reduced-motion pass. Use whenever you change anything visual (layout, colors, graphics, animation) and need to see the result, when asked to "show me", "screenshot", "how does it look", or before saying a design change is done.
---

# Preview the site

You can't judge a design change from code. Run the site, look at it, then say it's done.

## 1. Start it (no keys needed)

```bash
npm ci                     # only if node_modules is missing
NEXT_PUBLIC_PREVIEW_MODE=true nohup npx next dev -p 3000 > /tmp/next-dev.log 2>&1 &
```

Run it in the background, then wait until `curl -s -o /dev/null -w '%{http_code}' localhost:3000/` answers 200.
The first request to each page compiles it (5-10 s), later ones are fast.

Preview mode needs no environment variables: checkout, accounts and `/api/*` are switched off
(`lib/preview.ts`, `middleware.ts`) and pages render without Supabase data. That's all you need for
visual work. Don't create a `.env` with real keys for this.

Pages worth checking: `/`, `/services`, `/about`, `/order`, plus anything you touched (`find app -name page.tsx`).

## 2. Look at it

`scripts/shoot.mjs` drives the preinstalled Chromium (`require('playwright')`, no install needed):

```bash
node .claude/skills/preview-site/scripts/shoot.mjs / /services          # desktop 1440x900 + phone 390x844
node .claude/skills/preview-site/scripts/shoot.mjs / --full             # whole page, top to bottom
node .claude/skills/preview-site/scripts/shoot.mjs / --scroll 6         # 6 frames while scrolling: scroll-linked motion
node .claude/skills/preview-site/scripts/shoot.mjs / --video            # .webm of a slow scroll (motion timing)
node .claude/skills/preview-site/scripts/shoot.mjs / --reduced-motion   # what reduced-motion users get
node .claude/skills/preview-site/scripts/shoot.mjs / --hover "a.btn"    # hover state of an element
```

Output goes to `$OUT_DIR` (default `/tmp/site-shots`); the script prints each file path and any page errors.
Open the PNGs with the Read tool and actually look: alignment, overflow at phone width, contrast,
whether the graphic reads at a glance. Videos you can't watch: for motion, use `--scroll` frames.

Screenshots are taken at deviceScaleFactor 1 for your own checks. For an image the user will see,
pass `--dpr 2` and send it with SendUserFile.

## 3. Before calling a visual change done

- Desktop and phone both checked, no horizontal scroll on phone.
- No new console/page errors in the script output.
- Motion checked with `--scroll` and with `--reduced-motion` (it must still look finished, not blank).
- For a deeper audit use `impeccable`, `review-animations` or `web-design-guidelines`.

Stop the server when finished: `pkill -f "next dev"`.
