import type { Metadata } from "next";

export const metadata: Metadata = { title: "Order Tracking | The Card Doc", robots: { index: false } };

export default function OrderTrackingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
