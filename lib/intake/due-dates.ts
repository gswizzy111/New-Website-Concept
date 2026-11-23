import type { SupabaseClient } from "@supabase/supabase-js";
import { addBusinessDays, DEFAULT_HOLIDAYS, holidaySet, isDay, nyToday } from "@/lib/intake/business-days";
import { normalizeTier } from "@/lib/intake/codes";
import type { DueStatus, IntakeResult, TierBagRow } from "@/lib/intake/types";

/**
 * Bag due dates: the tier's MAX turnaround (restoration_settings
 * .turnaround_max_days, labelled business days in Store Settings) counted in
 * business days from the day the cards arrived. Stored on the bag with the
 * turnaround used, never silently recalculated; changed by hand only with a
 * reason (tier_bag_due_changes).
 *
 * computeDueDate is pure; the loaders take the server's Supabase admin client
 * (lib/supabase/admin.ts) so this file has no server-only imports.
 */

/** store_config key for PSA Prep's turnaround in business days (not set yet: prep bags need review). */
export const PREP_TURNAROUND_KEY = "prep_turnaround_max_days";

export type DueDateResult = {
  due_date: string | null;
  due_status: DueStatus;
  turnaround_days: number | null;
};

/**
 * A bag's due date and status:
 * - no received day: due null, 'missing_received_date'
 * - no turnaround for the tier: due null, 'needs_review'
 * - historical (Historical Order Setup; past settings unknown): the date, 'needs_review'
 * - otherwise: the date, 'calculated'
 */
