import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/fetch-all";
import { codeKind, normalizeCode } from "@/lib/intake/codes";
import { resolveCode } from "@/lib/intake/data";
import { loadOrdersContext } from "@/lib/intake/tracking/context";
import { DESK_CODE, deskCardView, deskPlaces, ensureDesk, pickDesk, type DeskCardRow, type DeskOrderRow, type DeskPlace } from "@/lib/intake/tracking/desk";
import { bagSummary, byBag, bySeq } from "@/lib/intake/tracking/summaries";
import type { OpenDesk, OpenInput } from "./view";

/**
 * The reads behind the scan landing (server only; the page checks admin
 * access). The order and its cards come from the tracking library's reads
 * (lib/intake/tracking/context.ts) plus the few columns the Desk shows
 * (notes, known defects, declared value, the customer's order notes), each
 * card turned into the Desk's view (deskCardView), so where a card is reads
 * exactly as on the Scan and Desk pages. Nothing here writes, except making
 * the first desk (LOC-DESK) when there is none, as the Desk page does.
 */

export type OpenLoad =
  | { ok: true; input: OpenInput }
  | { ok: false; status: 404 }
  | { ok: false; status: 500; error: string };

const EXTRA_CARD_COLUMNS = "id, variation, notes, known_defects, estimated_value_cents";
type ExtraRow = Pick<DeskCardRow, "id" | "variation" | "notes" | "known_defects" | "estimated_value_cents">;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A Bag ID or order number and everything the page shows for it; 404 for any other code, or one nothing has. */
export async function loadOpen(admin: SupabaseClient, raw: string): Promise<OpenLoad> {
  const code = normalizeCode(raw);
  const kind = code ? codeKind(code) : null;
  if (kind !== "bag" && kind !== "order") return { ok: false, status: 404 };
  try {
    const found = await resolveCode(admin, code);
    if (!found || (found.kind !== "bag" && found.kind !== "order")) return { ok: false, status: 404 };
    const orderId = found.orderId ?? (found.kind === "order" ? found.id : null);
    if (!orderId) return { ok: false, status: 404 };

    const [ctx, extras, notes] = await Promise.all([
      loadOrdersContext(admin, [orderId]),
      fetchAll<ExtraRow>((from, to) => admin.from("cards").select(EXTRA_CARD_COLUMNS).eq("order_id", orderId).order("id").range(from, to)),
      admin.from("orders").select("id, customer_notes").eq("id", orderId).maybeSingle(),
    ]);
    if (notes.error) throw new Error(notes.error.message);
    const order = ctx.orders.get(orderId);
    if (!order) return { ok: false, status: 404 };
    if (found.kind === "bag" && !ctx.bags.has(found.id)) return { ok: false, status: 404 };

    const customerNotes = (notes.data?.customer_notes as string | null | undefined) ?? null;
    const extraById = new Map(extras.map((e) => [e.id, e]));
    const orders = new Map<string, DeskOrderRow>([[orderId, { ...order, customer_notes: customerNotes }]]);
    const cards = [...ctx.cards].sort(bySeq).map((row) => deskCardView({ ...row, ...extraById.get(row.id) }, { ...ctx, orders }, null));
    const bags = [...ctx.bags.values()].sort(byBag).map((b) => {
      const s = bagSummary(b, ctx.cards, ctx);
      return {
        id: s.id, code: s.code, tier: s.tier, tierName: s.tierName, dueDate: s.dueDate, complete: s.complete,
        cardCount: s.cardCount, doneCount: s.doneCount, location: s.location,
      };
    });
    return {
      ok: true,
      input: {
        kind: found.kind,
        code: found.code,
        bagId: found.kind === "bag" ? found.id : null,
        order: { id: order.id, orderNumber: order.order_number, customer: order.customer_name, customerNotes, status: order.status },
        bags,
        cards,
      },
    };
  } catch (e) {
    return { ok: false, status: 500, error: errText(e) };
  }
}

/** The desks cards can go to (switched on), the default one, and why there is none. */
export type DeskChoice = { desks: OpenDesk[]; defaultId: string | null; problem: string | null };

const openDesk = (d: Pick<DeskPlace, "id" | "code" | "name">): OpenDesk => ({ id: d.id, code: d.code, name: d.name });

/**
 * Every switched-on desk (LOC-DESK first) and the default (pickDesk). When
 * there is no desk at all, LOC-DESK "DESK" is made (ensureDesk, as the Desk
 * page does on its first visit; preview mode refuses the write and says so).
 * Never throws: a failed read becomes `problem`.
 */
export async function loadDeskChoice(admin: SupabaseClient, by: string | null): Promise<DeskChoice> {
  try {
    let desks: Pick<DeskPlace, "id" | "code" | "name" | "active" | "kind">[] = await deskPlaces(admin);
    if (!desks.length) {
      try {
        const { location } = await ensureDesk(admin, by);
        // Not read again with deskPlaces(): Next.js memoizes the identical read from before the insert
        if (location.kind !== "other") return { desks: [], defaultId: null, problem: `Couldn't make your desk: ${DESK_CODE} is taken by a place that isn't a desk.` };
        desks = [location];
      } catch (e) {
        return { desks: [], defaultId: null, problem: `Couldn't make your desk: ${errText(e)}` };
      }
    }
    const on = desks.filter((d) => d.active);
    return { desks: on.map(openDesk), defaultId: pickDesk(on)?.id ?? null, problem: null };
  } catch (e) {
    return { desks: [], defaultId: null, problem: `Couldn't read the desks: ${errText(e)}` };
  }
}
