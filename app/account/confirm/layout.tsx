import type { Metadata } from "next";

// The confirm token is in this page's address: never pass it on to other pages or sites
export const metadata: Metadata = { referrer: "no-referrer" };

export default function ConfirmEmailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
