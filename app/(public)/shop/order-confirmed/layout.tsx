import type { Metadata } from "next";
import { withOg } from "@/lib/seo";

export const metadata: Metadata = withOg("/shop/order-confirmed", {
  title: "Order Confirmed | The Card Doc",
  description: "Your kit order with The Card Doc is confirmed. We'll ship it out shortly and send you a tracking number.",
  robots: { index: false },
});

export default function ShopOrderConfirmedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
