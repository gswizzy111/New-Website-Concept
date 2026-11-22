"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Cancel / restore a show drop-off and keep admin notes on it. */
export function DropoffActions({ id, status, adminNotes }: { id: string; status: string; adminNotes: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState(adminNotes);
  const [saving, setSaving] = useState<"" | "notes" | "status">("");
  const [message, setMessage] = useState("");

  async function patch(body: Record<string, unknown>, kind: "notes" | "status") {
    setSaving(kind);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/show-dropoffs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data.error ?? "Couldn't save."); return; }
      setMessage(kind === "notes" ? "Notes saved." : "");
      router.refresh();
    } catch {
      setMessage("Network error. Try again.");
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-semibold text-muted-foreground" htmlFor="admin-notes">Admin notes (only you see these)</label>
      <textarea
        id="admin-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        maxLength={4000}
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => patch({ admin_notes: notes }, "notes")}
          disabled={!!saving}
          className="h-9 rounded-lg border border-border bg-white px-4 text-sm font-semibold hover:border-primary/40 disabled:opacity-60"
        >
          {saving === "notes" ? "Saving…" : "Save notes"}
        </button>
        {status === "new" && (
          <button
            type="button"
            onClick={() => { if (confirm("Cancel this drop-off? It stays on record.")) patch({ status: "cancelled" }, "status"); }}
            disabled={!!saving}
            className="h-9 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            Cancel drop-off
          </button>
        )}
        {status === "cancelled" && (
          <button
            type="button"
            onClick={() => patch({ status: "new" }, "status")}
            disabled={!!saving}
            className="h-9 rounded-lg border border-border bg-white px-4 text-sm font-semibold hover:border-primary/40 disabled:opacity-60"
          >
            Move back to To enter
          </button>
        )}
        {message && <span role="status" className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
