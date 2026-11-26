"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLink } from "@/components/admin-ui/admin-link";
import type { WorkshopUserView } from "@/lib/workshop-users";
import {
  cardsText, confirmFor, lastSignInText, setupLinkText, shortWhen, signedOutText, turnedOffText, turnedOnText,
  workerStatus, workerTitle, type RowAction, type Tone,
} from "../_lib/view";

/**
 * The Team page's controls: "Add a worker" (username, optional name; then
 * the one-time setup link with Copy), and per worker Turn off / on, New
 * setup link and Sign out everywhere (/api/admin/team/**, full admins only).
 * Every change asks first except turning someone back on, then refreshes the
 * list from the server.
 */

export type TeamRow = WorkshopUserView & { cardsThisWeek: number | null; activityHref: string };

const button = "inline-flex items-center justify-center min-h-11 px-4 rounded-lg text-sm font-bold whitespace-nowrap transition-colors disabled:opacity-50";
const primary = `${button} bg-primary text-primary-foreground hover:bg-primary/90`;
const quiet = `${button} border border-border bg-white text-foreground hover:border-foreground/40`;
const danger = `${button} border border-red-200 bg-white text-red-700 hover:border-red-400`;
const field = "min-h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:outline-none focus:border-primary";

const TONE: Record<Tone, string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-800",
  gray: "bg-gray-200 text-gray-800",
};

async function call(url: string, method: "POST" | "PATCH", body?: unknown): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "That didn't work. Please try again." };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check the connection and try again." };
  }
}

/** The setup link, a Copy button and what to do with it. */
function SetupLink({ url, name, onDone }: { url: string; name: string; onDone?: () => void }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked: select the link so it can be copied by hand
      input.current?.focus();
      input.current?.select();
    }
  }
  return (
    <div className="rounded-xl border border-green-200 bg-green-50 p-3 sm:p-4 flex flex-col gap-2" data-setup-link>
      <label htmlFor={id} className="text-xs font-bold text-green-900">Setup link for {name}</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          ref={input}
          id={id}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-11 flex-1 min-w-0 rounded-lg border border-green-200 bg-white px-3 font-mono text-xs text-foreground"
        />
        <button type="button" onClick={copy} className={`${primary} sm:w-28`}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="text-sm text-green-900" aria-live="polite">
        {setupLinkText(name)}
        {copied && <span className="sr-only"> Link copied.</span>}
      </p>
      {onDone && (
        <button type="button" onClick={onDone} className="self-start inline-flex items-center min-h-11 text-sm font-semibold text-green-900 underline underline-offset-2">
          Done
        </button>
      )}
    </div>
  );
}

function AddWorker() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState<{ url: string; name: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const r = await call("/api/admin/team", "POST", { username: username.trim(), name: name.trim() || null });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const worker = r.data.worker as WorkshopUserView | undefined;
    setMade({ url: String(r.data.setupUrl ?? ""), name: worker ? workerTitle(worker) : username.trim() });
    setUsername("");
    setName("");
    router.refresh();
  }

  return (
    <section className="bg-white rounded-xl border border-border p-4 sm:p-6 flex flex-col gap-4" aria-labelledby="add-worker">
      <div>
        <h2 id="add-worker" className="font-heading font-black text-lg text-foreground">Add a worker</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          You get a setup link to give them. They open it, choose a password, then sign in on the admin login with their username.
        </p>
      </div>
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 sm:items-end" noValidate>
        <div>
          <label htmlFor="worker-username" className="block text-xs font-semibold text-muted-foreground mb-1.5">Username</label>
          <input
            id="worker-username"
            className={field}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))}
            placeholder="sam"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-describedby="worker-username-hint"
            maxLength={32}
          />
        </div>
        <div>
          <label htmlFor="worker-name" className="block text-xs font-semibold text-muted-foreground mb-1.5">Their name <span className="font-normal">(optional)</span></label>
          <input id="worker-name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Lee" autoComplete="off" maxLength={60} />
        </div>
        <button type="submit" disabled={busy || !username.trim()} className={`${primary} w-full sm:w-auto`}>
          {busy ? "Adding…" : "Add a worker"}
        </button>
        <p id="worker-username-hint" className="sm:col-span-3 -mt-1 text-xs text-muted-foreground">
          Username: lower case letters or numbers, no spaces. They sign in with it, and the Activity page shows it.
        </p>
      </form>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {made && <SetupLink url={made.url} name={made.name} onDone={() => setMade(null)} />}
    </section>
  );
}

