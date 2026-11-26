import { renameWorkshopUser, setWorkshopUserActive } from "@/lib/workshop-users";
import { UUID, json, respond, smallBody, teamAdmin } from "../_lib/http";

export const dynamic = "force-dynamic";

/**
 * PATCH { active?: boolean, name?: string | null } → { worker, endedSessions }
 * Turns a worker off (they can't sign in and every session of theirs ends)
 * or back on, and/or changes their display name. Full admins only.
 * 400 { error } bad body; 404 { error } unknown worker.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await teamAdmin();
  if ("response" in admin) return admin.response;
  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "That worker wasn't found." }, 404);
  const body = await smallBody(request);
  if (!body) return json({ error: "Invalid request" }, 400);
  const hasActive = "active" in body;
  const hasName = "name" in body;
  if (!hasActive && !hasName) return json({ error: "Nothing to change." }, 400);
  if (hasActive && typeof body.active !== "boolean") return json({ error: "active must be true or false." }, 400);

  let endedSessions = 0;
  let worker: unknown = null;
  if (hasName) {
    const renamed = await renameWorkshopUser(id, body.name);
    if (!renamed.ok) return respond(renamed);
    worker = renamed.worker;
  }
  if (hasActive) {
    const switched = await setWorkshopUserActive(id, body.active as boolean);
    if (!switched.ok) return respond(switched);
    worker = switched.worker;
    endedSessions = switched.endedSessions;
  }
  return json({ worker, endedSessions });
}
