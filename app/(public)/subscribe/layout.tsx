import type { Metadata } from "next";
import { withOg } from "@/lib/seo";

export const metadata: Metadata = withOg("/subscribe", {
  title: "Kit Club | The Card Doc",
  description: "Monthly Kit Club: get a fresh restoration kit from The Card Doc delivered every month.",
});

export default function SubscribeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
