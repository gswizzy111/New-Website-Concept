"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";

// How long the pointer (or keyboard focus) rests on a link before it counts as
// intent. Scrolling the order list past the pointer, or sweeping across the
// tabs, crosses rows in well under this, so only the row you stop on is fetched.
const INTENT_MS = 100;

type DashboardLinkProps = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string };

/**
 * A <Link> for the dashboard's tabs, chips and order rows that prefetches on
 * intent instead of on sight. Next prefetches every <Link> that scrolls into
 * view: on this page that was hundreds of order rows, each one a server
 * request, and the burst woke extra cold function instances. This one never
 * prefetches by itself; it asks for the route once the mouse or keyboard focus
 * has rested on it, so the loading skeleton is usually ready by the click. A
 * touch is usually the start of a scroll, so it doesn't count; the tap itself
 * navigates as normal.
 *
 * Same behaviour as AdminLink (components/admin-ui/admin-link.tsx, built in
 * parallel for the rest of the admin); either can replace the other.
 */
export function DashboardLink({ href, onPointerEnter, onPointerLeave, onPointerCancel, onFocus, onBlur, onClick, ...rest }: DashboardLinkProps) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const soon = () => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      router.prefetch(href);
    }, INTENT_MS);
  };
  useEffect(() => cancel, []);

  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (e.pointerType !== "touch") soon();
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        cancel();
      }}
      onPointerCancel={(e) => {
        onPointerCancel?.(e);
        cancel();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        soon();
      }}
      onBlur={(e) => {
        onBlur?.(e);
        cancel();
      }}
      onClick={(e) => {
        // The click navigates; a prefetch on top would be a second request
        cancel();
        onClick?.(e);
      }}
    />
  );
}
