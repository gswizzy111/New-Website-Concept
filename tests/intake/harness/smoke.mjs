// Smoke test: the harness renders EXISTING admin pages, signed in, with no
// server or browser errors. Desktop (1440x900) and phone (iPhone 13).
//   node tests/intake/harness/smoke.mjs
//   (or, against a running harness) HARNESS_APP_URL=… HARNESS_MOCK_URL=… node tests/intake/harness/smoke.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPlaywright, newAdminContext, serverErrorsSince, startHarness } from "./start.mjs";
import { IDS, ORDER_NUMBERS } from "./seed.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../e2e/out");

export const SMOKE_PAGES = [
  { name: "dashboard", url: "/admin", expect: ORDER_NUMBERS.mailOrder },
  { name: "dashboard-awaiting", url: "/admin?tab=awaiting", expect: ORDER_NUMBERS.mailOrder },
  { name: "dashboard-fulfillment", url: "/admin?tab=fulfillment", expect: ORDER_NUMBERS.inProgressOrder },
  { name: "order-mail-in", url: `/admin/orders/${IDS.mailOrder}`, expect: ORDER_NUMBERS.mailOrder },
  { name: "order-in-progress", url: `/admin/orders/${IDS.inProgressOrder}`, expect: ORDER_NUMBERS.inProgressOrder },
  { name: "order-delivered", url: `/admin/orders/${IDS.deliveredOrder}`, expect: ORDER_NUMBERS.deliveredOrder },
  { name: "show-dropoffs", url: "/admin/show-dropoffs?filter=all", expect: "Test Customer F" },
];

// Browser console noise that says nothing about the page
// (QZ Tray: the order page looks for the print helper on this machine's ports 8181-8485; there is none here.)
const IGNORE_CONSOLE = [/WebSocket connection to 'wss?:\/\/localhost(\.qz\.io)?:\d+\/' failed/i, /qz/i, /favicon/i, /Download the React DevTools/i, /\[HMR\]/, /\[Fast Refresh\]/, /maps\.googleapis/i, /googletagmanager|facebook/i];

export async function runSmoke(h, { pages = SMOKE_PAGES } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const phone of [false, true]) {
      const ctx = await newAdminContext(browser, { phone, appUrl: h.appUrl });
      const page = await ctx.newPage();
      for (const p of pages) {
        const label = `${p.name} (${phone ? "phone" : "desktop"})`;
        const pageErrors = [];
        const consoleErrors = [];
        const onPageError = (e) => pageErrors.push(e.message);
        const onConsole = (m) => { if (m.type() === "error" && !IGNORE_CONSOLE.some((re) => re.test(m.text()))) consoleErrors.push(m.text().slice(0, 300)); };
        page.on("pageerror", onPageError);
        page.on("console", onConsole);
        const before = serverErrorsSince(0).offset;
        const problems = [];
        let status = 0;
        try {
          const res = await page.goto(p.url, { waitUntil: "load", timeout: 240_000 });
          status = res?.status() ?? 0;
          await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
          const finalPath = new URL(page.url()).pathname;
          if (finalPath.startsWith("/admin/login")) problems.push("redirected to /admin/login (cookie/session not accepted)");
          if (status >= 400) problems.push(`HTTP ${status}`);
          const text = await page.locator("body").innerText();
          if (p.expect && !text.includes(p.expect)) problems.push(`"${p.expect}" not on the page`);
          if (/Unhandled Runtime Error|Application error|Internal Server Error/i.test(text)) problems.push("error page text");
          await page.screenshot({ path: path.join(OUT, `smoke-${p.name}-${phone ? "phone" : "desktop"}.png`), fullPage: !phone });
        } catch (e) {
          problems.push(`navigation failed: ${e.message.split("\n")[0]}`);
        }
        const server = serverErrorsSince(before).errors;
        if (server.length) problems.push(`server log: ${server.slice(0, 3).join(" | ").slice(0, 400)}`);
        if (pageErrors.length) problems.push(`page errors: ${pageErrors.slice(0, 3).join(" | ").slice(0, 300)}`);
        if (consoleErrors.length) problems.push(`console errors: ${consoleErrors.slice(0, 3).join(" | ").slice(0, 300)}`);
        page.off("pageerror", onPageError);
        page.off("console", onConsole);
        results.push({ label, status, ok: problems.length === 0, problems });
        console.log(`${problems.length ? "FAIL" : "PASS"}  ${label}  HTTP ${status}${problems.length ? "\n        - " + problems.join("\n        - ") : ""}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  const dump = await h.dump();
  if (dump.unknown.tables.length || dump.unknown.rpcs.length) {
    console.log(`note: tables/relations the seed doesn't model (answered with no rows): ${dump.unknown.tables.join(", ") || "none"}; unknown RPCs: ${dump.unknown.rpcs.join(", ") || "none"}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nsmoke: ${results.length - failed}/${results.length} passed. Screenshots: ${path.relative(process.cwd(), OUT)}/smoke-*.png`);
  return failed === 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const h = await startHarness();
  const ok = await runSmoke(h);
  await h.stop();
  process.exit(ok ? 0 : 1);
}
