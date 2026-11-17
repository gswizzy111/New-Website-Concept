import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { PortalHeader } from "@/components/account/portal";
import { cn } from "@/lib/utils";

/** The customer portal header: Orders, Settings, the signed-in email, Log out. */
export function AccountHeader({ email, active }: { email: string; active: "orders" | "settings" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-bold transition-colors",
        on ? "bg-ink text-white" : "text-ink-soft hover:bg-chalk hover:text-ink"
      )}
    >
      {label}
    </Link>
  );
  return (
    <PortalHeader>
      <nav aria-label="Account" className="flex items-center gap-1">
        {tab("/account", "Orders", active === "orders")}
        {tab("/account/settings", "Settings", active === "settings")}
      </nav>
      <span className="hidden max-w-[22ch] truncate text-sm text-ink-soft lg:block">{email}</span>
      <LogoutButton />
    </PortalHeader>
  );
}
