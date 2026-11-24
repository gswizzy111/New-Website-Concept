import type { Metadata } from "next";
import { ScanLine, TriangleAlert, X } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { nyToday } from "@/lib/intake/business-days";
import { normalizeTier, tierRank } from "@/lib/intake/codes";
import { MIGRATION_NOTICE } from "../_components/schema";
import { DoneBar, dueInfo, DUE_TEXT, endOfWeek, shortDay, StepSummary, TierBadge, type DueInfo } from "../bags/_components/bag-bits";
import { ShelfSignButton } from "./_components/print-buttons";
import { scanHref, shelfSlotCode, shelfSlotName } from "./_lib/places";
import { loadShelf, type PlaceRef, type ShelfBag, type ShelfCard } from "./load-shelf";

/**
 * The Shelf: open bags by due date, one section per due date (its shelf slot,
 * "DUE MON DEC 7"): overdue first, then today, then the days after; bags
 * without a due date, then bags whose cards are all done, last. Each bag shows
 * where every card is now: its slot (CLAMP 07), on the shelf, or not in a
 * slot. Filters are plain GET links, so they work without JavaScript.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shelf | Receiving", robots: { index: false } };

const BASE = "/admin/receiving/shelf";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

type DueFilter = "overdue" | "week";
type Filters = { tier: string | null; due: DueFilter | null };
type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function parseFilters(sp: Params): Filters {
  const tier = normalizeTier(first(sp.tier));
  const due = first(sp.due);
  return {
    tier: tier && /^[a-z_]{1,40}$/.test(tier) ? tier : null,
    due: due === "overdue" || due === "week" ? due : null,
  };
}

function shelfHref(f: Filters, patch: Partial<Filters> = {}): string {
  const next = { ...f, ...patch };
  const p = new URLSearchParams();
  if (next.tier) p.set("tier", next.tier);
  if (next.due) p.set("due", next.due);
  const s = p.toString();
  return s ? `${BASE}?${s}` : BASE;
}

type Ctx = { today: string; weekEnd: string };
const isOverdue = (b: ShelfBag, ctx: Ctx) => !b.allCardsDone && !!b.dueDate && b.dueDate < ctx.today;
const isDueThisWeek = (b: ShelfBag, ctx: Ctx) => !b.allCardsDone && !!b.dueDate && b.dueDate <= ctx.weekEnd;

function passes(b: ShelfBag, f: Filters, ctx: Ctx, skip?: "tier" | "due"): boolean {
  if (skip !== "tier" && f.tier && normalizeTier(b.tier) !== f.tier) return false;
  if (skip !== "due" && f.due === "overdue" && !isOverdue(b, ctx)) return false;
  if (skip !== "due" && f.due === "week" && !isDueThisWeek(b, ctx)) return false;
  return true;
}

function Chip({ href, active, tone = "default", children }: { href: string; active: boolean; tone?: "default" | "red"; children: React.ReactNode }) {
  const idle = tone === "red" ? "border-red-200 text-red-800" : "border-border text-foreground";
  return (
    <AdminLink
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full border text-sm font-bold whitespace-nowrap transition-colors ${focusRing} ${
        active ? "bg-primary text-primary-foreground border-primary" : `bg-white hover:border-primary/40 ${idle}`
      }`}
    >
      {children}
    </AdminLink>
  );
}

function Count({ n, active }: { n: number; active: boolean }) {
  return <span className={`min-w-6 px-1.5 py-0.5 rounded-full text-xs font-black tabular-nums text-center ${active ? "bg-white/20" : "bg-secondary"}`}>{n}</span>;
}

/** Where a card is, as a chip: its slot, on its shelf, another shelf, done, or not in a slot. */
function placeChip(c: ShelfCard, slot: PlaceRef | null, tracking: boolean, bagOnShelf: boolean): { text: string; cls: string } {
  const chip = "bg-gray-100 text-gray-700 border-gray-200";
  if (!tracking) return { text: c.done ? "Done" : c.stageLabel, cls: c.done ? "bg-green-50 text-green-800 border-green-200" : chip };
  const p = c.place;
  if (!p) {
    if (c.done) return { text: "Done · not in a slot", cls: "bg-green-50 text-green-800 border-green-200" };
    // In its bag, and the bag was scanned onto its shelf
    return bagOnShelf ? { text: "On shelf", cls: "bg-green-50 text-green-800 border-green-200" } : { text: "Not in a slot", cls: chip };
  }
  if (p.kind === "shelf") {
    return slot && p.id === slot.id
      ? { text: "On shelf", cls: "bg-green-50 text-green-800 border-green-200" }
      : { text: `On shelf ${p.name}`, cls: "bg-amber-50 text-amber-900 border-amber-300" };
  }
  if (p.kind === "station") return { text: p.name, cls: "bg-purple-50 text-purple-900 border-purple-200" };
  if (p.kind === "done") return { text: p.name, cls: "bg-green-50 text-green-800 border-green-200" };
  return { text: p.name, cls: "bg-sky-50 text-sky-900 border-sky-200" };
}

