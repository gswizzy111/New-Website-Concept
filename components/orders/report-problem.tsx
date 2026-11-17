"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { PhotoUploader } from "@/components/order-builder/photo-uploader";
import { PROBLEM_NOTICE } from "@/lib/problem-report-notice";
import { cta } from "@/components/brand";
import { PANEL, PANEL_TITLE } from "@/components/account/portal";

/** "Report a problem" on an order page (Terms Section 20). */
export function ReportProblem({ orderRef, email }: { orderRef: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/orders/${encodeURIComponent(orderRef)}/problem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, description: description.trim(), photo_urls: photos }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setError(data.error ?? "Something went wrong. Please email thecarddoc1@gmail.com."); return; }
    setSent(true);
  }

  return (
    <div className={PANEL}>
      <h2 className={`${PANEL_TITLE} mb-2`}>Report a problem</h2>
      <p className="flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-cobalt" strokeWidth={1.75} />
        {PROBLEM_NOTICE}
      </p>
      {sent ? (
        <p className="mt-4 flex items-center gap-2 rounded-[14px] bg-success-tint px-4 py-3 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" />Thanks. We got your report and will reply by email.</p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className={cta({ tone: "outline", size: "sm", className: "mt-4" })}>
          Report a problem
        </button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">Order <span className="font-mono">{orderRef}</span></p>
          <label htmlFor="problem-text" className="text-sm font-semibold text-ink">What happened?</label>
          <textarea
            id="problem-text"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Which card or item, what you noticed, and when it was delivered"
            className="w-full min-h-24 py-2.5 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
          />
          <div>
            <p className="mb-1.5 text-sm font-semibold text-ink">Photos of the item and the packaging</p>
            <PhotoUploader photoUrls={photos} onChange={setPhotos} max={6} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="button" onClick={send} disabled={busy || description.trim().length < 10} className={cta({ tone: "sun", size: "md", className: "self-start" })}>
            {busy ? "Sending…" : "Send report"}
          </button>
        </div>
      )}
    </div>
  );
}
