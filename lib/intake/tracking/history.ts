import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { codeKind, normalizeCode } from "@/lib/intake/codes";
import { resolveCode } from "@/lib/intake/data";
import type { IntakeResult } from "@/lib/intake/types";
import { chunks, loadLocationRefs } from "@/lib/intake/tracking/context";
import { moveStageLabel } from "@/lib/intake/tracking/places";
import type { CardMoveRow, HistoryResponse, TrackMove } from "@/lib/intake/tracking/types";

/** Where cards have been (card_moves), newest first. Server only; admin access is checked by the route. */

export const HISTORY_LIMIT = 50;
const MOVE_COLUMNS = "id, card_id, order_id, bag_id, from_location_id, to_location_id, stage_before, stage_after, action, by, session_id, created_at";

/**
 * GET /api/admin/track/history?code=: the last 50 moves of a card (Card ID),
 * a bag (its cards), an order, or a slot (cards that went in or out).
 */
export async function loadHistory(admin: SupabaseClient, raw: string): Promise<IntakeResult<{ response: HistoryResponse }>> {
  const code = normalizeCode(raw);
  const kind = code ? codeKind(code) : null;
  if (!kind) return { ok: false, status: 400, error: "That isn't a slot, bag, order or card code." };
  try {
    const found = await resolveCode(admin, code);
    if (!found) return { ok: false, status: 404, error: `Nothing has the code ${code}.` };
    let q = admin.from("card_moves").select(MOVE_COLUMNS);
    if (found.kind === "card") q = q.eq("card_id", found.id);
    else if (found.kind === "order") q = q.eq("order_id", found.id);
    else if (found.kind === "location") q = q.or(`to_location_id.eq.${found.id},from_location_id.eq.${found.id}`);
    else {
      const { data, error } = await admin.from("cards").select("id").eq("bag_id", found.id);
      if (error) throw new Error(error.message);
      const ids = (data ?? []).map((r) => r.id as string);
      q = ids.length ? q.in("card_id", ids.slice(0, 500)) : q.eq("bag_id", found.id);
    }
    const { data: rows, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(HISTORY_LIMIT);
    if (error) throw new Error(error.message);
    const moves = (rows ?? []) as CardMoveRow[];
    const cardIds = [...new Set(moves.map((m) => m.card_id))];
    const [locations, cards] = await Promise.all([
      moves.length ? loadLocationRefs(admin) : Promise.resolve(new Map()),
      Promise.all(chunks(cardIds).map(async (part) => {
        const { data, error: cErr } = await admin.from("cards").select("id, card_code, card_name").in("id", part);
        if (cErr) throw new Error(cErr.message);
        return (data ?? []) as { id: string; card_code: string | null; card_name: string | null }[];
      })).then((p) => p.flat()),
    ]);
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const view: TrackMove[] = moves.map((m) => ({
      id: m.id,
      at: m.created_at,
      by: m.by,
      action: m.action,
      cardId: m.card_id,
      cardCode: cardById.get(m.card_id)?.card_code ?? null,
      cardName: cardById.get(m.card_id)?.card_name ?? null,
      bagId: m.bag_id,
      from: m.from_location_id ? locations.get(m.from_location_id) ?? null : null,
      to: m.to_location_id ? locations.get(m.to_location_id) ?? null : null,
      stageBefore: m.stage_before,
      stageAfter: m.stage_after,
      stageBeforeLabel: moveStageLabel(m.stage_before),
      stageAfterLabel: moveStageLabel(m.stage_after),
    }));
    return { ok: true, response: { kind: found.kind, code, moves: view } };
  } catch (e) {
    return { ok: false, status: 500, error: `Couldn't read the history. (${e instanceof Error ? e.message : String(e)})` };
  }
}
