"use client";

import { useState } from "react";
import type { UnfinishedBlast } from "./blasts";

type Status = "idle" | "sending" | "done" | "stopped";

type Failure = { email: string; reason: string };
type Progress = { sent: number; failed: Failure[]; total: number };

export function ComposeForm({
  totalEmails,
  blocked = false,
  unfinished = null,
}: {
  totalEmails: number;
  blocked?: boolean;
  /** A send that stopped part way (a closed tab, a lost connection) */
  unfinished?: UnfinishedBlast | null;
}) {
  const [subject, setSubject] = useState(unfinished?.subject ?? "");
  const [body, setBody] = useState(unfinished?.body ?? "");
  const [status, setStatus] = useState<Status>(unfinished ? "stopped" : "idle");
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  // The current send: its id, made when Send is pressed and kept for every
  // part, and how far it got as the server reports it. The server keeps that
  // record, so Continue picks up where the send really stopped, even after a
  // lost reply or a closed tab, and never sends a part twice.
  const [blastId, setBlastId] = useState<string | null>(unfinished?.id ?? null);
  const [progress, setProgress] = useState<Progress | null>(
    unfinished ? { sent: unfinished.sent, failed: unfinished.failed, total: totalEmails } : null
  );
  const [discarding, setDiscarding] = useState(false);

  async function send(id: string) {
    setStatus("sending");
    setError(null);
    setResult(null);
    let lastNext: string | null = null;

    try {
      for (;;) {
        const res = await fetch("/api/admin/email-blast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blastId: id, subject, body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Send failed");
        const now: Progress = {
          sent: data.sent ?? 0,
          failed: (data.failedEmails ?? []) as Failure[],
          total: data.total ?? totalEmails,
        };
        setProgress(now);
        if (data.stopped) throw new Error(data.stopped);
        if (data.done) {
          setResult({ sent: now.sent, failed: now.failed.length });
          break;
        }
        if (data.next === lastNext) throw new Error("Sending stopped without getting further.");
        lastNext = data.next ?? null;
      }
      setStatus("done");
      setConfirmed(false);
      setBlastId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      // Continue picks up from what the server saved
      setStatus("stopped");
    }
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) {
      setError("Subject and message are required.");
      return;
    }
    if (!confirmed) {
      setError(`Please confirm you want to send to all ${totalEmails} contacts.`);
      return;
    }
    const id = crypto.randomUUID();
    setBlastId(id);
    setProgress({ sent: 0, failed: [], total: totalEmails });
    await send(id);
  }

  // Sets the stopped send aside. The text is cleared too, so the same message
  // isn't sent again from the start by mistake.
  async function discard() {
    if (blastId) {
      setDiscarding(true);
      try {
        const res = await fetch("/api/admin/email-blast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blastId, discard: true }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "Couldn't set this send aside. Try again.");
          return;
        }
      } catch {
        setError("Couldn't reach the server. Try again.");
        return;
      } finally {
        setDiscarding(false);
      }
    }
    setBlastId(null);
    setStatus("idle");
    setProgress(null);
    setError(null);
    setConfirmed(false);
    setSubject("");
    setBody("");
  }

  const canSend = !blocked && status !== "sending" && status !== "stopped" && subject.trim().length > 0 && body.trim().length > 0;

  return (
    <div className="bg-white rounded-xl border border-border p-6 space-y-5">
      <div>
        <h2 className="font-heading font-bold text-xl text-foreground">Compose Email</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Will be sent to all <span className="font-semibold text-foreground">{totalEmails}</span> contacts
        </p>
      </div>

      {status === "done" && result && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm">
          <p className="font-semibold text-green-800">
            Sent to {result.sent} contact{result.sent !== 1 ? "s" : ""}
            {result.failed > 0 && (
              <span className="text-red-600"> · {result.failed} failed</span>
            )}
          </p>
        </div>
      )}

      {status === "stopped" && progress && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm space-y-2">
          <p className="font-semibold text-amber-900">
            Sending stopped. Sent to {progress.sent} of {progress.total} so far
            {progress.failed.length > 0 && <span className="text-red-600"> · {progress.failed.length} failed</span>}
          </p>
          <p className="text-amber-900">Continue sends it to the rest. The message can&apos;t be changed until this send is finished.</p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => blastId && send(blastId)}
              disabled={blocked || discarding || !blastId}
              className="h-9 px-4 rounded-full bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue sending
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={discarding}
              className="text-sm font-semibold text-amber-900 underline disabled:opacity-40"
            >
              Write a new email instead
            </button>
          </div>
        </div>
      )}

      {(status === "done" || status === "stopped") && progress && progress.failed.length > 0 && (
        <details className="border border-border rounded-lg px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-foreground">
            {progress.failed.length} address{progress.failed.length !== 1 ? "es" : ""} failed
          </summary>
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {progress.failed.map((f) => (
              <li key={f.email} className="text-muted-foreground break-all">
                <span className="text-foreground">{f.email}</span>: {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Subject line
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. We're back — restoration slots now open!"
          className="w-full px-3 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          disabled={status === "sending" || status === "stopped"}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Message body
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Hi [first name],\n\nWrite your message here...\n\nThanks,\nThe Card Doc`}
          rows={10}
          className="w-full px-3 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono leading-relaxed resize-y"
          disabled={status === "sending" || status === "stopped"}
        />
        <p className="text-xs text-muted-foreground">
          Write in plain text. Each line becomes a paragraph. Each contact&apos;s first name is automatically inserted.
        </p>
      </div>

      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <input
          type="checkbox"
          id="confirm-send"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="w-4 h-4 mt-0.5 accent-amber-600 flex-shrink-0"
          disabled={status === "sending" || status === "stopped"}
        />
        <label htmlFor="confirm-send" className="text-sm cursor-pointer text-amber-900">
          I confirm I want to send this email to all <strong>{totalEmails}</strong> contacts. This cannot be undone.
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600 font-medium">{error}</p>
      )}

      <button
        onClick={handleSend}
        disabled={!canSend || !confirmed}
        className="w-full py-3 px-6 rounded-full font-bold text-sm transition-all duration-150 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {status === "sending"
          ? progress && progress.sent + progress.failed.length > 0
            ? `Sending… ${progress.sent + progress.failed.length} of ${progress.total}`
            : "Sending…"
          : `Send to ${totalEmails} contacts`}
      </button>
    </div>
  );
}
