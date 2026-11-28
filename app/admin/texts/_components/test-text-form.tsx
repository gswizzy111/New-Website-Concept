"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEST_SMS_TEXT } from "./text-helpers";

/** The Setup box's "Send a test text" (POST /api/admin/texts/test). */
export function TestTextForm({ disabledReason }: { disabledReason: string | null }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) { setResult({ ok: false, message: "Enter a phone number first." }); return; }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/texts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setResult({ ok: false, message: data.error ?? "Not sent." }); return; }
      setResult({ ok: true, message: `Sent to ${data.to ?? phone}. It shows under Recent texts; its status changes to Delivered when the carrier confirms.` });
      router.refresh();
    } catch {
      setResult({ ok: false, message: "Couldn't reach the server. Nothing was sent." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Send a test text</p>
      <p className="text-xs text-muted-foreground">Sends &ldquo;{TEST_SMS_TEXT}&rdquo; to the number you type, usually your own phone.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="test-text-phone" className="sr-only">Phone number</label>
        <input
          id="test-text-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(201) 555-1234"
          className="h-9 w-48 px-3 rounded-lg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={busy || !!disabledReason}
          className="h-9 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send test text"}
        </button>
      </div>
      {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-xs font-medium break-words ${result.ok ? "text-green-700" : "text-red-600"}`}>
          {result.message}
        </p>
      )}
    </form>
  );
}
