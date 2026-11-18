"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// How old the dashboard's data may be when it opens before it is reloaded.
const STALE_MS = 10_000;

/**
 * The Orders dashboard usually opens from a copy loaded ahead of time (links
 * to /admin prefetch it in full: components/admin-ui/admin-link.tsx), so it
 * shows at once. When that copy is more than STALE_MS old, its data is quietly
 * reloaded in place (router.refresh), so the list is never more than a few
 * seconds behind. Renders nothing.
 */
export function DashboardFreshness({ renderedAt }: { renderedAt: number }) {
  const router = useRouter();
  useEffect(() => {
    if (Date.now() - renderedAt > STALE_MS) router.refresh();
  }, [renderedAt, router]);
  return null;
}
