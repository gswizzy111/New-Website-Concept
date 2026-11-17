import type { Metadata } from "next";
import { withOg } from "@/lib/seo";

export const metadata: Metadata = withOg("/restoration", {
  title: "Book a Restoration | The Card Doc",
  description: "Book a card restoration with The Card Doc. Surfaces, corners & edges — cleaned and restored to their best.",
});

export default function RestorationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
