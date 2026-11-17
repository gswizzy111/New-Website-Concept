import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin Sign In | The Card Doc", robots: { index: false } };

export default function AdminLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
