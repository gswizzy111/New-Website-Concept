import { z } from "zod";
import { isAdmin } from "@/lib/admin-auth";
import { markCompletedBagsSeen } from "@/lib/intake/completed";

/**
 * POST → { marked: 0 | 1 }
 * Dismisses one completed bag's "New" alert.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Bag not found" }, { status: 404 });
  try {
    const marked = await markCompletedBagsSeen([id]);
    return Response.json({ marked });
  } catch (e) {
    console.error("[intake] mark bag seen failed:", e);
    return Response.json({ error: "Couldn't mark it seen. Try again." }, { status: 500 });
  }
}
