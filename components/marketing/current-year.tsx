"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * The current year by the visitor's clock. Static pages are rendered once at
 * build, so a year printed on the server would stay stale after January 1;
 * `builtYear` is what the server rendered, used until the page starts.
 */
export function CurrentYear({ builtYear }: { builtYear: number }) {
  const year = useSyncExternalStore(noSubscription, () => new Date().getFullYear(), () => builtYear);
  return <>{year}</>;
}