export function computeDueDate(input: {
  receivedOn: string | null;
  turnaroundDays: number | null;
  holidays: ReadonlySet<string>;
  historical?: boolean;
}): DueDateResult {
  const { receivedOn, turnaroundDays, holidays, historical = false } = input;
  const turnaround = turnaroundDays != null && Number.isInteger(turnaroundDays) && turnaroundDays >= 0 ? turnaroundDays : null;
  if (!receivedOn || !isDay(receivedOn)) return { due_date: null, due_status: "missing_received_date", turnaround_days: turnaround };
  if (turnaround == null) return { due_date: null, due_status: "needs_review", turnaround_days: null };
  return {
    due_date: addBusinessDays(receivedOn, turnaround, holidays),
    due_status: historical ? "needs_review" : "calculated",
    turnaround_days: turnaround,
  };
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Every tier's max turnaround right now: restoration_settings rows, plus
 * 'prep' from store_config[PREP_TURNAROUND_KEY] when set. A tier missing
 * here has no turnaround (its bags need review).
 */
export async function loadTurnarounds(admin: SupabaseClient): Promise<Record<string, number | null>> {
  const [{ data: tiers, error }, { data: prep }] = await Promise.all([
    admin.from("restoration_settings").select("tier, turnaround_max_days"),
    admin.from("store_config").select("value").eq("key", PREP_TURNAROUND_KEY).maybeSingle(),
  ]);
  if (error) throw new Error(`Couldn't read the tier turnarounds: ${error.message}`);
  const out: Record<string, number | null> = {};
  for (const row of tiers ?? []) {
    const tier = normalizeTier(row.tier as string);
    if (tier) out[tier] = positiveInt(row.turnaround_max_days);
  }
  out.prep = positiveInt(prep?.value);
  return out;
}

/** One tier's max turnaround in business days, or null (no setting: the bag needs review). */
export async function turnaroundFor(admin: SupabaseClient, tier: string | null | undefined): Promise<number | null> {
  const t = normalizeTier(tier);
  if (!t) return null;
  return (await loadTurnarounds(admin))[t] ?? null;
}

/** The business_holidays rows, by day. Falls back to the seeded list if the table can't be read. */
export async function loadHolidayRows(admin: SupabaseClient): Promise<{ day: string; name: string }[]> {
  const { data, error } = await admin.from("business_holidays").select("day, name").order("day");
  if (error) {
    console.warn("[intake] business_holidays unavailable, using the built-in list:", error.message);
    return [...DEFAULT_HOLIDAYS];
  }
  return (data ?? []) as { day: string; name: string }[];
}

/** Holiday days as a Set for addBusinessDays / computeDueDate. */
export async function loadHolidays(admin: SupabaseClient): Promise<Set<string>> {
  return holidaySet(await loadHolidayRows(admin));
}

export const BAG_COLUMNS =
  "id, order_id, tier, batch, bag_code, received_on, due_date, due_status, turnaround_days, due_note, completed_at, completion_seen_at, label_printed_at, source, created_at, created_by";

/**
 * Change a bag's due date by hand (authorized admins only; check before
 * calling). Needs a reason; writes the tier_bag_due_changes row and marks the
 * bag 'manual'. The same date with a reason also works ("reviewed, keep it").
 */
export async function changeBagDueDate(
  admin: SupabaseClient,
  input: { bagId: string; newDue: string; reason: string; by: string | null },
): Promise<IntakeResult<{ bag: TierBagRow }>> {
  const reason = (input.reason ?? "").trim();
  if (!reason) return { ok: false, status: 400, error: "Give a reason for the new due date." };
  if (reason.length > 500) return { ok: false, status: 400, error: "Keep the reason under 500 characters." };
  if (!isDay(input.newDue)) return { ok: false, status: 400, error: "Pick a valid due date." };

  const { data: bag, error: readErr } = await admin.from("tier_bags").select(BAG_COLUMNS).eq("id", input.bagId).maybeSingle();
  if (readErr) return { ok: false, status: 500, error: `Couldn't read the bag: ${readErr.message}` };
  if (!bag) return { ok: false, status: 404, error: "Bag not found" };

  const { data: updated, error: updErr } = await admin.from("tier_bags")
    .update({ due_date: input.newDue, due_status: "manual", due_note: reason })
    .eq("id", input.bagId)
    .select(BAG_COLUMNS)
    .single();
  if (updErr || !updated) return { ok: false, status: 500, error: `Couldn't save the due date: ${updErr?.message ?? "no row"}` };

  const { error: logErr } = await admin.from("tier_bag_due_changes").insert({
    bag_id: input.bagId, old_due: bag.due_date, new_due: input.newDue, reason, changed_by: input.by,
  });
  if (logErr) {
    // No change without its record: put the bag back
    await admin.from("tier_bags")
      .update({ due_date: bag.due_date, due_status: bag.due_status, due_note: bag.due_note })
      .eq("id", input.bagId);
    return { ok: false, status: 500, error: `Couldn't record the change, so nothing was changed: ${logErr.message}` };
  }
  return { ok: true, bag: updated as TierBagRow };
}

/** Midday in New York on `day` (17:00 UTC: 12:00 EST, 13:00 EDT), so it reads as that day everywhere. */
export const receiptTimeFor = (day: string) => `${day}T17:00:00.000Z`;

/**
 * The bag's cards with no received_at get one on `day` (or when the card was
 * added, if later). Best effort: the bag's date is already saved.
 */
async function fillCardReceipts(admin: SupabaseClient, bagId: string, day: string, by: string | null): Promise<void> {
  const { data: cards, error } = await admin.from("cards").select("id, created_at").eq("bag_id", bagId).is("received_at", null);
  if (error) {
    console.error("[intake] bag cards' receipts not filled:", error.message);
    return;
  }
  const at = receiptTimeFor(day);
  const onDay = (cards ?? []).filter((c) => !(Date.parse(c.created_at as string) > Date.parse(at))).map((c) => c.id as string);
  const later = (cards ?? []).filter((c) => Date.parse(c.created_at as string) > Date.parse(at));
  const writes = [
    ...(onDay.length ? [admin.from("cards").update({ received_at: at, received_by: by }).in("id", onDay).is("received_at", null)] : []),
    ...later.map((c) => admin.from("cards").update({ received_at: c.created_at, received_by: by }).eq("id", c.id).is("received_at", null)),
  ];
  for (const r of await Promise.all(writes)) if (r.error) console.error("[intake] bag card receipt not filled:", r.error.message);
}

/**
 * Set or correct the day a bag's cards arrived, then work its due date out
 * the same way receiving does (Historical Order Setup bags stay
 * 'needs_review': past turnaround settings are unknown). A manual due date
 * is kept. A due date that changes is logged in tier_bag_due_changes. Cards of
 * the bag with no receipt record (a historical bag) get one for that day
 * (never before the card was added to the order), so they read as received.
 */
export async function setBagReceivedOn(
  admin: SupabaseClient,
  input: { bagId: string; receivedOn: string; by: string | null; holidays?: ReadonlySet<string> },
): Promise<IntakeResult<{ bag: TierBagRow }>> {
  if (!isDay(input.receivedOn)) return { ok: false, status: 400, error: "Pick a valid received date." };
  if (input.receivedOn > nyToday()) return { ok: false, status: 400, error: "The received date can't be in the future." };

  const { data: bag, error: readErr } = await admin.from("tier_bags").select(BAG_COLUMNS).eq("id", input.bagId).maybeSingle();
  if (readErr) return { ok: false, status: 500, error: `Couldn't read the bag: ${readErr.message}` };
  if (!bag) return { ok: false, status: 404, error: "Bag not found" };

  const patch: Partial<TierBagRow> = { received_on: input.receivedOn };
  if (bag.due_status !== "manual") {
    const turnaround = bag.turnaround_days ?? (await turnaroundFor(admin, bag.tier));
    const holidays = input.holidays ?? (await loadHolidays(admin));
    const due = computeDueDate({ receivedOn: input.receivedOn, turnaroundDays: turnaround, holidays, historical: bag.source === "migration" });
    Object.assign(patch, due);
  }

  const { data: updated, error: updErr } = await admin.from("tier_bags").update(patch).eq("id", input.bagId).select(BAG_COLUMNS).single();
  if (updErr || !updated) return { ok: false, status: 500, error: `Couldn't save the received date: ${updErr?.message ?? "no row"}` };

  if (patch.due_date !== undefined && patch.due_date !== bag.due_date) {
    const { error: logErr } = await admin.from("tier_bag_due_changes").insert({
      bag_id: input.bagId, old_due: bag.due_date, new_due: patch.due_date,
      reason: `Received date set to ${input.receivedOn}`, changed_by: input.by,
    });
    if (logErr) console.error("[intake] due change not logged:", logErr.message);
  }
  await fillCardReceipts(admin, input.bagId, input.receivedOn, input.by);
  return { ok: true, bag: updated as TierBagRow };
}
