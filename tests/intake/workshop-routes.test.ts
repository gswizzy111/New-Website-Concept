/**
 * Default deny for workshop logins, checked against the code itself: walks
 * every page (page.tsx) under app/admin and every route handler (route.ts)
 * under app/api/admin, works out the addresses it serves, and asks the
 * allowlist (lib/workshop-access.ts) about each one (each method, for APIs).
 *
 * - Allowlisted: the page or handler must use a check that lets workshop
 *   logins in (requireAdminOrWorkshop, adminOrWorkshopActor, staffActor,
 *   trackStaff, isAdminOrWorkshop), or a worker would be refused anyway.
 * - Not allowlisted: the page or handler must use a check that refuses them
 *   (requireAdmin, isAdmin, adminName, trackAdmin, teamAdmin, a role ===
 *   "admin" test ...) and none that lets them in. So a new admin page or
 *   route is closed to workers until someone opens it in the allowlist on
 *   purpose, and the middleware is never the only thing in the way.
 *
 * Also pins the exact list of files open to workers, so widening it is a
 * deliberate change here too. Reads files only: no Next.js, no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { isWorkshopApi, isWorkshopPage, WORKSHOP_NOT_AVAILABLE_PATH } from "@/lib/workshop-access";

const ROOT = process.cwd();
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

// Checks that let a workshop login in (only for allowlisted pages and routes)
const WORKSHOP_GUARDS = ["requireAdminOrWorkshop(", "adminOrWorkshopActor(", "staffActor(", "trackStaff(", "isAdminOrWorkshop("];
// Checks that refuse a workshop login (full admins, or admins and support / accountants)
const REFUSING_GUARDS = [
  "requireAdmin(", "isAdmin(", "requireAdminOrSupport(", "isAdminOrSupport(", "requireAdminOrAccountant(",
  "adminName(", "trackAdmin(", "teamAdmin(", "getRealAdminSession(",
];
// getAdminSession()/getAdminRole() count only with an explicit role test next to them
const ROLE_TESTS = [/role\s*!==\s*"admin"/, /role\s*===\s*"admin"/, /role\s*!==\s*"support"/];

// Public by design: signing in and password recovery
const AUTH_PAGES = new Set(["/admin/login", "/admin/forgot-password", "/admin/reset-password"]);
const AUTH_ROUTES = new Set(["/api/admin/login", "/api/admin/logout", "/api/admin/forgot-password", "/api/admin/reset-password"]);

function walk(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // _private folders are not routes in the App Router
      if (!entry.startsWith("_")) out.push(...walk(full, name));
    } else if (entry === name) {
      out.push(full);
    }
  }
  return out;
}

/** The route pattern a file serves: /admin/receiving/[orderId] (route groups dropped). */
function routeOf(file: string): string {
  const rel = path.relative(path.join(ROOT, "app"), path.dirname(file)).split(path.sep);
  return "/" + rel.filter((s) => !(s.startsWith("(") && s.endsWith(")"))).join("/");
}

// Sample values for dynamic segments: an id is a UUID, anything else a code
const UUID = "00000000-0000-4000-8000-00000000c001";
const SAMPLES: Record<string, string[]> = { id: [UUID], code: ["CD-2549-P", "LOC-CLAMP-07"] };

/** Concrete addresses for a pattern (each dynamic segment tried with a UUID and a code). */
function addresses(pattern: string): string[] {
  let paths = [""];
  for (const seg of pattern.split("/").slice(1)) {
    const dyn = /^\[(\.\.\.)?([^\]]+)\]$/.exec(seg);
    const values = dyn ? (/id$/i.test(dyn[2]) ? [...SAMPLES.id, ...SAMPLES.code] : [...SAMPLES.code, ...SAMPLES.id]) : [seg];
    paths = paths.flatMap((p) => values.map((v) => `${p}/${v}`));
  }
  return paths;
}

const read = (file: string) => readFileSync(file, "utf8");

