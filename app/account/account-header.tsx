import Link from "next/link";
import { LogoutButton } from "./logout-button";

/** The customer portal header: Orders, Settings, the signed-in email, Log out. */
export function AccountHeader({ email, active }: { email: string; active: "orders" | "settings" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`text-sm font-semibold transition-colors ${on ? "text-foreground underline underline-offset-[6px] decoration-2 decoration-rx" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="bg-white border-b border-border sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5 sm:gap-6 min-w-0">
          <Link href="/" className="font-heading font-black text-lg text-foreground hover:text-primary transition-colors shrink-0">
            The Card Doc
          </Link>
          <nav aria-label="Account" className="flex items-center gap-4">
            {tab("/account", "Orders", active === "orders")}
            {tab("/account/settings", "Settings", active === "settings")}
          </nav>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm text-muted-foreground hidden md:block">{email}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
