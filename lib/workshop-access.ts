/**
 * What a workshop login may open (role 'workshop', lib/admin-session.ts):
 * the Scan page, the Desk, and Receiving & labels (receive cards, take
 * photos, add a card, print bag labels). Nothing else: no money, refunds,
 * reports, settings, customer emails other than what receiving and the
 * tracking moves send themselves, order editing, shipping or places setup.
 *
 * DEFAULT DENY. A page or API is open to a worker only if it is listed here,
 * and an API only for the listed methods. middleware.ts asks workshopGate()
 * on every /admin and /api/admin request of a workshop session; each listed
 * page and route checks the role again itself (requireAdminOrWorkshop in
 * lib/admin-auth.ts, staffActor in app/api/admin/intake/orders/guard.ts,
 * trackStaff in lib/intake/tracking/http.ts), and every other one only lets
 * full admins in. tests/intake/workshop-routes.test.ts walks every admin page
 * and route file and fails when one is neither listed here nor full-admin
 * only, so a new page is closed to workers until someone opens it here on
 * purpose.
 *
 * Pure (no imports): the middleware, the login page and the tests use it.
 */

export const WORKSHOP_HOME = "/admin/scan";
/** Shown in place of any admin page a worker can't use (middleware rewrites to it). */
export const WORKSHOP_NOT_AVAILABLE_PATH = "/admin/not-available";
export const WORKSHOP_DENIED_MESSAGE = "Not available for workshop logins";

/** The worker's menu (app/admin/admin-nav.tsx). */
export const WORKSHOP_NAV_ITEMS = [
  { href: "/admin/scan", label: "Scan", icon: "🏷️" },
  { href: "/admin/receiving", label: "Receiving", icon: "📥" },
  { href: "/admin/receiving/bags", label: "Bags", icon: "🗂️" },
  { href: "/admin/receiving/desk", label: "Desk", icon: "🪑" },
] as const;

// One path segment of each kind. Strict on purpose: /admin/receiving/<uuid>
// must never match a sibling page such as /admin/receiving/settings.
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const CODE = "[A-Za-z0-9%._~-]{1,100}";

function exact(pattern: string) {
  return new RegExp(`^${pattern}$`);
}

/** Admin pages a worker may open (pathname only; any query string). */
export const WORKSHOP_PAGES: readonly RegExp[] = [
  exact("/admin/scan"),
  exact("/admin/receiving"),
  exact(`/admin/receiving/${UUID}`),
  exact(`/admin/receiving/${UUID}/photos`),
  exact(`/admin/receiving/open/${CODE}`),
  exact(`/admin/receiving/card/${UUID}`),
  exact(`/admin/receiving/bag/${UUID}`),
  exact("/admin/receiving/bags"),
  exact("/admin/receiving/desk"),
  // The printing guide (static steps for the label printer, linked from Receiving)
  exact("/admin/receiving/printing"),
  exact(WORKSHOP_NOT_AVAILABLE_PATH),
];

type Method = "GET" | "HEAD" | "POST" | "PATCH" | "PUT" | "DELETE";
type ApiRule = { path: RegExp; methods: readonly Method[] };
const READ: readonly Method[] = ["GET", "HEAD"];

/**
 * Admin APIs a worker may call, and with which methods: exactly what the
 * pages above call for scanning, the desk, receiving, photos and labels.
 * Left out on purpose (full admins only): card name edits and tier changes
 * (a worker may only fill a missing tier), a bag's due date or received
 * date, order status, "Completed bags" seen marks, places
 * setup (track/locations POST/PATCH, signs), ship checks, label settings
 * changes, Historical Order Setup, printing shipping labels (proxy-label).
 */
