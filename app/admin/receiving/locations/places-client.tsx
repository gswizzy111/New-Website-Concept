"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Pencil, Plus, Power, ScanLine } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { STAGES, adminStageLabel } from "@/lib/restoration-stages";
import { MergedPrintButton } from "../shelf/_components/print-buttons";
import { KIND_NAMES, scanMoveHref, signUrl, stationStepText, type PlaceKind } from "../shelf/_lib/places";
import { prepareShelfSlots } from "./actions";

/**
 * The Places page's client parts: one place's row (print its sign, move cards
 * there, rename, turn off or on), the add form and the batch sign prints.
 * Writes go through /api/admin/track/locations (POST create, PATCH rename or
 * turn off/on); the page re-renders after each.
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const quiet = `min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 inline-flex items-center gap-1.5 disabled:opacity-50 ${focusRing}`;

export type PlaceItemData = {
  id: string;
  code: string;
  name: string;
  kind: PlaceKind;
  stage: string | null;
  dueDate: string | null;
  active: boolean;
  cardCount: number;
  /** "Overdue", "Today" etc. for a shelf slot; null otherwise. */
  note?: string | null;
  /** The Shelf view's section for this slot. */
  shelfHref?: string | null;
};

async function send(method: "POST" | "PATCH", body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/admin/track/locations", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return "Network error. Check the connection and try again.";
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return typeof data.error === "string" ? data.error : `Couldn't save (${res.status}).`;
}

