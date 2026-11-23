import { z } from "zod";
import { isAdmin, getAdminSession } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { STAGES } from "@/lib/restoration-stages";
import { advanceCards } from "@/lib/intake/stages";

const Body = z.object({
  orderId: z.string().uuid(),
  cardIds: z.array(z.string().uuid()).min(1).max(500),
  // The step the cards are at now; null = not started. Only cards still there move.
  fromStage: z.enum(STAGES).nullable(),
});

/**
 * POST { orderId, cardIds, fromStage: string | null }
 *   → { moved: string[], completed: string[], skipped: { cardId, reason, current }[],
 *       target: { kind, stage?, label }, emailed: boolean, bagsCompleted: string[] }
 * Moves the cards that are at `fromStage` one step on (from Final Dry: marks
 * them done), the way the order page's stage buttons record it, with one
 * customer email for the move. Cards at any other step are skipped and
 * listed, never changed. Bags whose cards are all done become completed.
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { orderId, cardIds, fromStage } = parsed.data;

  const by = (await getAdminSession())?.username ?? null;
  const result = await advanceCards(createAdminClient(), { orderId, cardIds, fromStage, by });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({
    moved: [...result.moved.map((m) => m.cardId), ...result.completed],
    completed: result.completed,
    skipped: result.skipped,
    target: result.target,
    emailed: result.emailed,
    bagsCompleted: result.bagsCompleted,
  });
}
