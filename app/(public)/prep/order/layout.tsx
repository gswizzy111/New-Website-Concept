import type { Metadata } from "next";
import { withOg } from "@/lib/seo";

export const metadata: Metadata = withOg("/prep/order", {
  title: "Prep Order | The Card Doc",
  description: "Start your prep order with The Card Doc. Grade-ready submission prep for PSA, BGS & CGC.",
});

export default function PrepOrderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
