"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";

// How long the pointer (or keyboard focus) rests on a link before it counts as
// intent. Sweeping across the sidebar to reach one item crosses the others in
// well under this, so only the item you stop on is fetched.
const INTENT_MS = 100;

type AdminLinkProps = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string };

/**
 * A <Link> for staff pages that prefetches on intent instead of on sight.
 *
 * Next prefetches every <Link> as it scrolls into view, again after each
 * navigation. In the admin that was the 30-item sidebar plus every row of a
 * list: each prefetch is a server request (middleware session lookup, then the
 * admin layout with its counts), and a burst of them woke extra cold function
 * instances, which is where the 5-8 s stalls came from. This link never
 * prefetches by itself: it asks for the route once the mouse or keyboard focus
 * has rested on it (INTENT_MS), so the loading skeleton is usually ready by
 * the click. A touch is usually the start of a scroll, so it doesn't count;
 * the tap itself navigates as normal.
 *
 * One exception: links to the Orders dashboard (/admin) load it in full in
 * the background as soon as they are on screen (prefetch={true}), from any
 * other admin page, so going back to Orders shows at once instead of waiting
 * ~2 s for the server. One request per page view; the dashboard refreshes its
 * data quietly when that copy is more than a few seconds old
 * (app/admin/dashboard-freshness.tsx).
 *
 * Admin only: customer pages keep Next's default prefetching.
 */
const DASHBOARD = "/admin";
export function AdminLink({ href, onPointerEnter, onPointerLeave, onPointerCancel, onFocus, onBlur, onClick, ...rest }: AdminLinkProps) {
  const router = useRouter();
  const pathname = usePathname();
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

  // The Orders dashboard, from another admin page: ready before the click
  if (href === DASHBOARD && pathname !== DASHBOARD) {
    return <Link {...rest} href={href} prefetch={true} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onPointerCancel={onPointerCancel} onFocus={onFocus} onBlur={onBlur} onClick={onClick} />;
  }

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
