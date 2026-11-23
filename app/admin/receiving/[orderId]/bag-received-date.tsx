"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Enter the day a bag's cards really arrived (a historical bag with no known
 * date). The due date is then worked out from it, in business days.
 */
export function BagReceivedDate({ orderId, bagId, bagCode, today, current }: { orderId: string; bagId: string; bagCode: string; today: string; current: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) {
      setError("Enter the day the cards arrived (today or earlier).");
      return;
    }
    if (current && !confirm(`Change the received date of ${bagCode}? Its due date is worked out again from the new date.`)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/intake/orders/${orderId}/received-date`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bagId, receivedOn: day }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) {
      setError(data.error ?? "Couldn't save the date.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold text-primary hover:border-primary/50">
        {current ? "Change received date" : "Enter received date"}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">
        Cards arrived on
        <input type="date" value={day} max={today} min="2020-01-01" onChange={(e) => setDay(e.target.value)} className="h-11 px-3 rounded-lg border border-border bg-white text-base sm:text-sm" required />
      </label>
      <button type="submit" disabled={busy} className="min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
      <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold">Cancel</button>
      {error && <p role="alert" className="basis-full text-sm font-semibold text-red-600">{error}</p>}
    </form>
  );
}
