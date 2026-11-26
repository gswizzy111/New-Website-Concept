import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_SESSION_COOKIE, VIEW_AS_COOKIE, lookupAdminSession, withViewAs, type AdminRole, type AdminSession } from "@/lib/admin-session";
import { WORKSHOP_HOME, WORKSHOP_NOT_AVAILABLE_PATH } from "@/lib/workshop-access";

export type { AdminRole } from "@/lib/admin-session";

/** The admin, accountant or support member signed in on this request, if any (looked up once per request). */
// An admin in "View as Support" gets the support role here, like everywhere else.
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const jar = await cookies();
  return withViewAs(await lookupAdminSession(jar.get(ADMIN_SESSION_COOKIE)?.value), jar.get(VIEW_AS_COOKIE)?.value);
});

/** The signed-in person as they really are, ignoring "View as Support". */
export async function getRealAdminSession(): Promise<AdminSession | null> {
  const jar = await cookies();
  return lookupAdminSession(jar.get(ADMIN_SESSION_COOKIE)?.value);
}

export async function getAdminRole(): Promise<AdminRole | null> {
  return (await getAdminSession())?.role ?? null;
}

/** A signed-in full admin (accountants, support staff and workshop logins are not). */
export async function isAdmin(): Promise<boolean> {
  return (await getAdminRole()) === "admin";
}

// Accountants see the tax reports and nothing else (see middleware.ts).
export const ACCOUNTANT_HOME = "/admin/tax";

// Customer support staff see order lookup, cases and email problems (see
// middleware.ts and SUPPORT_PAGES in lib/admin-session.ts).
export const SUPPORT_HOME = "/admin/support";

/** Where each role lands after signing in, and when it opens a page it can't use. */
export function homeFor(role: AdminRole): string {
  if (role === "accountant") return ACCOUNTANT_HOME;
  if (role === "support") return SUPPORT_HOME;
  if (role === "workshop") return WORKSHOP_HOME;
  return "/admin";
}

// A workshop login on a page that isn't theirs sees "Not available for
// workshop logins" (middleware.ts normally shows it before the page runs)
function refuseWorkshop(role: AdminRole | null) {
  if (role === "workshop") redirect(WORKSHOP_NOT_AVAILABLE_PATH);
}

export async function requireAdmin(): Promise<"admin"> {
  const role = await getAdminRole();
  refuseWorkshop(role);
  if (role && role !== "admin") redirect(homeFor(role));
  if (role !== "admin") redirect("/admin/login");
  return "admin";
}

/** A signed-in workshop login (lib/workshop-access.ts says what they may open). */
export async function isWorkshop(): Promise<boolean> {
  return (await getAdminRole()) === "workshop";
}

/**
 * For the pages workshop logins share with admins (Scan, Receiving, Bags,
 * Desk: WORKSHOP_PAGES in lib/workshop-access.ts) and nothing else. Every
 * other admin page uses requireAdmin(), which refuses them.
 */
export async function requireAdminOrWorkshop(): Promise<"admin" | "workshop"> {
  const role = await getAdminRole();
  if (role === "admin" || role === "workshop") return role;
  if (role) redirect(homeFor(role));
  redirect("/admin/login");
}

/**
 * For the routes workshop logins share with admins (WORKSHOP_APIS in
 * lib/workshop-access.ts) and nothing else: who is acting, by the username
 * their actions record (card_moves.by, stage events, received_by ...), or
 * null for anyone else. Every other admin route uses isAdmin().
 */
export async function adminOrWorkshopActor(): Promise<{ role: "admin" | "workshop"; by: string } | null> {
  const session = await getAdminSession();
  if (session?.role !== "admin" && session?.role !== "workshop") return null;
  return { role: session.role, by: session.username || session.role };
}

/** A full admin or a workshop login (for WORKSHOP_APIS routes only; see adminOrWorkshopActor). */
export async function isAdminOrWorkshop(): Promise<boolean> {
  return (await adminOrWorkshopActor()) !== null;
}

/** A full admin or a support member: the people who answer customers. */
export async function isAdminOrSupport(): Promise<boolean> {
  const role = await getAdminRole();
  return role === "admin" || role === "support";
}

/** For pages admins and support staff share; accountants go to their own page. */
export async function requireAdminOrSupport(): Promise<"admin" | "support"> {
  const role = await getAdminRole();
  refuseWorkshop(role);
  if (role === "accountant") redirect(ACCOUNTANT_HOME);
  if (role !== "admin" && role !== "support") redirect("/admin/login");
  return role;
}

/**
 * Who to name on a case note or a desk: the admin's username, the support
 * member's name, or the workshop login's username (what their actions record).
 */
export async function staffName(): Promise<string | null> {
  const session = await getAdminSession();
  if (!session) return null;
  if (session.preview) return `${session.username} (admin, viewing as support)`;
  return session.role === "support" ? `${session.name ?? session.username} (support)` : session.username;
}

export async function requireAdminOrAccountant(): Promise<"admin" | "accountant"> {
  const role = await getAdminRole();
  refuseWorkshop(role);
  if (role === "support") redirect(SUPPORT_HOME);
  if (role !== "admin" && role !== "accountant") redirect("/admin/login");
  return role;
}
