"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { RestorationWaitlistForm } from "@/app/(public)/restoration/restoration-waitlist-form";

export function WaitlistModal() {
  const [open, setOpen] = useState(false);

  // Small delay so the page renders first
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 400);
    return () => clearTimeout(t);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 animate-[fade-in_200ms_ease-out_both] bg-ink/55 backdrop-blur-[3px] motion-reduce:animate-none"
        onClick={() => setOpen(false)}
      />

      {/* Modal: a sun header over a white form */}
      <div className="relative z-10 w-full max-w-md animate-[rx-in_280ms_cubic-bezier(.16,1,.3,1)_both] motion-reduce:animate-none">
        <div className="max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl bg-white shadow-[var(--pop-shadow)]">
          <div className="surface-sun relative rounded-t-2xl px-6 pt-6 pb-6 md:px-8 md:pt-8">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-ink/10 focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-ink"
              aria-label="Close"
            >
              <X aria-hidden className="size-5" strokeWidth={2} />
            </button>
            <p className="eyebrow mb-3 pr-10 text-cobalt-deep">Restoration Services</p>
            <h2 className="caps pr-8 font-display text-[40px] font-black leading-[0.9] text-ink">
              We&apos;re Currently Closed
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink">
              Sign up below and we&apos;ll notify you the moment we start accepting new restoration orders.
            </p>
          </div>

          <div className="px-6 pt-6 pb-7 md:px-8 md:pb-8">
            <RestorationWaitlistForm onSuccess={() => setOpen(false)} />

            <button
              onClick={() => setOpen(false)}
              className="mt-3 flex min-h-11 w-full items-center justify-center rounded-full text-sm font-semibold text-ink-soft underline underline-offset-4 hover:text-ink focus-visible:outline-3 focus-visible:outline-cobalt"
            >
              No thanks, just browsing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
