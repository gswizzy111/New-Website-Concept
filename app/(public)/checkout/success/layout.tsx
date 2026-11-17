import type { Metadata } from "next";
import { withOg } from "@/lib/seo";

export const metadata: Metadata = withOg("/checkout/success", {
  title: "Order Confirmed | The Card Doc",
  description: "Your order with The Card Doc is confirmed. We'll send confirmation to your email with next steps.",
  robots: { index: false },
});

export default function CheckoutSuccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
