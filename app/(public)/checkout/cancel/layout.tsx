import type { Metadata } from "next";
import { withOg } from "@/lib/seo";

export const metadata: Metadata = withOg("/checkout/cancel", {
  title: "Checkout Cancelled | The Card Doc",
  description: "Your order wasn't placed and you weren't charged. Your selections are still saved if you'd like to return.",
});

export default function CheckoutCancelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
