import type { Metadata } from "next";

export const metadata: Metadata = { title: "You're Subscribed | The Card Doc", robots: { index: false } };

export default function SubscribeSuccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
