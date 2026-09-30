"use client";

import { useState, useEffect } from "react";
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
        className="absolute inset-0 bg-ink/50"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg border border-rule shadow-[0_24px_60px_-20px_oklch(0.2_0.03_165/0.5)] w-full max-w-md p-8 z-10">
        {/* Close button */}
        <button
          onClick={() => setOpen(false)}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>

        <div className="text-center mb-6">
          <p className="rx-label text-rx mb-2">Restoration Services</p>
          <h2 className="font-heading font-extrabold text-2xl text-ink mb-2">
            We&apos;re Currently Closed
          </h2>
          <p className="text-sm text-muted-foreground">
            Sign up below and we&apos;ll notify you the moment we start accepting new restoration orders.
          </p>
        </div>

        <RestorationWaitlistForm onSuccess={() => setOpen(false)} />

        <button
          onClick={() => setOpen(false)}
          className="mt-4 w-full text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          No thanks, just browsing
        </button>
      </div>
    </div>
  );
}
