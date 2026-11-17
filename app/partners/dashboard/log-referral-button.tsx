"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cta } from "@/components/brand";

export function LogReferralButton() {
  const [open, setOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/partners/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: clientName, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOpen(false);
      setClientName("");
      setNotes("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cta({ tone: "outline", size: "lg", className: "w-full" })}
      >
        Log Referral
      </button>
    );
  }

  return (
    <div className="col-span-2 flex flex-col gap-3 rounded-[22px] bg-white p-5 shadow-[0_0_0_1px_var(--line),var(--panel-shadow)]">
      <p className="font-heading text-[1.5rem] leading-none font-extrabold text-ink">Log Referral</p>
      <input
        type="text"
        value={clientName}
        onChange={(e) => setClientName(e.target.value)}
        placeholder="Client name"
        className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
      />
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes — e.g. restoration, PSA prep (optional)"
        className="w-full h-11 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className={cta({ tone: "sun", size: "sm" })}
        >
          {saving ? "Saving..." : "Log Referral"}
        </button>
        <button onClick={() => setOpen(false)} className="min-h-11 rounded-full px-4 text-sm font-bold text-ink-soft hover:bg-chalk hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}
