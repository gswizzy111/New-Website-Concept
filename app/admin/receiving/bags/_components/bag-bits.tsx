import { Check, Printer, TriangleAlert } from "lucide-react";
import { addCalendarDays, businessDaysBetween, isDay, weekday } from "@/lib/intake/business-days";
import { normalizeTier } from "@/lib/intake/codes";
import { stageIndex } from "@/lib/intake/stage-plan";
import { nyDate } from "@/lib/intake/tracking-format";
import type { BagStageGroup, DueStatus } from "@/lib/intake/types";

/**
 * Small pieces the Bags board (/admin/receiving/bags) and the order page's
 * work orders panel (components/intake/order-bags-panel.tsx) share: where a
 * bag stands against its due date, which steps its cards are at, and whether
 * its label is printed. Server components, no client code.
 */

export type DueKind = "overdue" | "today" | "upcoming" | "none" | "done";

export type DueInfo = {
  kind: DueKind;
  /** Business days after today up to the due date (upcoming only). */
  businessDaysLeft: number | null;
  /** Calendar days past the due date (overdue only), like the bag page. */
  daysOverdue: number | null;
  /** "Due today", "4 business days left", "Overdue 2 days", "No received date"; null when done. */
  hint: string | null;
  /** The date was worked out with today's settings (historical bag) and should be checked. */
  needsReview: boolean;
};

const NO_DATE_HINT: Partial<Record<DueStatus, string>> = {
  missing_received_date: "No received date",
  needs_review: "Due date needs review",
  pending: "No due date yet",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Where a bag stands against its due date, in New York days: business days
 * left (lib/intake/business-days.ts, with the business_holidays list) or how
 * many days overdue. A bag whose cards are all done is never overdue.
 */
export function dueInfo(input: {
  dueDate: string | null;
  dueStatus: DueStatus;
  complete: boolean;
  today: string;
  holidays: ReadonlySet<string>;
}): DueInfo {
  const { dueDate, dueStatus, complete, today, holidays } = input;
  const needsReview = dueStatus === "needs_review" && isDay(dueDate);
  const base = { businessDaysLeft: null, daysOverdue: null, needsReview };
  if (complete) return { ...base, kind: "done", hint: null };
  if (!isDay(dueDate)) return { ...base, kind: "none", hint: NO_DATE_HINT[dueStatus] ?? "No due date" };
  if (dueDate < today) {
    const days = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${dueDate}T12:00:00Z`)) / 86_400_000);
    return { ...base, kind: "overdue", daysOverdue: days, hint: `Overdue ${plural(days, "day")}` };
  }
  if (dueDate === today) return { ...base, kind: "today", hint: "Due today" };
  const left = businessDaysBetween(today, dueDate, holidays);
  return {
    ...base,
    kind: "upcoming",
    businessDaysLeft: left,
    hint: left > 0 ? `${plural(left, "business day")} left` : "Under 1 business day left",
  };
}

/** The last day (Sunday) of the week `today` is in, Monday to Sunday. */
export function endOfWeek(today: string): string {
  return addCalendarDays(today, (7 - weekday(today)) % 7);
}

/** "Mon, Dec 7" for a stored day; the year only when it isn't this year's. */
export function shortDay(day: string | null | undefined, today: string): string {
  if (!isDay(day)) return "—";
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" as const }),
  });
}

export const DUE_TEXT: Record<DueKind, string> = {
  overdue: "text-red-700",
  today: "text-amber-800",
  upcoming: "text-foreground",
  none: "text-amber-800",
  done: "text-green-700",
};

/** Tier colours, the same as the order page's tier badge. */
const TIER_STYLES: Record<string, string> = {
  elite: "bg-cyan-100 text-cyan-800 border-cyan-300",
  ultra_premium: "bg-blue-100 text-blue-800 border-blue-300",
  premium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  expedited: "bg-slate-100 text-slate-700 border-slate-300",
  regular: "bg-amber-100 text-amber-800 border-amber-300",
  fast_pass: "bg-orange-100 text-orange-800 border-orange-300",
  prep: "bg-emerald-100 text-emerald-800 border-emerald-300",
};

export function TierBadge({ tier, name, className = "" }: { tier: string; name: string; className?: string }) {
  const style = TIER_STYLES[normalizeTier(tier) ?? ""] ?? "bg-gray-100 text-gray-700 border-gray-300";
  return <span className={`inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${style} ${className}`}>{name}</span>;
}

/** One chip of the steps summary: "Step 3 Humidity Press: 2", "Not started: 1", "Done: 1". */
export type StepChip = { key: string; text: string; name: string | null; count: number; tone: "waiting" | "step" | "done" };

/** The bag's cards by step (BagStageGroup[], already in step order) as chips. */
export function stepChips(groups: readonly BagStageGroup[]): StepChip[] {
  return groups.map((g) => {
    const count = g.cardIds.length;
    if (g.completed) return { key: g.key, text: "Done", name: null, count, tone: "done" };
    if (!g.stage) return { key: g.key, text: "Not started", name: null, count, tone: "waiting" };
    const i = stageIndex(g.stage);
    return { key: g.key, text: i >= 0 ? `Step ${i + 1}` : g.label, name: i >= 0 ? g.label : null, count, tone: "step" };
  });
}

const CHIP_TONE: Record<StepChip["tone"], string> = {
  waiting: "bg-gray-100 text-gray-800 border-gray-200",
  step: "bg-purple-50 text-purple-900 border-purple-200",
  done: "bg-green-50 text-green-800 border-green-200",
};

/** "Step 3 Humidity Press: 2 · Not started: 1" as wrapping chips. */
export function StepSummary({ groups }: { groups: readonly BagStageGroup[] }) {
  const chips = stepChips(groups);
  if (!chips.length) return <p className="text-xs text-muted-foreground">No cards in this bag.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Cards by step">
      {chips.map((c) => (
        <li key={c.key} className={`inline-flex items-baseline max-w-full rounded-md border px-2 py-0.5 text-xs ${CHIP_TONE[c.tone]}`}>
          {/* A long step name shortens with an ellipsis; the count always shows */}
          <span className="min-w-0 truncate">
            <span className="font-bold">{c.text}</span>
            {c.name ? ` ${c.name}` : ""}:
          </span>
          <span className="ml-1 font-black tabular-nums whitespace-nowrap">
            {c.count}
            <span className="sr-only"> card{c.count === 1 ? "" : "s"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Label printed (and when), not printed, or printed but out of date. */
export function LabelStatus({ printedAt, outdated }: { printedAt: string | null; outdated: boolean }) {
  const pill = "inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap";
  if (!printedAt) {
    return (
      <span className={`${pill} bg-amber-100 text-amber-900`}>
        <Printer aria-hidden className="size-3.5" strokeWidth={1.75} />
        Label not printed
      </span>
    );
  }
  if (outdated) {
    return (
      <span className={`${pill} bg-amber-100 text-amber-900`} title={`Printed ${nyDate(printedAt)}, then the bag changed`}>
        <TriangleAlert aria-hidden className="size-3.5" strokeWidth={1.75} />
        Label out of date: reprint
      </span>
    );
  }
  return (
    <span className={`${pill} bg-green-50 text-green-800`}>
      <Check aria-hidden className="size-3.5" strokeWidth={1.75} />
      Label printed {nyDate(printedAt)}
    </span>
  );
}

/** Thin "cards done" bar. */
export function DoneBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div
      className="h-1.5 rounded-full bg-muted overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${done} of ${total} cards done`}
    >
      <div className="h-full rounded-full bg-green-600" style={{ width: `${pct}%` }} />
    </div>
  );
}
