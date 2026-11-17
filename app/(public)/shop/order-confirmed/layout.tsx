import type { Metadata } from "next";

export const metadata: Metadata = { title: "Order Confirmed | The Card Doc", robots: { index: false } };

export default function ShopOrderConfirmedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
