import type { Metadata } from "next";
import { canonical } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Gift Cards | The Card Doc",
  description: "Give the gift of card restoration. The recipient gets a code they can apply at checkout.",
  alternates: canonical("/gift-cards"),
};

export default function GiftCardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
