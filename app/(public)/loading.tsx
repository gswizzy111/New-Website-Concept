import { ViewTransition } from "react";

export default function Loading() {
  return (
    // The skeleton dissolves into the page when it arrives (CSS: .skeleton-out).
    <ViewTransition exit="skeleton-out" default="none">
      {/* Fills the screen so the footer doesn't flash up under a short skeleton. */}
      <div className="relative min-h-[100svh]" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading</span>
        <div className="route-progress" aria-hidden />
        <div className="max-w-6xl mx-auto px-4 md:px-10 py-12 md:py-20" aria-hidden>
          <div className="skeleton h-3 w-24 rounded-full mb-5" />
          <div className="skeleton h-12 md:h-16 w-[80%] md:w-[55%] rounded-md mb-3" />
          <div className="skeleton h-12 md:h-16 w-[60%] md:w-[40%] rounded-md mb-8" />
          <div className="skeleton h-4 w-[70%] md:w-[38%] rounded-full mb-12" />
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-72 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </ViewTransition>
  );
}
