import type { Metadata } from "next";
import { CalendarClock, CircleAlert, Clock, Hourglass, PackageCheck } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { nyToday } from "@/lib/intake/business-days";
import { isMissingIntakeSchema } from "@/lib/intake/completed";
import { dayText } from "@/lib/intake/tracking-format";
import { loadForgotten, type ForgottenCardItem, type ForgottenReport, type PastDueBag } from "@/components/intake/ship/forgotten-data";
import { FINAL_DRY_DAYS, SLOT_DAYS, SLOT_DAY_CHOICES, STALE_DAYS, type ForgottenRule } from "@/components/intake/ship/rules";
import { PLACES_NOTICE } from "@/components/intake/ship/schema";

/**
 * Forgotten cards (/admin/receiving/forgotten, the "Check" menu item): the
 * owner's "once in a while a card will be forgotten to be marked done, and
 * then we have no way of knowing". Lists cards that look forgotten, one rule
 * each (components/intake/ship/rules.ts), with where each was last seen and
 * links to fix it (the ship check page has Mark done). Read-only. Filters are
 * GET links: ?older=1 includes orders from before Receiving went live,
 * ?slot=<days> sets the "same slot" days, ?all=1 shows every row.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forgotten cards | Receiving", robots: { index: false } };

const BASE = "/admin/receiving/forgotten";
/** Rows shown per section before "Show all". */
const SHOWN = 100;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Params = Record<string, string | string[] | undefined>;
type Filters = { older: boolean; slot: number; all: boolean };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function parseFilters(sp: Params): Filters {
  const slot = Number(first(sp.slot));
  return {
    older: first(sp.older) === "1",
    slot: SLOT_DAY_CHOICES.includes(slot) ? slot : SLOT_DAYS,
    all: first(sp.all) === "1",
  };
}

function href(f: Filters, patch: Partial<Filters> = {}, hash = ""): string {
  const next = { ...f, ...patch };
  const p = new URLSearchParams();
  if (next.older) p.set("older", "1");
  if (next.slot !== SLOT_DAYS) p.set("slot", String(next.slot));
  if (next.all) p.set("all", "1");
  const q = p.toString();
  return `${BASE}${q ? `?${q}` : ""}${hash}`;
}

type SectionDef = { rule: ForgottenRule; id: string; title: string; hint: string; tone: "red" | "amber"; icon: React.ReactNode };

function sections(slotDays: number): SectionDef[] {
  const icon = (I: typeof CircleAlert) => <I aria-hidden className="size-5" strokeWidth={1.75} />;
  return [
    { rule: "finished_not_done", id: "finished", title: "Order finished, card not marked done", tone: "red", icon: icon(CircleAlert),
      hint: "The order is Completed, Shipped Back or Delivered, but this card was never ticked done. Check where it is." },
    { rule: "final_dry", id: "final-dry", title: `At Final Dry ${FINAL_DRY_DAYS}+ days`, tone: "red", icon: icon(Hourglass),
      hint: `Its step has been Final Dry (or it has sat in a Final Dry slot or on the Done shelf) for ${FINAL_DRY_DAYS} days or more, and it isn't marked done.` },
    { rule: "slot_idle", id: "slot", title: `Same slot ${slotDays}+ days`, tone: "amber", icon: icon(Clock),
      hint: `In one slot for ${slotDays} days or more with no move. A done card still in a slot may have been left behind.` },
    { rule: "stale", id: "untouched", title: `Untouched ${STALE_DAYS}+ days`, tone: "amber", icon: icon(CalendarClock),
      hint: `Its order is open, but nothing has happened to it (slot move, step change) for ${STALE_DAYS} days or more.` },
  ];
}

const TONES = {
  red: { tile: "border-red-200 bg-red-50 text-red-900", zero: "border-border bg-white text-muted-foreground", text: "text-red-800" },
  amber: { tile: "border-amber-200 bg-amber-50 text-amber-900", zero: "border-border bg-white text-muted-foreground", text: "text-amber-900" },
};