/** Function bodies by name in a file (function declarations and const arrows), roughly. */
function localFunctions(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(|const\s+([A-Za-z0-9_]+)\s*=\s*(?:cache\()?(?:async\s*)?\(/g;
  const starts: { name: string; at: number }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1] ?? m[2], at: m.index });
  starts.forEach((s, i) => out.set(s.name, src.slice(s.at, starts[i + 1]?.at ?? src.length)));
  return out;
}

/** The exported handlers of a route file and their bodies. */
function handlers(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+(${METHODS.join("|")})\\b|export\\s+const\\s+(${METHODS.join("|")})\\b`, "g");
  const starts: { method: string; at: number }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ method: m[1] ?? m[2], at: m.index });
  starts.forEach((s, i) => {
    const next = src.indexOf("\nexport ", s.at + 1);
    out.set(s.method, src.slice(s.at, next > 0 ? next : starts[i + 1]?.at ?? src.length));
  });
  // `export { GET as HEAD }` style re-exports share the body
  const alias = /export\s*\{\s*([A-Z]+)\s+as\s+([A-Z]+)\s*\}/g;
  for (let m = alias.exec(src); m; m = alias.exec(src)) if (out.has(m[1])) out.set(m[2], out.get(m[1])!);
  return out;
}

/** A body plus the bodies of the same-file helpers it calls (one level). */
function withHelpers(body: string, src: string): string {
  const fns = localFunctions(src);
  let text = body;
  for (const [name, fnBody] of fns) if (fnBody !== body && new RegExp(`\\b${name}\\(`).test(body)) text += "\n" + fnBody;
  return text;
}

function lets(text: string) {
  return WORKSHOP_GUARDS.some((g) => text.includes(g));
}

function refuses(text: string) {
  if (REFUSING_GUARDS.some((g) => text.includes(g))) return true;
  return /getAdminSession\(|getAdminRole\(/.test(text) && ROLE_TESTS.some((re) => re.test(text));
}

// ── Pages ────────────────────────────────────────────────────────────────────
const pageFiles = walk(path.join(ROOT, "app", "admin"), "page.tsx");

/** Layouts above a page (inside app/admin, not app/admin/layout.tsx itself) that check the role. */
function guardingLayouts(file: string): string {
  let dir = path.dirname(file);
  let text = "";
  const top = path.join(ROOT, "app", "admin");
  while (dir.startsWith(top) && dir !== top) {
    const layout = path.join(dir, "layout.tsx");
    if (existsSync(layout)) text += "\n" + read(layout);
    dir = path.dirname(dir);
  }
  return text;
}

const EXPECTED_WORKSHOP_PAGES = [
  "/admin/not-available",
  "/admin/receiving",
  "/admin/receiving/[orderId]",
  "/admin/receiving/[orderId]/photos",
  "/admin/receiving/bag/[bagId]",
  "/admin/receiving/bags",
  "/admin/receiving/card/[cardId]",
  "/admin/receiving/desk",
  "/admin/receiving/open/[code]",
  "/admin/receiving/printing",
  "/admin/scan",
];

test("there are admin pages to check", () => {
  assert.ok(pageFiles.length > 40, `found ${pageFiles.length}`);
});

test("exactly the expected admin pages are open to workshop logins", () => {
  const open = pageFiles.map((f) => routeOf(f)).filter((r) => addresses(r).some(isWorkshopPage)).sort();
  assert.deepEqual(open, EXPECTED_WORKSHOP_PAGES);
});

for (const file of pageFiles) {
  const route = routeOf(file);
  const rel = path.relative(ROOT, file);
  if (AUTH_PAGES.has(route)) continue;
  const open = addresses(route).some(isWorkshopPage);
  test(`page ${route}: ${open ? "open to workshop logins, and lets them in" : "closed to workshop logins, and refuses them itself"}`, () => {
    const src = read(file);
    if (route === WORKSHOP_NOT_AVAILABLE_PATH) {
      // Shows nothing but the way back, to anyone signed in
      assert.match(src, /getAdminSession\(\)/, rel);
      return;
    }
    if (open) {
      assert.ok(lets(src), `${rel} is allowlisted but doesn't let workshop logins in (requireAdminOrWorkshop)`);
      assert.ok(!src.includes("requireAdmin()"), `${rel} is allowlisted but still calls requireAdmin()`);
    } else {
      const text = src + guardingLayouts(file);
      assert.ok(!lets(text), `${rel} lets workshop logins in but isn't in WORKSHOP_PAGES`);
      assert.ok(refuses(text), `${rel} has no check that refuses workshop logins (requireAdmin / isAdmin, here or in a layout)`);
    }
  });
}

