"use client";

import { useEffect, useRef, useState } from "react";
import {
  Ban, Check, CircleAlert, ExternalLink, ImageOff, LoaderCircle, PackageCheck, Printer, RotateCw, TriangleAlert, Truck, X,
} from "lucide-react";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { useLabelPrint } from "@/components/admin/labelife-print-button";
import { TierBadge } from "@/app/admin/receiving/bags/_components/bag-bits";
import {
  buyOutcome, cardsText, checkMark, checkSummary, defaultRate, markShippedQuestion, money, oneTapText, packageRows, packagesHeadline,
  packState, rateText, readError, serviceName, shipOutcome, splitCheck, STALE_RETRY_QUESTION, trackingHref, whenText,
  type CheckTone, type PackExtras, type PackFix, type PackState, type PackageTone,
} from "@/lib/intake/packing-view";
import type { BagShipment, PackingResponse, ShipRate } from "@/lib/intake/shipping/types";
import type { ShipCheckCard } from "@/lib/intake/tracking/types";

/**
 * The packing page's board: the bag's person and where it goes, the check
 * (each card with its photo and a big ✓ / ✗ to match the bag by eye), and
 * one step at a time from the packing API's `next`: buy the label, print it
 * and Mark shipped, or the tracking once it has gone. Every tap is one
 * request (the button waits while it runs); the API's answer is shown as it
 * words it, then the page asks the API again (GET ship-label) for the state.
 */