export const WORKSHOP_APIS: readonly ApiRule[] = [
  // Scan page, Desk and what a scanned code opens (lib/intake/tracking)
  { path: exact("/api/admin/track/resolve"), methods: READ },
  { path: exact("/api/admin/track/search"), methods: READ },
  { path: exact("/api/admin/track/assign"), methods: ["POST"] },
  { path: exact("/api/admin/track/move"), methods: ["POST"] },
  { path: exact("/api/admin/track/done"), methods: ["POST"] },
  { path: exact("/api/admin/track/release"), methods: ["POST"] },
  { path: exact("/api/admin/track/bag-ready"), methods: ["POST"] },
  // The Desk's holder picker lists the slots; desk and shelf signs print from here
  { path: exact("/api/admin/track/locations"), methods: READ },
  { path: exact("/api/admin/track/locations/labels"), methods: READ },
  // Receiving: receive (and undo), add a card, photos, bag labels, steps
  { path: exact(`/api/admin/intake/orders/${UUID}/receive`), methods: ["POST"] },
  { path: exact(`/api/admin/intake/orders/${UUID}/unreceive`), methods: ["POST"] },
  { path: exact(`/api/admin/intake/orders/${UUID}/add-card`), methods: ["POST"] },
  { path: exact(`/api/admin/intake/orders/${UUID}/prepare-labels`), methods: ["GET", "HEAD", "POST"] },
  { path: exact(`/api/admin/intake/cards/${UUID}/photos`), methods: ["POST"] },
  { path: exact(`/api/admin/intake/labels/order/${UUID}`), methods: READ },
  { path: exact(`/api/admin/intake/labels/bag/${UUID}`), methods: READ },
  { path: exact("/api/admin/intake/labels/printed"), methods: ["POST"] },
  { path: exact("/api/admin/intake/stages"), methods: ["POST"] },
  // Picking a tier for a card that has none ("Missing tier"); the route refuses
  // a worker who tries to change a tier a card already has
  { path: exact(`/api/admin/cards/${UUID}/tier`), methods: ["PATCH"] },
  // Reading the label stock only (the print button asks which paper is loaded)
  { path: exact("/api/admin/intake/settings"), methods: READ },
  // QZ Tray: the label printer on the shop computer
  { path: exact("/api/admin/qz-cert"), methods: READ },
  { path: exact("/api/admin/qz-sign"), methods: ["POST"] },
];

/** Signing in and out and recovering a password work for everyone (middleware.ts lists them too). */
export const AUTH_APIS: readonly string[] = ["/api/admin/login", "/api/admin/logout", "/api/admin/forgot-password", "/api/admin/reset-password"];
export const AUTH_PAGES: readonly string[] = ["/admin/login", "/admin/forgot-password", "/admin/reset-password"];

export function isAuthApi(pathname: string): boolean {
  return AUTH_APIS.includes(pathname);
}

export function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** An admin page a worker may open. */
export function isWorkshopPage(pathname: string): boolean {
  return WORKSHOP_PAGES.some((re) => re.test(pathname));
}

/** An admin API a worker may call with this method. */
export function isWorkshopApi(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  return WORKSHOP_APIS.some((rule) => rule.path.test(pathname) && (rule.methods as readonly string[]).includes(m));
}

/**
 * What the middleware does with a workshop session's request:
 * - "allow": go ahead (the page or route checks the role again);
 * - "home": /admin itself, the Orders page: send them to WORKSHOP_HOME;
 * - "deny-page": show the "Not available for workshop logins" page;
 * - "deny-api": answer 403 { error: WORKSHOP_DENIED_MESSAGE }.
 * Paths outside /admin and /api/admin are not this function's business ("allow").
 */
export type WorkshopVerdict = "allow" | "home" | "deny-page" | "deny-api";

export function workshopGate(pathname: string, method: string): WorkshopVerdict {
  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
    if (isAuthApi(pathname)) return "allow";
    return isWorkshopApi(pathname, method) ? "allow" : "deny-api";
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (pathname === "/admin") return "home";
    if (isAuthPage(pathname)) return "allow";
    return isWorkshopPage(pathname) ? "allow" : "deny-page";
  }
  return "allow";
}

/**
 * Where a worker lands after signing in: the `?next=` page when they may open
 * it (a scanned QR code's /q/<CODE> or an allowed admin page), else the Scan page.
 */
export function workshopLanding(next: string | null): string {
  if (!next) return WORKSHOP_HOME;
  const pathname = next.split(/[?#]/)[0];
  if (/^\/q\/[A-Za-z0-9-]{1,40}$/.test(pathname)) return next;
  return isWorkshopPage(pathname) && pathname !== WORKSHOP_NOT_AVAILABLE_PATH ? next : WORKSHOP_HOME;
}
