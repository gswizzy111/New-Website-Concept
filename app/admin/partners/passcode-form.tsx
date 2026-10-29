"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PARTNER_PASSCODE_MIN } from "@/lib/partner-portal-rules";

// Passcodes are stored hashed, so the page can't show them: the admin sets a new one instead
export function PasscodeForm({ partnerId }: { partnerId: string }) {
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/passcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the passcode. Please try again.");
      setPasscode("");
      setOpen(false);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the passcode. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <p className="text-xs text-muted-foreground mt-1">
        Passcode: <span className="font-mono font-bold text-foreground">••••••••</span>{" "}
        <button
          type="button"
          onClick={() => { setOpen(true); setSaved(false); }}
          className="font-bold text-primary hover:underline underline-offset-2"
        >
          Set new passcode
        </button>
        {saved && <span className="ml-2 font-semibold text-green-600">Passcode updated.</span>}
      </p>
    );
  }

  return (
    <form onSubmit={save} className="mt-2 flex flex-wrap items-center gap-2">
      <input
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        placeholder={`At least ${PARTNER_PASSCODE_MIN} characters`}
        minLength={PARTNER_PASSCODE_MIN}
        required
        autoComplete="off"
        aria-label="New passcode"
        className="w-56 border border-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <button
        type="submit"
        disabled={saving}
        className="text-xs font-bold px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {saving ? "Saving..." : "Save"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setPasscode(""); setError(""); }}
        className="text-xs px-2 py-1.5 text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
