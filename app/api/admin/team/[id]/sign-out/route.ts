import { signOutWorkshopUserEverywhere } from "@/lib/workshop-users";
import { UUID, json, respond, teamAdmin } from "../../_lib/http";

export const dynamic = "force-dynamic";

/**
 * POST → { worker, endedSessions } (full admins only)
 * Signs the worker out on every device: deletes all their sessions. Their
 * password still works, so they can sign in again (Reset or turning them off
 * stops that). 404 { error } unknown worker.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await teamAdmin();
  if ("response" in admin) return admin.response;
  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "That worker wasn't found." }, 404);
  return respond(await signOutWorkshopUserEverywhere(id));
}
