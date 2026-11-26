import type { Metadata } from "next";
import { getAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { WORKSHOP_DENIED_MESSAGE, WORKSHOP_HOME, WORKSHOP_NAV_ITEMS } from "@/lib/workshop-access";

/**
 * "Not available for workshop logins": what a workshop login sees on any
 * admin page that isn't theirs (middleware.ts shows it in place of the page,
 * keeping the address; requireAdmin() sends them here). It shows nothing but
 * the way back to their own pages.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Not available | The Card Doc", robots: { index: false } };

export default async function NotAvailablePage() {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
      <div className="bg-white rounded-xl border border-border p-6 sm:p-8">
        <h1 className="font-heading font-black text-2xl text-foreground">{WORKSHOP_DENIED_MESSAGE}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is for the shop owner. Your login opens the Scan page, Receiving, Bags and the Desk.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {WORKSHOP_NAV_ITEMS.map((item) => (
            <AdminLink
              key={item.href}
              href={item.href}
              className={`inline-flex items-center gap-2 min-h-11 px-4 rounded-lg text-sm font-bold transition-colors ${
                item.href === WORKSHOP_HOME
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border bg-white text-foreground hover:border-primary/40"
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </AdminLink>
          ))}
        </div>
      </div>
    </div>
  );
}
