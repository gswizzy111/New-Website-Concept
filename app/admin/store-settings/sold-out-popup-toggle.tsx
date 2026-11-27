"use client";

import { useState } from "react";

/** Admin switch for the site-wide "sold out, join the waitlist?" pop-up. */
export function SoldOutPopupToggle({ initialOn }: { initialOn: boolean }) {
  const [on, setOn] = useState(initialOn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setSaving(true);
    setError("");
    const next = !on;
    try {
      const res = await fetch("/api/admin/sold-out-popup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Couldn't save.");
        return;
      }
      setOn(next);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border mb-5 ${on ? "border-green-200 bg-green-50/40" : "border-border bg-secondary/30"}`}>
      <div>
        <p className="text-sm font-semibold text-foreground">
          Pop-up on the website: <span className={on ? "text-green-700" : "text-muted-foreground"}>{on ? "ON" : "OFF"}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {on
            ? "Visitors see “All restoration tiers sold out, want to join the waitlist?” once per visit. Turn it off when slots reopen."
            : "Turn it on while every tier is sold out."}
        </p>
        {error && <p className="text-xs text-red-600 font-medium mt-1">{error}</p>}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        className={`h-9 px-4 rounded-lg text-sm font-bold transition-colors disabled:opacity-60 ${on ? "bg-white border border-border text-foreground hover:border-primary/40" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
      >
        {saving ? "Saving…" : on ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}
