"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { REPLY_MAX_CHARS, replyProblem, replySmsText, segmentLabel } from "./text-helpers";

/** A small reply box under a customer's text (POST /api/admin/texts/reply). */
export function ReplyBox({ inboundId }: { inboundId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-primary hover:underline">
        Reply by text
      </button>
    );
  }

  const sentAs = replySmsText(text);

  async function send() {
    const problem = replyProblem(text);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/texts/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inboundId, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Not sent. Try again in a minute."); return; }
      toast.success("Reply sent");
      setText("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      <label htmlFor={`reply-${inboundId}`} className="sr-only">Reply</label>
      <textarea
        id={`reply-${inboundId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={REPLY_MAX_CHARS}
        placeholder="Type a reply"
        className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-y"
      />
      {sentAs && (
        <p className="text-xs text-muted-foreground break-words">
          Sent as: <span className="text-foreground">{sentAs}</span> · {segmentLabel(text)}
        </p>
      )}
      {error && <p role="alert" className="text-xs text-red-600 font-medium">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={busy || !text.trim()}
          className="h-8 px-4 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send reply"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(""); }}
          disabled={busy}
          className="h-8 px-3 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-secondary transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