type Busy = null | "buy" | "rates" | "ship" | "reload";
type Notice = { tone: "ok" | "error"; text: string; labelUrl?: string | null };

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const eyebrow = "text-[11px] font-bold uppercase tracking-widest text-muted-foreground";
const panel = "rounded-2xl border border-border bg-white p-4 sm:p-6";
const bigBase = `inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 text-lg font-black transition-[background-color,transform] active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-60 disabled:active:scale-100 ${focusRing}`;
const bigPrimary = `${bigBase} bg-primary text-primary-foreground hover:bg-primary/90`;
const bigOutline = `${bigBase} border-2 border-primary bg-white text-primary hover:bg-primary/5`;
const smallButton = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-white px-4 text-sm font-bold text-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-60 ${focusRing}`;
const textLink = `inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-bold text-primary hover:underline ${focusRing}`;

const apiBase = (bagId: string) => `/api/admin/intake/bags/${encodeURIComponent(bagId)}`;

/** A minute-or-less clock, for "a purchase that never finished" (2 minutes old). */
function useNow(everyMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function Spinner() {
  return <LoaderCircle className="size-5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden="true" />;
}

// ─── Top: who and where ─────────────────────────────────────────────────

function Person({ packing, extras }: { packing: PackingResponse; extras: PackExtras }) {
  const live = splitCheck(packing.check.cards).live.length;
  const multi = packing.packages.length > 1;
  const at = packing.packages.findIndex((p) => p.bagId === packing.bag.id);
  return (
    <section aria-labelledby="pack-customer" className={`${panel} lg:col-span-2`}>
      <p className={eyebrow}>Pack and ship</p>
      <h1 id="pack-customer" className="mt-1 font-heading text-4xl font-black leading-[1.04] text-foreground break-words sm:text-5xl">
        {packing.order.customer?.trim() || "No customer name"}
      </h1>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-lg font-bold text-foreground">
        <span className="break-all">{packing.order.orderNumber}</span>
        <TierBadge tier={packing.bag.tier} name={packing.bag.tierName} />
        <span className="font-mono text-base font-black break-all">{packing.bag.code}</span>
      </p>
      <p className="mt-1 font-heading text-2xl font-black text-foreground">{cardsText(live)}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:gap-x-6">
        <div className="min-w-0">
          <dt className={eyebrow}>Ships to</dt>
          <dd className="mt-0.5 break-words text-base font-semibold text-foreground">
            {extras.shipTo ?? <span className="text-red-700">No address on file</span>}
            {packing.order.international && <span className="ml-2 inline-block rounded-full bg-blue-50 px-2 py-0.5 align-middle text-xs font-bold text-blue-800">International</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={eyebrow}>Customer paid for</dt>
          <dd className="mt-0.5 break-words text-base font-semibold text-foreground">
            {extras.paidService ?? <span className="text-muted-foreground">No shipping service saved</span>}
          </dd>
        </div>
      </dl>
      {multi && (
        <p className="mt-3 rounded-xl bg-secondary/60 px-3 py-2 text-sm font-semibold text-foreground">
          {at >= 0 ? `Package ${at + 1} of ${packing.packages.length} of this order` : `This order ships in ${packing.packages.length} packages`}
        </p>
      )}
    </section>
  );
}

// ─── The check ──────────────────────────────────────────────────────────

const MARK_STYLE: Record<CheckTone, { circle: string; text: string }> = {
  ok: { circle: "bg-green-600 text-white", text: "text-green-800" },
  bad: { circle: "bg-red-600 text-white", text: "text-red-800" },
  warn: { circle: "bg-amber-400 text-amber-950", text: "text-amber-900" },
  refunded: { circle: "bg-gray-200 text-gray-600", text: "text-gray-600" },
};

function MarkIcon({ tone }: { tone: CheckTone }) {
  const cls = "size-6";
  if (tone === "ok") return <Check className={cls} strokeWidth={3} aria-hidden="true" />;
  if (tone === "bad") return <X className={cls} strokeWidth={3} aria-hidden="true" />;
  if (tone === "warn") return <TriangleAlert className={cls} strokeWidth={2.25} aria-hidden="true" />;
  return <Ban className={cls} strokeWidth={2} aria-hidden="true" />;
}

function CheckRow({ card, extras }: { card: ShipCheckCard; extras: PackExtras }) {
  const extra = extras.cards[card.id];
  const mark = checkMark(card);
  const style = MARK_STYLE[mark.tone];
  const refunded = mark.tone === "refunded";
  const name = card.name?.trim() || "No card name";
  return (
    <li className="flex items-center gap-3 py-3 first:pt-1 last:pb-1" data-card-code={card.code ?? undefined}>
      {extra?.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={extra.photo}
          alt={`Photo of ${name}`}
          width={64}
          height={64}
          loading="lazy"
          className={`size-16 shrink-0 rounded-lg border border-border bg-secondary object-cover ${refunded ? "opacity-60 grayscale" : ""}`}
        />
      ) : (
        <span className="flex size-16 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-secondary/40 text-center text-[10px] font-bold leading-tight text-muted-foreground">
          <ImageOff className="size-5" strokeWidth={1.75} aria-hidden="true" />
          No photo
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className={`break-words text-base font-bold leading-snug ${refunded ? "text-muted-foreground line-through decoration-gray-400" : "text-foreground"}`}>{name}</p>
        <p className="font-mono text-sm font-black text-foreground">{card.code ?? <span className="font-sans font-semibold text-muted-foreground">No Card ID</span>}</p>
        {extra?.details && <p className="break-words text-xs text-muted-foreground">{extra.details}</p>}
        {(mark.tone === "bad" || mark.tone === "warn") && extra?.cardUrl && (
          <AdminLink href={extra.cardUrl} className={`${textLink} min-h-9 text-xs`}>Open card →</AdminLink>
        )}
      </div>
      <div className="flex w-[5.5rem] shrink-0 flex-col items-center gap-1 text-center">
        <span className={`flex size-11 items-center justify-center rounded-full ${style.circle}`}>
          <MarkIcon tone={mark.tone} />
        </span>
        <span className={`text-xs font-black leading-tight break-words ${style.text}`}>{mark.text}</span>
      </div>
    </li>
  );
}

function TheCheck({ packing, extras }: { packing: PackingResponse; extras: PackExtras }) {
  const { live, refunded } = splitCheck(packing.check.cards);
  const allOk = live.length > 0 && live.every((c) => c.status === "ok");
  return (
    <section aria-labelledby="pack-check" className={`${panel} lg:col-start-1 lg:row-start-2`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="pack-check" className="font-heading text-xl font-black text-foreground">Match the cards in the bag</h2>
        <p className={`text-sm font-black ${allOk ? "text-green-700" : "text-red-700"}`}>{checkSummary(packing.check)}</p>
      </div>
      {live.length > 0 ? (
        <ul aria-label="Cards in this package" className="mt-2 flex flex-col divide-y divide-border">
          {live.map((c) => <CheckRow key={c.id} card={c} extras={extras} />)}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">No card goes back in this bag.</p>
      )}
      {refunded.length > 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-gray-50 px-3 py-2">
          <h3 className="pt-1 font-sans text-xs font-bold uppercase tracking-widest text-muted-foreground">Refunded: not in this package</h3>
          <ul aria-label="Refunded cards" className="flex flex-col divide-y divide-border">
            {refunded.map((c) => <CheckRow key={c.id} card={c} extras={extras} />)}
          </ul>
        </div>
      )}
    </section>
  );
}

// ─── The step ───────────────────────────────────────────────────────────

function NoticeBox({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  const ok = notice.tone === "ok";
  return (
    <div
      role={ok ? "status" : "alert"}
      className={`mb-4 rounded-xl border px-4 py-3 text-sm font-semibold break-words ${ok ? "border-green-300 bg-green-50 text-green-900" : "border-red-300 bg-red-50 text-red-800"}`}
    >
      <p className="flex items-start gap-2">
        {ok ? <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />}
        <span>{notice.text}</span>
      </p>
      {notice.labelUrl && (
        <a href={notice.labelUrl} target="_blank" rel="noopener noreferrer" className={`${textLink} mt-1 text-red-800`}>
          <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Open the label that was bought
        </a>
      )}
    </div>
  );
}

function Confirm({ question, yes, tone = "primary", busy, onYes, onNo }: {
  question: string;
  yes: string;
  tone?: "primary" | "danger";
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div role="group" aria-label={yes} className="mt-3 rounded-xl border-2 border-border bg-secondary/40 p-3">
      <p className="text-[15px] font-semibold leading-snug text-foreground">{question}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onYes}
          disabled={busy}
          aria-busy={busy || undefined}
          className={`inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-base font-black text-white disabled:opacity-60 ${focusRing} ${tone === "danger" ? "bg-red-700 hover:bg-red-800" : "bg-primary hover:bg-primary/90"}`}
        >
          {busy && <Spinner />}
          {yes}
        </button>
        <button type="button" onClick={onNo} disabled={busy} className={`${smallButton} min-h-12 sm:w-auto`}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Fixes({ fixes }: { fixes: PackFix[] }) {
  if (!fixes.length) return null;
  return (
    <nav aria-label="Fix it" className="mt-3 flex flex-col items-start gap-1">
      {fixes.map((f) =>
        f.external ? (
          <a key={f.href + f.text} href={f.href} target="_blank" rel="noopener noreferrer" className={textLink}>
            <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {f.text}
          </a>
        ) : (
          <AdminLink key={f.href + f.text} href={f.href} className={textLink}>{f.text} →</AdminLink>
        ),
      )}
    </nav>
  );
}

function LabelFacts({ shipment }: { shipment: BagShipment }) {
  const service = serviceName(shipment);
  const price = money(shipment.costCents);
  const insured = money(shipment.insuranceCents);
  const href = trackingHref(shipment);
  return (
    <dl className="mt-2 flex flex-col gap-1.5 text-[15px] text-foreground">
      {(service || price) && (
        <div className="flex flex-wrap gap-x-2">
          <dt className="sr-only">Service and price</dt>
          <dd className="font-bold">{[service, price].filter(Boolean).join(" · ")}</dd>
        </div>
      )}
      <div className="flex flex-wrap items-baseline gap-x-2">
        <dt className="text-sm text-muted-foreground">Tracking</dt>
        <dd className="font-mono font-black break-all">
          {shipment.trackingNumber ? (
            href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">{shipment.trackingNumber}</a> : shipment.trackingNumber
          ) : (
            <span className="font-sans font-semibold text-muted-foreground">Not given yet</span>
          )}
        </dd>
      </div>
      {insured && (
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-sm text-muted-foreground">Insured for</dt>
          <dd className="font-semibold">{insured}</dd>
        </div>
      )}
    </dl>
  );
}

function PrintButton({ labelUrl, primary, onPrinted }: { labelUrl: string; primary: boolean; onPrinted: () => void }) {
  const { status, print } = useLabelPrint(labelUrl, { fileName: "return-label.pdf" });
  const working = status === "sharing";
  return (
    <button
      type="button"
      onClick={async () => {
        onPrinted();
        await print();
      }}
      disabled={working}
      aria-busy={working || undefined}
      className={primary ? bigPrimary : bigOutline}
    >
      {working ? <Spinner /> : <Printer className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />}
      {working ? "Printing…" : primary ? "Print label" : "Print again"}
    </button>
  );
}

function StepNumber({ n, done }: { n: number; done?: boolean }) {
  return (
    <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${done ? "bg-green-600 text-white" : "bg-foreground text-background"}`}>
      {done ? <Check className="size-4" strokeWidth={3} /> : n}
    </span>
  );
}

