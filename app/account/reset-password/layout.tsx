import type { Metadata } from "next";

// The reset token is in this page's address: never pass it on to other pages or sites
export const metadata: Metadata = { title: "Set a New Password | The Card Doc", referrer: "no-referrer", robots: { index: false } };

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
