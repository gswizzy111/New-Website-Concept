import type { Metadata } from "next";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { addCalendarDays, nyToday } from "@/lib/intake/business-days";
import { dayText } from "@/lib/intake/tracking-format";
import { listWorkshopUsers } from "@/lib/workshop-users";
import {
  ACTIVITY_KINDS, ACTION_LABEL, COUNTED_KINDS, COUNT_LABEL, NOT_RECORDED_KEY,
  activityQuery, applyFilters, loadActivity, personKey, readFilters, summarize, weekStart,
  type ActivityFilters, type Counts,
} from "@/lib/team-activity";
import { ActionList, Person } from "../_components/action-list";
import { cardsText, personOption, workerDirectory, type WorkerName } from "../_lib/view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity | Team", robots: { index: false } };

/** Actions listed per page (the CSV has them all). */
const PAGE_SIZE = 100;

const panel = "bg-white rounded-xl border border-border";
const field = "min-h-11 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:outline-none focus:border-primary";
const chip = "inline-flex items-center min-h-11 px-3 rounded-lg text-xs font-bold whitespace-nowrap transition-colors";
const button = "inline-flex items-center justify-center min-h-11 px-4 rounded-lg text-sm font-bold whitespace-nowrap transition-colors";

type SearchParams = Record<string, string | string[] | undefined>;

function CountsGrid({ counts }: { counts: Counts }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
      {COUNTED_KINDS.map((k) => (
        <div key={k}>
          <dt className="text-[11px] font-semibold text-muted-foreground">{COUNT_LABEL[k]}</dt>
          <dd className={`font-black tabular-nums ${counts[k] ? "text-foreground" : "text-muted-foreground/60"}`}>{counts[k]}</dd>
        </div>
      ))}
      <div>
        <dt className="text-[11px] font-semibold text-muted-foreground">Other</dt>
        <dd className={`font-black tabular-nums ${counts.other ? "text-foreground" : "text-muted-foreground/60"}`}>{counts.other}</dd>
      </div>
    </dl>
  );
}

function Num({ n }: { n: number }) {
  return <span className={n ? "text-foreground" : "text-muted-foreground/50"}>{n}</span>;
}

/** The quick ranges (keeping the person and action). */
function quickRanges(f: ActivityFilters, today: string) {
  return [
    { label: "Today", from: today, to: today },
    { label: "This week", from: weekStart(today), to: today },
    { label: "Last 7 days", from: addCalendarDays(today, -6), to: today },
    { label: "Last 30 days", from: addCalendarDays(today, -29), to: today },
  ].map((r) => ({ ...r, active: r.from === f.from && r.to === f.to, href: `/admin/team/activity${activityQuery({ ...f, from: r.from, to: r.to })}` }));
}