function Notice({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  return (
    <p role={tone === "red" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${tone === "red" ? "border-red-300 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
      {children}
    </p>
  );
}

function Chip({ href: to, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <AdminLink
      href={to}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center min-h-11 px-3.5 rounded-full border text-sm font-bold whitespace-nowrap transition-colors ${focusRing} ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-white border-border text-foreground hover:border-primary/40"
      }`}
    >
      {children}
    </AdminLink>
  );
}

const smallLink = `inline-flex items-center min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 transition-colors ${focusRing}`;

function CardItem({ card, tone }: { card: ForgottenCardItem; tone: "red" | "amber" }) {
  return (
    <li className="px-4 py-3.5 border-t border-border first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {card.code ? (
          <AdminLink href={`/admin/receiving/card/${card.id}`} className={`font-mono font-black text-foreground hover:underline rounded ${focusRing}`}>{card.code}</AdminLink>
        ) : (
          <span className="text-xs font-bold text-muted-foreground">No Card ID</span>
        )}
        <span className="font-semibold text-foreground break-words [overflow-wrap:anywhere]">{card.name}</span>
        {card.done && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800">Done</span>}
      </div>
      {card.detail && <p className="text-xs text-muted-foreground break-words">{card.detail}</p>}
      <p className="text-sm text-foreground mt-1 break-words">
        <span className="font-bold">{card.customer ?? "No customer name"}</span>
        <span className="text-muted-foreground"> · {card.orderNumber} · {card.orderStatusLabel}{card.bagCode ? ` · bag ${card.bagCode}` : ""}{card.dueDate ? ` · due ${dayText(card.dueDate)}` : ""}</span>
      </p>
      <p className={`text-sm font-bold mt-1 ${TONES[tone].text}`}>{card.reasonText}</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        Step: {card.stageLabel}
        {card.lastSeen ? ` · Last seen: ${card.lastSeen}` : ""}
      </p>
      {card.alsoText.length > 0 && <p className="text-xs text-muted-foreground mt-0.5">Also: {card.alsoText.join("; ")}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <AdminLink href={`/admin/receiving/ship/${card.orderId}`} className={smallLink}>
          {card.done ? "Ship check" : "Ship check · Mark done"}
        </AdminLink>
        <AdminLink href={`/admin/orders/${card.orderId}`} className={smallLink}>Order</AdminLink>
      </div>
    </li>
  );
}

function BagItem({ bag }: { bag: PastDueBag }) {
  return (
    <li className="px-4 py-3.5 border-t border-border first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <AdminLink href={`/admin/receiving/bag/${bag.id}`} className={`font-mono font-black text-foreground hover:underline rounded ${focusRing}`}>{bag.code}</AdminLink>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-secondary text-foreground">{bag.tierName}</span>
      </div>
      <p className="text-sm text-foreground mt-1 break-words">
        <span className="font-bold">{bag.customer ?? "No customer name"}</span>
        <span className="text-muted-foreground"> · {bag.orderNumber}</span>
      </p>
      <p className="text-sm font-bold mt-1 text-amber-900">
        Due {dayText(bag.dueDate)} · {plural(bag.daysOverdue, "day")} overdue
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {bag.doneCount} of {plural(bag.cardCount, "card")} done{bag.place ? ` · bag on ${bag.place}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <AdminLink href={`/admin/receiving/bag/${bag.id}`} className={smallLink}>Bag</AdminLink>
        <AdminLink href={`/admin/receiving/ship/${bag.orderId}?bag=${bag.id}`} className={smallLink}>Ship check</AdminLink>
      </div>
    </li>
  );
}

function SectionShell({ id, title, hint, icon, tone, count, children }: {
  id: string; title: string; hint: string; icon: React.ReactNode; tone: "red" | "amber"; count: number; children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 rounded-xl border border-border bg-white overflow-hidden">
      <header className="px-4 py-3 border-b border-border bg-secondary/40">
        <h2 id={`${id}-h`} className={`flex items-center gap-2 font-heading font-black text-lg ${count ? TONES[tone].text : "text-foreground"}`}>
          {icon}
          <span className="min-w-0">{title}</span>
          <span className="ml-auto tabular-nums">{count}</span>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </header>
      {children}
    </section>
  );
}

export default async function ForgottenCardsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const f = parseFilters(await searchParams);
  const today = nyToday();

  let report: ForgottenReport | null = null;
  let error: string | null = null;
  try {
    report = await loadForgotten(createAdminClient(), { includeOlder: f.older, slotDays: f.slot });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const defs = sections(f.slot);

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-5">
        <div>
          <AdminLink href="/admin/receiving" className={`inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline rounded ${focusRing}`}>
            ← Receiving
          </AdminLink>
          <h1 className="font-heading font-black text-3xl text-foreground">Forgotten cards</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Cards that look forgotten: finished orders with a card not marked done, cards left at Final Dry, cards sitting in one slot, cards nobody has touched, and bags past their due date. Each shows where it was last seen.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <nav aria-label="Which orders" className="flex flex-wrap gap-2">
            <Chip href={href(f, { older: false })} active={!f.older}>New system only</Chip>
            <Chip href={href(f, { older: true })} active={f.older}>Include older orders</Chip>
          </nav>
          <nav aria-label="Days in the same slot" className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-muted-foreground mr-1">Same slot for</span>
            {SLOT_DAY_CHOICES.map((d) => (
              <Chip key={d} href={href(f, { slot: d })} active={f.slot === d}>{d}+ days</Chip>
            ))}
          </nav>
          {f.older && (
            <p className="text-xs text-muted-foreground">
              Older orders (before Receiving went live on Nov 23) were tracked on the order page only, so many of their finished cards were never ticked done.
            </p>
          )}
        </div>

        {error && (isMissingIntakeSchema({ message: error })
          ? <Notice tone="amber">The receiving tables aren&apos;t in the database yet (supabase/migrations/20261123_intake_tracking.sql), so this report can&apos;t run.</Notice>
          : <Notice tone="red">Couldn&apos;t load the report: {error}</Notice>)}
        {report && !report.trackPlaces && <Notice tone="amber">{PLACES_NOTICE}</Notice>}

        {report && (
          <>
            {/* Counts */}
            <nav aria-label="Counts" className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {defs.map((d) => {
                const n = report.counts[d.rule];
                return (
                  <a key={d.id} href={`#${d.id}`} className={`rounded-xl border p-3 min-h-11 flex flex-col justify-between transition-colors hover:border-primary/40 ${focusRing} ${n ? TONES[d.tone].tile : TONES[d.tone].zero}`}>
                    <span className="font-heading font-black text-3xl tabular-nums">{n}</span>
                    <span className="text-xs font-bold leading-snug">{d.title}</span>
                  </a>
                );
              })}
              <a href="#bags" className={`col-span-2 sm:col-span-1 rounded-xl border p-3 min-h-11 flex flex-col justify-between transition-colors hover:border-primary/40 ${focusRing} ${report.counts.pastDue ? TONES.amber.tile : TONES.amber.zero}`}>
                <span className="font-heading font-black text-3xl tabular-nums">{report.counts.pastDue}</span>
                <span className="text-xs font-bold leading-snug">Bags past due</span>
              </a>
            </nav>
            <p className="text-xs text-muted-foreground -mt-2">
              The red number on Check in the menu counts the first two (new system only).
              {report.cards.length === 0 && report.bags.length === 0 ? " Nothing looks forgotten right now." : ""}
            </p>

            {defs.map((d) => {
              const rows = report.cards.filter((c) => c.rule === d.rule);
              const shown = f.all ? rows : rows.slice(0, SHOWN);
              return (
                <SectionShell key={d.id} id={d.id} title={d.title} hint={d.hint} icon={d.icon} tone={d.tone} count={rows.length}>
                  {rows.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-muted-foreground flex items-center gap-2">
                      <PackageCheck aria-hidden className="size-4 text-green-700" strokeWidth={1.75} />
                      None.
                    </p>
                  ) : (
                    <>
                      <ul>{shown.map((c) => <CardItem key={c.id} card={c} tone={d.tone} />)}</ul>
                      {shown.length < rows.length && (
                        <div className="px-4 py-3 border-t border-border">
                          <AdminLink href={href(f, { all: true }, `#${d.id}`)} className={smallLink}>Show all {rows.length}</AdminLink>
                        </div>
                      )}
                    </>
                  )}
                </SectionShell>
              );
            })}

            <SectionShell
              id="bags"
              title="Bags past due"
              hint={`Bags whose due date has passed (today is ${dayText(today)}) and still have cards not done.`}
              icon={<CalendarClock aria-hidden className="size-5" strokeWidth={1.75} />}
              tone="amber"
              count={report.bags.length}
            >
              {report.bags.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground flex items-center gap-2">
                  <PackageCheck aria-hidden className="size-4 text-green-700" strokeWidth={1.75} />
                  None.
                </p>
              ) : (
                <ul>{(f.all ? report.bags : report.bags.slice(0, SHOWN)).map((b) => <BagItem key={b.id} bag={b} />)}</ul>
              )}
            </SectionShell>
          </>
        )}
      </div>
    </div>
  );
}