// ── API routes ───────────────────────────────────────────────────────────────
const routeFiles = walk(path.join(ROOT, "app", "api", "admin"), "route.ts");

const EXPECTED_WORKSHOP_APIS = [
  "GET /api/admin/intake/labels/bag/[bagId]",
  "GET /api/admin/intake/labels/order/[orderId]",
  "GET /api/admin/intake/orders/[orderId]/prepare-labels",
  "GET /api/admin/intake/settings",
  "GET /api/admin/qz-cert",
  "GET /api/admin/track/locations",
  "GET /api/admin/track/locations/labels",
  "GET /api/admin/track/resolve",
  "GET /api/admin/track/search",
  "PATCH /api/admin/cards/[id]/tier",
  "POST /api/admin/intake/cards/[id]/photos",
  "POST /api/admin/intake/labels/printed",
  "POST /api/admin/intake/orders/[orderId]/add-card",
  "POST /api/admin/intake/orders/[orderId]/prepare-labels",
  "POST /api/admin/intake/orders/[orderId]/receive",
  "POST /api/admin/intake/orders/[orderId]/unreceive",
  "POST /api/admin/intake/stages",
  "POST /api/admin/qz-sign",
  "POST /api/admin/track/assign",
  "POST /api/admin/track/bag-ready",
  "POST /api/admin/track/done",
  "POST /api/admin/track/move",
  "POST /api/admin/track/release",
];

test("there are admin API routes to check", () => {
  assert.ok(routeFiles.length > 100, `found ${routeFiles.length}`);
});

test("exactly the expected admin API handlers are open to workshop logins", () => {
  const open: string[] = [];
  for (const file of routeFiles) {
    const route = routeOf(file);
    for (const method of handlers(read(file)).keys()) {
      if (addresses(route).some((a) => isWorkshopApi(a, method))) open.push(`${method} ${route}`);
    }
  }
  assert.deepEqual(open.sort(), EXPECTED_WORKSHOP_APIS);
});

for (const file of routeFiles) {
  const route = routeOf(file);
  const rel = path.relative(ROOT, file);
  if (AUTH_ROUTES.has(route)) continue;
  const src = read(file);
  const hs = handlers(src);
  test(`api ${route}: every handler is allowlisted and lets workers in, or refuses them itself`, () => {
    assert.ok(hs.size > 0, `${rel} exports no handler the test can read`);
    for (const [method, body] of hs) {
      const text = withHelpers(body, src);
      const open = addresses(route).some((a) => isWorkshopApi(a, method));
      if (open) {
        assert.ok(lets(text), `${method} ${rel} is allowlisted but doesn't let workshop logins in`);
      } else {
        assert.ok(!lets(text), `${method} ${rel} lets workshop logins in but isn't in WORKSHOP_APIS`);
        assert.ok(refuses(text), `${method} ${rel} has no check that refuses workshop logins (isAdmin, requireAdmin, ...)`);
        assert.ok(!/"workshop"/.test(text), `${method} ${rel} mentions the workshop role but isn't in WORKSHOP_APIS`);
      }
    }
  });
}

