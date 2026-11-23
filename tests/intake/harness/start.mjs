// Starts the fake Supabase (mock-supabase.mjs, seeded by seed.mjs) and
// `next dev` against it, with placeholder keys only. No real database, no
// real emails (Resend goes to the mock through RESEND_BASE_URL), no Stripe or
// Shippo keys that work.
//
//   node tests/intake/harness/start.mjs            start both; Ctrl+C stops both
//   node tests/intake/harness/smoke.mjs            start, smoke-test existing admin pages, stop
//
// As a library (Playwright scripts):
//   import { startHarness, loadPlaywright, newAdminContext } from "../harness/start.mjs";
//   const h = await startHarness();             // { appUrl, mockUrl, dump, reset, emails, stop }
//   const { chromium } = loadPlaywright();
//   const browser = await chromium.launch();
//   const ctx = await newAdminContext(browser, { phone: false, appUrl: h.appUrl });
//
// Env knobs: HARNESS_APP_PORT, HARNESS_MOCK_PORT (default: free ports),
// HARNESS_HTTP=1 (plain-http mock; card photo URLs then fail isOurCardPhoto,
// which requires https), HARNESS_APP_URL + HARNESS_MOCK_URL (reuse a harness
// that is already running instead of starting one).
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import https from "node:https";
import httpLib from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMock } from "./mock-supabase.mjs";
import { buildSeed, ADMIN_TOKEN } from "./seed.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const RUN_DIR = path.join(HERE, ".run"); // certs and logs (gitignored)

export { ADMIN_TOKEN };

/** A self-signed certificate for localhost (made once with openssl), so the mock can serve https. */
export function ensureCert() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const keyPath = path.join(RUN_DIR, "localhost-key.pem");
  const certPath = path.join(RUN_DIR, "localhost-cert.pem");
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "365",
      "-keyout", keyPath, "-out", certPath, "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      "-addext", "basicConstraints=critical,CA:TRUE",
    ], { stdio: "ignore" });
  }
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), certPath };
}

/** The machine's CA bundle (proxy CA included) plus our localhost certificate, for the Next.js process. */
function caBundleWith(certPath) {
  const parts = [];
  for (const f of [process.env.NODE_EXTRA_CA_CERTS, process.env.SSL_CERT_FILE, "/etc/ssl/certs/ca-certificates.crt"]) {
    if (f && fs.existsSync(f) && !parts.some((p) => p.file === f)) parts.push({ file: f, text: fs.readFileSync(f, "utf8") });
  }
  const bundle = path.join(RUN_DIR, "ca-bundle.pem");
  fs.writeFileSync(bundle, [...parts.map((p) => p.text), fs.readFileSync(certPath, "utf8")].join("\n"));
  return bundle;
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** Playwright is installed globally here (never run `playwright install`). */
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ["playwright", "/opt/node22/lib/node_modules/playwright", "/usr/local/lib/node_modules_global/playwright"];
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    tries.push(path.join(globalRoot, "playwright"));
  } catch { /* npm missing: use the fixed paths */ }
  for (const t of tries) {
    try { return require(t); } catch { /* next */ }
  }
  throw new Error("playwright not found (expected a global install; do not run `playwright install`)");
}

/**
 * A browser context signed in as the harness admin (cookie admin_session).
 * phone: true = devices['iPhone 13'], else 1440x900. deviceScaleFactor 1.
 */
export async function newAdminContext(browser, { phone = false, appUrl = process.env.HARNESS_APP_URL, ...extra } = {}) {
  const { devices } = loadPlaywright();
  const base = phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } };
  const ctx = await browser.newContext({
    ...base,
    deviceScaleFactor: 1,
    baseURL: appUrl,
    // the mock's self-signed https certificate (photos are served from it)
    ignoreHTTPSErrors: true,
    ...extra,
  });
  const host = new URL(appUrl ?? "http://localhost").hostname;
  await ctx.addCookies([{ name: "admin_session", value: ADMIN_TOKEN, domain: host, path: "/", httpOnly: true, sameSite: "Lax" }]);
  return ctx;
}

// Mock helpers for a harness already running (HARNESS_MOCK_URL) or the one startHarness() made
let current = null;
const mockUrl = () => current?.mockUrl ?? process.env.HARNESS_MOCK_URL;
/** GET/POST the mock's test endpoints (trusts the harness's own localhost certificate). */
function mockFetch(p, init = {}) {
  const u = mockUrl();
  if (!u) return Promise.reject(new Error("no harness running (call startHarness() or set HARNESS_MOCK_URL)"));
  const target = new URL(p, u);
  const lib = target.protocol === "https:" ? https : httpLib;
  const certPath = path.join(RUN_DIR, "localhost-cert.pem");
  const ca = target.protocol === "https:" && fs.existsSync(certPath) ? fs.readFileSync(certPath) : undefined;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, { method: init.method ?? "GET", ca, headers: { "content-type": "application/json" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode >= 400) return reject(new Error(`${p}: ${res.statusCode} ${text.slice(0, 200)}`));
        try { resolve(text ? JSON.parse(text) : null); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    if (init.body) req.write(typeof init.body === "string" ? init.body : JSON.stringify(init.body));
    req.end();
  });
}
/** Every table, captured emails, stored files, unknown tables/RPCs. */
export const dump = () => mockFetch("/__dump");
/** Reseed the mock (fresh fake data). */
export const reset = () => mockFetch("/__reset", { method: "POST" });
export const emails = () => mockFetch("/__emails");
/** Insert raw rows into a mock table (no defaults or constraints), for test setup. */
export const insertRows = (table, rows) => mockFetch(`/__rows/${table}`, { method: "POST", body: rows });