function WorkerRow({ w }: { w: TeamRow }) {
  const router = useRouter();
  const [asking, setAsking] = useState<Exclude<RowAction, "on"> | null>(null);
  const [busy, setBusy] = useState<RowAction | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const name = workerTitle(w);
  const status = workerStatus(w);

  // The question takes focus, so a keyboard or screen reader lands on it
  useEffect(() => {
    if (asking) questionRef.current?.focus();
  }, [asking]);

  async function run(action: RowAction) {
    setAsking(null);
    setBusy(action);
    setMessage(null);
    const base = `/api/admin/team/${w.id}`;
    const r = action === "off" || action === "on"
      ? await call(base, "PATCH", { active: action === "on" })
      : action === "reset"
        ? await call(`${base}/setup-link`, "POST")
        : await call(`${base}/sign-out`, "POST");
    setBusy(null);
    if (!r.ok) return setMessage({ text: r.error, tone: "error" });
    const ended = Number(r.data.endedSessions ?? 0) || 0;
    const worker = (r.data.worker as WorkshopUserView | undefined) ?? w;
    if (action === "reset") {
      setLink(String(r.data.setupUrl ?? ""));
      if (ended) setMessage({ text: signedOutText(ended), tone: "ok" });
    } else {
      setLink(null);
      setMessage({ text: action === "off" ? turnedOffText(ended) : action === "on" ? turnedOnText(worker) : signedOutText(ended), tone: "ok" });
    }
    router.refresh();
  }

  const ask = asking ? confirmFor(asking, w) : null;

  return (
    <li className="px-4 sm:px-5 py-4 flex flex-col gap-3" data-worker={w.username}>
      <div className="flex flex-col lg:flex-row lg:items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-base text-foreground break-words">{name}</p>
            {w.name && <span className="font-mono text-xs text-muted-foreground">{w.username}</span>}
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE[status.tone]}`}>{status.label}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {lastSignInText(w.lastLoginAt)}
            {!w.hasPassword && w.setupPending && w.setupExpiresAt && w.active ? ` · Setup link works until ${shortWhen(w.setupExpiresAt)}` : ""}
          </p>
          <p className="text-sm mt-0.5">
            {w.cardsThisWeek === null ? (
              <span className="text-muted-foreground">Cards this week: couldn&apos;t be counted</span>
            ) : (
              <AdminLink href={w.activityHref} className="inline-flex items-center min-h-11 font-semibold text-primary hover:underline underline-offset-2">
                {cardsText(w.cardsThisWeek)} handled this week →
              </AdminLink>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {w.active ? (
            <button type="button" className={danger} disabled={!!busy} onClick={() => setAsking("off")}>
              {busy === "off" ? "Turning off…" : "Turn off"}
            </button>
          ) : (
            <button type="button" className={quiet} disabled={!!busy} onClick={() => run("on")}>
              {busy === "on" ? "Turning on…" : "Turn on"}
            </button>
          )}
          {w.active && (
            <button type="button" className={quiet} disabled={!!busy} onClick={() => setAsking("reset")}>
              {busy === "reset" ? "Making a link…" : "New setup link"}
            </button>
          )}
          {w.active && w.hasPassword && (
            <button type="button" className={quiet} disabled={!!busy} onClick={() => setAsking("signout")}>
              {busy === "signout" ? "Signing out…" : "Sign out everywhere"}
            </button>
          )}
        </div>
      </div>

      {ask && asking && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 sm:p-4 flex flex-col gap-3" role="group" aria-label={`Confirm for ${name}`}>
          <p ref={questionRef} tabIndex={-1} className="text-sm font-semibold text-amber-950 outline-none">{ask.question}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={asking === "off" ? `${button} bg-red-600 text-white hover:bg-red-700` : primary} onClick={() => run(asking)}>
              {ask.yes}
            </button>
            <button type="button" className={quiet} onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </div>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-red-700" : "text-green-800"}`}>
          {message.text}
        </p>
      )}
      {link && <SetupLink url={link} name={name} onDone={() => setLink(null)} />}
    </li>
  );
}

export function TeamManager({ workers, error }: { workers: TeamRow[]; error: string | null }) {
  return (
    <>
      <AddWorker />
      <section className="bg-white rounded-xl border border-border overflow-hidden" aria-labelledby="workers">
        <div className="px-4 sm:px-5 py-4 border-b border-border">
          <h2 id="workers" className="font-heading font-black text-lg text-foreground">Workers</h2>
        </div>
        {error && <p role="alert" className="px-4 sm:px-5 py-4 text-sm text-red-700">{error}</p>}
        {!error && workers.length === 0 && (
          <p className="px-4 sm:px-5 py-10 text-center text-sm text-muted-foreground">No workers yet. Add one above.</p>
        )}
        {workers.length > 0 && <ul className="divide-y divide-border">{workers.map((w) => <WorkerRow key={w.id} w={w} />)}</ul>}
      </section>
    </>
  );
}
