import type { Metadata } from "next";
import { withOg } from "@/lib/seo";

export const metadata: Metadata = withOg("/subscribe/success", {
  title: "You're Subscribed | The Card Doc",
  description: "Your Kit Club subscription is confirmed. Your first kit will ship within 1-2 business days.",
  robots: { index: false },
});

export default function SubscribeSuccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