function waitForReady(child, logFile, timeoutMs) {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`next dev was not Ready after ${timeoutMs / 1000}s (log: ${logFile})`)), timeoutMs);
    const onData = (d) => {
      const s = d.toString();
      out += s;
      fs.appendFileSync(logFile, s);
      if (/Another .*next dev.* server is already running/i.test(out)) {
        clearTimeout(timer);
        reject(new Error(`another next dev server is already running in ${ROOT} (one per folder; stop it or set HARNESS_APP_URL/HARNESS_MOCK_URL to reuse a running harness). Log: ${logFile}`));
      } else if (/Ready in|✓ Ready/.test(out)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`next dev exited (${code}) before Ready; log: ${logFile}`)); });
  });
}

/**
 * Start mock + next dev. Returns { appUrl, mockUrl, mock, dump, reset, emails, stop }.
 * With HARNESS_APP_URL and HARNESS_MOCK_URL set, nothing is started.
 */
export async function startHarness({ appPort, mockPort, http = process.env.HARNESS_HTTP === "1", quiet = false } = {}) {
  if (process.env.HARNESS_APP_URL && process.env.HARNESS_MOCK_URL) {
    current = { appUrl: process.env.HARNESS_APP_URL, mockUrl: process.env.HARNESS_MOCK_URL, stop: async () => {} };
    return { ...current, dump, reset, emails, insertRows };
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const log = (...a) => { if (!quiet) console.log("[harness]", ...a); };
  const tls = http ? null : ensureCert();
  const mock = await startMock({ port: Number(mockPort ?? process.env.HARNESS_MOCK_PORT ?? 0), tls, seedFn: (base) => buildSeed({ baseUrl: base }), quiet: true });
  log(`mock supabase: ${mock.url}`);

  execFileSync(process.execPath, ["scripts/legal-texts.mjs"], { cwd: ROOT, stdio: quiet ? "ignore" : "inherit" });

  const port = Number(appPort ?? process.env.HARNESS_APP_PORT ?? (await freePort()));
  const appUrl = `http://localhost:${port}`;
  const logFile = path.join(RUN_DIR, `next-dev-${port}.log`);
  fs.writeFileSync(logFile, "");
  const env = {
    ...process.env,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    // placeholders only (CLAUDE.md): nothing here works against a real service
    RESEND_API_KEY: "re_placeholder",
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    SHIPPO_API_TOKEN: "shippo_test_placeholder",
    NEXT_PUBLIC_SUPABASE_URL: mock.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder-anon",
    SUPABASE_SERVICE_ROLE_KEY: "placeholder-service",
    // emails go to the mock and are kept for assertions (GET /__emails)
    RESEND_BASE_URL: `${mock.url}/__resend`,
    FROM_EMAIL: "orders@example.com",
    CONTACT_EMAIL: "harness-contact@example.com",
    ADMIN_NOTIFICATION_EMAIL: "harness-admin@example.com",
    // QR codes and links point at this local app
    NEXT_PUBLIC_APP_URL: appUrl,
    NEXT_PUBLIC_PREVIEW_MODE: "false",
    CRON_SECRET: "harness-cron-secret",
  };
  for (const k of ["NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_WEBHOOK_SECRET", "QZ_PRIVATE_KEY", "NETLIFY"]) delete env[k];
  if (tls) {
    const bundle = caBundleWith(tls.certPath);
    env.NODE_EXTRA_CA_CERTS = bundle;
    env.SSL_CERT_FILE = bundle;
  }
  const nextBin = path.join(ROOT, "node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], { cwd: ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  log(`next dev on ${appUrl} (log ${path.relative(ROOT, logFile)})`);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (child.exitCode == null) {
      const exited = new Promise((r) => child.once("exit", r));
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
      const t = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }, 5000);
      await exited;
      clearTimeout(t);
    }
    await mock.close();
    log("stopped");
  };
  const onSignal = () => { stop().finally(() => process.exit(130)); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.once("exit", () => { if (child.exitCode == null) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } } });

  try {
    await waitForReady(child, logFile, 180_000);
  } catch (e) {
    await stop();
    throw e;
  }
  // after Ready, keep logging
  child.stdout.on("data", (d) => fs.appendFileSync(logFile, d));
  child.stderr.on("data", (d) => fs.appendFileSync(logFile, d));
  log("ready");
  current = { appUrl, mockUrl: mock.url, mock, logFile, stop };
  process.env.HARNESS_APP_URL ??= appUrl;
  process.env.HARNESS_MOCK_URL ??= mock.url;
  return { ...current, dump, reset, emails, insertRows };
}

/** Server errors logged by next dev since a byte offset of its log (for "no server errors" checks). */
export function serverErrorsSince(offset = 0) {
  if (!current?.logFile) return { offset: 0, errors: [] };
  const text = fs.readFileSync(current.logFile, "utf8");
  const chunk = text.slice(offset);
  const errors = chunk.split("\n").filter((l) => /(⨯|Error:|TypeError|ReferenceError|Unhandled|PGRST|mock crashed)/.test(l) && !/RESEND_API_KEY is not set/.test(l));
  return { offset: text.length, errors };
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // (Smoke test and scenarios import this file, so they run as their own scripts:
  // node tests/intake/harness/smoke.mjs, node tests/intake/e2e/scenarios.mjs.)
  const h = await startHarness();
  console.log(`\n  App:    ${h.appUrl}/admin   (cookie admin_session=${ADMIN_TOKEN})\n  Mock:   ${h.mockUrl}/__dump\n  Ctrl+C stops both.\n`);
  console.log(`  Reuse from another shell:\n    HARNESS_APP_URL=${h.appUrl} HARNESS_MOCK_URL=${h.mockUrl} node tests/intake/e2e/scenarios.mjs\n`);
}
