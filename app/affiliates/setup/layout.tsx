import type { Metadata } from "next";

// The setup token is in this page's address: never pass it on to other sites
export const metadata: Metadata = { title: "Set Password | The Card Doc", referrer: "no-referrer", robots: { index: false } };

export default function CreatorSetupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
