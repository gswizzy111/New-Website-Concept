import type { Metadata } from "next";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { nyToday } from "@/lib/intake/business-days";
import { dayText } from "@/lib/intake/tracking-format";
import { listWorkshopUsers } from "@/lib/workshop-users";
import { activityQuery, cardsHandled, loadActivity, weekStart } from "@/lib/team-activity";
import { TeamManager, type TeamRow } from "./_components/team-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team", robots: { index: false } };

// The owner's answer (Nov 26 2026): hired help get "Workshop only" (lib/workshop-access.ts)
const CAN = [
  "Scan cards, bags and holders; move cards, set their step, mark them Done, take them out (Scan page, Desk, card and bag pages)",
  "Receive orders, take photos, add a card that came in, pick a tier for a card that has none, print bag labels (Receiving and Bags)",
  "See the card and order details those pages show",
];
const CANNOT = [
  "Any money: totals, payments, refunds, gift cards, coupons",
  "Reports, dashboards, settings and places setup",
  "Edit orders, change an order's status by hand or a tier a card already has, buy shipping labels",
  "Customers, emails (other than what receiving sends), affiliates, partners, this page",
];

export default async function TeamPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const today = nyToday();
  const from = weekStart(today);

  const [team, week] = await Promise.all([listWorkshopUsers(admin), loadActivity(admin, { from, to: today })]);
  const handled = week.ok ? cardsHandled(week.actions) : null;
  const workers: TeamRow[] = team.ok
    ? team.workers.map((w) => ({
      ...w,
      cardsThisWeek: handled ? handled.get(w.username) ?? 0 : null,
      activityHref: `/admin/team/activity${activityQuery({ from, to: today, person: w.username, action: null })}`,
    }))
    : [];

  return (
    <div className="min-h-screen bg-secondary/30">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex-1">
            <h1 className="font-heading font-black text-3xl text-foreground">Team</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Logins for people you hire. They see only Scan, Receiving, Bags and Desk, and every move, Done, Take out, receipt and step change is saved with their name.
            </p>
          </div>
          <AdminLink
            href="/admin/team/activity"
            className="inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-gray-900 text-white text-sm font-bold whitespace-nowrap hover:bg-gray-800 transition-colors"
          >
            See who did what →
          </AdminLink>
        </div>

        <TeamManager workers={workers} error={team.ok ? null : team.error} />

        <p className="text-xs text-muted-foreground -mt-2">
          Cards handled this week: different cards each person received, moved, marked done, took out, changed the step of or photographed since {dayText(from)}, New York time.
          {!week.ok ? ` ${week.error}` : ""}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-950 leading-relaxed">
            <p className="font-bold mb-2">Workers can</p>
            <ul className="list-disc pl-4 flex flex-col gap-1">{CAN.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-950 leading-relaxed">
            <p className="font-bold mb-2">Workers can&apos;t see or do</p>
            <ul className="list-disc pl-4 flex flex-col gap-1">{CANNOT.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}
