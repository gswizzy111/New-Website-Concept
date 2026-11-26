/**
 * The workshop login allowlist (lib/workshop-access.ts): what a worker may
 * open is exactly the Scan page, the Desk and Receiving & labels; every
 * other admin page shows "Not available for workshop logins" and every other
 * admin API answers 403. Pure: no Next.js, no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORKSHOP_APIS,
  WORKSHOP_HOME,
  WORKSHOP_NAV_ITEMS,
  WORKSHOP_NOT_AVAILABLE_PATH,
  WORKSHOP_PAGES,
  isWorkshopApi,
  isWorkshopPage,
  workshopGate,
  workshopLanding,
} from "@/lib/workshop-access";

const ORDER = "4f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const CARD = "00000000-0000-4000-8000-00000000c001";
const BAG = "00000000-0000-4000-8000-00000000b001";

test("the worker's pages are open", () => {
  for (const p of [
    "/admin/scan",
    "/admin/receiving",
    `/admin/receiving/${ORDER}`,
    `/admin/receiving/${ORDER.toUpperCase()}`,
    `/admin/receiving/${ORDER}/photos`,
    "/admin/receiving/open/CD-2549-P",
    "/admin/receiving/open/CD-2549",
    `/admin/receiving/card/${CARD}`,
    `/admin/receiving/bag/${BAG}`,
    "/admin/receiving/bags",
    "/admin/receiving/desk",
    "/admin/receiving/printing",
    WORKSHOP_NOT_AVAILABLE_PATH,
  ]) {
    assert.equal(isWorkshopPage(p), true, p);
    assert.equal(workshopGate(p, "GET"), "allow", p);
  }
});

test("every other admin page is not available to a worker", () => {
  for (const p of [
    "/admin/orders/" + ORDER,
    "/admin/orders/new",
    "/admin/receiving/settings",
    "/admin/receiving/setup",
    "/admin/receiving/locations",
    "/admin/receiving/shelf",
    "/admin/receiving/completed",
    "/admin/receiving/forgotten",
    `/admin/receiving/ship/${ORDER}`,
    "/admin/receiving/not-a-uuid",
    `/admin/receiving/${ORDER}/photos/extra`,
    `/admin/receiving/${ORDER}x`,
    "/admin/receiving/card/CD-2549-03",
    "/admin/receiving/open/a/b",
    "/admin/receiving/open/",
    "/admin/scan/",
    "/admin/Scan",
    "/admin/scan/..",
    "/admin/scan%2F..%2Forders",
    "/admin/team",
    "/admin/team/activity",
    "/admin/profile",
    "/admin/tax",
    "/admin/customers",
    "/admin/support",
    "/admin/support-team",
    "/admin/accountant",
    "/admin/store-settings",
    "/admin/profit-loss",
    "/admin/sales-statement",
    "/admin/email-blast",
    "/admin/ship-queue",
    "/admin/shop-orders",
    "/admin/gift-cards",
    "/admin/backlog",
    "/admin/incoming",
    "/admin/unclaimed",
    "/admin/cases",
    "/admin/email-problems",
  ]) {
    assert.equal(isWorkshopPage(p), false, p);
    assert.equal(workshopGate(p, "GET"), "deny-page", p);
  }
});

test("/admin itself (Orders) sends a worker to the Scan page", () => {
  assert.equal(workshopGate("/admin", "GET"), "home");
  assert.equal(WORKSHOP_HOME, "/admin/scan");
});

test("signing in, out and password recovery stay open", () => {
  for (const p of ["/admin/login", "/admin/forgot-password", "/admin/reset-password", "/admin/reset-password/x"]) {
    assert.equal(workshopGate(p, "GET"), "allow", p);
  }
  for (const p of ["/api/admin/login", "/api/admin/logout", "/api/admin/forgot-password", "/api/admin/reset-password"]) {
    assert.equal(workshopGate(p, "POST"), "allow", p);
  }
});

test("the worker's APIs are open with their methods only", () => {
  const allowed: [string, string][] = [
    ["GET", "/api/admin/track/resolve"],
    ["GET", "/api/admin/track/search"],
    ["HEAD", "/api/admin/track/search"],
    ["POST", "/api/admin/track/assign"],
    ["POST", "/api/admin/track/move"],
    ["POST", "/api/admin/track/done"],
    ["POST", "/api/admin/track/release"],
    ["POST", "/api/admin/track/bag-ready"],
    ["GET", "/api/admin/track/locations"],
    ["GET", "/api/admin/track/locations/labels"],
    ["POST", `/api/admin/intake/orders/${ORDER}/receive`],
    ["POST", `/api/admin/intake/orders/${ORDER}/unreceive`],
    ["POST", `/api/admin/intake/orders/${ORDER}/add-card`],
    ["GET", `/api/admin/intake/orders/${ORDER}/prepare-labels`],
    ["POST", `/api/admin/intake/orders/${ORDER}/prepare-labels`],
    ["POST", `/api/admin/intake/cards/${CARD}/photos`],
    ["GET", `/api/admin/intake/labels/order/${ORDER}`],
    ["GET", `/api/admin/intake/labels/bag/${BAG}`],
    ["POST", "/api/admin/intake/labels/printed"],
    ["POST", "/api/admin/intake/stages"],
    ["GET", "/api/admin/intake/settings"],
    ["PATCH", `/api/admin/cards/${CARD}/tier`],
    ["GET", "/api/admin/qz-cert"],
    ["POST", "/api/admin/qz-sign"],
  ];
  for (const [method, p] of allowed) {
    assert.equal(isWorkshopApi(p, method), true, `${method} ${p}`);
    assert.equal(isWorkshopApi(p, method.toLowerCase()), true, `${method} ${p} (lower case)`);
    assert.equal(workshopGate(p, method), "allow", `${method} ${p}`);
  }
});

test("every other admin API answers 403 to a worker", () => {
  const denied: [string, string][] = [
    // places setup, signs, ship checks, history
    ["POST", "/api/admin/track/locations"],
    ["PATCH", "/api/admin/track/locations"],
    ["DELETE", "/api/admin/track/locations"],
    ["GET", `/api/admin/track/locations/${BAG}/sign`],
    ["GET", "/api/admin/track/ship-check"],
    ["GET", "/api/admin/track/history"],
    ["GET", "/api/admin/track/move"],
    // receiving corrections that move due dates, settings, setup
    ["POST", `/api/admin/intake/orders/${ORDER}/received-date`],
    ["PATCH", `/api/admin/intake/bags/${BAG}`],
    ["POST", `/api/admin/intake/bags/${BAG}/seen`],
    ["POST", "/api/admin/intake/completed/seen"],
    ["PATCH", "/api/admin/intake/settings"],
    ["POST", "/api/admin/intake/setup/run"],
    ["GET", "/api/admin/intake/setup/orders"],
    ["POST", `/api/admin/intake/cards/${CARD}/photos/x`],
    ["GET", `/api/admin/intake/cards/${CARD}/photos`],
    // orders, money, emails, customers
    ["PATCH", `/api/admin/cards/${CARD}`],
    ["POST", `/api/admin/cards/${CARD}/refund`],
    ["POST", `/api/admin/cards/${CARD}/complete`],
    ["GET", `/api/admin/cards/${CARD}/tier`],
    ["POST", `/api/admin/orders/${ORDER}/status`],
    ["POST", `/api/admin/orders/${ORDER}/refund`],
    ["PATCH", `/api/admin/orders/${ORDER}/edit`],
    ["POST", "/api/admin/orders/resend-confirmations"],
    ["GET", "/api/admin/proxy-label"],
    ["POST", "/api/admin/email-blast"],
    ["GET", "/api/admin/tax/export"],
    ["GET", "/api/admin/sales-statement"],
    ["POST", "/api/admin/settings/tiers"],
    ["GET", "/api/admin/diagnostics"],
    ["POST", "/api/admin/support/view-as"],
    ["POST", "/api/admin/profile/password"],
    // the team pages themselves
    ["GET", "/api/admin/team"],
    ["POST", "/api/admin/team"],
    ["PATCH", `/api/admin/team/${ORDER}`],
    ["POST", `/api/admin/team/${ORDER}/setup-link`],
    ["POST", `/api/admin/team/${ORDER}/sign-out`],
    ["GET", "/api/admin/team/activity"],
    // odd shapes
    ["GET", "/api/admin"],
    ["GET", "/api/admin/"],
    ["GET", "/api/admin/track/resolve/"],
    ["OPTIONS", "/api/admin/track/resolve"],
    ["GET", "/api/admin/qz-cert/../tax/export"],
  ];
  for (const [method, p] of denied) {
    assert.equal(isWorkshopApi(p, method), false, `${method} ${p}`);
    assert.equal(workshopGate(p, method), "deny-api", `${method} ${p}`);
  }
});

test("nothing under /admin/team or money, settings or orders is ever on the list", () => {
  const plain = (re: RegExp) => re.source.replace(/\\\//g, "/");
  for (const re of WORKSHOP_PAGES) assert.doesNotMatch(plain(re), /team|orders|tax|refund|settings|profile|setup/, plain(re));
  for (const rule of WORKSHOP_APIS) {
    const src = plain(rule.path);
    // intake/settings is open for GET only (reading the label stock)
    if (src.includes("/intake/settings")) {
      assert.deepEqual([...rule.methods].sort(), ["GET", "HEAD"]);
      continue;
    }
    assert.doesNotMatch(src, /\/team|\/api\/admin\/orders|refund|tax|email|profile|setup|proxy-label|status/, src);
  }
});

test("pages outside the admin are not the gate's business", () => {
  for (const p of ["/", "/q/CD-2549-P", "/workshop/setup", "/api/upload", "/api/workshop/setup"]) {
    assert.equal(workshopGate(p, "GET"), "allow", p);
  }
});

test("the worker's menu is Scan, Receiving, Bags and Desk, all open to them", () => {
  assert.deepEqual(WORKSHOP_NAV_ITEMS.map((i) => i.label), ["Scan", "Receiving", "Bags", "Desk"]);
  for (const item of WORKSHOP_NAV_ITEMS) assert.equal(isWorkshopPage(item.href), true, item.href);
});

test("after signing in a worker lands on a page of theirs", () => {
  assert.equal(workshopLanding(null), "/admin/scan");
  assert.equal(workshopLanding("/q/CD-2549-P"), "/q/CD-2549-P");
  assert.equal(workshopLanding("/admin/receiving/desk?desk=LOC-DESK"), "/admin/receiving/desk?desk=LOC-DESK");
  assert.equal(workshopLanding(`/admin/receiving/${ORDER}`), `/admin/receiving/${ORDER}`);
  assert.equal(workshopLanding(`/admin/orders/${ORDER}`), "/admin/scan");
  assert.equal(workshopLanding("/admin/team"), "/admin/scan");
  assert.equal(workshopLanding(WORKSHOP_NOT_AVAILABLE_PATH), "/admin/scan");
  assert.equal(workshopLanding("/q/../admin/tax"), "/admin/scan");
});
