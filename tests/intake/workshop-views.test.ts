/**
 * What workshop logins see on their shared pages: no declared values and no
 * order page links (workshopOpenView, workshopDeskCard, stripped on the
 * server), and the pages and the setup link check the role themselves.
 * Pure, plus reading a few files: no Next.js, no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { workshopOpenView, type OpenView } from "@/app/admin/receiving/open/[code]/_lib/view";
import { workshopDeskCard, type DeskPanelCard } from "@/app/admin/receiving/desk/_lib/view";

const read = (...p: string[]) => readFileSync(path.join(process.cwd(), ...p), "utf8");

test("the scan landing loses declared values and the order link for a worker", () => {
  const card = { id: "c1", code: "CD-2549-03", name: "Charizard", declaredValue: "$1,200.00", notes: "corner", state: "ready" };
  const view = {
    header: { kind: "order", code: "CD-2549", orderId: "o1", customer: "Pat", orderNumber: "CD-2549", orderUrl: "/admin/orders/o1", photosUrl: "/admin/receiving/o1/photos" },
    groups: [{ key: "b1", title: "Gold", subtitle: null, overdue: false, cards: [card, { ...card, id: "c2", declaredValue: "$40.00" }] }],
    bags: [],
    orderStatus: "received",
  } as unknown as OpenView;
  const w = workshopOpenView(view);
  assert.equal(w.header.orderUrl, null);
  assert.equal(w.header.photosUrl, "/admin/receiving/o1/photos");
  assert.deepEqual(w.groups[0].cards.map((c) => c.declaredValue), [null, null]);
  assert.equal(w.groups[0].cards[0].notes, "corner");
  assert.ok(!JSON.stringify(w).includes("$"), "no money left anywhere in the view");
  assert.ok(!JSON.stringify(w).includes("/admin/orders/"), "no order page link left");
  // The admin's view is untouched
  assert.equal(view.header.orderUrl, "/admin/orders/o1");
  assert.equal(view.groups[0].cards[0].declaredValue, "$1,200.00");
});

test("a Desk card loses its declared value and order link for a worker", () => {
  const card = { id: "c1", orderNumber: "CD-2549", orderUrl: "/admin/orders/o1", cardUrl: "/admin/receiving/card/c1", declaredValue: "$1,200.00", notes: "x" } as unknown as DeskPanelCard;
  const w = workshopDeskCard(card);
  assert.equal(w.declaredValue, null);
  assert.equal(w.orderUrl, null);
  assert.equal(w.orderNumber, "CD-2549");
  assert.equal(w.cardUrl, "/admin/receiving/card/c1");
  assert.equal(card.declaredValue, "$1,200.00");
});

test("the worker pages strip them on the server, and hide Places and Ship check", () => {
  const open = read("app", "admin", "receiving", "open", "[code]", "page.tsx");
  assert.match(open, /role === "workshop" \? workshopOpenView\(built\) : built/);
  assert.match(open, /placesLink=\{role === "admin"\}/);
  assert.match(open, /\{header\.orderUrl && \(/);
  const desk = read("app", "admin", "receiving", "desk", "page.tsx");
  assert.match(desk, /loaded\.ok && workshop \? \{ \.\.\.loaded, cards: loaded\.cards\.map\(workshopDeskCard\) \}/);
  assert.match(desk, /<SignButtons desk=\{desk\} places=\{!workshop\} \/>/);
  const panel = read("app", "admin", "receiving", "desk", "_components", "desk-card-panel.tsx");
  assert.equal((panel.match(/href=\{card\.orderUrl\}/g) ?? []).length, 2);
  assert.equal((panel.match(/\{card\.orderUrl \? \(|\{card\.orderUrl && \(/g) ?? []).length, 2, "both order links only when there is one");
  const scan = read("app", "admin", "scan", "page.tsx");
  assert.match(scan, /const shipCheck = role === "admin"/);
  assert.match(scan, /initialShip=\{shipCheck && first\(sp\.mode\) === "ship"\} shipCheck=\{shipCheck\}/);
  assert.match(read("components", "intake", "scan", "scan-app.tsx"), /\{shipCheck && <button/);
});

test("a setup link opened where a full admin is signed in changes nothing", () => {
  const route = read("app", "api", "workshop", "setup", "route.ts");
  const check = route.indexOf('(await getRealAdminSession())?.role === "admin"');
  assert.ok(check > 0, "the route checks for a full admin");
  assert.ok(check < route.indexOf("setWorkshopPassword("), "before the link is used");
  assert.ok(check < route.indexOf("createAdminSession("), "before any session is made");
  assert.match(route, /status: 409/);
  const page = read("app", "workshop", "setup", "page.tsx");
  assert.match(page, /session\?\.role === "admin" \? <AdminSignedIn \/> : <WorkshopSetup \/>/);
  assert.match(read("app", "workshop", "setup", "messages.ts"), /You're signed in as an admin\. Open this link in a private window or on the worker's phone\./);
});
