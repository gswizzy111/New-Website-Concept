import type { Metadata } from "next";

// The emailed manage link's token is in this page's address: never pass it on to other pages or sites
export const metadata: Metadata = { referrer: "no-referrer" };

export default function ManageSubscriptionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
