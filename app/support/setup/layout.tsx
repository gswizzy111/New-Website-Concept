import type { Metadata } from "next";
import { AdminLook } from "@/components/admin-ui/admin-look";

// The invite token is in this page's address: never pass it on to other pages or sites
export const metadata: Metadata = { title: "Set Password | The Card Doc", referrer: "no-referrer", robots: { index: false } };

export default function SupportSetupLayout({ children }: { children: React.ReactNode }) {
  // Staff pages: the admin's old look, like /admin/login they lead to
  return <AdminLook>{children}</AdminLook>;
}
