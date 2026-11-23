import { AdminLink } from "@/components/admin-ui/admin-link";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_HOLIDAYS } from "@/lib/intake/business-days";
import { tierDisplayName, tierRank } from "@/lib/intake/codes";
import { PREP_TURNAROUND_KEY } from "@/lib/intake/due-dates";
import { getLabelSettings } from "@/lib/intake/labels/data";
import { STAGES, adminStageLabel } from "@/lib/restoration-stages";
import { HolidaysEditor, LabelSettingsForm } from "./settings-forms";

export const dynamic = "force-dynamic";

type TierRow = { tier: string; display_name: string | null; turnaround_min_days: number | null; turnaround_max_days: number | null };

export default async function ReceivingSettingsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const [labels, holidays, tiers, prep] = await Promise.all([
    getLabelSettings(admin),
    admin.from("business_holidays").select("day, name").order("day"),
    admin.from("restoration_settings").select("tier, display_name, turnaround_min_days, turnaround_max_days"),
    admin.from("store_config").select("value").eq("key", PREP_TURNAROUND_KEY).maybeSingle(),
  ]);

  const tierRows = ((tiers.data ?? []) as TierRow[]).sort((a, b) => tierRank(a.tier) - tierRank(b.tier));
  const prepDays = parseInt(prep.data?.value ?? "", 10);

  const panel = "bg-white rounded-xl border border-border p-5 sm:p-6";
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <AdminLink href="/admin/receiving" className="text-sm font-bold text-primary hover:underline min-h-11 inline-flex items-center">
        Back to Receiving
      </AdminLink>
      <h1 className="font-heading font-black text-3xl text-foreground mt-1">Receiving Settings</h1>
      <p className="text-sm text-muted-foreground mt-1">Bag labels, the business days due dates count, and the steps and turnarounds they use.</p>

      <div className="mt-6 flex flex-col gap-6">
        <section aria-labelledby="labels-h" className={panel}>
          <h2 id="labels-h" className="font-heading font-black text-lg text-foreground">Bag labels</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-5">
            Size of the die-cut labels in the Labelife printer and how wide the label prints on them. Every bag label and tag is made at this size.
          </p>
          <LabelSettingsForm initial={labels} />
        </section>

        <section aria-labelledby="holidays-h" className={panel}>
          <h2 id="holidays-h" className="font-heading font-black text-lg text-foreground">Business holidays</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-5">
            Due dates count business days in New York: weekdays that aren&apos;t on this list. Changes apply to due dates worked out from now on; due dates already saved on bags never change.
          </p>
          <HolidaysEditor initial={(holidays.data ?? []) as { day: string; name: string }[]} initialError={holidays.error?.message ?? null} fallback={DEFAULT_HOLIDAYS} />
        </section>

        <section aria-labelledby="steps-h" className={panel}>
          <h2 id="steps-h" className="font-heading font-black text-lg text-foreground">Restoration steps</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-4">The 8 steps every card moves through (the numbers on the reusable tag). Read only.</p>
          <ol className="grid gap-2 sm:grid-cols-2">
            {STAGES.map((s, i) => (
              <li key={s} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border-2 border-foreground font-bold">{i + 1}</span>
                <span className="font-semibold text-foreground">{adminStageLabel(s)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="turnaround-h" className={panel}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="turnaround-h" className="font-heading font-black text-lg text-foreground">Tier turnaround</h2>
            <AdminLink href="/admin/store-settings" className="text-sm font-bold text-primary hover:underline min-h-11 inline-flex items-center">
              Change in Store Settings
            </AdminLink>
          </div>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            A bag&apos;s due date is the longest turnaround of its tier, in business days from the day its cards arrived, saved on the bag when it is made. Read only here.
          </p>
          {tiers.error ? (
            <p className="text-sm text-red-600">Couldn&apos;t read the tiers: {tiers.error.message}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {tierRows.map((t) => (
                <li key={t.tier} className="flex items-center justify-between gap-3 px-3 py-2 text-sm min-h-11">
                  <span className="font-semibold text-foreground">{t.display_name || tierDisplayName(t.tier)}</span>
                  <span className="text-right">
                    {t.turnaround_max_days ? (
                      <>
                        <strong>{t.turnaround_max_days}</strong> business days
                        {t.turnaround_min_days ? <span className="text-muted-foreground"> (range {t.turnaround_min_days} to {t.turnaround_max_days})</span> : null}
                      </>
                    ) : (
                      <span className="font-semibold text-amber-700">Not set: bags need a manual due date</span>
                    )}
                  </span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm min-h-11">
                <span className="font-semibold text-foreground">PSA Prep</span>
                <span className="text-right">
                  {prepDays > 0 ? (
                    <>
                      <strong>{prepDays}</strong> business days
                    </>
                  ) : (
                    <span className="font-semibold text-amber-700">Not set: prep bags need a manual due date</span>
                  )}
                </span>
              </li>
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
