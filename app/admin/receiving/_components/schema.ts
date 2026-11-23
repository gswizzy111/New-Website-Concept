/**
 * True when a Supabase error says a table or column of the intake update
 * (supabase/migrations/20261123_intake_tracking.sql) isn't in the database
 * yet, so the receiving pages can explain that instead of failing.
 */
export function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (["42703", "42P01", "PGRST200", "PGRST204", "PGRST205"].includes(error.code ?? "")) return true;
  return /(tier_bags|card_code|card_seq|bag_id|received_at|awaiting_arrival|receiving_photo_urls|label_printed_at|business_holidays)/.test(error.message ?? "")
    && /(does not exist|could not find|schema cache)/i.test(error.message ?? "");
}

export const MIGRATION_NOTICE =
  "The intake database update (supabase/migrations/20261123_intake_tracking.sql) isn't applied yet, so receiving, Card IDs and bags can't be saved. Order search still works.";
