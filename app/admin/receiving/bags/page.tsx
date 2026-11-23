import type { Metadata } from "next";
import { Search, X } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { nyToday } from "@/lib/intake/business-days";
import { codeKind, normalizeCode, normalizeTier, tierRank } from "@/lib/intake/codes";
import { MIGRATION_NOTICE } from "../_components/schema";
import { loadBoard, type BoardBag } from "./load-board";
import { BagRow, ROW_COLUMNS } from "./bag-row";
import { dueInfo, endOfWeek, shortDay, type DueInfo } from "./_components/bag-bits";

/**
 * The Bags board: every open tier bag as its own work order (its own Bag ID,
 * label, due date, steps and completion), overdue first, then the soonest
 * due. The customer keeps one order; staff work bag by bag. Filters are plain
 * GET links and a GET form, so they work without JavaScript.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bags | Receiving", robots: { index: false } };

/** Rows shown before "Show all". */
const SHOWN = 100;
const BASE = "/admin/receiving/bags";

type DueFilter = "overdue" | "week";
type Filters = { tier: string | null; due: DueFilter | null; label: boolean; q: string };
type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function parseFilters(sp: Params): Filters {
  const tier = normalizeTier(first(sp.tier));
  const due = first(sp.due);
  return {
    tier: tier && /^[a-z_]{1,40}$/.test(tier) ? tier : null,
    due: due === "overdue" || due === "week" ? due : null,
    label: first(sp.label) === "todo",
    q: first(sp.q).trim().slice(0, 100),
  };
}

function boardHref(f: Filters, patch: Partial<Filters> = {}, showAll = false): string {
  const next = { ...f, ...patch };
  const p = new URLSearchParams();
  if (next.tier) p.set("tier", next.tier);
  if (next.due) p.set("due", next.due);
  if (next.label) p.set("label", "todo");
  if (next.q) p.set("q", next.q);
  if (showAll) p.set("show", "all");
  const s = p.toString();
  return s ? `${BASE}?${s}` : BASE;
}

/**
 * Customer name, Bag ID or order number. A scanned or typed code matches
 * exactly: an order code (CD-2549) every bag of the order, a Bag ID its bag,
 * a Card ID (or a card's QR link) the bag the card is in.
 */
