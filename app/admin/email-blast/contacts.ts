import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { isSendableAddress, normalizeEmail, undeliverableEmails, unsubscribedEmails } from "@/lib/email-unsubscribe";

/**
 * Everyone the Email Blast can reach: restoration customers, kit customers and
 * both waitlists, one entry per address. The page and the send route both use
 * this, so the count shown is the list sent to. Every read is paged (the API
 * returns at most 1,000 rows at a time).
 */

export type SkipReason = "unsubscribed" | "undeliverable" | "invalid";

export type BlastContact = {
  name: string;
  email: string;
  source: string;
  since: string;
  /** Why a blast leaves this address out; null when it gets it */
  skip: SkipReason | null;
};

type Row = { id: string; email: string | null; name: string | null; created_at: string };

/**
 * strict: throw when the unsubscribe or bounce lists can't be read (sending).
 * Otherwise (the page) those addresses are counted in and `listError` says why.
 */
export async function loadBlastContacts({ strict }: { strict: boolean }): Promise<{ contacts: BlastContact[]; listError: string | null }> {
  const admin = createAdminClient();

  const [restorationOrders, shopOrders, waitlistRows, rlWaitlist] = await Promise.all([
    fetchAll<Row>((from, to) =>
      admin.from("orders").select("id, email:customer_email, name:customer_name, created_at")
        .neq("status", "awaiting_payment")
        .order("created_at", { ascending: true }).order("id").range(from, to)
    ),
    fetchAll<Row>((from, to) =>
      admin.from("shop_orders").select("id, email:customer_email, name:customer_name, created_at")
        .order("created_at", { ascending: true }).order("id").range(from, to)
    ),
    fetchAll<Omit<Row, "name">>((from, to) =>
      admin.from("waitlist").select("id, email, created_at")
        .order("created_at", { ascending: true }).order("id").range(from, to)
    ),
    fetchAll<Row>((from, to) =>
      admin.from("restoration_waitlist").select("id, email, name, created_at")
        .order("created_at", { ascending: true }).order("id").range(from, to)
    ),
  ]);

  let unsubscribed = new Set<string>();
  let undeliverable = new Set<string>();
  let listError: string | null = null;
  try {
    [unsubscribed, undeliverable] = await Promise.all([unsubscribedEmails(), undeliverableEmails()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (strict) throw new Error(`Couldn't read the unsubscribe and bounce lists: ${message}`);
    console.error("Email blast: unsubscribe/bounce lists unreadable:", message);
    listError = message;
  }

  const map = new Map<string, BlastContact>();

  function add(row: { email: string | null; name?: string | null; created_at: string }, source: string) {
    const email = normalizeEmail(row.email);
    if (!email) return;
    const name = (row.name ?? "").trim();
    const existing = map.get(email);
    if (existing) {
      if ((existing.source === "Restoration" && source === "Kit Order") || (existing.source === "Kit Order" && source === "Restoration")) {
        existing.source = "Both";
      }
      if (!existing.name && name) existing.name = name;
      return;
    }
    map.set(email, { name, email, source, since: row.created_at, skip: null });
  }

  for (const o of restorationOrders) add(o, "Restoration");
  for (const o of shopOrders) add(o, "Kit Order");
  for (const w of waitlistRows) add(w, "Waitlist");
  for (const w of rlWaitlist) add(w, "Restoration Waitlist");

  for (const c of map.values()) {
    c.skip = unsubscribed.has(c.email)
      ? "unsubscribed"
      : undeliverable.has(c.email)
        ? "undeliverable"
        : !isSendableAddress(c.email)
          ? "invalid"
          : null;
  }

  return { contacts: Array.from(map.values()), listError };
}
