import { requireAdmin } from "@/lib/admin-auth";

// The page is a client component: this checks it is a full admin before it
// renders (its API routes check again). Workshop logins, support staff and
// accountants never get here (middleware.ts sends them away first).
export default async function FullAdminOnlyLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return children;
}
