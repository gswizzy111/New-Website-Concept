"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ShipQueueStatusControl({ orderId, currentStatus }: { orderId: string; currentStatus: string }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const router = useRouter();
  const loading = saving || refreshing;

  async function setStatus(status: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/shop-orders/${orderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not update the status.");
        return;
      }
      startRefresh(() => router.refresh());
    } catch {
      setError("Could not update the status. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const errorLine = error && <p role="alert" className="text-xs text-red-600 max-w-48 text-right">{error}</p>;

  if (currentStatus === "shipped") {
    return (
      <div className="flex flex-col gap-2 items-end">
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700">Shipped</span>
        <button
          onClick={() => setStatus("processing")}
          disabled={loading}
          className="text-xs font-bold px-3 py-1.5 border border-border text-muted-foreground hover:border-red-400 hover:text-red-600 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? "Reverting…" : "↩ Revert to Processing"}
        </button>
        {errorLine}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 items-end">
      <button
        onClick={() => setStatus("shipped")}
        disabled={loading}
        className="px-4 py-2 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
      >
        {loading ? "Marking…" : "Mark as Shipped"}
      </button>
      {errorLine}
    </div>
  );
}
