"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { backlogKnown, backlogNotes, formatDay, type BacklogDay } from "@/lib/dashboard-metrics";
import { BACKLOG_DAY_CLS, BACKLOG_DAY_LABEL, backlogEstimated } from "./backlog/quality";

// End-of-day backlog (restoration cards received and not finished, and their
// orders), one point per New York calendar day. Days without enough history
// are gaps, never zero; estimated days are drawn dashed with hollow dots.

const CARDS = "#0d9488";  // teal-600
const ORDERS = "#6366f1"; // indigo-500

type Point = {
  label: string;
  cards: number | null;      // exact days
  cardsEst: number | null;   // estimated days (plus the exact day either side, so the line joins)
  orders: number | null;
  ordersEst: number | null;
  row: BacklogDay;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Orders are counted only under the restoration-only rule (a database without it reports none). */
const ordersOf = (row: BacklogDay) => (row.rule ? row.orders : null);

function BacklogTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const { row } = payload[0].payload;
  const notes = backlogNotes(row);
  return (
    <div className="bg-white border border-border rounded-lg p-3 shadow-md text-sm max-w-64">
      <p className="font-bold text-foreground mb-1">
        {formatDay(row.day, { weekday: "short", month: "short", day: "numeric" })}
        {row.quality === "live" ? " (so far)" : ""}
      </p>
      {backlogKnown(row) ? (
        <>
          <p className="font-bold" style={{ color: CARDS }}>{plural(row.total, "card")} in backlog</p>
          {ordersOf(row) != null && <p className="font-semibold" style={{ color: ORDERS }}>in {plural(row.orders, "order")}</p>}
          <p className="text-xs text-muted-foreground mt-0.5">+{row.added} added · −{row.completed} completed</p>
        </>
      ) : null}
      {row.quality !== "live" && (
        <p className="mt-1.5">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${BACKLOG_DAY_CLS[row.quality]}`}>
            {BACKLOG_DAY_LABEL[row.quality]}
          </span>
        </p>
      )}
      {notes.map((n) => (
        <p key={n} className="text-xs text-muted-foreground mt-0.5">{n}</p>
      ))}
    </div>
  );
}

/** A filled dot on exact days, a hollow one on estimated days, none on gaps. */
function dotFor(color: string, estimatedLine: boolean) {
  function BacklogDot(props: { cx?: number; cy?: number; index?: number; payload?: Point; value?: number | null }) {
    const { cx, cy, index, payload, value } = props;
    const est = payload ? backlogEstimated(payload.row.quality) : false;
    if (cx == null || cy == null || value == null || est !== estimatedLine) return <g key={`d${index}`} />;
    return est
      ? <circle key={`d${index}`} cx={cx} cy={cy} r={3} fill="#fff" stroke={color} strokeWidth={1.5} />
      : <circle key={`d${index}`} cx={cx} cy={cy} r={2.5} fill={color} />;
  }
  return BacklogDot;
}

export function BacklogChart({ days, title = "Card Backlog — Last 30 Days" }: { days: BacklogDay[]; title?: string }) {
  const known = days.map(backlogKnown);
  const est = days.map((d, i) => known[i] && backlogEstimated(d.quality));
  const exact = days.map((_, i) => known[i] && !est[i]);
  // An exact day next to an estimated one also carries the dashed line, so the two join
  const joinsEst = (i: number) => est[i] || (exact[i] && (est[i - 1] === true || est[i + 1] === true));
  const data: Point[] = days.map((row, i) => ({
    label: formatDay(row.day),
    cards: exact[i] ? row.total : null,
    cardsEst: joinsEst(i) ? row.total : null,
    orders: exact[i] ? ordersOf(row) : null,
    ordersEst: joinsEst(i) ? ordersOf(row) : null,
    row,
  }));
  const hasEstimated = est.some(Boolean);
  const today = days[days.length - 1];
  const knownDays = days.filter(backlogKnown);
  const first = knownDays[0];
  const change = today && first && today !== first && backlogKnown(today) ? today.total - first.total : null;

  const line = { type: "monotone" as const, strokeWidth: 2, connectNulls: false, isAnimationActive: false };

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="font-heading font-black text-lg text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Restoration cards received and not finished, and their orders, at the end of each day (New York time)
          </p>
        </div>
        {today && backlogKnown(today) && (
          <div className="sm:text-right">
            <p className="font-heading font-black text-2xl" style={{ color: CARDS }}>
              {today.total} <span className="text-sm font-sans font-bold">card{today.total !== 1 ? "s" : ""}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {ordersOf(today) != null && <>in {plural(today.orders, "order")}</>}
              {ordersOf(today) != null && change != null && " · "}
              {change != null && (
                <>{change === 0 ? "no change" : `${change > 0 ? "+" : "−"}${Math.abs(change)} cards`} since {formatDay(first.day)}</>
              )}
            </p>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} interval={4} />
          <YAxis tick={{ fontSize: 12, fill: "#888" }} axisLine={false} tickLine={false} allowDecimals={false} domain={["auto", "auto"]} />
          <Tooltip content={<BacklogTooltip />} />
          <Line {...line} dataKey="orders" name="Orders" stroke={ORDERS} dot={dotFor(ORDERS, false)} activeDot={{ r: 4 }} />
          <Line {...line} dataKey="ordersEst" name="Orders (estimated)" stroke={ORDERS} strokeDasharray="5 4" dot={dotFor(ORDERS, true)} activeDot={{ r: 4 }} />
          <Line {...line} dataKey="cards" name="Cards" stroke={CARDS} dot={dotFor(CARDS, false)} activeDot={{ r: 4 }} />
          <Line {...line} dataKey="cardsEst" name="Cards (estimated)" stroke={CARDS} strokeDasharray="5 4" dot={dotFor(CARDS, true)} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>

      <div className="flex gap-x-6 gap-y-2 mt-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="w-4 h-0.5 inline-block" style={{ background: CARDS }} />Cards in backlog
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="w-4 h-0.5 inline-block" style={{ background: ORDERS }} />Orders
        </div>
        {hasEstimated && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <svg width="16" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="16" y2="4" stroke="#888" strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            Estimated day
          </div>
        )}
      </div>
    </div>
  );
}