function BagCard({ bag, slot, tracking, today }: { bag: ShelfBag; slot: PlaceRef | null; tracking: boolean; today: string }) {
  const bagOnShelf = !!slot && bag.bagPlace?.id === slot.id;
  const onShelf = bag.cards.filter((c) => (c.place && slot && c.place.id === slot.id) || (!c.place && !c.done && bagOnShelf)).length;
  const inSlots = bag.cards.filter((c) => c.place?.kind === "station").length;
  const loose = bagOnShelf ? 0 : bag.cards.filter((c) => !c.place && !c.done).length;
  const bagWhere = bag.bagPlace
    ? bag.bagPlace.kind === "shelf" && slot && bag.bagPlace.id === slot.id ? "Bag on shelf" : `Bag at ${bag.bagPlace.name}`
    : null;
  return (
    <li className="min-w-0 bg-white rounded-xl border border-border p-4 flex flex-col gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <AdminLink href={`/admin/receiving/bag/${bag.id}`} className={`font-mono font-black text-xl leading-tight text-foreground hover:text-primary hover:underline underline-offset-4 [overflow-wrap:anywhere] rounded ${focusRing}`}>
            {bag.code}
          </AdminLink>
          <TierBadge tier={bag.tier} name={bag.tierName} />
          {bagWhere && <span className="text-xs font-bold text-muted-foreground">{bagWhere}</span>}
        </div>
        <p className="mt-0.5 text-base font-bold leading-snug text-foreground [overflow-wrap:anywhere]">
          {bag.customerName ?? <span className="font-semibold text-muted-foreground">No customer name</span>}
          <span className="text-xs font-normal text-muted-foreground"> · Order #{bag.orderNumber}</span>
        </p>
      </div>

      <div>
        <p className="text-sm text-foreground">
          <span className="font-black tabular-nums">{bag.completedCount}/{bag.cardCount}</span> card{bag.cardCount === 1 ? "" : "s"} done
          {tracking && bag.cards.length > 0 && (
            <span className="text-muted-foreground">
              {" · "}
              {[onShelf ? `${onShelf} on shelf` : null, inSlots ? `${inSlots} in slots` : null, loose ? `${loose} not in a slot` : null].filter(Boolean).join(" · ") || "all elsewhere"}
            </span>
          )}
        </p>
        <div className="mt-1.5 max-w-48">
          <DoneBar done={bag.completedCount} total={bag.cardCount} />
        </div>
      </div>

      {bag.cardCount > 0 && <StepSummary groups={bag.stageGroups} />}

      {bag.cards.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-t border-border" aria-label={`Where the cards of ${bag.code} are`}>
          {bag.cards.map((c) => {
            const chip = placeChip(c, slot, tracking, bagOnShelf);
            return (
              <li key={c.id} className="flex items-center gap-2 py-1.5 text-sm min-w-0">
                <AdminLink href={`/admin/receiving/card/${c.id}`} className={`font-mono text-xs font-bold text-foreground hover:text-primary hover:underline shrink-0 rounded ${focusRing}`}>
                  {c.code ?? "No ID"}
                </AdminLink>
                <span className="min-w-0 flex-1 truncate text-foreground" title={c.name}>{c.name}</span>
                {tracking && c.place?.kind === "station" && !c.done && (
                  <span className="hidden sm:inline text-xs text-muted-foreground shrink-0">{c.stageLabel}</span>
                )}
                <span className={`shrink-0 max-w-[50%] truncate rounded-md border px-2 py-0.5 text-xs font-bold ${chip.cls}`} title={chip.text}>{chip.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {bag.receivedOn && <p className="text-xs text-muted-foreground -mt-1">Received {shortDay(bag.receivedOn, today)}</p>}
    </li>
  );
}

type Section = { key: string; dueDate: string | null; done: boolean; bags: ShelfBag[] };

export default async function ShelfPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const f = parseFilters(await searchParams);
  const result = await loadShelf(createAdminClient());
  const today = nyToday();
  const ctx: Ctx = { today, weekEnd: endOfWeek(today) };
  const bags = result.ok ? result.bags : [];
  const filtered = bags.filter((b) => passes(b, f, ctx));

  // One section per due date (bags come soonest due first), then no due date, then all cards done
  const sections: Section[] = [];
  const byKey = new Map<string, Section>();
  for (const b of filtered) {
    const key = b.allCardsDone ? "done" : b.dueDate ?? "none";
    let s = byKey.get(key);
    if (!s) {
      s = { key, dueDate: b.allCardsDone ? null : b.dueDate, done: b.allCardsDone, bags: [] };
      byKey.set(key, s);
      sections.push(s);
    }
    s.bags.push(b);
  }
  const rank = (s: Section) => (s.done ? 2 : s.dueDate ? 0 : 1);
  sections.sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  // Chip counts: what each choice would show with the other filter kept
  const forTier = bags.filter((b) => passes(b, f, ctx, "tier"));
  const tierCounts = new Map<string, { name: string; n: number }>();
  for (const b of forTier) {
    const key = normalizeTier(b.tier) ?? b.tier;
    const t = tierCounts.get(key) ?? { name: b.tierName, n: 0 };
    t.n++;
    tierCounts.set(key, t);
  }
  if (f.tier && !tierCounts.has(f.tier)) tierCounts.set(f.tier, { name: bags.find((b) => normalizeTier(b.tier) === f.tier)?.tierName ?? f.tier, n: 0 });
  const tiers = [...tierCounts.entries()].sort(([a], [b]) => tierRank(a) - tierRank(b) || a.localeCompare(b));
  const forDue = bags.filter((b) => passes(b, f, ctx, "due"));
  const overdueCount = forDue.filter((b) => isOverdue(b, ctx)).length;
  const weekCount = forDue.filter((b) => isDueThisWeek(b, ctx)).length;
  const anyFilter = !!(f.tier || f.due);
  const tracking = result.ok && result.tracking;

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <AdminLink href="/admin/receiving" className={`inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline rounded ${focusRing}`}>
          ← Receiving
        </AdminLink>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-3xl">
            <h1 className="font-heading font-black text-3xl text-foreground">Shelf</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Open bags by due date, one shelf per date: overdue first, then today, then the days after. Each card shows where it is now: its slot, on the shelf, or not in a slot.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Tracking">
            <AdminLink href="/admin/scan" className={`inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 ${focusRing}`}>
              <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
              Scan
            </AdminLink>
            <AdminLink href="/admin/receiving/locations" className={`inline-flex items-center min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold hover:border-primary/40 ${focusRing}`}>
              Places
            </AdminLink>
          </nav>
        </div>

        {!result.ok && (
          <p role={result.missingSchema ? "status" : "alert"} className={`mb-5 rounded-xl border px-4 py-3 text-sm ${result.missingSchema ? "border-amber-300 bg-amber-50 text-amber-800" : "border-red-300 bg-red-50 text-red-700"}`}>
            {result.missingSchema ? MIGRATION_NOTICE : `Couldn't load the shelf: ${result.error}`}
          </p>
        )}
        {result.ok && !result.tracking && bags.length > 0 && (
          <p role="status" className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Where each card is shows once the card tracking update (supabase/migrations/20261124_card_tracking.sql) is applied. Bags and steps are below.
          </p>
        )}

        {result.ok && bags.length > 0 && (
          <div className="flex flex-col gap-3 mb-6">
            <nav aria-label="Tier" className="flex flex-wrap gap-2">
              <Chip href={shelfHref(f, { tier: null })} active={!f.tier}>All tiers <Count n={forTier.length} active={!f.tier} /></Chip>
              {tiers.map(([key, t]) => (
                <Chip key={key} href={shelfHref(f, { tier: key })} active={f.tier === key}>{t.name} <Count n={t.n} active={f.tier === key} /></Chip>
              ))}
            </nav>
            <nav aria-label="Due date" className="flex flex-wrap gap-2">
              <Chip href={shelfHref(f, { due: null })} active={!f.due}>Any due date</Chip>
              <Chip href={shelfHref(f, { due: "overdue" })} active={f.due === "overdue"} tone={overdueCount ? "red" : "default"}>
                Overdue <Count n={overdueCount} active={f.due === "overdue"} />
              </Chip>
              <Chip href={shelfHref(f, { due: "week" })} active={f.due === "week"}>
                Due this week <Count n={weekCount} active={f.due === "week"} />
              </Chip>
              {anyFilter && (
                <AdminLink href={BASE} className={`inline-flex items-center gap-1 min-h-11 px-2 text-sm font-bold text-primary hover:underline rounded ${focusRing}`}>
                  <X aria-hidden className="size-4" strokeWidth={1.75} />
                  Clear filters
                </AdminLink>
              )}
            </nav>
            {sections.length > 1 && (
              <nav aria-label="Jump to a shelf" className="flex flex-wrap gap-1.5 text-xs">
                {sections.map((s) => (
                  <a key={s.key} href={`#due-${s.key}`} className={`inline-flex items-center min-h-9 px-2.5 rounded-md border border-border bg-white font-bold hover:border-primary/40 ${s.dueDate && s.dueDate < today ? "text-red-700" : "text-foreground"} ${focusRing}`}>
                    {s.done ? "All done" : s.dueDate ? shortDay(s.dueDate, today) : "No due date"} · {s.bags.length}
                  </a>
                ))}
              </nav>
            )}
          </div>
        )}

        {result.ok && bags.length === 0 && (
          <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">
            No open bags. Bags show up here as soon as cards are received into them.
          </div>
        )}
        {result.ok && bags.length > 0 && filtered.length === 0 && (
          <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">
            No bags match these filters. <AdminLink href={BASE} className={`font-bold text-primary hover:underline rounded ${focusRing}`}>Clear filters</AdminLink>
          </div>
        )}

        <div className="flex flex-col gap-8">
          {result.ok && sections.map((s) => {
            const due: DueInfo | null = s.dueDate ? dueInfo({ dueDate: s.dueDate, dueStatus: "calculated", complete: false, today, holidays: result.holidays }) : null;
            const slot = s.dueDate ? result.slots.get(s.dueDate) ?? null : null;
            const cards = s.bags.reduce((n, b) => n + b.cardCount, 0);
            const title = s.done ? "All cards done" : s.dueDate ? slot?.name ?? shelfSlotName(s.dueDate) : "No due date";
            const accent = due?.kind === "overdue" ? "border-l-red-600" : due?.kind === "today" ? "border-l-amber-500" : "border-l-transparent";
            return (
              <section key={s.key} id={`due-${s.key}`} aria-labelledby={`due-h-${s.key}`} className="scroll-mt-20 lg:scroll-mt-6">
                <div className={`mb-3 flex flex-wrap items-end justify-between gap-3 border-l-4 pl-3 ${accent}`}>
                  <div className="min-w-0">
                    <h2 id={`due-h-${s.key}`} className={`font-heading font-black text-2xl sm:text-3xl leading-none tracking-tight ${due ? DUE_TEXT[due.kind] : "text-foreground"}`}>
                      {title}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {due?.hint && (
                        <span className={`font-bold ${due.kind === "upcoming" ? "" : DUE_TEXT[due.kind]}`}>
                          {due.kind === "overdue" && <TriangleAlert aria-hidden className="inline size-3.5 mr-1 -mt-0.5" strokeWidth={1.75} />}
                          {due.hint} ·{" "}
                        </span>
                      )}
                      {s.bags.length} bag{s.bags.length === 1 ? "" : "s"} · {cards} card{cards === 1 ? "" : "s"}
                      {s.dueDate && <span className="font-mono text-xs"> · {slot?.code ?? shelfSlotCode(s.dueDate)}</span>}
                    </p>
                    {s.done && <p className="mt-1 text-sm text-muted-foreground">Every card in these bags is done: they go to the Done shelf.</p>}
                    {!s.done && !s.dueDate && <p className="mt-1 text-sm text-muted-foreground">These bags need a due date before they get a shelf.</p>}
                  </div>
                  {slot && (
                    <div className="flex flex-wrap gap-2">
                      <ShelfSignButton placeId={slot.id} code={slot.code} name={slot.name} />
                      <AdminLink href={scanHref(slot.code)} className={`inline-flex items-center gap-1.5 min-h-11 px-3 rounded-lg border border-border bg-white text-sm font-bold hover:border-primary/40 ${focusRing}`} aria-label={`Scan ${slot.name}`}>
                        <ScanLine aria-hidden className="size-4" strokeWidth={1.75} />
                        Scan
                      </AdminLink>
                    </div>
                  )}
                </div>
                <ul className="grid gap-3 lg:grid-cols-2" aria-label={`Bags ${s.done ? "with every card done" : s.dueDate ? `due ${shortDay(s.dueDate, today)}` : "without a due date"}`}>
                  {s.bags.map((b) => <BagCard key={b.id} bag={b} slot={slot} tracking={tracking} today={today} />)}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
