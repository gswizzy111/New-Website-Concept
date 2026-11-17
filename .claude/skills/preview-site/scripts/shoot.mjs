#!/usr/bin/env node
// Screenshot pages of the local dev server. See ../SKILL.md.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const valued = new Set(['--scroll', '--dpr', '--hover', '--base', '--only']);
const paths = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
if (!paths.length) paths.push('/');

const base = val('--base', process.env.BASE_URL || 'http://localhost:3000');
const out = process.env.OUT_DIR || '/tmp/site-shots';
const dpr = Number(val('--dpr', 1));
const scrollFrames = Number(val('--scroll', 0));
const hover = val('--hover');
const only = val('--only'); // desktop | mobile
mkdirSync(out, { recursive: true });

const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const browser = await chromium.launch();
const errors = [];

for (const p of paths) {
  for (const [vname, viewport] of Object.entries(viewports)) {
    if (only && only !== vname) continue;
    const slug = (p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').replace(/\//g, '_')) + '-' + vname
      + (flag('--reduced-motion') ? '-reduced' : '');
    const ctx = await browser.newContext({
      viewport, deviceScaleFactor: dpr,
      isMobile: vname === 'mobile', hasTouch: vname === 'mobile',
      reducedMotion: flag('--reduced-motion') ? 'reduce' : 'no-preference',
      ...(flag('--video') ? { recordVideo: { dir: out, size: viewport } } : {}),
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${slug}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${slug} console: ${m.text()}`));
    await page.goto(base + p, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(1200);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 1) errors.push(`${slug}: page is ${overflow}px wider than the viewport (horizontal scroll)`);

    if (hover) { await page.hover(hover); await page.waitForTimeout(400); }

    if (scrollFrames > 0 || flag('--video')) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const n = scrollFrames || 12;
      for (let i = 0; i <= n; i++) {
        await page.mouse.wheel(0, 0);
        await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), Math.round((height * i) / n));
        await page.waitForTimeout(flag('--video') ? 700 : 500);
        if (scrollFrames) {
          const f = join(out, `${slug}-scroll${String(i).padStart(2, '0')}.png`);
          await page.screenshot({ path: f }); console.log(f);
        }
      }
    } else {
      const f = join(out, `${slug}${flag('--full') ? '-full' : ''}.png`);
      await page.screenshot({ path: f, fullPage: flag('--full') }); console.log(f);
    }
    const video = page.video();
    await ctx.close();
    if (video) console.log(await video.path());
  }
}
await browser.close();
console.log(errors.length ? 'PROBLEMS:\n' + errors.join('\n') : 'no page errors');
