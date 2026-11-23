"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { dayText, nyDate } from "@/lib/intake/tracking-format";
import type { RunOutcome } from "@/app/api/admin/intake/setup/_lib/store";
import type { IssueOrder, SetupList, SetupOrderView, SetupPreview } from "@/app/api/admin/intake/setup/_lib/views";

/**
 * Historical Order Setup: pick orders (or every eligible one), preview what
 * changes, confirm, and the browser sends them in batches of `batchSize`
 * with a progress bar, then shows a report. Each batch is re-read and
 * re-planned on the server, so leaving halfway and running again is safe.
 */

type Filters = { status: string; show: string; from: string; to: string; q: string };
const EMPTY: Filters = { status: "all", show: "needs", from: "", to: "", q: "" };

const STATUSES: [string, string][] = [
  ["all", "Every status"],
  ["received", "Cards Received"],
  ["in_progress", "In Progress"],
  ["completed", "Completed"],
  ["shipped_back", "Shipped Back"],
  ["delivered", "Delivered"],
];
const SHOW: [string, string][] = [["needs", "Needs setup"], ["done", "Set up"], ["all", "All"]];

const STATUS_STYLES: Record<string, string> = {
  received: "bg-blue-100 text-blue-700",
  in_progress: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  shipped_back: "bg-cyan-100 text-cyan-700",
  delivered: "bg-emerald-100 text-emerald-700",
};

function listQuery(f: Filters, page: number): string {
  const qs = new URLSearchParams({ status: f.status, show: f.show, page: String(page), pageSize: "25" });
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  if (f.q.trim()) qs.set("q", f.q.trim());
  return qs.toString();
}

type Phase = "select" | "previewing" | "preview" | "running" | "report";
type Progress = { done: number; total: number; ok: number; skipped: number; errors: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const btn = "min-h-11 px-4 rounded-lg text-sm font-bold transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none";
const primaryBtn = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`;
const outlineBtn = `${btn} border border-border bg-white text-foreground hover:border-primary/40`;
const chip = "text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap";
const inputCls = "min-h-11 w-full rounded-lg border border-border bg-white px-3 text-base sm:text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}.`);
  return data as T;
}

function OrderLink({ id, number }: { id: string; number: string | null }) {
  return (
    <AdminLink href={`/admin/receiving/${id}`} className="font-heading font-black text-primary hover:underline">
      {number ?? "Order"}
    </AdminLink>
  );
}

