import { z } from "zod";
import { isAdmin, getAdminSession } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { STAGES } from "@/lib/restoration-stages";
import { advanceCards } from "@/lib/intake/stages";

const Stage = z.enum(STAGES);

const Body = z
  .object({
    orderId: z.string().uuid(),
    cardIds: z.array(z.string().uuid()).min(1).max(500),
    // Where the cards are now, as the page showed it (null = not started). Only
    // cards still there move, so two people tapping at once never clobber
    // each other: one step for all (`fromStage`), or one per card (`fromStages`).
    fromStage: Stage.nullable().optional(),
    fromStages: z.record(z.string().uuid(), Stage.nullable()).optional(),
    // Any of the 8 steps, earlier or later than now, or "done". Left out: the
    // step after `fromStage` (the old one-tap advance).
    toStage: z.union([Stage, z.literal("done")]).optional(),
  })
  .refine((b) => b.fromStage !== undefined || (b.fromStages !== undefined && b.toStage !== undefined), {
    message: "Say which step the cards are at now",
  });

/**
 * POST { orderId, cardIds, toStage?, fromStage?, fromStages? }
 *   toStage: one of STAGES or "done"; fromStage: string | null (every card);
 *   fromStages: { [cardId]: string | null } (per card, wins over fromStage).
 *   Old shape, still accepted: { orderId, cardIds, fromStage } = one step on.
 *   → { moved: string[], completed: string[], newStep: string[],
 *       skipped: { cardId, reason, current }[], target: { kind, stage?, label },
 *       emailed: boolean, bagsCompleted: string[], orderCompletion?, bagPlaces? }
 * Puts the cards at the chosen step, in any order (skip ahead, go back), or
 * marks them done, the way the order page's stage buttons record it. Cards
 * whose step changed meanwhile are skipped and listed (reason
 * "different_stage"), never changed; cards already there are skipped as
 * "already_there", so sending it again changes nothing. One customer email
 * lists the cards at a step new to the customer (`newStep`: past the
 * furthest step they reached this round); going back or re-entering a step
 * sends none, and no step email for done (the order's last card done
 * completes the order, with its completed email, below). Bags whose cards are all done become
 * completed. When cards were marked done, `orderCompletion` is the order
 * auto-complete check (lib/intake/order-autocomplete.ts): the order's last
 * card done makes the order Completed with the customer's usual email
 * (`completed`, `emailed`, `message`). Cards marked done go back in their
 * bag (out of any holder or desk); `bagPlaces` (TrackBagPlace[]) says where
 * each bag is, for "Put it back in REYES's bag: Open bags box, under R."
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { orderId, cardIds, fromStage, fromStages, toStage } = parsed.data;

  const by = (await getAdminSession())?.username ?? null;
  const result = await advanceCards(createAdminClient(), {
    orderId,
    cardIds,
    fromStage,
    fromStages,
    toStage: toStage === "done" ? "complete" : toStage,
    by,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  return Response.json({
    moved: [...result.moved.map((m) => m.cardId), ...result.completed],
    completed: result.completed,
    newStep: result.moved.filter((m) => m.email).map((m) => m.cardId),
    skipped: result.skipped,
    target: result.target,
    emailed: result.emailed,
    bagsCompleted: result.bagsCompleted,
    ...(result.orderCompletion ? { orderCompletion: result.orderCompletion } : {}),
    ...(result.bagPlaces ? { bagPlaces: result.bagPlaces } : {}),
  });
}
