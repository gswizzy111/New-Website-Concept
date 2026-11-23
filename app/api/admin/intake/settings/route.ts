import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDay } from "@/lib/intake/business-days";
import { getLabelSettings } from "@/lib/intake/labels/data";
import { CONTENT_WIDTH_CONFIG_KEY, LABEL_STOCKS, MIN_CONTENT_WIDTH_IN, STOCK_CONFIG_KEY } from "@/lib/intake/labels/stock";

// Receiving settings: the label stock and print width (store_config) and the
// business holidays (business_holidays). Holiday changes only affect due
// dates computed afterwards; saved due dates never change.

const NO_STORE = { "Cache-Control": "private, no-store" };

const Body = z
  .object({
    labels: z
      .object({
        stock: z.enum(Object.keys(LABEL_STOCKS) as [keyof typeof LABEL_STOCKS, ...(keyof typeof LABEL_STOCKS)[]]),
        contentWidthIn: z.number().min(MIN_CONTENT_WIDTH_IN).max(8),
      })
      .refine((l) => l.contentWidthIn <= LABEL_STOCKS[l.stock].widthIn, {
        message: "The print width can't be wider than the label.",
      })
      .optional(),
    addHoliday: z.object({ day: z.string().refine(isDay, "Pick a date."), name: z.string().trim().min(1).max(80) }).optional(),
    removeHoliday: z.object({ day: z.string().refine(isDay, "Pick a date.") }).optional(),
  })
  .refine((b) => b.labels || b.addHoliday || b.removeHoliday, { message: "Nothing to change." });

async function state(admin: SupabaseClient) {
  const [labels, holidays] = await Promise.all([
    getLabelSettings(admin),
    admin.from("business_holidays").select("day, name").order("day"),
  ]);
  return {
    labels,
    holidays: (holidays.data ?? []) as { day: string; name: string }[],
    holidaysError: holidays.error ? holidays.error.message : null,
  };
}

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await state(createAdminClient()), { headers: NO_STORE });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." }, { status: 400 });
  }
  const { labels, addHoliday, removeHoliday } = parsed.data;
  const admin = createAdminClient();

  if (labels) {
    const updated_at = new Date().toISOString();
    const { error } = await admin.from("store_config").upsert(
      [
        { key: STOCK_CONFIG_KEY, value: labels.stock, updated_at },
        { key: CONTENT_WIDTH_CONFIG_KEY, value: String(Math.round(labels.contentWidthIn * 100) / 100), updated_at },
      ],
      { onConflict: "key" },
    );
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }
  if (addHoliday) {
    const { error } = await admin.from("business_holidays").upsert(addHoliday, { onConflict: "day" });
    if (error) return Response.json({ error: `Couldn't save the holiday: ${error.message}` }, { status: 500 });
  }
  if (removeHoliday) {
    const { error } = await admin.from("business_holidays").delete().eq("day", removeHoliday.day);
    if (error) return Response.json({ error: `Couldn't remove the holiday: ${error.message}` }, { status: 500 });
  }
  return Response.json(await state(admin), { headers: NO_STORE });
}
