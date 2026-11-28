/** Shared helpers for the SMS tables (pure). */

/** "relation does not exist": the SMS migration isn't applied yet. */
export function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42883" || error.code === "PGRST202") return true;
  const m = error.message ?? "";
  return /relation .* does not exist|Could not find the table|Could not find the function/i.test(m);
}
