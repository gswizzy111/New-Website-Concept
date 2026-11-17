"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { savedOrderHref } from "@/components/order-builder/saved-order";

const noSubscription = () => () => {};

/**
 * "Return to Order Builder": the builder on the tier the customer was
 * ordering (kept in this tab by components/order-builder/saved-order.ts),
 * where their answers are restored. Without one, /order as before.
 */
export function ReturnToBuilderLink({ className, children }: { className?: string; children: ReactNode }) {
  const href = useSyncExternalStore(noSubscription, savedOrderHref, () => "/order");
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