function Stat({ label, value, hint, tone = "default" }: { label: string; value: number; hint?: string; tone?: "default" | "warn" | "bad" | "good" }) {
  const color = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-green-700" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-white p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${color}`}>{value.toLocaleString("en-US")}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A collapsible list of orders with a problem, each linking to its receiving page. */
function IssueList({ title, orders, note, tone = "amber", render }: {
  title: string;
  orders: IssueOrder[];
  note: string;
  tone?: "amber" | "red" | "gray";
  render?: (o: IssueOrder) => ReactNode;
}) {
  if (!orders.length) return null;
  const border = tone === "red" ? "border-red-200" : tone === "gray" ? "border-border" : "border-amber-200";
  return (
    <details className={`rounded-xl border ${border} bg-white`}>
      <summary className="min-h-11 px-4 py-2 flex flex-wrap items-center gap-x-2 text-sm font-bold text-foreground cursor-pointer select-none">
        {title}
        <span className="font-semibold text-muted-foreground">({plural(orders.length, "order")})</span>
      </summary>
      <p className="px-4 pb-2 text-xs text-muted-foreground">{note}</p>
      <ul className="divide-y divide-border border-t border-border max-h-96 overflow-y-auto">
        {orders.map((o) => (
          <li key={o.orderId} className="px-4 py-2.5 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <OrderLink id={o.orderId} number={o.orderNumber} />
              <span className="text-muted-foreground truncate">{o.customerName ?? "—"}</span>
              {render?.(o)}
            </div>
            {o.cards.length > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {o.cards.map((c) => `${c.code ?? `#${c.seq ?? "?"}`} ${c.name}`).join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function OrderRow({ o, checked, disabled, onToggle }: { o: SetupOrderView; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const stateChip = o.state === "set_up"
    ? <span className={`${chip} bg-green-100 text-green-800`}>Set up</span>
    : o.state === "error"
      ? <span className={`${chip} bg-red-100 text-red-700`}>Can&apos;t set up</span>
      : <span className={`${chip} bg-blue-100 text-blue-700`}>Needs setup</span>;
  const changes = [
    o.changes.cardCodes ? plural(o.changes.cardCodes, "Card ID") : null,
    o.changes.newBags.length ? `bag${o.changes.newBags.length === 1 ? "" : "s"} ${o.changes.newBags.join(", ")}` : null,
    o.changes.bagFills ? plural(o.changes.bagFills, "bag update") : null,
  ].filter(Boolean).join(" · ");
  return (
    <li className="bg-white">
      <div className="flex items-start gap-2 px-2 sm:px-3 py-2">
        <label className="shrink-0 size-11 flex items-center justify-center cursor-pointer">
          <input
            type="checkbox"
            className="size-5 accent-primary cursor-pointer"
            checked={checked}
            disabled={disabled}
            onChange={onToggle}
            aria-label={`Select ${o.orderNumber ?? "order"}`}
          />
        </label>
        <div className="min-w-0 flex-1 py-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <OrderLink id={o.id} number={o.orderNumber} />
            <span className="text-sm font-semibold text-foreground truncate max-w-[14rem]">{o.customerName ?? "—"}</span>
            <span className={`${chip} ${STATUS_STYLES[o.status] ?? "bg-gray-100 text-gray-600"}`}>{o.statusLabel}</span>
            {stateChip}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Ordered {nyDate(o.createdAt)}</span>
            {o.receivedOn ? (
              <span>Received {dayText(o.receivedOn, false)}{o.receivedSource === "dropoff" ? " (drop-off)" : ""}</span>
            ) : (
              <span className={`${chip} bg-amber-100 text-amber-800`}>Missing receiving date</span>
            )}
            <span>{plural(o.cardCount, "card")}</span>
            {o.issues.missingImages > 0 && <span className={`${chip} bg-red-100 text-red-700`}>{o.issues.missingImages} missing image{o.issues.missingImages === 1 ? "" : "s"}</span>}
            {o.issues.missingTiers > 0 && <span className={`${chip} bg-amber-100 text-amber-800`}>{o.issues.missingTiers} missing tier{o.issues.missingTiers === 1 ? "" : "s"}</span>}
            {o.issues.finishedDateUnknown && <span className={`${chip} bg-gray-100 text-gray-600`}>Completion date unknown</span>}
          </div>
          {changes && o.state === "needs_setup" && <p className="mt-1 text-xs font-semibold text-foreground">Will add: {changes}</p>}
          {o.issues.errors.length > 0 && <p className="mt-1 text-xs font-semibold text-red-700">{o.issues.errors.join(" ")}</p>}
          <details className="mt-1.5">
            <summary className="min-h-9 inline-flex items-center text-xs font-semibold text-primary cursor-pointer select-none">Cards</summary>
            <ul className="mt-1 rounded-lg border border-border divide-y divide-border">
              {o.cards.map((c) => (
                <li key={c.id} className="px-3 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`font-mono font-bold ${c.planned ? "text-muted-foreground" : "text-foreground"}`} title={c.planned ? "Assigned when set up" : undefined}>
                    {c.code ?? "—"}
                  </span>
                  <span className="font-semibold text-foreground min-w-0 flex-1 truncate">{c.name}{c.detail ? <span className="font-normal text-muted-foreground"> · {c.detail}</span> : null}</span>
                  <span className="text-muted-foreground">{c.tierName}</span>
                  {c.bagCode && <span className="font-mono text-muted-foreground">{c.bagCode}</span>}
                  {c.refunded && <span className={`${chip} bg-gray-100 text-gray-500`}>Refunded</span>}
                  {c.awaiting && <span className={`${chip} bg-amber-100 text-amber-800`}>Awaiting arrival</span>}
                  {c.completed && <span className={`${chip} bg-green-100 text-green-800`}>Done</span>}
                  {c.missingImage && <span className={`${chip} bg-red-100 text-red-700`}>Missing image</span>}
                  {c.missingTier && <span className={`${chip} bg-amber-100 text-amber-800`}>Missing tier</span>}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </li>
  );
}

export function SetupClient({ batchSize }: { batchSize: number }) {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<SetupList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMode, setAllMode] = useState(false);
  const [phase, setPhase] = useState<Phase>("select");
  const [preview, setPreview] = useState<SetupPreview | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ done: 0, total: 0, ok: 0, skipped: 0, errors: 0 });
  const [results, setResults] = useState<RunOutcome[]>([]);
  const [stopped, setStopped] = useState(false);
  const stopRef = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  // The list for the applied filters and page; refetched when they change or after a run
  const query = listQuery(filters, page);
  const [reloads, setReloads] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const requestKey = `${query}#${reloads}`;
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/intake/setup/orders?${query}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? `The server answered ${res.status}.`);
        return data as SetupList | { ready: false; notice: string };
      })
      .then((data) => {
        if (cancelled) return;
        if (data.ready === false) setNotice(data.notice);
        else setList(data);
        setListError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setListError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  // Leaving mid-run is safe, but say so before the browser drops the run
  useEffect(() => {
    if (phase !== "running") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const applyFilters = (e: FormEvent) => {
    e.preventDefault();
    setAllMode(false);
    setFilters(draft);
    setPage(1);
  };
  const clearFilters = () => {
    setDraft(EMPTY);
    setFilters(EMPTY);
    setAllMode(false);
    setPage(1);
  };

  const toggle = (id: string) => {
    setAllMode(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const pageIds = list?.orders.map((o) => o.id) ?? [];
  const pageAllChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const togglePage = () => {
    setAllMode(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllChecked) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const clearSelection = () => {
    setAllMode(false);
    setSelected(new Set());
  };

  const selectionCount = allMode ? list?.eligibleMatching ?? 0 : selected.size;

  const runPreview = async () => {
    setActionError(null);
    setPhase("previewing");
    try {
      const body = allMode ? { all: true, filters: { status: filters.status, from: filters.from || undefined, to: filters.to || undefined, q: filters.q || undefined } } : { orderIds: [...selected] };
      const data = await postJson<SetupPreview | { ready: false; notice: string }>("/api/admin/intake/setup/preview", body);
      if (data.ready === false) {
        setNotice(data.notice);
        setPhase("select");
        return;
      }
      setPreview(data);
      setPhase("preview");
      scrollTop();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setPhase("select");
    }
  };

  const runAll = async () => {
    if (!preview) return;
    const ids = preview.orderIds;
    stopRef.current = false;
    setStopped(false);
    setActionError(null);
    setResults([]);
    const p: Progress = { done: 0, total: ids.length, ok: 0, skipped: 0, errors: 0 };
    setProgress({ ...p });
    setPhase("running");
    scrollTop();
    const all: RunOutcome[] = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      if (stopRef.current) break;
      const batch = ids.slice(i, i + batchSize);
      let outcomes: RunOutcome[] | null = null;
      let lastError = "";
      for (let attempt = 0; attempt < 2 && !outcomes; attempt++) {
        try {
          const data = await postJson<{ ready: true; results: RunOutcome[] } | { ready: false; notice: string }>("/api/admin/intake/setup/run", { orderIds: batch });
          if (data.ready === false) {
            setNotice(data.notice);
            stopRef.current = true;
            outcomes = [];
          } else {
            outcomes = data.results;
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      if (!outcomes) {
        const byId = new Map(preview.orders.map((o) => [o.orderId, o.orderNumber]));
        outcomes = batch.map((orderId) => ({
          orderId, orderNumber: byId.get(orderId) ?? null, outcome: "error" as const,
          message: `Not sent: ${lastError}`, changes: null, missingImages: 0, missingTiers: 0, missingReceivedDate: false,
        }));
      }
      all.push(...outcomes);
      for (const r of outcomes) {
        p.done += 1;
        if (r.outcome === "ok") p.ok += 1;
        else if (r.outcome === "skipped") p.skipped += 1;
        else p.errors += 1;
      }
      setProgress({ ...p });
      setResults([...all]);
    }
    setStopped(stopRef.current && p.done < p.total);
    setPhase("report");
    scrollTop();
  };

  const backToList = () => {
    setPhase("select");
    setPreview(null);
    setResults([]);
    setSelected(new Set());
    setAllMode(false);
    setReloads((n) => n + 1);
  };

  if (notice) {
    return <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{notice}</div>;
  }

  return (
    <div ref={topRef} className="scroll-mt-4">
      {actionError && (
        <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{actionError}</div>
      )}

      {phase === "preview" && preview && (
        <PreviewPanel preview={preview} onConfirm={runAll} onBack={() => setPhase("select")} batchSize={batchSize} />
      )}

      {phase === "running" && (
        <section className="mb-6 rounded-xl border border-border bg-white p-4 sm:p-5" aria-live="polite">
          <h2 className="font-heading font-black text-xl text-foreground">Setting up orders…</h2>
          <p className="mt-1 text-sm font-semibold text-foreground tabular-nums">
            {progress.done.toLocaleString("en-US")} of {plural(progress.total, "order")}
          </p>
          <div
            className="mt-3 h-3 w-full rounded-full bg-secondary overflow-hidden"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <div className="h-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {`${progress.ok} set up · ${progress.skipped} skipped · ${progress.errors} errors. ${batchSize} orders at a time; keep this page open. If you leave, run it again later: finished orders are skipped.`}
          </p>
          <button type="button" className={`${outlineBtn} mt-3`} onClick={() => { stopRef.current = true; }}>
            Stop after this batch
          </button>
        </section>
      )}

      {phase === "report" && (
        <ReportPanel results={results} preview={preview} stopped={stopped} onBack={backToList} onRerun={() => void runPreview()} />
      )}

      {(phase === "select" || phase === "previewing") && (
        <>
          <form onSubmit={applyFilters} className="rounded-xl border border-border bg-white p-3 sm:p-4 mb-4 grid gap-3 sm:grid-cols-6">
            <label className="sm:col-span-6 block">
              <span className="sr-only">Search</span>
              <input
                type="search"
                className={inputCls}
                placeholder="Order number, customer name, email or Card ID"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="block text-xs font-semibold text-muted-foreground mb-1">Status</span>
              <select className={inputCls} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="sm:col-span-2 block">
              <span className="block text-xs font-semibold text-muted-foreground mb-1">Ordered from</span>
              <input type="date" className={inputCls} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </label>
            <label className="sm:col-span-2 block">
              <span className="block text-xs font-semibold text-muted-foreground mb-1">Ordered to</span>
              <input type="date" className={inputCls} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </label>
            <fieldset className="sm:col-span-4 flex flex-wrap gap-2">
              <legend className="sr-only">Show</legend>
              {SHOW.map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={draft.show === v}
                  onClick={() => {
                    const next = { ...draft, show: v };
                    setDraft(next);
                    setFilters(next);
                    setAllMode(false);
                    setPage(1);
                  }}
                  className={`min-h-11 px-3 rounded-lg text-xs font-bold border whitespace-nowrap transition-colors ${draft.show === v ? "bg-primary text-primary-foreground border-primary" : "bg-white text-muted-foreground border-border hover:border-primary/40"}`}
                >
                  {l}
                </button>
              ))}
            </fieldset>
            <div className="sm:col-span-2 flex gap-2 sm:justify-end">
              <button type="submit" className={`${primaryBtn} flex-1 sm:flex-none`}>Apply</button>
              <button type="button" className={`${outlineBtn} flex-1 sm:flex-none`} onClick={clearFilters}>Clear</button>
            </div>
          </form>

          {list && (
            <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold">
              <span className={`${chip} bg-blue-100 text-blue-700`}>{plural(list.counts.needsSetup, "order")} need setup</span>
              <span className={`${chip} bg-green-100 text-green-800`}>{list.counts.setUp.toLocaleString("en-US")} set up</span>
              {list.counts.errors > 0 && <span className={`${chip} bg-red-100 text-red-700`}>{list.counts.errors} can&apos;t be set up</span>}
            </div>
          )}

          <div className="sticky top-0 z-10 -mx-4 sm:mx-0 mb-3 px-4 sm:px-4 py-3 bg-white/95 backdrop-blur border-y sm:border sm:rounded-xl border-border flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-foreground mr-auto" aria-live="polite">
              {allMode
                ? `All ${plural(list?.eligibleMatching ?? 0, "eligible order")} selected`
                : selected.size > 0 ? `${plural(selected.size, "order")} selected` : "Select orders to set up"}
            </p>
            <label className={`${outlineBtn} cursor-pointer has-[:disabled]:opacity-50 has-[:disabled]:pointer-events-none`}>
              <input
                type="checkbox"
                className="size-5 accent-primary cursor-pointer"
                checked={allMode}
                disabled={!list || list.eligibleMatching === 0}
                onChange={(e) => { setAllMode(e.target.checked); setSelected(new Set()); }}
              />
              Select all eligible{list ? ` (${list.eligibleMatching.toLocaleString("en-US")})` : ""}
            </label>
            {(allMode || selected.size > 0) && (
              <button type="button" className={outlineBtn} onClick={clearSelection}>Clear selection</button>
            )}
            <button type="button" className={primaryBtn} disabled={selectionCount === 0 || phase === "previewing"} onClick={() => void runPreview()}>
              {phase === "previewing" ? "Preparing preview…" : "Preview"}
            </button>
          </div>

          {listError && (
            <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&apos;t load the orders: {listError}
            </div>
          )}

          {loading && !list ? (
            <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">Loading orders…</div>
          ) : list && list.orders.length === 0 ? (
            <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">
              {filters.show === "needs" ? "No orders matching these filters need setting up." : "No orders match these filters."}
            </div>
          ) : list ? (
            <div className={`rounded-xl border border-border bg-white overflow-hidden ${loading ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2 px-2 sm:px-3 py-1 border-b border-border bg-secondary/40">
                <label className="size-11 flex items-center justify-center cursor-pointer">
                  <input type="checkbox" className="size-5 accent-primary cursor-pointer" checked={pageAllChecked && !allMode} disabled={allMode} onChange={togglePage} aria-label="Select this page" />
                </label>
                <span className="text-xs font-semibold text-muted-foreground">
                  {allMode ? "Every eligible order is selected" : "Select this page"} · {plural(list.total, "order")}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {list.orders.map((o) => (
                  <OrderRow
                    key={o.id}
                    o={o}
                    checked={allMode ? o.state === "needs_setup" : selected.has(o.id)}
                    disabled={allMode}
                    onToggle={() => toggle(o.id)}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {list && list.total > list.pageSize && (
            <nav className="mt-4 flex items-center justify-between gap-2" aria-label="Pages">
              <button type="button" className={outlineBtn} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>← Newer</button>
              <span className="text-sm text-muted-foreground tabular-nums">
                Page {page} of {Math.ceil(list.total / list.pageSize)}
              </span>
              <button type="button" className={outlineBtn} disabled={page * list.pageSize >= list.total || loading} onClick={() => setPage(page + 1)}>Older →</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function PreviewPanel({ preview, onConfirm, onBack, batchSize }: { preview: SetupPreview; onConfirm: () => void; onBack: () => void; batchSize: number }) {
  const t = preview.totals;
  const missingImageCards = preview.missingImages.reduce((n, o) => n + o.cards.length, 0);
  const missingTierCards = preview.missingTiers.reduce((n, o) => n + o.cards.length, 0);
  return (
    <section className="mb-6" aria-labelledby="preview-title">
      <h2 id="preview-title" className="font-heading font-black text-2xl text-foreground">Preview</h2>
      <p className="text-sm text-muted-foreground mt-0.5 mb-3">Nothing has changed yet. Check what will be added, then confirm.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Orders to set up" value={t.ordersToChange} hint={`of ${plural(t.orders, "order")} picked`} />
        <Stat label="Cards to update" value={t.cardsToUpdate} hint={`${plural(t.cardCodes, "new Card ID")}`} />
        <Stat label="Bags to create" value={t.bagsToCreate} hint={t.completedBags ? `${t.completedBags.toLocaleString("en-US")} already finished (marked completed)` : "One per tier per order"} />
        <Stat label="Already set up" value={t.alreadySetUp} hint="Skipped: nothing to add" tone={t.alreadySetUp ? "good" : "default"} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Stat label="Missing images" value={missingImageCards} hint={`${plural(preview.missingImages.length, "order")}: add photos on the order page`} tone={missingImageCards ? "bad" : "default"} />
        <Stat label="Missing tiers" value={missingTierCards} hint={`${plural(preview.missingTiers.length, "order")}: these cards get a Card ID but no bag`} tone={missingTierCards ? "warn" : "default"} />
        <Stat label="Missing receiving dates" value={preview.missingReceivedDates.length} hint="Orders: bags get no due date until a date is entered" tone={preview.missingReceivedDates.length ? "warn" : "default"} />
      </div>

      <div className="flex flex-col gap-2 mb-4">
        <IssueList
          title="Missing images"
          orders={preview.missingImages}
          tone="red"
          note="No customer photo, receiving photo or catalog picture. Open the order to photograph these cards."
        />
        <IssueList
          title="Missing tiers"
          orders={preview.missingTiers}
          note="Neither the card nor the order has a tier. Set the tier on the order page, then run the setup again to bag these cards."
        />
        <IssueList
          title="Missing receiving dates"
          orders={preview.missingReceivedDates}
          note="No 'Cards Received' record and not a drop-off, so no date is invented. Enter the date on the order page; the due date is then worked out (for review)."
        />
        <IssueList
          title="Finished, completion date unknown"
          orders={preview.finishedDateUnknown}
          tone="gray"
          note="Finished orders with no completion record: their bags stay open until checked on the order page."
        />
        <IssueList
          title="Can't be set up"
          orders={preview.errors}
          tone="red"
          note="These orders are skipped."
          render={(o) => <span className="text-xs font-semibold text-red-700">{(o as IssueOrder & { message: string }).message}</span>}
        />
        <IssueList
          title="Not eligible"
          orders={preview.notEligible}
          tone="gray"
          note="Only received, in-progress and finished orders with cards are set up here; orders still awaiting cards go through Receiving."
          render={(o) => <span className="text-xs text-muted-foreground">{(o as IssueOrder & { message: string }).message}</span>}
        />
        {preview.orders.length > 0 && (
          <details className="rounded-xl border border-border bg-white">
            <summary className="min-h-11 px-4 py-2 flex items-center gap-2 text-sm font-bold text-foreground cursor-pointer select-none">
              What each order gets <span className="font-semibold text-muted-foreground">({plural(preview.orders.length, "order")})</span>
            </summary>
            <ul className="divide-y divide-border border-t border-border max-h-[28rem] overflow-y-auto">
              {preview.orders.map((o) => (
                <li key={o.orderId} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <OrderLink id={o.orderId} number={o.orderNumber} />
                    <span className="text-muted-foreground truncate">{o.customerName ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{o.receivedOn ? `Received ${dayText(o.receivedOn, false)}` : "Receiving date missing"}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-foreground">
                    {[o.cardCodes ? plural(o.cardCodes, "Card ID") : null, `${plural(o.cardsToUpdate, "card")} updated`].filter(Boolean).join(" · ")}
                  </p>
                  {o.newBags.length > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {o.newBags.map((b) => (
                        <li key={b.code} className="text-[11px] font-semibold rounded-md border border-border px-2 py-0.5">
                          <span className="font-mono">{b.code}</span> · {plural(b.cards, "card")} · {b.completed ? "completed" : b.dueDate ? `due ${dayText(b.dueDate, false)} (review)` : b.dueStatus === "missing_received_date" ? "no due date yet" : "due date needs review"}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="rounded-xl border border-border bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-xs text-muted-foreground flex-1">
          {`Runs ${batchSize} orders at a time from this page. Existing Card IDs, bags, dates, stages and completed orders are never changed. `}
          Due dates are worked out from today&apos;s tier settings and marked for review.
        </p>
        <div className="flex gap-2">
          <button type="button" className={outlineBtn} onClick={onBack}>Back</button>
          <button type="button" className={primaryBtn} disabled={preview.orderIds.length === 0} onClick={onConfirm}>
            {preview.orderIds.length ? `Confirm: set up ${plural(preview.orderIds.length, "order")}` : "Nothing to set up"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ReportPanel({ results, preview, stopped, onBack, onRerun }: {
  results: RunOutcome[];
  preview: SetupPreview | null;
  stopped: boolean;
  onBack: () => void;
  onRerun: () => void;
}) {
  const ok = results.filter((r) => r.outcome === "ok");
  const skipped = results.filter((r) => r.outcome === "skipped");
  const errors = results.filter((r) => r.outcome === "error");
  const followUp = results.filter((r) => r.outcome !== "error" && (r.missingImages > 0 || r.missingTiers > 0 || r.missingReceivedDate));
  const alreadyBefore = preview?.alreadySetUp ?? 0;
  // What the run actually wrote, to set against the preview's totals
  const made = results.reduce(
    (t, r) => ({
      cardCodes: t.cardCodes + (r.changes?.cardCodes ?? 0),
      bags: t.bags + (r.changes?.bagsCreated.length ?? 0),
      bagged: t.bagged + (r.changes?.cardsLinked ?? 0),
    }),
    { cardCodes: 0, bags: 0, bagged: 0 },
  );
  const row = (r: RunOutcome, extra?: ReactNode) => (
    <li key={r.orderId} className="px-4 py-2.5 text-sm flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <OrderLink id={r.orderId} number={r.orderNumber} />
      <span className={`text-xs ${r.outcome === "error" ? "font-semibold text-red-700" : "text-muted-foreground"}`}>{r.message}</span>
      {extra}
    </li>
  );
  return (
    <section className="mb-6" aria-labelledby="report-title">
      <h2 id="report-title" className="font-heading font-black text-2xl text-foreground">Report</h2>
      <p className="text-sm text-muted-foreground mt-0.5 mb-3">
        {stopped ? "Stopped early: run the setup again to finish the rest." : "Done."} Each order links to its receiving page to add images, enter receiving dates, fix tiers and print labels.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Stat label="Set up" value={ok.length} tone={ok.length ? "good" : "default"} />
        <Stat label="Skipped" value={skipped.length + alreadyBefore} hint={alreadyBefore ? `${alreadyBefore.toLocaleString("en-US")} already set up before this run` : "Already set up"} />
        <Stat label="Errors" value={errors.length} tone={errors.length ? "bad" : "default"} hint={errors.length ? "Run again to retry: what was saved is kept, nothing is doubled" : undefined} />
      </div>
      <p className="mb-4 text-sm text-foreground tabular-nums">
        {`Created ${plural(made.bags, "bag")} and ${plural(made.cardCodes, "Card ID")}; ${plural(made.bagged, "card")} put in bags.`}
        {preview ? <span className="text-muted-foreground">{` The preview expected ${plural(preview.totals.bagsToCreate, "bag")} and ${plural(preview.totals.cardCodes, "Card ID")}.`}</span> : null}
      </p>
      <div className="flex flex-col gap-2 mb-4">
        {errors.length > 0 && (
          <details open className="rounded-xl border border-red-200 bg-white">
            <summary className="min-h-11 px-4 py-2 flex items-center text-sm font-bold text-foreground cursor-pointer select-none">Errors ({errors.length})</summary>
            <ul className="divide-y divide-border border-t border-border max-h-96 overflow-y-auto">{errors.map((r) => row(r))}</ul>
          </details>
        )}
        {followUp.length > 0 && (
          <details open className="rounded-xl border border-amber-200 bg-white">
            <summary className="min-h-11 px-4 py-2 flex items-center text-sm font-bold text-foreground cursor-pointer select-none">
              Needs a follow-up ({plural(followUp.length, "order")})
            </summary>
            <ul className="divide-y divide-border border-t border-border max-h-96 overflow-y-auto">
              {followUp.map((r) => row(r, (
                <span className="flex flex-wrap gap-1.5">
                  {r.missingImages > 0 && <span className={`${chip} bg-red-100 text-red-700`}>{r.missingImages} missing image{r.missingImages === 1 ? "" : "s"}</span>}
                  {r.missingTiers > 0 && <span className={`${chip} bg-amber-100 text-amber-800`}>{r.missingTiers} missing tier{r.missingTiers === 1 ? "" : "s"}</span>}
                  {r.missingReceivedDate && <span className={`${chip} bg-amber-100 text-amber-800`}>Missing receiving date</span>}
                </span>
              )))}
            </ul>
          </details>
        )}
        {ok.length > 0 && (
          <details className="rounded-xl border border-border bg-white">
            <summary className="min-h-11 px-4 py-2 flex items-center text-sm font-bold text-foreground cursor-pointer select-none">Set up ({ok.length})</summary>
            <ul className="divide-y divide-border border-t border-border max-h-96 overflow-y-auto">{ok.map((r) => row(r))}</ul>
          </details>
        )}
        {skipped.length > 0 && (
          <details className="rounded-xl border border-border bg-white">
            <summary className="min-h-11 px-4 py-2 flex items-center text-sm font-bold text-foreground cursor-pointer select-none">Skipped ({skipped.length})</summary>
            <ul className="divide-y divide-border border-t border-border max-h-96 overflow-y-auto">{skipped.map((r) => row(r))}</ul>
          </details>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <button type="button" className={outlineBtn} onClick={onRerun}>Run the setup again</button>
        <button type="button" className={primaryBtn} onClick={onBack}>Back to the list</button>
      </div>
    </section>
  );
}
