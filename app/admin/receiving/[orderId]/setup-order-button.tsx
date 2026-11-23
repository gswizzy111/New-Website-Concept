"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Set up this order": the Historical Order Setup for this one order
 * (POST /api/admin/intake/setup/run). Card IDs for every card, one bag per
 * tier with the order's real received date (never an invented one), the
 * cards' progress untouched. Safe to repeat: only what's missing is added.
 */
export function SetupOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/intake/setup/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds: [orderId] }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    const result = Array.isArray(data.results) ? data.results[0] : null;
    if (!res || !res.ok || data.ready === false || !result || result.outcome === "error") {
      setMessage({ kind: "error", text: result?.message ?? data.notice ?? data.error ?? "The order couldn't be set up. Try again." });
      return;
    }
    const text = String(result.message ?? "").replace(/\.$/, "");
    setMessage({ kind: "ok", text: result.outcome === "ok" ? `Set up: ${text}.` : `${text}.` });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 w-full sm:w-auto"
      >
        {busy ? "Setting up…" : "Set up this order"}
      </button>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm font-semibold ${message.kind === "error" ? "text-red-600" : "text-green-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
