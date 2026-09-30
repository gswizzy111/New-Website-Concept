"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const HIDE_ON = ["/restoration", "/tier-selection"];

export function RestorationBubble() {
  const pathname = usePathname();
  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;

  return (
    <div className="fixed bottom-5 left-0 right-0 flex justify-center z-50 px-4 md:hidden">
      <Link
        href="/restoration"
        className="flex items-center gap-2.5 bg-rx text-primary-foreground font-heading font-bold text-base pl-2.5 pr-6 py-2.5 rounded-lg shadow-[0_10px_24px_-8px_oklch(0.3_0.06_165/0.45)] active:scale-[0.98] transition-transform"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/card-doctor.jpg" alt="" className="w-8 h-8 rounded-md object-cover flex-shrink-0 ring-1 ring-white/30" />
        Book a Restoration
      </Link>
    </div>
  );
}
