import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Email Blast sends (table email_blasts, supabase/migrations/20261027_email.sql).
 * The send route keeps each blast's progress there, not in the admin's
 * browser, so a lost reply, a closed tab or a second tab never sends a part
 * twice, and the page can pick up a send that stopped part way.
 */

export type BlastFailure = { email: string; reason: string };

export type BlastRow = {
  id: string;
  subject: string;
  body: string;
  /** The last address handled: recipients go out in address order */
  last_email: string;
  sent: number;
  failed_emails: BlastFailure[];
  /** Held while a request is sending ('epoch' when free) */
  locked_until: string;
  finished_at: string | null;
  discarded_at: string | null;
};

export const BLAST_COLUMNS = "id, subject, body, last_email, sent, failed_emails, locked_until, finished_at, discarded_at";

/** A send that stopped part way, for the page to continue. */
export type UnfinishedBlast = { id: string; subject: string; body: string; sent: number; failed: BlastFailure[] };

export function failuresOf(value: unknown): BlastFailure[] {
  return Array.isArray(value) ? (value as BlastFailure[]) : [];
}

/** The newest blast that isn't finished and wasn't set aside, if any. Throws
 * if it can't be read. */
export async function latestUnfinishedBlast(): Promise<UnfinishedBlast | null> {
  const { data, error } = await createAdminClient()
    .from("email_blasts")
    .select("id, subject, body, sent, failed_emails")
    .is("finished_at", null)
    .is("discarded_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    subject: data.subject as string,
    body: data.body as string,
    sent: (data.sent as number) ?? 0,
    failed: failuresOf(data.failed_emails),
  };
}
