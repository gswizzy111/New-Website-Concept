"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { cta } from "@/components/brand";

export function ComplaintForm({ caseId, token }: { caseId: string; token: string }) {
  const [complaint, setComplaint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!complaint.trim()) { setError("Please describe your complaint."); return; }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cases/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complaint: complaint.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong. Please try again."); setSubmitting(false); return; }
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="text-center py-6">
        <span aria-hidden className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-success-tint text-success">
          <CheckCircle2 className="size-7" strokeWidth={2} />
        </span>
        <p className="mb-2 font-heading text-[1.75rem] leading-none font-black text-ink">Complaint submitted</p>
        <p className="text-[15px] leading-relaxed text-ink-soft">
          We&apos;ll review your case and get back to you within <strong>3 business days</strong>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="complaint-text" className="mb-1.5 block text-sm font-semibold text-ink">
          Your complaint *
        </label>
        <textarea
          id="complaint-text"
          className="w-full resize-none py-2.5 min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"
          rows={6}
          value={complaint}
          onChange={(e) => setComplaint(e.target.value)}
          placeholder="Please describe what happened, including any relevant order details, dates, or other information that will help us investigate..."
          autoFocus
        />
      </div>
      {error && <p className="text-sm text-destructive font-medium">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !complaint.trim()}
        className={cta({ tone: "sun", size: "md", className: "w-full" })}
      >
        {submitting ? "Submitting..." : "Submit Complaint"}
      </button>
    </form>
  );
}
