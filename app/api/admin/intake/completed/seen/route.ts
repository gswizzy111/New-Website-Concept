import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { markCompletedBagsSeen } from "@/lib/intake/completed";

const Body = z.object({
  // Leave out to mark every completed bag not yet seen
  bagIds: z.array(z.string().uuid()).max(500).optional(),
});

/**
 * POST { bagIds?: uuid[] } → { marked: number }
 * Dismisses the "bag completed" alert ("New" badge, nav badge) for the given
 * completed bags, or for all of them ("Mark all seen").
 */
export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    const marked = await markCompletedBagsSeen(parsed.data.bagIds);
    return Response.json({ marked });
  } catch (e) {
    console.error("[intake] mark completed bags seen failed:", e);
    return Response.json({ error: "Couldn't mark them seen. Try again." }, { status: 500 });
  }
}
