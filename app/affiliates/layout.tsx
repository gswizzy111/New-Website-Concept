import type { Metadata } from "next";

export const metadata: Metadata = { title: "Creator Portal | The Card Doc", robots: { index: false } };

export default function AffiliatesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
