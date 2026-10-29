"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { fbq } from "@/lib/pixel";

// Fires PageView on every client-side navigation (the pixel's own page views
// on navigation are off; see lib/tracking-guard.ts).
// The initial PageView is sent by the first script in <head>, so we skip the first mount.
export function MetaPixelRouteTracker() {
  const pathname = usePathname();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    // No page view once a private page has been opened in this tab: the
    // guard sets window.__noTrack before the address changes, and fbq()
    // (lib/pixel.ts) sends nothing after that
    fbq("track", "PageView");
  }, [pathname]);

  return null;
}