function matchesSearch(bag: BoardBag, q: string): boolean {
  if (!q) return true;
  const code = normalizeCode(q);
  const kind = code ? codeKind(code) : null;
  if (kind === "order") return bag.orderNumber.toUpperCase() === code;
  if (kind === "bag") return bag.code.toUpperCase() === code;
  if (kind === "card") return bag.cardCodes.some((c) => c.toUpperCase() === code);
  const needle = q.replace(/^#+\s*/, "").toLowerCase();
  if (!needle) return true;
  return [bag.customerName ?? "", bag.code, bag.orderNumber].some((s) => s.toLowerCase().includes(needle));
}

type Ctx = { today: string; weekEnd: string };
const isOverdue = (b: BoardBag, ctx: Ctx) => !b.allCardsDone && !!b.dueDate && b.dueDate < ctx.today;
/** Due by Sunday of this week; overdue bags are due already, so they count too. */
const isDueThisWeek = (b: BoardBag, ctx: Ctx) => !b.allCardsDone && !!b.dueDate && b.dueDate <= ctx.weekEnd;
const needsLabel = (b: BoardBag) => !b.labelPrintedAt || b.labelOutdated;

/** The filters, all but `skip` (so each group of chips counts what picking it would show). */
function passes(b: BoardBag, f: Filters, ctx: Ctx, skip?: "tier" | "due" | "label"): boolean {
  if (skip !== "tier" && f.tier && normalizeTier(b.tier) !== f.tier) return false;
  if (skip !== "due" && f.due === "overdue" && !isOverdue(b, ctx)) return false;
  if (skip !== "due" && f.due === "week" && !isDueThisWeek(b, ctx)) return false;
  if (skip !== "label" && f.label && !needsLabel(b)) return false;
  return matchesSearch(b, f.q);
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function Chip({ href, active, tone = "default", children }: { href: string; active: boolean; tone?: "default" | "red" | "amber"; children: React.ReactNode }) {
  const idle = tone === "red" ? "border-red-200 text-red-800" : tone === "amber" ? "border-amber-200 text-amber-900" : "border-border text-foreground";
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
  return (
    <span className={`min-w-6 px-1.5 py-0.5 rounded-full text-xs font-black tabular-nums text-center ${active ? "bg-white/20" : "bg-secondary"}`}>
      {n}
    </span>
  );
}

function Notice({ tone, children }: { tone: "amber" | "red"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "red" ? "alert" : "status"}
      className={`mb-5 rounded-xl border px-4 py-3 text-sm ${tone === "red" ? "border-red-300 bg-red-50 text-red-700" : "border-amber-300 bg-amber-50 text-amber-800"}`}
    >
      {children}
    </p>
  );
}

export default async function BagsBoardPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdmin();
  const sp = await searchParams;
  const f = parseFilters(sp);
  const showAll = first(sp.show) === "all";
  const result = await loadBoard(createAdminClient());

  const today = nyToday();
  const ctx: Ctx = { today, weekEnd: endOfWeek(today) };
  const bags = result.ok ? result.bags : [];
  const due = new Map<string, DueInfo>(
    result.ok
      ? bags.map((b) => [b.id, dueInfo({ dueDate: b.dueDate, dueStatus: b.dueStatus, complete: b.allCardsDone, today, holidays: result.holidays })])
      : [],
  );

  const filtered = bags.filter((b) => passes(b, f, ctx));
  const shown = showAll ? filtered : filtered.slice(0, SHOWN);
  const orderCount = new Set(bags.map((b) => b.orderId)).size;
  const anyFilter = !!(f.tier || f.due || f.label || f.q);

  // Chip counts: what each choice would show with the other filters kept
  const forTier = bags.filter((b) => passes(b, f, ctx, "tier"));
  const tierCounts = new Map<string, { name: string; n: number }>();
  for (const b of forTier) {
    const key = normalizeTier(b.tier) ?? b.tier;
    const t = tierCounts.get(key) ?? { name: b.tierName, n: 0 };
    t.n++;
    tierCounts.set(key, t);
  }
  if (f.tier && !tierCounts.has(f.tier)) {
    tierCounts.set(f.tier, { name: bags.find((b) => normalizeTier(b.tier) === f.tier)?.tierName ?? f.tier, n: 0 });
  }
  const tiers = [...tierCounts.entries()].sort(([a], [b]) => tierRank(a) - tierRank(b) || a.localeCompare(b));
  const forDue = bags.filter((b) => passes(b, f, ctx, "due"));
  const overdueCount = forDue.filter((b) => isOverdue(b, ctx)).length;
  const weekCount = forDue.filter((b) => isDueThisWeek(b, ctx)).length;
  const labelCount = bags.filter((b) => passes(b, f, ctx, "label") && needsLabel(b)).length;

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <AdminLink href="/admin/receiving" className={`inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline rounded ${focusRing}`}>
          ← Receiving
        </AdminLink>
        <div className="mb-5">
          <h1 className="font-heading font-black text-3xl text-foreground">Bags</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Every open tier bag is its own work order: its own Bag ID, label, due date and steps. The customer still has one order. Overdue bags first, then the soonest due.
          </p>
          {result.ok && bags.length > 0 && (
            <p className="mt-2 text-sm font-semibold text-foreground">
              {bags.length} open bag{bags.length === 1 ? "" : "s"} in {orderCount} order{orderCount === 1 ? "" : "s"}
            </p>
          )}
        </div>

        {!result.ok && result.missingSchema && <Notice tone="amber">{MIGRATION_NOTICE}</Notice>}
        {!result.ok && !result.missingSchema && <Notice tone="red">Couldn&apos;t load the bags: {result.error}</Notice>}

        {result.ok && bags.length > 0 && (
          <div className="flex flex-col gap-3 mb-5">
            <form method="GET" action={BASE} role="search" className="flex gap-2">
              {f.tier && <input type="hidden" name="tier" value={f.tier} />}
              {f.due && <input type="hidden" name="due" value={f.due} />}
              {f.label && <input type="hidden" name="label" value="todo" />}
              <label htmlFor="bags-q" className="sr-only">Search bags</label>
              <input
                id="bags-q"
                name="q"
                type="search"
                defaultValue={f.q}
                placeholder="Customer name, Bag ID or order number"
                className="flex-1 min-w-0 h-12 px-4 rounded-lg border border-border bg-white text-base sm:text-sm outline-none focus:border-primary transition-colors"
                enterKeyHint="search"
                autoComplete="off"
              />
              <button
                type="submit"
                className={`h-12 px-4 sm:px-5 inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors ${focusRing}`}
              >
                <Search aria-hidden className="size-4" strokeWidth={1.75} />
                <span className="max-sm:sr-only">Search</span>
              </button>
            </form>

            <nav aria-label="Tier" className="flex flex-wrap gap-2">
              <Chip href={boardHref(f, { tier: null })} active={!f.tier}>
                All tiers <Count n={forTier.length} active={!f.tier} />
              </Chip>
              {tiers.map(([key, t]) => (
                <Chip key={key} href={boardHref(f, { tier: key })} active={f.tier === key}>
                  {t.name} <Count n={t.n} active={f.tier === key} />
                </Chip>
              ))}
            </nav>

            <nav aria-label="Due date and label" className="flex flex-wrap gap-2">
              <Chip href={boardHref(f, { due: null })} active={!f.due}>
                Any due date
              </Chip>
              <Chip href={boardHref(f, { due: "overdue" })} active={f.due === "overdue"} tone={overdueCount ? "red" : "default"}>
                Overdue <Count n={overdueCount} active={f.due === "overdue"} />
              </Chip>
              <Chip href={boardHref(f, { due: "week" })} active={f.due === "week"}>
                Due this week <Count n={weekCount} active={f.due === "week"} />
              </Chip>
              <Chip href={boardHref(f, { label: !f.label })} active={f.label} tone={labelCount ? "amber" : "default"}>
                Label not printed <Count n={labelCount} active={f.label} />
              </Chip>
            </nav>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
              <p className="text-muted-foreground" aria-live="polite">
                {anyFilter ? `${filtered.length} of ${bags.length} bags` : `${bags.length} bags`}
                {f.due === "week" ? ` · due by ${shortDay(ctx.weekEnd, today)}, overdue included` : ""}
                {f.label ? " · label not printed or out of date" : ""}
                {f.q ? ` · matching “${f.q}”` : ""}
              </p>
              {anyFilter && (
                <AdminLink href={BASE} className={`inline-flex items-center gap-1 min-h-11 font-bold text-primary hover:underline rounded ${focusRing}`}>
                  <X aria-hidden className="size-4" strokeWidth={1.75} />
                  Clear filters
                </AdminLink>
              )}
            </div>
          </div>
        )}

        {result.ok && bags.length === 0 && (
          <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">
            No open bags. A bag shows up here as soon as cards are received into it, and leaves once every card in it is done.
          </div>
        )}

        {result.ok && bags.length > 0 && filtered.length === 0 && (
          <div className="rounded-xl border border-border bg-white p-8 text-center text-sm text-muted-foreground">
            No bags match these filters.{" "}
            <AdminLink href={BASE} className={`font-bold text-primary hover:underline rounded ${focusRing}`}>Clear filters</AdminLink>
          </div>
        )}

        {shown.length > 0 && (
          <>
            <div
              aria-hidden
              className={`hidden xl:grid ${ROW_COLUMNS} xl:gap-x-5 px-5 pb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground`}
            >
              <span>Bag · customer</span>
              <span>Due</span>
              <span>Cards · steps</span>
              <span>Label</span>
            </div>
            <ul className="flex flex-col gap-3" aria-label="Open bags">
              {shown.map((b) => <BagRow key={b.id} bag={b} due={due.get(b.id)!} today={today} />)}
            </ul>
          </>
        )}

        {filtered.length > shown.length && (
          <div className="mt-5 text-center">
            <AdminLink
              href={boardHref(f, {}, true)}
              className={`inline-flex items-center justify-center min-h-11 px-4 rounded-lg border border-border bg-white text-sm font-bold text-foreground hover:border-primary/40 ${focusRing}`}
            >
              Show all {filtered.length} bags
            </AdminLink>
          </div>
        )}
      </div>
    </div>
  );
}