/** One place: its name, code and step, how many cards are there, and what can be done with it. */
export function PlaceItem({ place }: { place: PlaceItemData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(place.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const step = place.kind === "station" ? stationStepText(place.stage) : "";

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next) return setError("A place needs a name.");
    if (next === place.name) return setEditing(false);
    setBusy(true);
    setError("");
    const problem = await send("PATCH", { id: place.id, name: next });
    setBusy(false);
    if (problem) return setError(problem);
    setEditing(false);
    router.refresh();
  }

  async function setActive(active: boolean) {
    if (!active) {
      const here = place.cardCount
        ? ` ${place.cardCount} card${place.cardCount === 1 ? " is" : "s are"} there now; ${place.cardCount === 1 ? "it stays" : "they stay"} listed there until scanned somewhere else.`
        : "";
      if (!confirm(`Turn off ${place.name}? It leaves the lists and its sign can't be scanned for moves. You can turn it back on.${here}`)) return;
    }
    setBusy(true);
    setError("");
    const problem = await send("PATCH", { id: place.id, active });
    setBusy(false);
    if (problem) return setError(problem);
    router.refresh();
  }

  return (
    <li className={`bg-white rounded-xl border border-border p-4 ${place.active ? "" : "opacity-70"}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
              <label htmlFor={`name-${place.id}`} className="sr-only">Name of {place.name}</label>
              <input
                id={`name-${place.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                autoFocus
                className="h-11 min-w-0 flex-1 basis-48 px-3 rounded-lg border border-border bg-white text-base sm:text-sm font-semibold"
              />
              <button type="submit" disabled={busy} className={`min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 ${focusRing}`}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => { setEditing(false); setName(place.name); setError(""); }} className={quiet}>
                Cancel
              </button>
            </form>
          ) : (
            <p className="font-heading font-black text-xl leading-tight text-foreground [overflow-wrap:anywhere]">{place.name}</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{place.code}</span>
            {step ? ` · ${step}` : place.kind !== "station" && place.kind !== "shelf" ? ` · ${KIND_NAMES[place.kind]}` : ""}
            {place.note ? <span className="font-bold"> · {place.note}</span> : null}
            {!place.active && <span className="font-bold text-foreground"> · Turned off</span>}
          </p>
        </div>

        <p className="text-sm md:w-28 md:text-right">
          {place.shelfHref && place.cardCount > 0 ? (
            <AdminLink href={place.shelfHref} className={`font-bold text-primary hover:underline rounded ${focusRing}`}>
              {place.cardCount} card{place.cardCount === 1 ? "" : "s"}
            </AdminLink>
          ) : (
            <span className={place.cardCount ? "font-bold text-foreground" : "text-muted-foreground"}>
              {place.cardCount ? `${place.cardCount} card${place.cardCount === 1 ? "" : "s"}` : "No cards"}
            </span>
          )}
        </p>

        <div className="flex flex-wrap items-start gap-2">
          {place.active && (
            <>
              <MergedPrintButton
                load={async () => ({ urls: [signUrl(place.id)] })}
                fileName={`${place.code}-sign.pdf`}
                prepareLabel="Print sign"
                printLabel={() => `Print the ${place.name} sign`}
              />
              <AdminLink href={scanMoveHref(place.code)} className={quiet} aria-label={`Move cards to ${place.name}`}>
                <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
                Move here
              </AdminLink>
            </>
          )}
          {!editing && (
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className={quiet} aria-label={`Rename ${place.name}`}>
              <Pencil aria-hidden className="size-4" strokeWidth={1.75} />
              Rename
            </button>
          )}
          <button type="button" onClick={() => setActive(!place.active)} disabled={busy} className={quiet}>
            <Power aria-hidden className="size-4" strokeWidth={1.75} />
            {place.active ? "Turn off" : "Turn on"}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
    </li>
  );
}

const ADDABLE: { kind: PlaceKind; label: string }[] = [
  { kind: "station", label: "Station (sets a step)" },
  { kind: "other", label: "Other place" },
  { kind: "done", label: "Done shelf" },
  { kind: "shipping", label: "Shipping" },
];

/** Add a place: a name, what kind it is and, for a station, the step scanning there sets. */
export function AddPlaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PlaceKind>("station");
  const [stage, setStage] = useState<string>(STAGES[0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setMessage({ ok: false, text: "Give the place a name." });
    setBusy(true);
    setMessage(null);
    const problem = await send("POST", { name: n, kind, ...(kind === "station" ? { stage } : {}) });
    setBusy(false);
    if (problem) return setMessage({ ok: false, text: problem });
    setName("");
    setMessage({ ok: true, text: `${n} added. Print its sign from the list.` });
    router.refresh();
  }

  const field = "h-11 px-3 rounded-lg border border-border bg-white text-base sm:text-sm font-semibold text-foreground w-full";
  return (
    <form onSubmit={add} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)_auto] sm:items-end">
      <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Humidor 2" className={`${field} normal-case tracking-normal`} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as PlaceKind)} className={`${field} normal-case tracking-normal`}>
          {ADDABLE.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
      </label>
      <label className={`flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground ${kind === "station" ? "" : "invisible max-sm:hidden"}`}>
        Step
        <select value={stage} onChange={(e) => setStage(e.target.value)} disabled={kind !== "station"} className={`${field} normal-case tracking-normal`}>
          {STAGES.map((s, i) => <option key={s} value={s}>{`Step ${i + 1} · ${adminStageLabel(s)}`}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy} className={`min-h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 ${focusRing}`}>
        <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        {busy ? "Adding…" : "Add place"}
      </button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`sm:col-span-4 text-sm font-semibold ${message.ok ? "text-green-700" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      <p className="sm:col-span-4 text-xs text-muted-foreground">
        <MapPin aria-hidden className="inline size-3.5 -mt-0.5 mr-1" strokeWidth={1.75} />
        Shelf slots aren&apos;t added here: each due date gets its own when cards are received (or with the shelf signs button above).
      </p>
    </form>
  );
}

/** Every active station's sign, as one print. */
export function StationSignsPrint({ placeIds }: { placeIds: string[] }) {
  if (!placeIds.length) return null;
  return (
    <MergedPrintButton
      load={async () => ({ urls: placeIds.map(signUrl) })}
      fileName="station-signs.pdf"
      prepareLabel={`Print all station signs (${placeIds.length})`}
      printLabel={(n) => `Print ${n} station sign${n === 1 ? "" : "s"}`}
    />
  );
}

/** The next 10 business days' shelf slots (made where missing), their signs as one print. */
export function NextShelfSignsPrint() {
  const router = useRouter();
  return (
    <MergedPrintButton
      load={async () => {
        const r = await prepareShelfSlots(10).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Couldn't make the shelf slots." }));
        if (!r.ok) return { error: r.error };
        router.refresh(); // new slots show in the list
        return { urls: r.slots.map((s) => signUrl(s.id)) };
      }}
      fileName="shelf-signs-next-10-days.pdf"
      prepareLabel="Print shelf signs for the next 10 business days"
      printLabel={(n) => `Print ${n} shelf sign${n === 1 ? "" : "s"}`}
    />
  );
}
