import { ViewTransition } from "react";

export default function Loading() {
  return (
    // The skeleton dissolves into the page when it arrives (CSS: .skeleton-out).
    <ViewTransition exit="skeleton-out" default="none">
      {/* Fills the screen so the footer doesn't flash up under a short skeleton. */}
      <div className="relative min-h-[100svh] bg-chalk" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading</span>
        <div className="route-progress" aria-hidden />
        <div className="wrap py-14 md:py-24" aria-hidden>
          <div className="skeleton mb-6 h-4 w-28 rounded-full" />
          <div className="skeleton mb-3 h-14 w-[85%] md:h-24 md:w-[60%]" />
          <div className="skeleton mb-9 h-14 w-[60%] md:h-24 md:w-[42%]" />
          <div className="mb-14 max-w-2xl space-y-3">
            <div className="skeleton h-4 w-[90%] rounded-full" />
            <div className="skeleton h-4 w-[60%] rounded-full" />
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-[22px] bg-white p-3 shadow-[0_0_0_1px_var(--line)]">
                <div className="skeleton h-64 rounded-[14px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </ViewTransition>
  );
}
