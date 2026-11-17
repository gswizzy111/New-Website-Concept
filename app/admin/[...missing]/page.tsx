import { notFound } from "next/navigation";

// An address under /admin that matches no page: the admin's 404
// (app/admin/not-found.tsx, Next.js's plain 404 as on thecarddoc1.com)
// instead of the public site's branded one.
export default function MissingAdminPage() {
  notFound();
}
