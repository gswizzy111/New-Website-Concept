import type { Metadata } from "next";

export const metadata: Metadata = { title: "Partner Portal | The Card Doc", robots: { index: false } };

export default function PartnersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