export default async function TeamActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = await searchParams;
  const today = nyToday();
  const filters = readFilters(params, today);
  const admin = createAdminClient();

  const [load, team] = await Promise.all([
    loadActivity(admin, { from: filters.from, to: filters.to }),
    listWorkshopUsers(admin),
  ]);
  const workers = team.ok ? team.workers : [];
  const dir: Map<string, WorkerName> = workerDirectory(workers);
  const all = load.ok ? load.actions : [];
  const shown = applyFilters(all, filters);
  const summary = summarize(shown);

  // Everyone in these days, every worker (even with nothing yet), and the person picked
  const people = new Map<string, string>();
  for (const p of summarize(all).people) people.set(personKey(p.by), personOption(p.by, dir));
  for (const w of workers) if (!people.has(w.username)) people.set(w.username, personOption(w.username, dir));
  if (filters.person && !people.has(filters.person)) {
    people.set(filters.person, filters.person === NOT_RECORDED_KEY ? personOption(null, dir) : personOption(filters.person, dir));
  }
  const personOptions = [...people].sort(([a, la], [b, lb]) =>
    (a === NOT_RECORDED_KEY ? 1 : 0) - (b === NOT_RECORDED_KEY ? 1 : 0) || la.localeCompare(lb));

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const rawPage = Number(typeof params.page === "string" ? params.page : 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, pages) : 1;
  const pageActions = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (n: number) => `/admin/team/activity${activityQuery(filters, { page: n > 1 ? n : null })}#actions`;
  const csvHref = (format?: "daily") => `/api/admin/team/activity${activityQuery(filters, { format })}`;

  const rangeText = filters.from === filters.to ? dayText(filters.from) : `${dayText(filters.from)} to ${dayText(filters.to)}`;
  const now = new Date();

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-5">
        <div>
          <AdminLink href="/admin/team" className="inline-flex items-center min-h-11 text-sm font-semibold text-primary hover:underline">← Team</AdminLink>
          <h1 className="font-heading font-black text-3xl text-foreground">Activity</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Who did what, by New York day: receiving, moves, Done, Take out, step changes, photos and labels. Only actions are saved; looking a card up isn&apos;t.
          </p>
        </div>

        {/* Filters */}
        <section className={`${panel} p-4 sm:p-5 flex flex-col gap-4`} aria-labelledby="filters">
          <h2 id="filters" className="sr-only">Filters</h2>
          <nav aria-label="Quick ranges" className="flex flex-wrap gap-2">
            {quickRanges(filters, today).map((r) => (
              <AdminLink
                key={r.label}
                href={r.href}
                aria-current={r.active ? "page" : undefined}
                className={`${chip} ${r.active ? "bg-foreground text-background" : "bg-secondary/60 text-foreground hover:bg-secondary"}`}
              >
                {r.label}
              </AdminLink>
            ))}
          </nav>
          {/* Keyed by the filters: a quick range or a page change shows its own values in the fields */}
          <form key={activityQuery(filters)} method="GET" action="/admin/team/activity" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-3 lg:items-end">
            <div>
              <label htmlFor="person" className="block text-xs font-semibold text-muted-foreground mb-1.5">Person</label>
              <select id="person" name="person" defaultValue={filters.person ?? ""} className={field}>
                <option value="">Everyone</option>
                {personOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="from" className="block text-xs font-semibold text-muted-foreground mb-1.5">From</label>
              <input id="from" type="date" name="from" defaultValue={filters.from} max={today} className={field} />
            </div>
            <div>
              <label htmlFor="to" className="block text-xs font-semibold text-muted-foreground mb-1.5">To</label>
              <input id="to" type="date" name="to" defaultValue={filters.to} max={today} className={field} />
            </div>
            <div>
              <label htmlFor="action" className="block text-xs font-semibold text-muted-foreground mb-1.5">Action</label>
              <select id="action" name="action" defaultValue={filters.action ?? ""} className={field}>
                <option value="">Every action</option>
                {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTION_LABEL[k]}</option>)}
              </select>
            </div>
            <button type="submit" className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}>Show</button>
          </form>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm text-foreground" aria-live="polite">
              <span className="font-bold">{rangeText}</span>
              <span className="text-muted-foreground"> · {shown.length} action{shown.length === 1 ? "" : "s"} · {cardsText(summary.counts.cards)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={csvHref()} download className={`${button} border border-border bg-white text-foreground hover:border-foreground/40`}>Download actions (CSV)</a>
              <a href={csvHref("daily")} download className={`${button} border border-border bg-white text-foreground hover:border-foreground/40`}>Download daily counts (CSV)</a>
            </div>
          </div>
        </section>

        {filters.note && <p role="status" className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">{filters.note}</p>}
        {load.ok && load.notes.map((n) => (
          <p key={n} role="status" className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">{n}</p>
        ))}
        {!load.ok && <p role="alert" className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{load.error}</p>}
        {!team.ok && (
          <p role="status" className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            Workers&apos; names couldn&apos;t be read, so usernames show instead. ({team.error})
          </p>
        )}

        {load.ok && shown.length === 0 && (
          <div className={`${panel} px-5 py-10 text-center`}>
            <p className="font-semibold text-foreground">Nothing recorded {filters.from === filters.to ? "on this day" : "in these days"}{filters.person || filters.action ? " for these filters" : ""}.</p>
            <p className="text-sm text-muted-foreground mt-1">Moves, Done, Take out, receiving and step changes show here as people make them.</p>
          </div>
        )}

        {shown.length > 0 && (
          <>
            {/* Per person, over the days shown */}
            <section aria-labelledby="by-person" className="flex flex-col gap-3">
              <h2 id="by-person" className="font-heading font-black text-lg text-foreground">By person</h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {summary.people.map((p) => (
                  <li key={personKey(p.by)} className={`${panel} p-4 flex flex-col gap-3`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base break-words"><Person by={p.by} dir={dir} /></p>
                        <p className="text-xs text-muted-foreground">
                          {cardsText(p.counts.cards)} · {p.counts.total} action{p.counts.total === 1 ? "" : "s"} · {p.days} day{p.days === 1 ? "" : "s"}
                          {p.by && dir.has(p.by) ? " · Worker" : ""}
                        </p>
                      </div>
                      {filters.person !== personKey(p.by) && (
                        <AdminLink
                          href={`/admin/team/activity${activityQuery({ ...filters, person: personKey(p.by) })}`}
                          className="shrink-0 inline-flex items-center min-h-11 text-xs font-bold text-primary hover:underline"
                          aria-label={`Show only ${personOption(p.by, dir)}`}
                        >
                          Only them
                        </AdminLink>
                      )}
                    </div>
                    <CountsGrid counts={p.counts} />
                  </li>
                ))}
              </ul>
            </section>

            {/* Per person per day */}
            <section aria-labelledby="by-day" className={`${panel} overflow-hidden`}>
              <div className="px-4 sm:px-5 py-4 border-b border-border">
                <h2 id="by-day" className="font-heading font-black text-lg text-foreground">Day by day</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Putting a card in a holder sets its step too: that counts once, as a move. Other: photos, labels printed, cards added, receiving undone, new rounds and due dates.
                </p>
              </div>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary/40 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <th scope="col" className="px-4 py-2.5">Person</th>
                      {COUNTED_KINDS.map((k) => <th key={k} scope="col" className="px-3 py-2.5 text-right whitespace-nowrap">{COUNT_LABEL[k]}</th>)}
                      <th scope="col" className="px-3 py-2.5 text-right">Other</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Cards</th>
                    </tr>
                  </thead>
                  {summary.days.map((d) => (
                    <tbody key={d.day} className="divide-y divide-border border-t border-border">
                      <tr className="bg-secondary/20">
                        <th scope="rowgroup" colSpan={COUNTED_KINDS.length + 3} className="px-4 py-2 text-left text-xs font-black uppercase tracking-wider text-foreground">
                          {dayText(d.day)}
                        </th>
                      </tr>
                      {d.people.map((p) => (
                        <tr key={personKey(p.by)}>
                          <th scope="row" className="px-4 py-2.5 text-left font-normal"><Person by={p.by} dir={dir} /></th>
                          {COUNTED_KINDS.map((k) => <td key={k} className="px-3 py-2.5 text-right font-bold tabular-nums"><Num n={p.counts[k]} /></td>)}
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums"><Num n={p.counts.other} /></td>
                          <td className="px-4 py-2.5 text-right font-black tabular-nums"><Num n={p.counts.cards} /></td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
              <ol className="sm:hidden flex flex-col">
                {summary.days.map((d) => (
                  <li key={d.day} className="border-t border-border first:border-t-0">
                    <h3 className="px-4 py-2 bg-secondary/20 text-xs font-black uppercase tracking-wider text-foreground">{dayText(d.day)}</h3>
                    <ul className="divide-y divide-border">
                      {d.people.map((p) => (
                        <li key={personKey(p.by)} className="px-4 py-3 flex flex-col gap-2">
                          <p className="flex items-baseline justify-between gap-3 text-sm">
                            <Person by={p.by} dir={dir} />
                            <span className="text-xs font-bold text-muted-foreground">{cardsText(p.counts.cards)}</span>
                          </p>
                          <CountsGrid counts={p.counts} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>

            {/* Every action */}
            <section id="actions" aria-labelledby="actions-title" className={`${panel} overflow-hidden scroll-mt-4`}>
              <div className="px-4 sm:px-5 py-4 border-b border-border flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="actions-title" className="font-heading font-black text-lg text-foreground">Actions</h2>
                <p className="text-xs text-muted-foreground">
                  {shown.length > PAGE_SIZE
                    ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, shown.length)} of ${shown.length}, newest first`
                    : "Newest first"}
                </p>
              </div>
              <ActionList actions={pageActions} dir={dir} now={now} />
              {pages > 1 && (
                <nav aria-label="Pages of actions" className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-border">
                  {page > 1
                    ? <AdminLink href={pageHref(page - 1)} className={`${button} border border-border bg-white text-foreground hover:border-foreground/40`}>← Newer</AdminLink>
                    : <span />}
                  <span className="text-xs text-muted-foreground">Page {page} of {pages}</span>
                  {page < pages
                    ? <AdminLink href={pageHref(page + 1)} className={`${button} border border-border bg-white text-foreground hover:border-foreground/40`}>Older →</AdminLink>
                    : <span />}
                </nav>
              )}
            </section>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          {shown.some((a) => a.by === null) ? "Not recorded: saved before names were kept, or on the old site. " : ""}
          Full admins show by their username; workers by their name.
        </p>
      </div>
    </div>
  );
}
