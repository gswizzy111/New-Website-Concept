"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SubscriptionCancelButton() {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleCancel() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/account/subscriptions/cancel", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please contact us.");
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <div className="rounded-[14px] bg-success-tint px-4 py-3 text-sm font-semibold text-success">
        ✓ Subscription cancelled. No future charges will occur.
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-bold text-destructive shadow-[inset_0_0_0_1.5px_currentColor] transition-colors hover:bg-red-50"
      >
        Cancel Subscription
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-red-50 p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_30%,transparent)]">
      <p className="text-sm font-semibold text-destructive">Are you sure you want to cancel?</p>
      <p className="text-xs text-destructive">
        Your subscription will be cancelled immediately. Any kit that has already shipped is yours to keep.
        Future monthly charges will stop.
      </p>
      {error && <p className="text-xs text-destructive font-semibold">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleCancel}
          disabled={loading}
          className="btn btn-danger btn-sm"
        >
          {loading ? "Cancelling…" : "Yes, Cancel Subscription"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="btn btn-white btn-sm"
        >
          Keep Subscription
        </button>
      </div>
    </div>
  );
}
