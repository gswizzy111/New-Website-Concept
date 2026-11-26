import { createWorkshopUser, listWorkshopUsers } from "@/lib/workshop-users";
import { json, respond, smallBody, teamAdmin } from "./_lib/http";

export const dynamic = "force-dynamic";

/**
 * Workshop logins (the Team page; full admins only).
 *
 * GET → { workers: WorkshopUserView[] } (newest first)
 * POST { username, name? } → 201 { worker, setupUrl, expiresAt }
 *   400 { error } bad username or name; 409 { error } the username is a
 *   worker's or an admin's already. The setup link is shown this once (only
 *   its SHA-256 is kept): a lost link is a Reset (POST [id]/setup-link).
 */
export async function GET() {
  const admin = await teamAdmin();
  if ("response" in admin) return admin.response;
  return respond(await listWorkshopUsers());
}

export async function POST(request: Request) {
  const admin = await teamAdmin();
  if ("response" in admin) return admin.response;
  const body = await smallBody(request);
  if (!body) return json({ error: "Invalid request" }, 400);
  return respond(await createWorkshopUser({ username: body.username, name: body.name, by: admin.by }), 201);
}
