"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Banner across the top of the admin while customers are waiting on a
 * "Where's my card?" answer. Hidden inside Cases, where the list already is.
 */
export function InquiryAlert({ count }: { count: number }) {
  const pathname = usePathname();
  if (count === 0 || pathname.startsWith("/admin/cases")) return null;

  // One string, so the compiler can't trim the spaces between the parts.
  const who = count === 1 ? "1 customer is" : `${count} customers are`;

  return (
    <Link
      href="/admin/cases?filter=open&type=inquiry"
      className="flex items-center justify-between gap-4 bg-rx px-6 py-3 text-sm font-semibold text-white hover:bg-rx/90 transition-colors"
    >
      <span>{`📬 ${who} asking “Where's my card?”`}</span>
      <span className="shrink-0 underline underline-offset-2">Reply →</span>
    </Link>
  );
}
