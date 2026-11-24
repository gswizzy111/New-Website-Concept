"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Power, ScanLine } from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { LazyPrintButton } from "../shelf/_components/print-buttons";
import { KIND_NAMES, placeLabelsUrl, scanHref, serialText, stepText, type PlaceKind, type StationType } from "../shelf/_lib/places";
import { prepareShelfSlots } from "./actions";

/**
 * The Places page's client parts: slot tiles (who's in the slot, its label,
 * rename, turn off), place rows (shelf slots, Done, Shipping, other), the
 * "Add slots" and "Add a place" forms, and the label prints (a station's
 * serial range, the next 10 business days' shelf signs). Writes go through
 * /api/admin/track/locations (POST, PATCH); the page re-renders after each.
 */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const quiet = `min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 inline-flex items-center justify-center gap-1.5 disabled:opacity-50 ${focusRing}`;
const field = "h-11 px-3 rounded-lg border border-border bg-white text-base sm:text-sm font-semibold text-foreground w-full normal-case tracking-normal";
const caption = "flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground";

async function send(method: "POST" | "PATCH", body: Record<string, unknown>): Promise<{ error: string } | { data: unknown }> {
  const res = await fetch("/api/admin/track/locations", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { error: "Network error. Check the connection and try again." };
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { data };
  return { error: typeof data?.error === "string" ? data.error : `Couldn't save (${res.status}).` };
}

/** Rename and turn off/on, shared by slot tiles and place rows. */
function usePlaceEdits(place: { id: string; name: string; cardCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function rename(next: string): Promise<boolean> {
    const name = next.trim();
    if (!name) {
      setError("A place needs a name.");
      return false;
    }
    if (name === place.name) return true;
    setBusy(true);
    setError("");
    const r = await send("PATCH", { id: place.id, name });
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function setActive(active: boolean) {
    if (!active) {
      const here = place.cardCount
        ? ` ${place.cardCount} card${place.cardCount === 1 ? " is" : "s are"} in it now and stay${place.cardCount === 1 ? "s" : ""} listed there until moved.`
        : "";
      if (!confirm(`Turn off ${place.name}? It leaves the lists and its QR can't be used for moves. You can turn it back on.${here}`)) return;
    }
    setBusy(true);
    setError("");
    const r = await send("PATCH", { id: place.id, active });
    setBusy(false);
    if ("error" in r) setError(r.error);
    else router.refresh();
  }

  return { busy, error, rename, setActive };
}

function RenameForm({ id, name, busy, onSave, onCancel }: { id: string; name: string; busy: boolean; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(name);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(value); }} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`name-${id}`} className="sr-only">New name for {name}</label>
      <input
        id={`name-${id}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={60}
        autoFocus
        className="h-11 min-w-0 flex-1 basis-40 px-3 rounded-lg border border-border bg-white text-base sm:text-sm font-semibold"
      />
      <button type="submit" disabled={busy} className={`min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 ${focusRing}`}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} className={quiet}>Cancel</button>
    </form>
  );
}

// ── Slots ──────────────────────────────────────────────────────────────────

export type SlotCard = { id: string; code: string | null; name: string; customer: string | null; dueText: string | null };

export type SlotTileData = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  capacity: number | null;
  cards: SlotCard[];
};

/** One serial-numbered slot: who's in it (or Empty), its label, rename and turn off. */
export function SlotTile({ slot }: { slot: SlotTileData }) {
  const { busy, error, rename, setActive } = usePlaceEdits({ id: slot.id, name: slot.name, cardCount: slot.cards.length });
  const [managing, setManaging] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const n = slot.cards.length;
  const over = slot.capacity != null && n > slot.capacity;
  const tone = over ? "border-amber-400 bg-amber-50" : n ? "border-primary/40 bg-primary/5" : "border-dashed border-border bg-white";

  return (
    <li className={`min-w-0 rounded-xl border p-3 flex flex-col gap-2 ${tone} ${slot.active ? "" : "opacity-70"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-heading font-black text-xl leading-none text-foreground [overflow-wrap:anywhere]">{slot.name}</p>
        {(slot.capacity == null ? n > 0 : slot.capacity > 1 || over) && (
          <span className={`shrink-0 text-xs font-black tabular-nums ${over ? "text-amber-800" : "text-muted-foreground"}`}>
            {slot.capacity == null ? n : `${n}/${slot.capacity}`}
          </span>
        )}
      </div>
      {n === 0 ? (
        <p className="text-sm text-muted-foreground">Empty</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label={`In ${slot.name}`}>
          {slot.cards.slice(0, 3).map((c) => (
            <li key={c.id} className="min-w-0 text-sm leading-snug">
              <AdminLink href={`/admin/receiving/card/${c.id}`} className={`font-semibold text-foreground hover:text-primary hover:underline [overflow-wrap:anywhere] rounded ${focusRing}`}>
                {c.name}
              </AdminLink>
              {c.code && <span className="font-mono text-xs font-semibold text-muted-foreground whitespace-nowrap"> · {c.code}</span>}
              {(c.customer || c.dueText) && (
                <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{[c.customer, c.dueText].filter(Boolean).join(" · ")}</span>
              )}
            </li>
          ))}
          {n > 3 && <li className="text-xs font-bold text-muted-foreground">and {n - 3} more</li>}
        </ul>
      )}
      {over && <p className="text-xs font-bold text-amber-800">Over capacity ({slot.capacity})</p>}

      {renaming ? (
        <RenameForm id={slot.id} name={slot.name} busy={busy} onSave={async (v) => { if (await rename(v)) setRenaming(false); }} onCancel={() => setRenaming(false)} />
      ) : (
        <div className="mt-auto flex flex-wrap gap-1.5">
          {slot.active && (
            <LazyPrintButton
              url={placeLabelsUrl({ ids: [slot.id] })}
              fileName={`${slot.code}-label.pdf`}
              prepareLabel="Label"
              printLabel={() => "Print"}
              compact
              ariaLabel={`Print the ${slot.name} label`}
            />
          )}
          <button type="button" onClick={() => setManaging((m) => !m)} aria-expanded={managing} className={`${quiet} px-2.5`} aria-label={`More for ${slot.name}`}>
            {managing ? "Close" : "More"}
          </button>
          {managing && (
            <>
              {slot.active && (
                <AdminLink href={scanHref(slot.code)} className={`${quiet} px-2.5`}>
                  <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
                  Scan
                </AdminLink>
              )}
              <button type="button" onClick={() => setRenaming(true)} disabled={busy} className={`${quiet} px-2.5`}>
                <Pencil aria-hidden className="size-4" strokeWidth={1.75} />
                Rename
              </button>
              <button type="button" onClick={() => setActive(!slot.active)} disabled={busy} className={`${quiet} px-2.5`}>
                <Power aria-hidden className="size-4" strokeWidth={1.75} />
                {slot.active ? "Turn off" : "Turn on"}
              </button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs font-semibold text-red-600">{error}</p>}
    </li>
  );
}

/**
 * A station type's labels for a serial range ("Clamps 01-20"), one label per
 * slot; slots without serial numbers print all together by id.
 */
export function StationRangePrint({ station, name, min, max, ids }: { station: string; name: string; min: number | null; max: number | null; ids: string[] }) {
  if (min == null || max == null) {
    return (
      <LazyPrintButton
        url={placeLabelsUrl({ ids })}
        fileName={`${station}-labels.pdf`}
        prepareLabel={`Labels (${ids.length})`}
        printLabel={() => `Print ${ids.length} ${name} label${ids.length === 1 ? "" : "s"}`}
      />
    );
  }
  return <SerialRangePrint station={station} name={name} min={min} max={max} />;
}

function SerialRangePrint({ station, name, min, max }: { station: string; name: string; min: number; max: number }) {
  const [from, setFrom] = useState(min);
  const [to, setTo] = useState(max);
  const lo = Math.max(min, Math.min(from, to));
  const hi = Math.min(max, Math.max(from, to));
  const url = placeLabelsUrl({ station, from: lo, to: hi });
  const count = hi - lo + 1;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className={`${caption} w-20`}>
        From
        <input type="number" inputMode="numeric" min={min} max={max} value={from} onChange={(e) => setFrom(Number(e.target.value) || min)} className={field} />
      </label>
      <label className={`${caption} w-20`}>
        To
        <input type="number" inputMode="numeric" min={min} max={max} value={to} onChange={(e) => setTo(Number(e.target.value) || max)} className={field} />
      </label>
      <LazyPrintButton
        key={url}
        url={url}
        fileName={`${station}-${serialText(lo)}-${serialText(hi)}-labels.pdf`}
        prepareLabel={count === 1 ? `Label ${serialText(lo)}` : `Labels ${serialText(lo)}–${serialText(hi)}`}
        printLabel={() => `Print ${count} ${name} label${count === 1 ? "" : "s"}`}
      />
    </div>
  );
}

/** "Add slots": a station type and how many; they get the next serial numbers (CLAMP 13, 14...). */
export function AddSlotsForm({ types, nextSerial }: { types: readonly StationType[]; nextSerial: Record<string, number> }) {
  const router = useRouter();
  const [station, setStation] = useState(types[0]?.key ?? "");
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; labels?: { url: string; n: number } } | null>(null);
  const type = types.find((t) => t.key === station);
  const first = nextSerial[station] ?? 1;
  const n = Math.min(99, Math.max(1, Math.floor(count) || 1));
  const upper = (type?.name ?? station).toUpperCase();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!type) return;
    setBusy(true);
    setMessage(null);
    const r = await send("POST", { station, count: n });
    setBusy(false);
    if ("error" in r) return setMessage({ ok: false, text: r.error });
    // The new slots' ids, if the API lists them; else their serial range
    const d = r.data as Record<string, unknown> | unknown[] | null;
    const list = (Array.isArray(d) ? d : [d?.locations, d?.created, d?.slots].find(Array.isArray) ?? []) as { id?: unknown; serial?: unknown }[];
    const ids = list.map((x) => x?.id).filter((id): id is string => typeof id === "string");
    const serials = list.map((x) => x?.serial).filter((s): s is number => typeof s === "number");
    const labels = ids.length
      ? { url: placeLabelsUrl({ ids }), n: ids.length }
      : serials.length
        ? { url: placeLabelsUrl({ station, from: Math.min(...serials), to: Math.max(...serials) }), n: serials.length }
        : { url: placeLabelsUrl({ station, from: first, to: first + n - 1 }), n };
    setMessage({ ok: true, text: `Added ${n} ${type.name.toLowerCase()} slot${n === 1 ? "" : "s"}. Print their labels and stick one on each.`, labels });
    router.refresh();
  }

  return (
    <form onSubmit={add} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end">
      <label className={caption}>
        Station
        <select value={station} onChange={(e) => { setStation(e.target.value); setMessage(null); }} className={field}>
          {types.map((t) => <option key={t.key} value={t.key}>{t.name} ({stepText(t.stage)})</option>)}
        </select>
      </label>
      <label className={caption}>
        How many
        <input type="number" inputMode="numeric" min={1} max={99} value={count} onChange={(e) => setCount(Number(e.target.value))} className={field} />
      </label>
      <button type="submit" disabled={busy || !type} className={`min-h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 ${focusRing}`}>
        <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        {busy ? "Adding…" : `Add ${n}`}
      </button>
      <p className="sm:col-span-3 text-xs text-muted-foreground">
        {n === 1 ? `Makes ${upper} ${serialText(first)}.` : `Makes ${upper} ${serialText(first)} to ${upper} ${serialText(first + n - 1)}.`} Each slot gets a QR label; a card scanned into it moves to that step.
      </p>
      {message && (
        <div role={message.ok ? "status" : "alert"} className={`sm:col-span-3 flex flex-wrap items-center gap-3 text-sm font-semibold ${message.ok ? "text-green-700" : "text-red-600"}`}>
          <span>{message.text}</span>
          {message.labels && (
            <LazyPrintButton
              key={message.labels.url}
              url={message.labels.url}
              fileName={`${station}-new-labels.pdf`}
              prepareLabel={`Labels for the new slots (${message.labels.n})`}
              printLabel={() => `Print ${message.labels!.n} label${message.labels!.n === 1 ? "" : "s"}`}
            />
          )}
        </div>
      )}
    </form>
  );
}

// ── Other places ───────────────────────────────────────────────────────────

export type PlaceItemData = {
  id: string;
  code: string;
  name: string;
  kind: PlaceKind;
  stage: string | null;
  active: boolean;
  cardCount: number;
  /** "Past due date", "Due today" for a shelf slot. */
  note?: string | null;
  /** The Shelf view's section for this slot. */
  shelfHref?: string | null;
};

/** A shelf slot, the Done shelf, Shipping or another place (or a turned-off one): its label, cards, rename, turn off. */
export function PlaceItem({ place }: { place: PlaceItemData }) {
  const { busy, error, rename, setActive } = usePlaceEdits(place);
  const [renaming, setRenaming] = useState(false);
  const detail = place.kind === "station" ? stepText(place.stage) : place.kind === "shelf" ? "" : KIND_NAMES[place.kind];

  return (
    <li className={`bg-white rounded-xl border border-border p-4 ${place.active ? "" : "opacity-70"}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameForm id={place.id} name={place.name} busy={busy} onSave={async (v) => { if (await rename(v)) setRenaming(false); }} onCancel={() => setRenaming(false)} />
          ) : (
            <p className="font-heading font-black text-xl leading-tight text-foreground [overflow-wrap:anywhere]">{place.name}</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{place.code}</span>
            {detail ? ` · ${detail}` : ""}
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
              <LazyPrintButton
                url={placeLabelsUrl({ ids: [place.id] })}
                fileName={`${place.code}-sign.pdf`}
                prepareLabel="Sign"
                printLabel={() => "Print sign"}
                ariaLabel={`Print the ${place.name} sign`}
              />
              <AdminLink href={scanHref(place.code)} className={quiet} aria-label={`Scan ${place.name}`}>
                <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
                Scan
              </AdminLink>
            </>
          )}
          {!renaming && (
            <button type="button" onClick={() => setRenaming(true)} disabled={busy} className={quiet} aria-label={`Rename ${place.name}`}>
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
  { kind: "other", label: "Other place" },
  { kind: "done", label: "Done shelf" },
  { kind: "shipping", label: "Shipping" },
];

/** A place that isn't a station slot or a shelf slot (another Done shelf, a photo desk...). */
export function AddPlaceForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PlaceKind>("other");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setMessage({ ok: false, text: "Give the place a name." });
    setBusy(true);
    setMessage(null);
    const r = await send("POST", { name: n, kind });
    setBusy(false);
    if ("error" in r) return setMessage({ ok: false, text: r.error });
    setName("");
    setMessage({ ok: true, text: `${n} added. Print its sign from the list.` });
    router.refresh();
  }

  return (
    <form onSubmit={add} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
      <label className={caption}>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Photo desk" className={field} />
      </label>
      <label className={caption}>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as PlaceKind)} className={field}>
          {ADDABLE.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy} className={`${quiet} px-5`}>
        <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        {busy ? "Adding…" : "Add place"}
      </button>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`sm:col-span-3 text-sm font-semibold ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
      )}
    </form>
  );
}

/** The next 10 business days' shelf slots (made where missing), their signs as one print. */
export function NextShelfSignsPrint() {
  const router = useRouter();
  return (
    <LazyPrintButton
      load={async () => {
        const r = await prepareShelfSlots(10).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Couldn't make the shelf slots." }));
        if (!r.ok) return { error: r.error };
        router.refresh(); // new slots show in the list
        return { url: placeLabelsUrl({ ids: r.slots.map((s) => s.id) }), count: r.slots.length };
      }}
      fileName="shelf-signs-next-10-days.pdf"
      prepareLabel="Shelf signs for the next 10 business days"
      printLabel={(n) => `Print ${n ?? ""} shelf signs`.replace("  ", " ")}
    />
  );
}