// ── Server actions ───────────────────────────────────────────────────────────
test("every admin server action refuses workshop logins itself", () => {
  const actions: string[] = [];
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) scan(full);
      else if (/\.(ts|tsx)$/.test(entry) && /^["']use server["']/m.test(read(full))) actions.push(full);
    }
  };
  scan(path.join(ROOT, "app", "admin"));
  assert.ok(actions.length > 0);
  for (const file of actions) {
    const src = read(file);
    const exported = [...src.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const fns = localFunctions(src);
    for (const name of exported) {
      const body = fns.get(name) ?? "";
      assert.ok(refuses(body) && !lets(body), `${path.relative(ROOT, file)} ${name}() must check for a full admin itself`);
    }
  }
});

// ── The checks themselves ────────────────────────────────────────────────────
function fnBody(file: string, name: string): string {
  const body = localFunctions(read(path.join(ROOT, file))).get(name);
  assert.ok(body, `${name} not found in ${file}`);
  return body!;
}

test("the refusing checks only let full admins in", () => {
  assert.match(fnBody("lib/admin-auth.ts", "isAdmin"), /===\s*"admin"/);
  assert.match(fnBody("lib/admin-auth.ts", "requireAdmin"), /refuseWorkshop\(role\)/);
  assert.match(fnBody("lib/admin-auth.ts", "refuseWorkshop"), /role === "workshop"\) redirect\(WORKSHOP_NOT_AVAILABLE_PATH\)/);
  assert.match(fnBody("lib/admin-auth.ts", "requireAdminOrSupport"), /refuseWorkshop\(role\)/);
  assert.match(fnBody("lib/admin-auth.ts", "requireAdminOrAccountant"), /refuseWorkshop\(role\)/);
  assert.match(fnBody("lib/intake/tracking/http.ts", "trackAdmin"), /session\?\.role !== "admin"/);
  assert.match(fnBody("app/api/admin/intake/orders/guard.ts", "adminName"), /session\?\.role !== "admin"/);
  assert.match(fnBody("app/api/admin/team/_lib/http.ts", "teamAdmin"), /session\?\.role !== "admin"/);
  const isAdminOrSupport = fnBody("lib/admin-auth.ts", "isAdminOrSupport");
  assert.ok(!isAdminOrSupport.includes("workshop"));
});

test("the workshop checks let in full admins and workshop logins only", () => {
  const actor = fnBody("lib/admin-auth.ts", "adminOrWorkshopActor");
  assert.match(actor, /session\?\.role !== "admin" && session\?\.role !== "workshop"\) return null/);
  assert.match(fnBody("lib/admin-auth.ts", "requireAdminOrWorkshop"), /role === "admin" \|\| role === "workshop"/);
  assert.match(fnBody("lib/intake/tracking/http.ts", "trackStaff"), /adminOrWorkshopActor\(\)/);
  assert.match(fnBody("app/api/admin/intake/orders/guard.ts", "staffActor"), /adminOrWorkshopActor\(\)/);
});

test("the middleware gates workshop sessions with the allowlist", () => {
  const mw = read(path.join(ROOT, "middleware.ts"));
  assert.match(mw, /isWorkshopSession\s*=\s*adminSession\?\.role === "workshop"/);
  assert.match(mw, /if \(isWorkshopSession\) \{\s*const verdict = workshopGate\(pathname, request\.method\)/);
  assert.match(mw, /verdict === "deny-api"[\s\S]{0,200}status: 403/);
  assert.match(mw, /verdict === "deny-page"\) return NextResponse\.rewrite\(new URL\(WORKSHOP_NOT_AVAILABLE_PATH/);
  // A workshop session gets past the signed-out gate only because the role is listed on purpose
  assert.match(mw, /isAdminSession = isFullAdmin \|\| isAccountantSession \|\| isSupportSession \|\| isWorkshopSession/);
});

test("a scanned QR code opens only for full admins and workshop logins", () => {
  const q = read(path.join(ROOT, "app", "q", "[code]", "route.ts"));
  assert.match(q, /session\?\.role !== "admin" && session\?\.role !== "workshop"\) return redirect\(request, `\/admin\/login/);
});
