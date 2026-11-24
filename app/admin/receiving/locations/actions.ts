"use server";

import { isAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { addCalendarDays, isBusinessDay, nyToday } from "@/lib/intake/business-days";
import { loadHolidays } from "@/lib/intake/due-dates";
import { ensureShelfSlot } from "@/lib/intake/tracking/shelf";

export type PreparedSlot = { id: string; code: string; name: string; dueDate: string };

/**
 * The shelf slots of the next `days` business days (today first when it is
 * one; weekends and business_holidays skipped), made where missing with
 * ensureShelfSlot, so their signs can be printed ahead. Full admins only.
 */
export async function prepareShelfSlots(days = 10): Promise<{ ok: true; slots: PreparedSlot[] } | { ok: false; error: string }> {
  if (!(await isAdmin())) return { ok: false, error: "Sign in again to print signs." };
  const n = Math.min(30, Math.max(1, Math.floor(Number(days)) || 10));
  const admin = createAdminClient();
  const holidays = await loadHolidays(admin);
  const dates: string[] = [];
  for (let day = nyToday(); dates.length < n; day = addCalendarDays(day, 1)) {
    if (isBusinessDay(day, holidays)) dates.push(day);
  }
  const slots: PreparedSlot[] = [];
  try {
    for (const day of dates) {
      const made = (await ensureShelfSlot(admin, day)) as unknown;
      const row = (made && typeof made === "object" && "location" in made ? (made as { location: unknown }).location : made) as
        | { id?: unknown; code?: unknown; name?: unknown }
        | null;
      if (!row || typeof row.id !== "string") throw new Error(`The shelf slot for ${day} couldn't be made.`);
      slots.push({ id: row.id, code: String(row.code), name: String(row.name), dueDate: day });
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, slots };
}