function StateTitle({ icon, tone, children }: { icon: React.ReactNode; tone: "ok" | "info" | "warn" | "done"; children: React.ReactNode }) {
  const color = tone === "ok" ? "bg-green-600 text-white" : tone === "done" ? "bg-green-600 text-white" : tone === "warn" ? "bg-amber-400 text-amber-950" : "bg-primary text-primary-foreground";
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-full ${color}`}>{icon}</span>
      <h2 id="pack-step" className={`font-heading font-black leading-tight text-foreground ${tone === "done" ? "text-3xl text-green-800" : "text-2xl"}`}>{children}</h2>
    </div>
  );
}

// ─── The board ──────────────────────────────────────────────────────────

export function PackBoard({ initial, extras }: { initial: PackingResponse; extras: PackExtras }) {
  const [packing, setPacking] = useState(initial);
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [staleSeen, setStaleSeen] = useState(false);
  const [rates, setRates] = useState<ShipRate[] | null>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "ship" | "stale">(null);
  const [printed, setPrinted] = useState(false);
  const now = useNow();
  const bagId = packing.bag.id;
  const state: PackState = packState(packing, extras.links, now);
  const unsavedLabel = state.kind === "wait" ? state.unsavedLabel : null;
  // A label bought but not kept: saving it buys nothing, so no second-label warning
  const stale = state.kind === "wait" && !unsavedLabel && (state.stale || staleSeen);

  /** One request at a time: a second tap while one runs does nothing. */
  async function run(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try {
      await fn();
    } catch {
      setNotice({ tone: "error", text: "Couldn't reach the server. Check the connection, then try again." });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  /** GET ship-label again; `quiet`: a failure keeps what the page shows (the action's message stays). */
  async function reload(quiet: boolean): Promise<PackingResponse | null> {
    try {
      const res = await fetch(`${apiBase(bagId)}/ship-label`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.bag) {
        if (!quiet) setNotice({ tone: "error", text: readError(res.status, body) });
        return null;
      }
      setPacking(body as PackingResponse);
      return body as PackingResponse;
    } catch {
      if (!quiet) setNotice({ tone: "error", text: "Couldn't reach the server. Check the connection, then try again." });
      return null;
    }
  }

  function buy(body: { rateObjectId?: string; retryStaleClaim?: boolean }) {
    return run("buy", async () => {
      setNotice(null);
      setConfirm(null);
      const res = await fetch(`${apiBase(bagId)}/ship-label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = buyOutcome(res.status, await res.json().catch(() => null));
      if (out.ok) {
        setNotice({ tone: "ok", text: out.message });
        setStaleSeen(false);
        setRates(null);
        setPrinted(false);
        // Show the label at once; the GET below brings the rest
        setPacking((p) => ({
          ...p,
          shipment: out.shipment,
          next: out.shipment.status === "purchased" ? "print_and_ship" : out.shipment.status === "shipped" ? "shipped" : out.shipment.status === "delivered" ? "delivered" : p.next,
          canBuy: false,
          blocked: null,
        }));
      } else {
        setNotice({ tone: "error", text: out.message, labelUrl: out.labelUrl });
        if (out.stale) setStaleSeen(true);
      }
      await reload(true);
    });
  }

  function chooseRate() {
    return run("rates", async () => {
      setNotice(null);
      setRatesError(null);
      const res = await fetch(`${apiBase(bagId)}/ship-label?rates=1`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.bag) {
        setNotice({ tone: "error", text: readError(res.status, body) });
        return;
      }
      const p = body as PackingResponse;
      setPacking(p);
      if (p.rates?.length) {
        setRates(p.rates);
        setChosen(defaultRate(p.rates)?.objectId ?? null);
      } else {
        setRatesError(p.ratesError ?? "No rates came back for this address.");
      }
    });
  }

  function markShipped() {
    return run("ship", async () => {
      setNotice(null);
      const res = await fetch(`${apiBase(bagId)}/shipped`, { method: "POST" });
      const out = shipOutcome(res.status, await res.json().catch(() => null));
      setNotice({ tone: out.ok ? "ok" : "error", text: out.message });
      setConfirm(null);
      await reload(true);
    });
  }

  function tryAgain() {
    if (stale) {
      setConfirm("stale");
      return;
    }
    return run("reload", async () => {
      setNotice(null);
      await reload(false);
    });
  }

  const chosenRate = rates?.find((r) => r.objectId === chosen) ?? null;

  let step: React.ReactNode;
  if (state.kind === "buy") {
    step = (
      <>
        <StateTitle tone="ok" icon={<Check className="size-5" strokeWidth={3} />}>Ready to ship</StateTitle>
        <p className="mt-2 text-[15px] leading-snug text-muted-foreground">
          Every card is done. Check each one below is in the bag, then buy the label.
        </p>
        {packing.lastFailure && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 break-words">
            The last try{whenText(packing.lastFailure.at) ? ` (${whenText(packing.lastFailure.at)})` : ""} didn&apos;t buy a label: {packing.lastFailure.error}
          </p>
        )}
        {!rates ? (
          <div className="mt-4">
            <button type="button" onClick={() => buy({})} disabled={busy !== null} aria-busy={busy === "buy" || undefined} className={bigPrimary}>
              {busy === "buy" ? <Spinner /> : <PackageCheck className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />}
              {busy === "buy" ? "Buying the label…" : "Buy return label"}
            </button>
            <p className="mt-2 text-sm text-muted-foreground">{oneTapText(extras.paidService)}</p>
            <button type="button" onClick={chooseRate} disabled={busy !== null} aria-busy={busy === "rates" || undefined} className={`${smallButton} mt-3`}>
              {busy === "rates" && <Spinner />}
              {busy === "rates" ? "Getting rates…" : "Choose another rate"}
            </button>
            {ratesError && <p role="alert" className="mt-2 text-sm font-semibold text-red-800 break-words">{ratesError}</p>}
          </div>
        ) : (
          <div className="mt-4">
            <fieldset>
              <legend className="text-sm font-black text-foreground">Choose a rate</legend>
              <div className="mt-2 flex flex-col gap-2">
                {rates.map((r) => (
                  <label
                    key={r.objectId}
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2 text-[15px] ${chosen === r.objectId ? "border-primary bg-primary/5" : "border-border bg-white"}`}
                  >
                    <input type="radio" name="pack-rate" value={r.objectId} checked={chosen === r.objectId} onChange={() => setChosen(r.objectId)} className="size-5 accent-primary" />
                    <span className="min-w-0 flex-1 break-words font-semibold text-foreground">{rateText(r)}</span>
                    {r.paid && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">Customer paid</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              type="button"
              onClick={() => chosenRate && buy({ rateObjectId: chosenRate.objectId })}
              disabled={busy !== null || !chosenRate}
              aria-busy={busy === "buy" || undefined}
              className={`${bigPrimary} mt-4`}
            >
              {busy === "buy" ? <Spinner /> : <PackageCheck className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />}
              {busy === "buy" ? "Buying the label…" : "Buy this label"}
            </button>
            <button type="button" onClick={() => setRates(null)} disabled={busy !== null} className={`${smallButton} mt-2`}>
              Cancel
            </button>
          </div>
        )}
      </>
    );
  } else if (state.kind === "print_and_ship") {
    const s = state.shipment;
    step = (
      <>
        <StateTitle tone="info" icon={<Printer className="size-5" strokeWidth={2} />}>Label bought</StateTitle>
        <LabelFacts shipment={s} />
        <ol className="mt-4 flex flex-col gap-4">
          <li className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-[15px] font-bold text-foreground">
              <StepNumber n={1} done={printed} />
              Print the label and stick it on the package
            </p>
            {s.labelUrl ? (
              <>
                <PrintButton labelUrl={s.labelUrl} primary={!printed} onPrinted={() => setPrinted(true)} />
                <a href={s.labelUrl} target="_blank" rel="noopener noreferrer" className={`${textLink} self-start`}>
                  <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  Open the PDF
                </a>
              </>
            ) : (
              <p className="text-sm text-red-800">The label file is missing. Open the order&apos;s shipping to check it.</p>
            )}
          </li>
          <li className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-[15px] font-bold text-foreground">
              <StepNumber n={2} />
              Pack the cards, then
            </p>
            {confirm === "ship" ? (
              <Confirm
                question={markShippedQuestion(extras.customerEmail)}
                yes="Yes, mark shipped"
                busy={busy === "ship"}
                onYes={markShipped}
                onNo={() => setConfirm(null)}
              />
            ) : (
              <button type="button" onClick={() => setConfirm("ship")} disabled={busy !== null} className={printed ? bigPrimary : bigOutline}>
                <Truck className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
                Mark shipped
              </button>
            )}
          </li>
        </ol>
      </>
    );
  } else if (state.kind === "shipped") {
    const s = state.shipment;
    const when = whenText(state.delivered ? s.deliveredAt : s.shippedAt);
    step = (
      <>
        <StateTitle tone="done" icon={state.delivered ? <PackageCheck className="size-5" strokeWidth={2} /> : <Truck className="size-5" strokeWidth={2} />}>
          {state.delivered ? "Delivered" : "Shipped"}
        </StateTitle>
        {when && (
          <p className="mt-2 text-[15px] text-foreground">
            {state.delivered ? `Delivered ${when}.` : `Shipped ${when}${s.shippedBy ? ` by ${s.shippedBy}` : ""}.`}
            {!state.delivered && s.emailSentAt ? " The customer was emailed the tracking." : ""}
          </p>
        )}
        <LabelFacts shipment={s} />
        <p className="mt-3 text-sm text-muted-foreground">Nothing left to do for this bag.</p>
      </>
    );
  } else if (state.kind === "wait" && unsavedLabel) {
    step = (
      <>
        <StateTitle tone="warn" icon={<RotateCw className="size-5" strokeWidth={2} />}>Label bought, not saved yet</StateTitle>
        <p className="mt-2 text-[15px] leading-snug text-foreground break-words">{state.reason}</p>
        <a href={unsavedLabel} target="_blank" rel="noopener noreferrer" className={`${textLink} mt-2`}>
          <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Open the label that was bought
        </a>
        <button type="button" onClick={() => buy({})} disabled={busy !== null} aria-busy={busy === "buy" || undefined} className={`${bigPrimary} mt-3`}>
          {busy === "buy" ? <Spinner /> : <Check className="size-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />}
          {busy === "buy" ? "Saving…" : "Save this label"}
        </button>
        <p className="mt-2 text-sm text-muted-foreground">Nothing new is bought: it keeps this label on the bag.</p>
      </>
    );
  } else if (state.kind === "wait") {
    step = (
      <>
        <StateTitle tone="warn" icon={<RotateCw className="size-5" strokeWidth={2} />}>
          {stale ? "The label purchase didn't finish" : "Label being bought"}
        </StateTitle>
        <p className="mt-2 text-[15px] leading-snug text-foreground break-words">{state.reason}</p>
        {confirm === "stale" ? (
          <Confirm
            question={STALE_RETRY_QUESTION}
            yes="Yes, buy again"
            tone="danger"
            busy={busy === "buy"}
            onYes={() => buy({ retryStaleClaim: true })}
            onNo={() => setConfirm(null)}
          />
        ) : (
          <button type="button" onClick={tryAgain} disabled={busy !== null} aria-busy={busy === "reload" || undefined} className={`${bigOutline} mt-4`}>
            {busy === "reload" ? <Spinner /> : <RotateCw className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />}
            Try again
          </button>
        )}
      </>
    );
  } else {
    step = (
      <>
        <StateTitle tone="warn" icon={<TriangleAlert className="size-5" strokeWidth={2.25} />}>
          {packing.orderLabel ? "The order already has a label" : "Not ready to ship"}
        </StateTitle>
        <p className="mt-2 text-[15px] leading-snug text-foreground break-words">{state.reason}</p>
        <Fixes fixes={state.fixes} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-6">
      <Person packing={packing} extras={extras} />
      <section
        aria-labelledby="pack-step"
        aria-busy={busy !== null || undefined}
        className={`${panel} border-2 ${state.kind === "shipped" ? "border-green-300" : state.kind === "blocked" || state.kind === "wait" ? "border-amber-300" : "border-primary/40"} lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-2`}
      >
        <NoticeBox notice={notice} />
        {packing.notice && (
          <p role="status" className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900 break-words">
            {packing.notice}
          </p>
        )}
        {step}
      </section>
      <TheCheck packing={packing} extras={extras} />
      <Packages packing={packing} />
      <nav aria-label="More about this bag" className="flex flex-wrap gap-x-4 lg:col-start-1">
        <AdminLink href={extras.links.order} className={textLink}>
          <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden="true" />
          Open full order
        </AdminLink>
        <AdminLink href={extras.links.open} className={textLink}>Open the bag</AdminLink>
        <AdminLink href={extras.links.shipCheck} className={textLink}>Ship check</AdminLink>
        <AdminLink href="/admin/ship-queue?tab=restoration" className={textLink}>Ship queue</AdminLink>
      </nav>
    </div>
  );
}

const PACKAGE_TONE: Record<PackageTone, string> = {
  done: "bg-green-100 text-green-800",
  label: "bg-blue-100 text-blue-800",
  ready: "bg-amber-100 text-amber-900",
  work: "bg-gray-100 text-gray-700",
};

/** Every package of the order (only when it ships in more than one). */
function Packages({ packing }: { packing: PackingResponse }) {
  if (packing.packages.length < 2) return null;
  const rows = packageRows(packing.packages, packing.bag.id);
  return (
    <section aria-labelledby="pack-packages" className={`${panel} lg:col-start-1`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="pack-packages" className="font-heading text-xl font-black text-foreground">This order&apos;s packages</h2>
        <p className="text-sm font-bold text-muted-foreground">{packagesHeadline(packing.packages)}</p>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.bagId} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${r.here ? "border-2 border-primary/40 bg-primary/5" : "bg-secondary/50"}`}>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="font-bold text-foreground">{r.tierName}</span>
              <span className="font-mono font-black text-foreground break-all">{r.bagCode}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${PACKAGE_TONE[r.status.tone]}`}>{r.status.text}</span>
              {r.trackingNumber && <span className="font-mono text-xs text-muted-foreground break-all">{r.trackingNumber}</span>}
            </div>
            {r.here ? (
              <span className="shrink-0 text-xs font-bold text-primary">This bag</span>
            ) : (
              <AdminLink href={r.href} className={`${textLink} min-h-9 shrink-0`}>Open →</AdminLink>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
