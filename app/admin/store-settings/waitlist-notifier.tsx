"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { siteUrl } from "@/lib/site-url";

type WaitlistPerson = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  notified_at: string | null;
};

const DEFAULT_EMAIL_SUBJECT = "We're back — restoration slots now open!";
const DEFAULT_EMAIL_BODY = `Hi [first name],

Great news — The Card Doc is now accepting restoration orders again.

You signed up to be notified, so we wanted to reach out right away. Spots fill up fast!

Book your restoration here: ${siteUrl()}/tier-selection

Thanks,
The Card Doc`;

const DEFAULT_SMS = `Hi [first name]! The Card Doc is now accepting restoration orders. Book your spot: ${siteUrl()}/tier-selection`;

// People per request: the route sends one email batch and the texts for each
// part well inside the function time limit
const PART_SIZE = 20;

export function WaitlistNotifier({
  people,
  loadedAt,
  blockedReason = null,
}: {
  people: WaitlistPerson[];
  /** When the server loaded this list, by its clock */
  loadedAt: string;
  /** Why sending is off (no postal address, unsubscribe links on another site) */
  blockedReason?: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emailSubject, setEmailSubject] = useState(DEFAULT_EMAIL_SUBJECT);
  const [emailBody, setEmailBody] = useState(DEFAULT_EMAIL_BODY);
  const [smsMessage, setSmsMessage] = useState(DEFAULT_SMS);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; texts: number; already: number } | null>(null);
  const [failed, setFailed] = useState<{ email: string; reason: string }[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();
  const [tab, setTab] = useState<"contacts" | "compose">("contacts");
  // The `since` of a send that hasn't finished: when the list it started from
  // was loaded, by the server's clock. Kept after a stop, so sending again
  // skips anyone already reached, even if a reply was lost on the way back.
  const [since, setSince] = useState<string | null>(null);

  // When the list reloads after a stop, people already reached since then
  // come off the selection
  const [shownPeople, setShownPeople] = useState(people);
  if (people !== shownPeople) {
    setShownPeople(people);
    if (since) {
      const sinceMs = Date.parse(since);
      const reached = people.filter((p) => p.notified_at && Date.parse(p.notified_at) >= sinceMs && selected.has(p.id));
      if (reached.length > 0) {
        const next = new Set(selected);
        for (const p of reached) next.delete(p.id);
        setSelected(next);
      }
    }
  }

  const unnotified = people.filter((p) => !p.notified_at);
  const allSelected = selected.size === people.length && people.length > 0;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(people.map((p) => p.id)));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function selectUnnotified() {
    setSelected(new Set(unnotified.map((p) => p.id)));
  }

  async function handleSend() {
    if (selected.size === 0) { setError("Select at least one person."); return; }
    if (!emailSubject.trim() || !emailBody.trim()) { setError("Email subject and body are required."); return; }
    if (!confirm(`Send notifications to ${selected.size} selected contact${selected.size !== 1 ? "s" : ""}?`)) return;

    setSending(true);
    setError("");
    setResult(null);
    setFailed([]);

    // Sent in parts. Everyone reached is marked notified as soon as their part
    // is sent and taken off the selection, so after a stop, sending again
    // carries on with the rest. The route skips anyone notified at or after
    // `since`, so a part whose reply was lost never goes to them twice.
    const ids = Array.from(selected);
    const sendSince = since ?? loadedAt;
    setSince(sendSince);
    let sent = 0;
    let texts = 0;
    let already = 0;
    const failures: { email: string; reason: string }[] = [];
    const remaining = new Set(ids);
    let stopped = false;
    setProgress({ done: 0, total: ids.length });

    try {
      for (let i = 0; i < ids.length; i += PART_SIZE) {
        const part = ids.slice(i, i + PART_SIZE);
        let res: Response;
        let data: { error?: string; sent?: number; texts?: number; notified?: string[]; failed?: { email: string; reason: string }[]; alreadyNotified?: number };
        try {
          res = await fetch("/api/admin/notify-restoration-waitlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: part, emailSubject, emailBody, smsMessage, since: sendSince }),
          });
          data = await res.json().catch(() => ({}));
        } catch {
          setError(`Network error. ${sent} email${sent !== 1 ? "s" : ""} went out before it stopped; send again to reach the rest.`);
          stopped = true;
          break;
        }
        sent += data.sent ?? 0;
        texts += data.texts ?? 0;
        already += data.alreadyNotified ?? 0;
        failures.push(...(data.failed ?? []));
        for (const id of data.notified ?? []) remaining.delete(id);
        setProgress({ done: Math.min(i + part.length, ids.length), total: ids.length });
        if (!res.ok) {
          setError(data.error ?? "Failed to send.");
          stopped = true;
          break;
        }
      }
    } finally {
      if (!stopped) setSince(null);
      if (!stopped || sent > 0 || texts > 0 || already > 0) setResult({ sent, texts, already });
      setFailed(failures);
      setSelected(new Set(remaining));
      setProgress(null);
      setSending(false);
      router.refresh();
    }
  }

  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground">No one on the waitlist yet.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 w-fit">
        {(["contacts", "compose"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors capitalize ${
              tab === t ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "contacts" ? `Contacts (${people.length})` : "Message"}
          </button>
        ))}
      </div>

      {tab === "contacts" && (
        <div className="space-y-3">
          {/* Bulk actions */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button onClick={toggleAll} className="text-primary font-semibold hover:underline">
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            <span className="text-muted-foreground">·</span>
            <button onClick={selectUnnotified} className="text-primary font-semibold hover:underline">
              Select unnotified ({unnotified.length})
            </button>
            {selected.size > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{selected.size} selected</span>
              </>
            )}
          </div>

          {/* Contact list */}
          <div className="border border-border rounded-lg overflow-hidden divide-y divide-border max-h-72 overflow-y-auto">
            {people.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggleOne(p.id)}
                  className="w-4 h-4 accent-primary flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{p.name || "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.email}{p.phone ? ` · ${p.phone}` : ""}</p>
                </div>
                {p.notified_at ? (
                  <span className="text-xs text-muted-foreground shrink-0">Notified</span>
                ) : (
                  <span className="text-xs font-semibold text-amber-600 shrink-0">Pending</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === "compose" && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email Subject</label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email Body</label>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono resize-y"
            />
            <p className="text-xs text-muted-foreground">Use [first name] where you want the customer&apos;s first name inserted.</p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">SMS Message</label>
            <textarea
              value={smsMessage}
              onChange={(e) => setSmsMessage(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono resize-y"
            />
            <p className="text-xs text-muted-foreground">Only sent to contacts who provided a phone number. Use [first name] for personalization.</p>
          </div>
        </div>
      )}

      {/* Send button — always visible */}
      {blockedReason && <p className="text-sm text-red-600 font-medium">Sending is off. {blockedReason}</p>}
      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      {result && (
        <p className="text-sm text-green-600 font-semibold">
          ✓ Sent {result.sent} email{result.sent !== 1 ? "s" : ""}
          {result.texts > 0 ? ` + ${result.texts} text${result.texts !== 1 ? "s" : ""}` : ""}
          {failed.length > 0 && <span className="text-red-600"> · {failed.length} not sent</span>}
          {result.already > 0 && <span className="text-muted-foreground"> · {result.already} already notified, skipped</span>}
        </p>
      )}
      {failed.length > 0 && (
        <details className="border border-border rounded-lg px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-foreground">
            {failed.length} email{failed.length !== 1 ? "s" : ""} not sent
          </summary>
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {failed.map((f, i) => (
              <li key={`${f.email}-${i}`} className="text-muted-foreground break-all">
                <span className="text-foreground">{f.email}</span>: {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button
        onClick={handleSend}
        disabled={sending || selected.size === 0 || !!blockedReason}
        className="h-9 px-5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
      >
        {sending
          ? progress && progress.done > 0
            ? `Sending… ${progress.done} of ${progress.total}`
            : "Sending…"
          : `Send to ${selected.size || "…"} selected`}
      </button>
    </div>
  );
}
